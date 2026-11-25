// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// What a line claims beyond its slots, and the fact that makes each claim true.

/* Tags pick which lines show; each claim is tested against the facts record directly, not against the
   tags. So a tag that lumps two cases together, or a line written for one case and shown for another,
   fails here on the variant where it is untrue.

   A claim's test returns
     true    the facts make it true for this variant
     false   the facts make it untrue: the line must not show here
     null    no fact can check it: the line rests on an assumption (unbacked)
   `basis: "none"` marks an unbacked claim (its test is always null).
   `basis: "rule"` marks a claim the facts stage decides by a rule (a prediction such as the NMD rule),
   not by a measurement: true by the rule, and worded as such or not at all.

   A claim tests the raw facts, never the routing. Its test reads positions, windows and values, not
   which kind of drawing the variant was routed to: "routed as a double-agent, so its letter marks the
   cut" is circular. Shared definitions come from the facts (the signal's window) or the contract's
   constants, never from numbers kept here.

   Every line declares its claims: [] means "nothing beyond its slots and its kind". A line with no
   `claims` field is unaudited and flagged. */

import { CONTACT_MAX_A, CONTACT_MIN_SEP, PLDDT_SOLID as SOLID } from "../../contracts/constants";
import { isOpen, type Ctx } from "./slots";

export type Claim = { says: string; holds: (c: Ctx) => boolean | null; basis?: "rule" | "none" };

const P = (c: Ctx) => c.v.hgvs_p || "";
const chain = (c: Ctx) => c.d.chain as any;
const o4 = (c: Ctx) => (c.d.fold as any)?.o4;
const J = (c: Ctx) => (c.d.transcript as any)?.junction ?? {};
const codon = (c: Ctx) => (c.d.codon as any) ?? c.v.drawings.map((x) => x.codon as any).find(Boolean);
const next = (c: Ctx) => c.v.drawings[c.i + 1];
const UNMAPPED = new Set(["no-model", "partial-model", "other-isoform", "not-fetched"]);

