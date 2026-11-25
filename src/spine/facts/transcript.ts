// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/** Transcript-lane facts: the renderer's TranscriptSpecimen for a variant at or
 *  near a junction, the gene's own coding pieces, and O1's routing by the cut
 *  signal's letters (SPEC.md §The bridge, P1-GRID §Edges). Browser-portable. */

import { SIGNAL as CUT_SIGNAL } from "../../contracts/constants.ts";
import { revcomp, type GeneModel, type RefGetter, type Edit } from "./model.ts";

/** THE CUT SIGNAL, DEFINED ONCE. The letters on each side of a join that mark
 *  the cut: the donor's MAG|GURAGU (the exon's last three, the intron's first six) and the
 *  acceptor's CAG| (the intron's last three; the exon's first letter is only weakly held and
 *  the drawing doesn't bracket it). Every stage reads this: the routing (a coding letter is a
 *  double-agent only inside it), the weakened/beside test (signalOf), the junction facts
 *  (`window`, which the renderer's bracket draws) and the copy ("these nine letters"). Before
 *  this, four stages each kept their own numbers, and AGRN c.2002G>T, the exon's third letter
 *  after an acceptor join, was routed as a cut letter the bracket said it wasn't. */
export const SIGNAL = { donor: CUT_SIGNAL.donor, acceptor: { exon: 0, intron: CUT_SIGNAL.acceptor.intron } } as const;
export type SignalWindow = { exon: number; intron: number };

export interface TranscriptRecord {
  kind: "foreclosed" | "double-agent" | "whole-gene" | "copies";
  locusC: number | null;
  locusOffset: number;
  junctionC: number | null;
  skipLo: null;
  skipHi: null;
  skipBp: null;
  inFrame: null;
  admitted: null;
  stopCodon: null;
  stopNtRef: null;
  proteinAa: number | null;
  /** "copies" only: copies of the gene after the change, and before it (2) */
  copies: number | null;
  spanBp: null;
  copiesFrom?: number;
  exons: { exon: number; cLo: number; cHi: number; bp: number }[];
  /** double-agent: the changed coding letter against the signal (SIGNAL). `letter` counts
   *  exon letters from the join, 1 touching it */
  signal?: { side: "donor" | "acceptor"; window: SignalWindow; letter: number; inside: boolean };
  cdsLength: number;
  /** all the gene's exons, coding or not (the stage caption's "OF N") */
  exonCount: number;
  junction?: JunctionFacts;
}

/** O1's junction close-up (stage 2): what the letter-scale drawing needs. */
export interface JunctionFacts {
  side: "donor" | "acceptor";
  /** the signal's letters on each side of the join (SIGNAL[side]); the bracket draws this */
  window: SignalWindow;
  /** HGVS intronic offsets the edit touches (+5; -3; +15..+51 for a run) */
  offsets: number[];
  state: "broken" | "weakened" | "beside";
  /** letters of the exon's edge codon on this side of the join: donor, the last codon's
   *  letters before the join; acceptor, the first codon's letters after it (0 = whole) */
  phase: number;
  edit: "sub" | "del" | "dup" | "ins" | "delins";
}

/** The offsets an HGVS c. name touches: c.N+5G>A -> [5]; c.N-3del -> [-3];
 *  c.N+15_N+51dup -> [15..51]; c.N-13_Mdel, which runs on into the exon -> [-13..-1].
 *  Null when it doesn't name an intronic offset. */
export function offsetsOf(hgvsC: string): { offsets: number[]; edit: JunctionFacts["edit"] } | null {
  const m = /^c\.\d+([+-]\d+)(_\d+([+-]\d+)?)?(del|dup|ins|delins)?/.exec(hgvsC);
  if (!m) return null;
  const a = +m[1];
  // A range that ends on an exon letter covers every intron letter from its start to the join.
  const b = m[3] ? +m[3] : m[2] && a < 0 ? -1 : a;
  const lo = Math.min(a, b),
    hi = Math.max(a, b);
  const offsets: number[] = [];
  for (let k = lo; k <= hi; k++) if (k !== 0) offsets.push(k);
  const edit = (m[4] as JunctionFacts["edit"] | undefined) ?? "sub";
  return { offsets, edit };
}

