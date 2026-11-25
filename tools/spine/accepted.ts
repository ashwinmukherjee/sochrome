// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The differences from the baseline that were made on purpose, each with its reason. Parity is: these, and no others.

import type { Differ } from "./parity";

export interface Accepted {
  /** What changed and why, in a sentence. */
  why: string;
  /** How many differences this covers across both samples: one more or one fewer fails the check. */
  count: number;
  match(d: Differ): boolean;
}

const isAc0 = (x: unknown) => typeof x === "object" && x !== null && "filter" in x && x.filter === "AC0";

/** Findings the baseline listed as carriers that SPEC lists under YOUR VARIANTS: two changes in one gene (phase unknown). */
export const REGROUPED: { sample: string; gene: string; positions: number[] }[] = [
  { sample: "hg001", gene: "DNAH12", positions: [57392028, 57446013] },
];
const regrouped = (d: Differ) =>
  REGROUPED.some(
    (r) =>
      r.sample === d.sample &&
      /^(bundles|facts)\./.test(d.at) &&
      (r.positions.some((p) => d.at.includes(`:${p}:`)) || d.at.startsWith("bundles.order.")),
  );

export const ACCEPTED: Accepted[] = [
  {
    why: "Two changes in one recessive gene stay in YOUR VARIANTS, not carriers (SPEC: carriers). HG001's two DNAH12 changes move lists: each leaves carriers and joins the survivors (4), their facts change group (2), and the survivors' order shifts to take them in (7).",
    count: 13,
    match: regrouped,
  },
  {
    why: "gnomAD's AC0 records (the allele failed its quality checks) read as the join reads them, not seen, where the first fixtures carried the raw record. The copy reads both as unseen.",
    count: 3,
    match: (d) => /^p23\..*\.gnomad$/.test(d.at) && isAc0(d.was) && d.now === null,
  },
];
