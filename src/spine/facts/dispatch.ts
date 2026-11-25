// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/** Dispatch: one variant's identity and facts -> the drawings P1 makes of it.
 *
 *  The rules are the design's, written once here instead of in documents: dispatch by
 *  grammar (A-F), the pLDDT gate, F1's 50-letter rule, the grid's rows E1-E12, and the
 *  bridge decisions.
 *
 *  A drawing that P1 does not have yet is never faked: it is either a STAND-IN
 *  (the nearest built drawing, with `standIn` saying what it can't show) or
 *  PENDING (listed, not drawn). Browser-portable. */

import { NMD_LETTERS, PLDDT_SOLID } from "../../contracts/constants.ts";
import type { Identity } from "../../contracts/types.ts";
import { trim, translate, applyToOrf, type GeneModel, type RefGetter } from "./model.ts";
import {
  locusOf,
  junctionOf,
  edgeJunction,
  edgeLetter,
  signalOf,
  SIGNAL,
  transcriptRecord,
  junctionFacts,
  slideAway,
  type TranscriptRecord,
} from "./transcript.ts";
import { codonFacts, type CodonFacts } from "./codon.ts";
import {
  foldFacts,
  chainFacts,
  runFacts,
  o4Of,
  type Fold,
  type FoldFacts,
  type ChainFacts,
  type ChainReason,
} from "./fold.ts";

export type Lane = "codon" | "transcript" | "chain" | "portrait";

/** the renderer's CodonSpecimen: codon facts plus the record's labels */
export type CodonRecord = CodonFacts & {
  /** the protein's length in amino acids (the stage caption's "OF N") */
  residues: number;
  id: string;
  gene: string;
  variant: string;
  clinvar: string;
  transcript: string;
  reviewStatus: string;
  reviewStars: number;
  consequence: string;
};
export type FoldRecord = FoldFacts & {
  id: string;
  length?: number;
  removed?: number;
  added?: number;
  extension?: number;
};
export type ChainRecord = ChainFacts & { id: string };
export type TranscriptRec = TranscriptRecord & {
  id: string;
  gene: string;
  variant: string;
  clinvar: string;
  transcript: string;
  reviewStatus: string;
  reviewStars: number;
  consequence: string;
};

export interface Drawing {
  lane: Lane;
  /** the built cell whose drawing this takes (a state name in that lane) */
  kind: string;
  beats?: string[];
  codon?: CodonRecord;
  fold?: FoldRecord;
  chain?: ChainRecord;
  transcript?: TranscriptRec;
  /** why this lane and kind, in a sentence */
  why: string;
  /** set when the drawing is the nearest built one and cannot show everything */
  standIn?: string;
  /** WHAT FOLLOWS, when no protein is made: the message is destroyed (the NMD rule)
   *  or reading never meets a stop. It was a second, empty drawing (portrait absent) repeating
   *  what the codon room's last line says; now the codon drawing carries the fact. */
  fate?: "destroyed" | "no-stop";
}

export interface VariantFacts {
  id: string;
  gene: string;
  transcript: string;
  hgvs_c: string;
  hgvs_p: string;
  consequence: string;
  row: string;
  rowName: string;
  drawings: Drawing[];
  /** drawings the design calls for that stage 1 doesn't make yet */
  pending: string[];
  notes: string[];
  plen: number;
  pieces: number;
  /** ClinVar's class for the variant, on every record: copy that says an effect
   *  "isn't known" shows only where ClinVar leaves it open (the claims audit) */
  clinvar: { clnsig: string; stars: number };
}

export interface ClinvarInfo {
  variation_id: number | null;
  stars: number | null;
  clnsig: string | null;
}
export interface FoldSource {
  fold: Fold | null;
  why: string;
  reason?: ChainReason;
  sitesChecked?: boolean;
  sites?: { kind: string; start: number; end: number; partner: string }[];
}

const CODON_BEATS: Record<string, string[]> = {
  frameshift: ["establish", "delete", "regroup", "misread", "reveal-stop", "settle"],
  "frameshift-ins": ["establish", "intrude", "regroup", "misread", "reveal-stop", "settle"],
};

/** F1, the 50-letter rule, from the gene's own pieces. */
export function fate(m: GeneModel, stopCodon: number): { destroyed: boolean; why: string } {
  if (m.lastJunctionC == null) return { destroyed: false, why: "escapes: a one-exon gene has no join after the stop" };
  const stopEnd = stopCodon * 3;
  const gap = m.lastJunctionC - stopEnd;
  if (gap < 0) return { destroyed: false, why: "escapes: the stop is in the last exon" };
  if (gap <= NMD_LETTERS)
    return {
      destroyed: false,
      why: `escapes: the stop is ${gap} letters before the last join (${NMD_LETTERS} or fewer)`,
    };
  return {
    destroyed: true,
    why: `destroyed: the stop is ${gap} letters before the last join (more than ${NMD_LETTERS})`,
  };
}

function siteOf(hgvsP: string): number | null {
  const m = /^p\.[A-Z][a-z]{2}(\d+)/.exec(hgvsP);
  return m ? +m[1] : null;
}

/** Portrait if the fold is placeable at the site, else the chain register. */
function proteinDrawing(
  id: string,
  m: GeneModel,
  src: FoldSource,
  site: number,
  kind: string,
  standIn?: string,
  extra: Partial<FoldRecord> = {},
  sites: number[] = [site],
): Drawing {
  const length = m.protein.length;
  if (src.fold) {
    // a run (E2) is placeable when every residue in it is
    const conf = Math.min(...sites.map((r) => src.fold!.residues[r - 1]?.plddt ?? 0));
    const f = sites.length > 1 ? runFacts(src.fold, sites) : foldFacts(src.fold, site);
    if (conf >= PLDDT_SOLID && f.planeHolds) {
      const o4 =
        kind === "substitution-contacts"
          ? { o4: { ...o4Of(src.fold, sites, src.sites ?? []), checked: !!src.sitesChecked } }
          : {};
      return {
        lane: "portrait",
        kind,
        fold: { ...f, ...extra, ...o4, length: src.fold.residues.length, id },
        why: `AlphaFold is confident at residue ${site} (pLDDT ${conf.toFixed(1)}, ${PLDDT_SOLID} or more), so the fold.`,
        ...(standIn ? { standIn } : {}),
      };
    }
    const reason =
      conf < PLDDT_SOLID
        ? `AlphaFold is not confident at residue ${site} (pLDDT ${conf.toFixed(1)}, under ${PLDDT_SOLID})`
        : `the window's plane keeps only ${Math.round((f.evr[0] + f.evr[1]) * 100)}% of its shape`;
    return {
      lane: "chain",
      kind: "local-failure",
      chain: {
        ...chainFacts(src.fold, m.symbol, length, site, "", conf < PLDDT_SOLID ? "low-confidence" : "no-flat-view"),
        id,
      },
      why: `${reason}, so the chain register.`,
    };
  }
  return {
    lane: "chain",
    kind: "local-failure",
    chain: { ...chainFacts(null, m.symbol, length, site, src.why, src.reason ?? "not-fetched"), id },
    why: `No structure to place it on (${src.why}), so the chain register, unmapped.`,
  };
}

/** F1's late branch: the protein is made up to `lastMade`. The fold when
 *  AlphaFold is confident there (the never-made part turns to unread outlines), the chain
 *  otherwise. `misread` is how many residues after `lastMade` are made in the wrong frame
 *  (a frameshift's run to its stop): not the reference's, so not drawn on its structure. */
/** A RUN-ON WITH NO CONFIDENT FOLD AT ITS END draws on the chain, its run-on drawn as the fold
 *  draws one (residues that fit, then a dotted line; not to scale): the same portrait drawing (beats and all), handed the chain record. */
function runOn(d: Drawing, ext: number): Drawing {
  if (d.lane !== "chain" || !d.chain) return d;
  return {
    lane: "portrait",
    kind: "stop-loss-extension",
    chain: { ...d.chain, extension: ext } as ChainRecord,
    why: d.why.replace(
      /, so the chain register(, unmapped)?\.$/,
      ", so the chain, with the run-on drawn as the fold draws it.",
    ),
  };
}

/** A change that keeps every amino acid and is not one swapped letter (several letters at once,
 *  or whole codons leaving or arriving at the stop): the silent drawing swaps one letter. */
const NOT_ONE_LETTER = "the protein is unchanged, by more than one swapped letter: no drawing built";
const UNREAD =
  "the reference ran out before a stop was read (the data stage ships the whole 3′ UTR, so this is a gap in it)";
/** F1, read to the end of the message (the whole 3′ UTR shipped): no stop anywhere
 *  in it means no protein; a reference that ran out first is a gap, said as one. */
function noStop(m: GeneModel, out: VariantFacts, what: string): void {
  if (m.tailComplete) {
    out.notes.push(`F1: ${what} runs to the end of the message without a stop, so no protein.`);
    out.drawings[out.drawings.length - 1].fate = "no-stop";
  } else out.pending.push(`portrait: ${UNREAD}`);
}

function lateStop(id: string, m: GeneModel, src: FoldSource, gene: string, lastMade: number, misread = 0): Drawing {
  const end = lastMade + misread;
  const tail = misread ? `, the last ${misread} read in the wrong frame` : "";
  let why: ChainReason = src.reason ?? "not-fetched";
  if (src.fold && lastMade >= 1) {
    const stopRes = Math.min(lastMade + 1, src.fold.residues.length);
    const conf = src.fold.residues[lastMade - 1]?.plddt ?? 0;
    const f = foldFacts(src.fold, stopRes);
    why = conf < PLDDT_SOLID ? "low-confidence" : "no-flat-view";
    if (conf >= PLDDT_SOLID && f.planeHolds) {
      return {
        lane: "portrait",
        kind: "truncated-fold",
        fold: { ...f, length: src.fold.residues.length, id },
        beats: ["establish", "locate", "identify", "truncate", "settle"],
        why: `The message escapes, so a protein of ${end} residues is made${tail}. AlphaFold is confident where it ends (pLDDT ${conf.toFixed(1)}), so the fold: what is made stays; from residue ${lastMade + 1} on, the reference's residues turn to unread outlines.`,
      };
    }
  }
  return {
    lane: "portrait",
    kind: "truncated",
    chain: { ...chainFacts(src.fold, gene, m.protein.length, lastMade, src.why, why, lastMade), id },
    why: `The message escapes, so a protein of ${end} residues is made${tail}. ${src.fold ? "AlphaFold is not confident where it ends" : "There is no structure"}, so the chain.`,
  };
}

/** A copy-number record's count: the gene's copies after the change and before it, and whether the whole coding sequence is in it. */
export interface CopyNumber {
  copies: number;
  from: number;
  whole: boolean;
}

export function dispatch(
  i: Identity,
  m: GeneModel,
  cv: ClinvarInfo,
  src: FoldSource,
  id: string,
  ref: RefGetter,
  copyNumber?: CopyNumber,
): VariantFacts {
  const hgvsP = typeof i.hgvs_p === "string" ? i.hgvs_p : "";
  const [, p, r, a] = i.normalized_key.split(":");
  const edit = trim(+p, r, a);
  const ee = typeof i.exon_edge === "number" ? i.exon_edge : null;
  const out: VariantFacts = {
    id,
    gene: i.gene,
    transcript: i.transcript,
    hgvs_c: i.hgvs_c,
    hgvs_p: hgvsP,
    consequence: i.consequence,
    row: "?",
    rowName: "Not routed",
    drawings: [],
    pending: [],
    notes: [],
    plen: m.protein.length,
    pieces: m.pieces.length,
    clinvar: { clnsig: cv.clnsig ?? "not in ClinVar", stars: cv.stars ?? 0 },
  };
  const label = (cf: CodonFacts): CodonRecord => ({
    ...cf,
    residues: m.protein.length,
    id,
    gene: i.gene,
    variant: i.hgvs_c,
    clinvar: cv.variation_id ? `VCV${String(cv.variation_id).padStart(9, "0")}` : "—",
    transcript: i.transcript,
    reviewStatus: cv.clnsig ?? "not in ClinVar",
    reviewStars: cv.stars ?? 0,
    consequence: hgvsP,
  });
  const tlabel = (r: TranscriptRecord, consequence: string): TranscriptRec => ({
    ...r,
    id,
    gene: i.gene,
    variant: i.hgvs_c,
    clinvar: cv.variation_id ? `VCV${String(cv.variation_id).padStart(9, "0")}` : "—",
    transcript: i.transcript,
    reviewStatus: cv.clnsig ?? "not in ClinVar",
    reviewStars: cv.stars ?? 0,
    consequence,
  });
  /** E11: the double-agent, for a coding change INSIDE THE CUT SIGNAL (SIGNAL).
   *  `exon_edge` (within three letters of a join, VEP's splice region) only nominates; a letter
   *  outside the signal is a plain coding change. True when the drawing was made. */
  const doubleAgent = (): boolean => {
    const loc = locusOf(i.hgvs_c);
    const e = loc ? edgeLetter(m, loc.c) : null;
    if (!loc || !e) {
      out.pending.push("transcript double-agent: the edge is not between two coding pieces (edge case)");
      return false;
    }
    if (!e.inside) {
      out.notes.push(
        `At an exon edge (${e.side}, exon letter ${e.letter} from the join) but outside the cut signal, so no double-agent.`,
      );
      return false;
    }
    const rec = {
      ...transcriptRecord(m, "double-agent", loc, e.j),
      signal: { side: e.side, window: { ...SIGNAL[e.side] }, letter: e.letter, inside: true },
    };
    out.drawings.push({
      lane: "transcript",
      kind: "double-agent",
      transcript: tlabel(rec, hgvsP),
      why: `Exon letter ${e.letter} from the join after coding base ${e.j}, inside the ${e.side} signal: the same letters spell the word and sign the cut. Both readings, no verdict.`,
    });
    return true;
  };
  const site = siteOf(hgvsP);
  if (m.pieces.length > 150) out.notes.push(`${m.pieces.length} pieces: the transcript lane needs the band (O2).`);

  switch (i.consequence) {
    case "missense": {
      if (ee != null && doubleAgent()) {
        out.row = "E11";
        out.rowName = "At an exon edge";
      } else {
        out.row = "E1";
        out.rowName = "One word changes";
      }
      // E2: neighbouring letters changed together change 2-3 consecutive residues
      const ed = applyToOrf(m, edit);
      const changedRes: number[] = [];
      if (ed && ed.delta === 0) {
        const a = translate(m.orfTail),
          b = translate(ed.seq);
        for (let k = 0; k < Math.min(a.length, b.length); k++) if (a[k] !== b[k]) changedRes.push(k + 1);
      }
      if (changedRes.length > 1 && ee == null) {
        out.row = "E2";
        out.rowName = "Two or three words change at once";
      }
      if (site) {
        const d = proteinDrawing(
          id,
          m,
          src,
          changedRes[0] ?? site,
          "substitution-contacts",
          undefined,
          {},
          changedRes.length > 1 ? changedRes : [changedRes[0] ?? site],
        );
        out.drawings.push(d);
        const o4 = d.fold?.o4;
        if (o4)
          out.notes.push(
            o4.state === "buried"
              ? `O4: buried (${o4.cn} residues within 10 Å).`
              : o4.state === "surface-site"
                ? `O4: on the surface (${o4.cn} within 10 Å), at an annotated site: ${o4.partners!.join(", ")}.`
                : `O4: on the surface (${o4.cn} within 10 Å); nothing annotated there.`,
          );
      }
      break;
    }
    case "synonymous_splice_region": {
      // the junction leads: what makes E11 distinct is the cut, not the silent word (routing review)
      if (doubleAgent()) {
        out.row = "E11";
        out.rowName = "At an exon edge";
      } else {
        out.row = "E1";
        out.rowName = "A word changes, same meaning";
      }
      const cf = codonFacts(m, edit);
      if (cf?.kind === "silent")
        out.drawings.push({
          lane: "codon",
          kind: "silent",
          codon: label(cf),
          why: "The word changes letter and still spells the same.",
        });
      else if (cf) out.pending.push(`codon: ${NOT_ONE_LETTER}`);
      break;
    }
    case "stop_gained": {
      out.row = "E3";
      out.rowName = "A word becomes stop";
      if (ee != null && doubleAgent()) {
        out.row = "E11";
        out.rowName = "At an exon edge";
      }
      const cf = codonFacts(m, edit);
      if (!cf || cf.terminator == null) {
        out.notes.push("codon facts unavailable");
        break;
      }
      out.drawings.push({ lane: "codon", kind: "nonsense", codon: label(cf), why: `Codon ${cf.seam} becomes a stop.` });
      const f = fate(m, cf.terminator);
      out.notes.push(`F1: ${f.why}.`);
      if (f.destroyed) out.drawings[out.drawings.length - 1].fate = "destroyed";
      else out.drawings.push(lateStop(id, m, src, i.gene, cf.terminator - 1));
      break;
    }
    case "frameshift": {
      out.row = "E4";
      out.rowName = "The frame breaks";
      // at an exon edge the junction leads, as in E11 (routing review)
      if (ee != null && doubleAgent()) {
        out.row = "E11";
        out.rowName = "At an exon edge";
      }
      const cf = codonFacts(m, edit);
      if (!cf || cf.kind !== "frameshift") {
        out.notes.push("codon facts unavailable");
        break;
      }
      const ins = cf.addCells.length > 0 || cf.netBaseDelta > 0;
      out.drawings.push({
        lane: "codon",
        kind: ins ? "frameshift-ins" : "frameshift-del",
        codon: label(cf),
        why:
          cf.terminator == null
            ? `From codon ${cf.seam} the reading shifts and no stop is read in the reference shipped.`
            : `From codon ${cf.seam} the reading shifts; a stop is read at codon ${cf.terminator}.`,
      });
      if (cf.terminator == null) {
        noStop(m, out, "The shifted reading");
        break;
      }
      const f = fate(m, cf.terminator);
      out.notes.push(`F1: ${f.why}.`);
      if (f.destroyed) {
        out.drawings[out.drawings.length - 1].fate = "destroyed";
        break;
      }
      if (cf.terminator > m.cds.length / 3) {
        // the shifted reading runs past the protein's own end: E8's ending
        const ext = cf.terminator - m.cds.length / 3;
        const d = runOn(
          proteinDrawing(id, m, src, m.protein.length, "stop-loss-extension", undefined, {
            extension: ext,
          } as Partial<FoldRecord>),
          ext,
        );
        d.why =
          `The shifted reading runs past the protein's end and stops ${ext} residue${ext === 1 ? "" : "s"} later (E8's ending; from residue ${cf.seam} on it is read in the wrong frame). ` +
          d.why;
        out.drawings.push(d);
        break;
      }
      out.drawings.push(lateStop(id, m, src, i.gene, cf.seam - 1, cf.terminator - cf.seam));
      break;
    }
    case "inframe_indel": {
      const cf = codonFacts(m, edit);
      if (!cf) {
        out.notes.push("codon facts unavailable");
        break;
      }
      const n = Math.abs(cf.words);
      const del = cf.words < 0;
      out.row = del ? "E5" : "E6";
      out.rowName = del ? "Whole words removed" : "Whole words added";
      // (O3's ghost, over three words removed, retired: every removal fades and closes
      // up with the cell's own beats, reflow included; a stretch too long for the row is elided)
      out.drawings.push({
        lane: "codon",
        kind: del ? "in-frame-del" : "in-frame-ins",
        codon: label(cf),
        why: `${n} whole word${n > 1 ? "s" : ""} ${del ? "leave" : "arrive"}; the grouping survives.`,
      });
      const at = del ? cf.seam : cf.seam - 1;
      out.drawings.push(
        proteinDrawing(
          id,
          m,
          src,
          Math.max(1, at),
          del ? "sealed-removal" : "insertion-bulge",
          undefined,
          (del ? { removed: n } : { added: n }) as Partial<FoldRecord>,
        ),
      );
      break;
    }
    case "stop_lost": {
      out.row = "E8";
      out.rowName = "The stop word breaks";
      const cf = codonFacts(m, edit);
      if (!cf || cf.kind !== "stop-loss") {
        out.notes.push("stop loss not read from sequence");
        break;
      }
      out.drawings.push({
        lane: "codon",
        kind: "stop-loss",
        codon: label(cf),
        why:
          cf.terminator == null
            ? "The stop word no longer says stop, and no new stop is read in the reference shipped."
            : `The stop word no longer says stop; reading runs on to codon ${cf.terminator}.`,
      });
      if (cf.terminator == null) {
        noStop(m, out, "The reading past the old stop");
        break;
      }
      const ext = cf.terminator - m.cds.length / 3;
      out.drawings.push(
        runOn(
          proteinDrawing(id, m, src, m.protein.length, "stop-loss-extension", undefined, {
            extension: ext,
          } as Partial<FoldRecord>),
          ext,
        ),
      );
      out.notes.push(`The protein runs on ${ext} residue${ext === 1 ? "" : "s"} past its end.`);
      break;
    }
    case "synonymous": {
      const cf = codonFacts(m, edit);
      if (!cf) {
        out.notes.push("codon facts unavailable");
        break;
      }
      out.row = cf.seam === m.cds.length / 3 ? "E8" : "E1";
      out.rowName = cf.seam === m.cds.length / 3 ? "The stop word changes, still stop" : "A word changes, same meaning";
      if (cf.kind === "silent") {
        out.drawings.push({
          lane: "codon",
          kind: "silent",
          codon: label(cf),
          why: "The word changes letter and still spells the same.",
        });
        break;
      }
      if (cf.kind !== "frameshift") {
        out.pending.push(`codon: ${NOT_ONE_LETTER}`);
        break;
      }
      /* LETTERS LEAVE OR ARRIVE AND THE READING IS KEPT: the letters that follow re-form every word
         through the stop. Two drawings: the letters go (or come), on the frameshift cell stopped
         before anything regroups or is misread, since nothing is; then the reading as it now
         stands, the same word for word, with no letter marked as swapped, since none was. */
      const read: CodonFacts = { ...cf, kind: "silent", terminator: null, cutCells: [], addCells: [] };
      delete read.cut;
      delete read.add;
      const n = Math.abs(cf.netBaseDelta);
      const s = n === 1 ? "" : "s";
      out.drawings.push(
        {
          lane: "codon",
          kind: cf.netBaseDelta > 0 ? "frameshift-ins" : "frameshift-del",
          beats: ["establish", cf.netBaseDelta > 0 ? "intrude" : "delete"],
          codon: label(cf),
          why: `${n} letter${s} ${cf.netBaseDelta > 0 ? "arrive" : "leave"}${n === 1 ? "s" : ""} in codon ${cf.seam}.`,
        },
        {
          lane: "codon",
          kind: "silent",
          codon: label(read),
          why: "The letters that follow close up into the same words, stop included: the protein is the same.",
        },
      );
      break;
    }
    case "start_lost": {
      out.row = "E7";
      out.rowName = "The start word breaks";
      const cf = codonFacts(m, edit);
      if (cf?.kind === "silent") {
        out.rowName = "The start word changes, still a start";
        out.drawings.push({
          lane: "codon",
          kind: "silent",
          codon: label(cf),
          why: `The start word changes (${cf.startFrom} to ATG), and ATG is a start: reading begins where it did and the protein is the same.`,
        });
        break;
      }
      if (!cf || cf.kind !== "start-loss") {
        out.notes.push("start loss not read from sequence");
        break;
      }
      out.drawings.push({
        lane: "codon",
        kind: "start-loss",
        codon: label(cf),
        beats: ["establish", "locate", "hold"],
        why: `The start word changes (${cf.startFrom} to ${cf.startTo}). ${cf.restart == null ? "No ATG follows, so reading has nowhere to begin." : cf.restart.inStep ? `The next ATG is codon ${cf.restart.codon}, in step: by the scanning rule the protein starts there.` : `The next ATG (letter ${cf.restart.nt}) is out of step: by the scanning rule the message is misread.`}`,
      });
      break;
    }
    case "splice_donor":
    case "splice_acceptor":
    case "splice_region": {
      const loc = locusOf(i.hgvs_c);
      const j = loc ? junctionOf(m, loc) : null;
      if (!loc || j == null) {
        out.row = i.consequence === "splice_region" ? "E10/E12" : "E9";
        out.rowName = "Near a junction";
        out.pending.push(
          "transcript: the junction is not between two coding pieces (the gene's first or last piece, or a UTR exon): an edge case",
        );
        break;
      }
      const side: "donor" | "acceptor" = loc.off > 0 ? "donor" : "acceptor";
      const rec = tlabel(transcriptRecord(m, "foreclosed", loc, j), "unmeasured");
      /* O1's close-up (stage 2): the state rides on the record; the drawing reads it */
      const withJunction = (state: "broken" | "weakened" | "beside") => {
        const jf = junctionFacts(j, side, i.hgvs_c, state);
        if (!jf) return rec;
        // a beside indel in a repeat is drawn at the run's far end (agrees with the letters rule)
        const offsets = state === "beside" ? slideAway(m, ref, j, side, jf.offsets, jf.edit) : jf.offsets;
        return { ...rec, junction: { ...jf, offsets } };
      };
      /* AN INDEL NAMED AT THE CUT POINT IS READ BY ITS LETTERS (stress pass). A
         deletion can be written across the edge or shifted into the intron (AGRN c.1177+4_+50del,
         left-aligned it spans the edge); every placement is the same edit, so the two essential
         letters after the edit decide: unchanged, it routes as the signal does. */
      let consequence = i.consequence;
      if (consequence !== "splice_region" && edit.ref.length !== edit.alt.length) {
        const s0 = signalOf(m, ref, j, side, edit);
        const ess = (x: string) => (side === "donor" ? x.slice(0, 2) : x.slice(1, 3));
        if (s0 && !s0.after.startsWith("(") && ess(s0.before) === ess(s0.after)) {
          consequence = "splice_region";
          out.notes.push(`The essential letters read ${ess(s0.after)} after the edit, as before: not broken.`);
        }
      }
      if (consequence !== "splice_region") {
        out.row = "E9";
        out.rowName = "A cut-point letter breaks";
        out.drawings.push({
          lane: "transcript",
          kind: "foreclosed-junction",
          transcript: withJunction("broken"),
          beats: ["establish", "locate", "break", "hold"],
          why: `It changes the cut point itself (${loc.off > 0 ? "+" : ""}${loc.off}). Which repair follows is not measured, so the drawing forecloses: the join is broken, the outcome unknown.`,
        });
        break;
      }
      const sig = signalOf(m, ref, j, loc.off > 0 ? "donor" : "acceptor", edit);
      if (!sig) {
        out.row = "E10/E12";
        out.rowName = "Near the cut signal";
        out.pending.push("transcript: the signal's letters are outside the shipped reference");
        break;
      }
      const where = `${sig.side === "donor" ? "donor +1 to +6" : "acceptor −3 to −1"}: ${sig.before} before, ${sig.after} after`;
      out.notes.push(`The signal's letters (${where}).`);
      if (sig.changed) {
        out.row = "E10";
        out.rowName = "Inside the cut signal";
        out.drawings.push({
          lane: "transcript",
          kind: "foreclosed-junction",
          transcript: withJunction("weakened"),
          beats: ["establish", "locate", "hold"],
          why: `The edit changes the signal's letters, so the site is weakened, not broken.`,
        });
      } else {
        out.row = "E12";
        out.rowName = "Beside the cut signal";
        out.drawings.push({
          lane: "transcript",
          kind: "foreclosed-junction",
          transcript: withJunction("beside"),
          beats: ["establish", "locate", "hold"],
          why: `The signal reads the same after the edit, so the variant sits beside it: near the signal, effect not known.`,
        });
      }
      break;
    }
    // One row per copy of the gene over the one ruler: a deletion takes a row away, an extra copy adds one.
    case "gene_deletion":
    case "copy_gain": {
      const gain = i.consequence === "copy_gain";
      if (!copyNumber) throw new Error(`a copy-number record without its copy number: ${id}`);
      out.row = "O5";
      if (!copyNumber.whole) {
        // The copies drawing shows whole copies of the gene; part of one has no drawing.
        out.rowName = "Not drawn, with the reason";
        out.notes.push(
          `O5, not drawn: ${gain ? "part of the gene is duplicated" : "part of the gene is deleted"}, and the drawing shows whole copies only.`,
        );
        break;
      }
      const { copies, from } = copyNumber;
      out.rowName = gain ? "An extra copy of the gene" : "A copy of the gene is gone";
      out.drawings.push({
        lane: "transcript",
        kind: "copies",
        beats: ["establish", "change", "settle"],
        transcript: tlabel(
          { ...transcriptRecord(m, "copies", { c: 1, off: 0 }, 0), locusC: null, copies, copiesFrom: from },
          gain ? "gene duplicated" : "gene deleted",
        ),
        why: gain
          ? `The whole gene is copied: ${copies} copies where there were ${from}. The protein is the usual one, and there is more of it.`
          : copies === 0
            ? "The whole gene is deleted and no copy is left: none of the protein is made."
            : `The whole gene is deleted from one copy: ${copies} of ${from} still makes the protein, less of it in all.`,
      });
      break;
    }
    case "inversion":
    case "complex_rearrangement": {
      // No stage. P1 draws nothing; the serif narrative says why.
      out.row = "O5";
      out.rowName = "Not drawn, with the reason";
      out.notes.push(
        "O5, not drawn: the gene is rearranged. Its effect depends on where the breaks fall, which the file doesn't say.",
      );
      break;
    }
    default:
      out.notes.push(`No route for consequence ${i.consequence}.`);
  }
  // beats the facts change: a frameshift whose stop is never read has no reveal-stop
  for (const d of out.drawings) {
    if (d.lane === "codon" && d.codon?.kind === "frameshift" && d.codon.terminator == null) {
      d.beats = (d.codon.addCells.length ? CODON_BEATS["frameshift-ins"] : CODON_BEATS.frameshift).filter(
        (b) => b !== "reveal-stop",
      );
    }
    if (d.lane === "codon" && d.codon?.kind === "stop-loss" && d.codon.terminator == null) {
      d.beats = ["establish", "dissolve-stop", "read-past", "settle"];
    }
  }
  return out;
}