export function junctionFacts(
  junctionC: number,
  side: "donor" | "acceptor",
  hgvsC: string,
  state: JunctionFacts["state"],
): JunctionFacts | null {
  const o = offsetsOf(hgvsC);
  if (!o) return null;
  const r = junctionC % 3;
  return {
    side,
    window: { ...SIGNAL[side] },
    offsets: o.offsets,
    state,
    edit: o.edit,
    phase: side === "donor" ? r : (3 - r) % 3,
  };
}

export interface Signal {
  side: "donor" | "acceptor";
  /** the signal's intron letters (SIGNAL), sense strand: donor +1..+6, acceptor -3..-1 */
  before: string;
  after: string;
  changed: boolean;
}

/** c.N, c.N+k, c.N-k: the first position named. Null for UTR (c.-N, c.*N) forms. */
export function locusOf(hgvsC: string): { c: number; off: number } | null {
  const m = /^c\.(\d+)([+-]\d+)?/.exec(hgvsC);
  return m ? { c: +m[1], off: m[2] ? +m[2] : 0 } : null;
}

const pieceEnding = (m: GeneModel, c: number) => m.pieces.find((p) => p.cHi === c);
const pieceStarting = (m: GeneModel, c: number) => m.pieces.find((p) => p.cLo === c);

/** The junction a splice variant is about, as the last coding base before the gap.
 *  Null when that gap is not between two coding pieces (UTR exons, the gene's ends). */
export function junctionOf(m: GeneModel, locus: { c: number; off: number }): number | null {
  const j = locus.off > 0 ? locus.c : locus.off < 0 ? locus.c - 1 : null;
  if (j == null) return null;
  return pieceEnding(m, j) && pieceStarting(m, j + 1) ? j : null;
}

/** A coding letter against the nearest join's signal: which side, how many exon letters from
 *  the join (1 touching), and whether SIGNAL puts it inside. Null when the nearest gap isn't
 *  between two coding pieces. */
export function edgeLetter(
  m: GeneModel,
  c: number,
): { j: number; side: "donor" | "acceptor"; letter: number; inside: boolean } | null {
  const j = edgeJunction(m, c);
  if (j == null) return null;
  const side = c <= j ? "donor" : "acceptor";
  const letter = side === "donor" ? j - c + 1 : c - j;
  return { j, side, letter, inside: letter <= SIGNAL[side].exon };
}

/** For an exonic variant at an edge, the junction it sits beside. */
export function edgeJunction(m: GeneModel, c: number): number | null {
  const p = m.pieces.find((x) => x.cLo <= c && c <= x.cHi);
  if (!p) return null;
  const j = c - p.cLo < p.cHi - c ? p.cLo - 1 : p.cHi;
  return pieceEnding(m, j) && pieceStarting(m, j + 1) ? j : null;
}

/** O1's rule: apply the edit and compare the signal's letters. Placement-free, so an
 *  indel in a repeat routes the same however it is written. */
