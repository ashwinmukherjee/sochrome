// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// How many copies of X a person has, from the X records of their own file. Used to read X; never shown.

import type { SampleSex, VcfRecord } from "../contracts/types.ts";

/** GRCh38's pseudoautosomal regions: two copies in everyone, so they say nothing about X. */
export const PAR: readonly (readonly [number, number])[] = [
  [10_001, 2_781_479],
  [155_701_383, 156_030_895],
];

export const inPar = (pos: number): boolean => PAR.some(([s, e]) => pos >= s && pos <= e);

/** A share of two-allele X records that are heterozygous at or under `one` reads as one copy, at or over `two` as two. */
export const X_HET_SHARE = { one: 0.15, two: 0.35 } as const;
/** Fewer two-allele X records than this decide nothing. */
export const X_MIN_RECORDS = 20;

/** The X genotypes outside the pseudoautosomal regions that carry the changed allele. */
export interface XTally {
  /** Called with one allele: the caller itself read one copy. */
  single: number;
  het: number;
  hom: number;
}

export function tallyX(records: readonly Pick<VcfRecord, "pos" | "gt">[]): XTally {
  const t: XTally = { single: 0, het: 0, hom: 0 };
  for (const r of records) {
    if (inPar(r.pos)) continue;
    const alleles = r.gt.split(/[/|]/);
    if (alleles.some((a) => a === ".") || !alleles.some((a) => a !== "0")) continue;
    if (alleles.length === 1) t.single++;
    else if (alleles.length === 2) t[alleles[0] === alleles[1] ? "hom" : "het"]++;
  }
  return t;
}

/**
 * 1, 2, or null when the file has no X or its X does not say.
 * One-allele calls decide when they are most of the records. Otherwise the heterozygous share
 * decides: one X cannot be heterozygous, bar a few miscalls; with two, about half the records are.
 */
export function copiesOfX(t: XTally): 1 | 2 | null {
  const two = t.het + t.hom;
  if (t.single > two) return 1;
  if (two < X_MIN_RECORDS) return null;
  const share = t.het / two;
  if (share <= X_HET_SHARE.one) return 1;
  if (share >= X_HET_SHARE.two) return 2;
  return null;
}

export const sexOf = (copiesX: 1 | 2 | null): SampleSex =>
  copiesX === 1 ? "male" : copiesX === 2 ? "female" : "unknown";