export const CLAIMS: Record<string, Claim> = {
  /* ---- the change ---- */
  "one-swap": {
    says: "exactly one amino acid changes, into another amino acid",
    holds: (c) => /^p\.[A-Z][a-z]{2}\d+(?!Ter)[A-Z][a-z]{2}$/.test(P(c)),
  },
  "two-adjacent": {
    says: "exactly two amino acids, side by side, change",
    holds: (c) => {
      const m = /^p\.[A-Z][a-z]{2}(\d+)_[A-Z][a-z]{2}(\d+)delins((?:[A-Z][a-z]{2}){2})$/.exec(P(c));
      return !!m && +m[2] === +m[1] + 1;
    },
  },
  "run-adjacent": {
    says: "three or more amino acids change, all side by side",
    holds: (c) => {
      const mk: number[] = (c.d.fold as any)?.marks ?? [];
      return mk.length >= 3 && mk.every((x, j) => j === 0 || x === mk[j - 1] + 1);
    },
  },
  "several-apart": {
    says: "two or more amino acids change, with unchanged ones between some of them",
    holds: (c) => {
      const mk: number[] = (c.d.fold as any)?.marks ?? [];
      return mk.length >= 2 && mk.some((x, j) => j > 0 && x !== mk[j - 1] + 1);
    },
  },
  "several-in-a-row": {
    says: "two or more amino acids, side by side, are each swapped for another (as many in as out)",
    holds: (c) => {
      const m = /^p\.[A-Z][a-z]{2}(\d+)_[A-Z][a-z]{2}(\d+)delins((?:[A-Z][a-z]{2})+)$/.exec(P(c));
      return !!m && !/Ter/.test(m[3]) && m[3].length / 3 === +m[2] - +m[1] + 1;
    },
  },
  "aa-removed": {
    says: "amino acids are removed and none are added or changed",
    holds: (c) => /del$/.test(P(c)) && !/delins/.test(P(c)),
  },
  "aa-added": {
    says: "amino acids are added and none are removed or changed",
    holds: (c) => /(dup|ins(?:[A-Z][a-z]{2})+)$/.test(P(c)) && !/delins/.test(P(c)),
  },
  "one-letter": { says: "exactly one DNA letter changes", holds: (c) => /\d[ACGT]>[ACGT]$/.test(c.v.hgvs_c) },
  "codon-aligned": {
    says: "the letters added or removed are whole codons, starting on a codon's first letter",
    holds: (c) => {
      const k = codon(c);
      return k ? !!k.aligned && k.netBaseDelta % 3 === 0 : false;
    },
  },
  "codon-straddled": {
    says: "the letters removed cut across codons",
    holds: (c) => {
      const k = codon(c);
      return k ? !k.aligned : false;
    },
  },
  "in-step": {
    says: "the reading frame is kept",
    holds: (c) => {
      const k = codon(c);
      return k ? k.netBaseDelta % 3 === 0 : false;
    },
  },
  "now-stop": {
    says: "the changed codon reads as a stop",
    holds: (c) => /Ter$/.test(P(c)) || /Ter$/.test((c.d.transcript as any)?.consequence ?? ""),
  },
  "same-aa": {
    says: "the codon still spells the same amino acid",
    holds: (c) => /=$/.test(P(c)) || /=$/.test((c.d.transcript as any)?.consequence ?? ""),
  },
  "protein-unchanged": {
    says: "nothing about the protein changes: same amino acids, and no effect on the cut on record or predicted by its position",
    holds: (c) =>
      c.v.consequence === "synonymous" &&
      !c.v.drawings.some((d) => d.kind === "double-agent" || d.lane === "transcript"),
  },
  "stop-kept": { says: "the stop codon still reads as a stop", holds: (c) => /^p\.Ter\d+=$/.test(P(c)) },
  "start-now-atg": { says: "the start codon is changed into ATG", holds: (c) => codon(c)?.startTo === "ATG" },
  "start-changed": {
    says: "the start codon is changed into something that isn't ATG",
    holds: (c) => {
      const k = codon(c);
      return k?.startFrom ? k.startTo !== "ATG" : false;
    },
  },
  "restart-in-step": {
    says: "by the scanning rule, reading begins instead at the next ATG, which is in step, so the protein is made without everything before it",
    holds: (c) => {
      const r = codon(c)?.restart;
      return r === undefined ? null : !!r?.inStep;
    },
    basis: "rule",
  },
  "restart-out-of-step": {
    says: "by the scanning rule, reading begins instead at the next ATG, which is out of step, so no working protein is made",
    holds: (c) => {
      const r = codon(c)?.restart;
      return r === undefined ? null : !!r && !r.inStep;
    },
    basis: "rule",
  },
  "no-restart": {
    says: "no ATG follows the lost start in the coding sequence, so no protein is made",
    holds: (c) => {
      const r = codon(c)?.restart;
      return r === undefined ? null : r === null;
    },
    basis: "rule",
  },
  "stop-lost": { says: "the stop codon no longer reads as a stop", holds: (c) => /^p\.Ter\d+(?!=)/.test(P(c)) },
  /* ---- dosage: read off the transcript record, never the routing ---- */
  "one-copy-lost": {
    says: "one copy of the gene is deleted and at least one remains",
    holds: (c) => {
      const t = c.d.transcript as any;
      return t?.copies != null ? t.copies > 0 && t.copies < (t.copiesFrom ?? 2) : false;
    },
  },
  "all-copies-lost": { says: "every copy of the gene is deleted", holds: (c) => (c.d.transcript as any)?.copies === 0 },
  "copy-gained": {
    says: "there are more copies of the gene than usual",
    holds: (c) => {
      const t = c.d.transcript as any;
      return t?.copies != null ? t.copies > (t.copiesFrom ?? 2) : false;
    },
  },
  "less-protein": {
    says: "with fewer copies, less of the protein is made",
    holds: (c) => {
      const t = c.d.transcript as any;
      return t?.copies != null ? t.copies < (t.copiesFrom ?? 2) : false;
    },
    basis: "rule",
  },
  "more-protein": {
    says: "with more copies, more of the protein is made",
    holds: (c) => {
      const t = c.d.transcript as any;
      return t?.copies != null ? t.copies > (t.copiesFrom ?? 2) : false;
    },
    basis: "rule",
  },
  "piece-deleted": {
    says: "one whole piece (exon) of the gene is deleted",
    holds: (c) => {
      const t = c.d.transcript as any;
      return t?.kind === "skip" && t.skipBp != null && c.v.consequence === "piece_deleted";
    },
  },
  "piece-duplicated": {
    says: "one whole piece (exon) of the gene is repeated right after the original",
    holds: (c) => {
      const t = c.d.transcript as any;
      return !!t?.admitted && c.v.consequence === "piece_duplicated";
    },
  },
  "frame-kept": {
    says: "the letters added or removed are a whole number of codons",
    holds: (c) => {
      const t = c.d.transcript as any;
      const n = t?.admitted?.nt ?? t?.skipBp;
      return n != null ? n % 3 === 0 : null;
    },
  },
  "frame-thrown": {
    says: "the letters added or removed are not a whole number of codons",
    holds: (c) => {
      const t = c.d.transcript as any;
      const n = t?.admitted?.nt ?? t?.skipBp;
      return n != null ? n % 3 !== 0 : null;
    },
  },
  "tx-stop-ahead": {
    says: "the misread stretch meets a stop",
    holds: (c) => (c.d.transcript as any)?.stopCodon != null,
  },
  "stop-in-copy": {
    says: "the stop falls inside the repeated piece",
    holds: (c) => (c.d.transcript as any)?.admitted?.stopWithinNt != null,
  },
  "whole-gene-gone": { says: "the whole gene is deleted", holds: (c) => c.v.consequence === "gene_deletion" },

  /* ---- the protein's shape (chain) ---- */
  predicted: { says: "a prediction of the protein's shape is in hand", holds: (c) => !!chain(c) && !chain(c).unmapped },
  "some-confident": {
    says: "some of the prediction is confident",
    holds: (c) => (chain(c)?.plddt?.length ? chain(c).plddt.some((x: number) => x >= SOLID) : false),
  },
  "some-unconfident": {
    says: "some of the prediction isn't confident",
    holds: (c) => (chain(c)?.plddt?.length ? chain(c).plddt.some((x: number) => x < SOLID) : false),
  },
  "site-unconfident": {
    says: "the prediction isn't confident where the variant sits",
    holds: (c) => {
      const ch = chain(c);
      if (!ch?.plddt?.length) return false;
      return ch.reason === "low-confidence" && ch.plddt[ch.site - 1] < SOLID;
    },
  },
  "site-confident-not-flat": {
    says: "the prediction is confident where the variant sits, but that part doesn't lie flat enough to draw",
    holds: (c) => chain(c)?.reason === "no-flat-view",
  },
  "no-full-prediction": {
    says: "no prediction of the whole protein is in hand",
    holds: (c) => !!chain(c) && UNMAPPED.has(chain(c).reason),
  },

  /* ---- where it sits on the fold ---- */
  buried: { says: "the site is packed inside the folded protein", holds: (c) => o4(c)?.state === "buried" },
  surface: {
    says: "the site is on the protein's surface",
    holds: (c) => o4(c)?.state === "surface" || o4(c)?.state === "surface-site",
  },
  "no-site-on-record": {
    says: "UniProt was checked and records no binding or interaction site near it",
    holds: (c) => o4(c)?.state === "surface" && o4(c)?.checked === true,
  },
  "touches-neighbors": {
    says: `within the drawn stretch, other amino acids (${CONTACT_MIN_SEP}+ apart in sequence) sit within ${CONTACT_MAX_A} Å of it in the predicted fold: the lines drawn, not all its contacts`,
    holds: (c) => ((c.d.fold as any)?.contacts?.length ?? 0) > 0,
  },
  "site-partner": {
    says: "UniProt records a binding site for a named partner there",
    holds: (c) => o4(c)?.state === "surface-site" && !!o4(c)?.partners?.length,
  },

  /* ---- the cut ---- */
  donor: { says: "the variant is at the end of an exon (a donor)", holds: (c) => J(c).side === "donor" },
  acceptor: { says: "the variant is at the start of an exon (an acceptor)", holds: (c) => J(c).side === "acceptor" },
  "at-cut-point": {
    says: "it changes one of the two letters that mark the cut",
    holds: (c) => J(c).state === "broken",
  },
  "in-signal": {
    says: "it changes a letter of the signal, not the cut point",
    holds: (c) => J(c).state === "weakened",
  },
  "outside-signal": { says: "it changes no letter of the signal", holds: (c) => J(c).state === "beside" },
  "single-letter-site": { says: "exactly one letter changes there", holds: (c) => (J(c).offsets?.length ?? 0) === 1 },
  /* from the letter's position and the signal's window as the facts give it */
  "exon-edge-letter": {
    says: "the changed letter is one of the exon's letters inside the cut signal",
    holds: (c) => {
      const t = c.d.transcript as any;
      const w = t?.signal?.window;
      if (!t || !w || t.locusOffset !== 0 || t.locusC == null || t.junctionC == null) return false;
      const donor = t.locusC <= t.junctionC,
        letter = donor ? t.junctionC - t.locusC + 1 : t.locusC - t.junctionC;
      return letter <= w.exon;
    },
  },

  /* ---- what follows (decided by the facts stage's rules) ---- */
  "message-destroyed": {
    says: "the message is destroyed before a protein is made (the NMD rule)",
    basis: "rule",
    holds: (c) => (c.d as any).fate === "destroyed",
  },
  "no-stop-no-protein": {
    says: "reading never meets a stop, so no protein is made (the non-stop rule)",
    basis: "rule",
    holds: (c) => (c.d as any).fate === "no-stop",
  },
  "shorter-protein": {
    says: "a shorter protein is made (the NMD rule: the stop is too late to destroy the message)",
    basis: "rule",
    holds: (c) =>
      next(c)?.kind === "truncated-fold" ||
      next(c)?.kind === "truncated" ||
      c.d.kind === "truncated-fold" ||
      (c.d.lane === "portrait" && c.d.kind === "truncated"),
  },
  "longer-protein": {
    says: "a longer protein is made: the message survives and its stop is read past the protein's own end",
    basis: "rule",
    holds: (c) => {
      const k = codon(c);
      return !(c.d as any).fate && k?.terminator != null && k.terminator > k.residues + 1;
    },
  },
  "stop-ahead": { says: "the misread or run-on reading meets a stop", holds: (c) => codon(c)?.terminator != null },
  "no-stop-ahead": {
    says: "no stop is met before the message ends",
    holds: (c) => {
      const k = codon(c);
      return !!k && k.terminator == null;
    },
  },

  /* ---- what isn't known: backed by ClinVar leaving the variant open. A classed variant has evidence
     of some effect or none, so P1 says nothing about its effect and P2 carries the evidence. ---- */
  "effect-unknown": {
    says: "what the change does isn't established: ClinVar leaves it open (uncertain, conflicting, or not in ClinVar)",
    holds: (c) => isOpen(c.v),
  },
  "cut-unknown": {
    says: "whether the change affects the cut isn't established: ClinVar leaves it open",
    holds: (c) => isOpen(c.v),
  },
};

export type ClaimCheck = {
  untrue: string[];
  unbacked: string[];
  unknown: string[];
  rule: string[];
  unaudited: boolean;
};
export function check(claims: string[] | undefined, c: Ctx): ClaimCheck {
  const r: ClaimCheck = { untrue: [], unbacked: [], unknown: [], rule: [], unaudited: claims == null };
  for (const id of claims ?? []) {
    const cl = CLAIMS[id];
    if (!cl) {
      r.unknown.push(id);
      continue;
    }
    const h = cl.holds(c);
    if (h === false) r.untrue.push(id);
    else if (h === null) r.unbacked.push(id);
    else if (cl.basis === "rule") r.rule.push(id);
  }
  return r;
}