export function signalOf(
  m: GeneModel,
  ref: RefGetter,
  junctionC: number,
  side: "donor" | "acceptor",
  e: Edit,
): Signal | null {
  // genomic base at the exon edge the signal is measured from
  const edgeG = side === "donor" ? m.gpos[junctionC - 1] : m.gpos[junctionC];
  if (edgeG == null) return null;
  const F = 60;
  const lo = edgeG - F,
    hi = edgeG + F;
  const plus = ref(lo, hi - lo + 1);
  if (!plus) return null;
  // sense strand window and the index of the exon edge in it
  const sense = m.strand === "+" ? plus : revcomp(plus);
  const edgeIdx = m.strand === "+" ? edgeG - lo : hi - edgeG;
  // the edit, in the same sense window
  if (e.pos < lo || e.pos + Math.max(0, e.ref.length - 1) > hi) return null;
  let eLo: number, eHi: number, alt: string; // sense indices [eLo, eHi) replaced by alt
  if (m.strand === "+") {
    eLo = e.pos - lo;
    eHi = eLo + e.ref.length;
    alt = e.alt;
  } else {
    eHi = hi - e.pos + 1;
    eLo = eHi - e.ref.length;
    alt = revcomp(e.alt);
  }
  const edited = sense.slice(0, eLo) + alt + sense.slice(eHi);
  const delta = alt.length - (eHi - eLo);
  const n = SIGNAL[side].intron;
  const read = (s: string, edge: number) =>
    side === "donor" ? s.slice(edge + 1, edge + 1 + n) : s.slice(edge - n, edge);
  const before = read(sense, edgeIdx);
  // the exon edge moves only when the edit lies wholly before it in reading order;
  // an edit that touches the edge itself changes the signal by definition
  let touches = eLo <= edgeIdx && eHi > edgeIdx;
  /* A PURE DELETION THAT TOUCHES THE EDGE IN ONE PLACEMENT MAY NOT IN ANOTHER (stress pass:
     AGRN c.1177+4_1177+50del, left-aligned, takes the exon's last letter). Every
     placement along the repeat is the same edit, so slide it (either way) to one that leaves
     the edge alone, if any does; the letters are then read off that one. */
  if (touches && alt.length === 0) {
    for (const dir of [1, -1]) {
      let a = eLo,
        b = eHi;
      for (let n = 0; n < 200; n++) {
        const ok = dir > 0 ? b < sense.length && sense[a] === sense[b] : a > 0 && sense[a - 1] === sense[b - 1];
        if (!ok) break;
        a += dir;
        b += dir;
        if (!(a <= edgeIdx && b > edgeIdx)) {
          eLo = a;
          eHi = b;
          touches = false;
          break;
        }
      }
      if (!touches) break;
    }
  }
  if (touches) return { side, before, after: "(the edge itself is edited)", changed: true };
  const newEdge = eHi <= edgeIdx ? edgeIdx + delta : edgeIdx;
  const after = read(edited, newEdge);
  return { side, before, after, changed: before !== after };
}

export function transcriptRecord(
  m: GeneModel,
  kind: TranscriptRecord["kind"],
  locus: { c: number; off: number },
  junctionC: number,
): TranscriptRecord {
  return {
    kind,
    locusC: locus.c,
    locusOffset: locus.off,
    junctionC,
    skipLo: null,
    skipHi: null,
    skipBp: null,
    inFrame: null,
    admitted: null,
    stopCodon: null,
    stopNtRef: null,
    proteinAa: kind === "double-agent" ? m.protein.length : null,
    copies: null,
    spanBp: null,
    exons: m.pieces.map((p) => ({ exon: p.exon, cLo: p.cLo, cHi: p.cHi, bp: p.bp })),
    cdsLength: m.cds.length,
    exonCount: m.exonCount,
  };
}

/** AN INDEL IN A REPEAT SITS AT THE FAR END OF THE RUN, for the drawing (stage 2).
 *  HTT c.3499-3del takes one T from TTTT (-6..-3); HGVS names the T nearest the cut, inside
 *  the signal span, though the signal's letters are unchanged (beside). Every placement in
 *  the run is the same edit, so the close-up marks the one farthest from the join: the
 *  drawing then agrees with the letters rule. Substitutions never move. */
export function slideAway(
  m: GeneModel,
  ref: RefGetter,
  junctionC: number,
  side: "donor" | "acceptor",
  offsets: number[],
  edit: string,
): number[] {
  if (edit === "sub" || !offsets.length) return offsets;
  const L = offsets.length;
  // sense letter at an intronic offset
  const edgeG = side === "donor" ? m.gpos[junctionC - 1] : m.gpos[junctionC];
  if (edgeG == null) return offsets;
  const at = (off: number): string | null => {
    const g = m.strand === "+" ? edgeG + off : edgeG - off;
    const b = ref(g, 1);
    return b == null ? null : m.strand === "+" ? b : revcomp(b);
  };
  let lo = Math.min(...offsets),
    hi = Math.max(...offsets);
  if (side === "acceptor") {
    // away from the join = more negative: shift while the letter entering equals the one leaving
    for (let n = 0; n < 50; n++) {
      const a = at(lo - 1),
        b = at(hi);
      if (a == null || b == null || a !== b) break;
      lo--;
      hi--;
    }
  } else {
    for (let n = 0; n < 50; n++) {
      const a = at(hi + 1),
        b = at(lo);
      if (a == null || b == null || a !== b) break;
      lo++;
      hi++;
    }
  }
  return Array.from({ length: L }, (_, k) => lo + k);
}
