// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The suite's contract: what goes in (a row of variants.tsv) and what an implementation must hand back.

/** one row of variants.tsv */
export type Input = {
  variation_id: string;
  chrom: string;
  pos: number;
  ref: string;
  alt: string;
  gene: string;
  consequence: string;
  class: string;
  review: string;
  clnsig: string;
  revstat: string;
  clnsigconf: string;
  submitters: number | null;
  mc: string;
  clnvc: string;
  origin: string;
  stratum: string;
};
/** one row of expected.tsv (oracle.py) */
export type Expected = {
  variation_id: string;
  scope: "in" | "out";
  loc: string;
  effect: string;
  aa: number | null;
  fate: string;
  skip_exon: number | null;
  skip_inframe: boolean | null;
  exon_kind: string;
  plen: number | null;
  tx_ok: boolean;
};
/** the person's copies the copy is read under */
/** copiesX null: the file's X does not say one copy or two. */
export type Scenario = {
  id: "het" | "one-x" | "x-unclear" | "x-all" | "hom" | "two-changes";
  zygosity: string;
  copiesX: number | null;
};

/** one line of copy as a room would show it */
export type CopyLine = {
  room: "P1" | "P2" | "P3";
  scenario: string;
  /** the template group (P1: lane--kind; P2/P3: the lab kind) and its part (P1: beat; P2/P3: unit) */
  kind: string;
  unit: string;
  /** the template line's id, so a finding points at the line to edit */
  template: string;
  /** the filled sentence */
  text: string;
  /** claim: the serif claim box (measured at both widths); row: a mono row (measured in characters) */
  box: "claim" | "row";
  rowMax?: number;
  /** slots the line names that this variant has no value for */
  missing: string[];
  /** problems only the implementation can see (P1: a declared claim its facts make untrue; two
   *  lines competing). The rebuild reports its own or leaves this empty. */
  implProblems: string[];
  drawing?: number;
};
/** a part of a room no line covers for this variant */
export type Gap = { room: string; scenario?: string; kind: string; unit: string; tags: string[]; why: string };

export type Observed = {
  id: string;
  /** every stage that threw, with its message: never swallowed */
  throws: { stage: string; error: string }[];
  /** in: the variant reaches a room (within 8 letters of the gene's coding sequence) */
  scope: "in" | "out";
  scopeWhy?: string;
  pinnedTo?: string[];
  /** in the oracle's vocabulary, for comparison with expected.tsv: see check.ts's `compare` */
  annotation?: {
    consequence: string;
    hgvs_c: string | null;
    hgvs_p: string | null;
    transcript: string;
    cds_distance: number | null;
    splice_distance: number | null;
    exon_edge: number | null;
    normalized_key: string;
  };
  join?: {
    clinvar: { variation_id: number; clnsig: string; stars: number; hgvs_c: string } | null;
    gnomad: any;
    am: any;
  };
  gates?: { coding: boolean; changesProtein: boolean };
  bundle?: { zygosity: string; inheritance: unknown };
  protein?: {
    status: string;
    uniprot: string | null;
    note: string;
    plen: number;
    pieces: number;
    tailComplete: boolean;
  };
  /** the facts stage: what follows (destroyed / no-stop / null), the stop codon, the drawings */
  derived?: {
    fate: string | null;
    terminator: number | null;
    seam: number | null;
    row: string;
    drawings: string[];
    pending: string[];
    junction: any;
  };
  facts: any;
  lab?: Record<
    string,
    { tags: string[]; p3: string; pattern: string | null; label: string; chart: string; points: number; bars: string[] }
  >;
  copy: CopyLine[];
  gaps: Gap[];
  implProblems: string[];
};
