// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Every word the ledger says. Labels are written in sentence case; CSS sets the caption uppercase.

/** A space that never breaks or collapses: before a count in parentheses, after the rows' key. */
export const NBSP = "\xa0";

const fmt = (n: number) => n.toLocaleString("en-US");

export const WORDS = {
  genome: "Your genome",
  reference: "Reference genome",
  /** The drawing's text alternative: the tally beside it carries the counts. */
  alt: "The genome as 23 rows: chromosomes 1 to 22, then the sex chromosomes.",
  /** The rows' key: stands left of a row's number while the row is pointed at. */
  key: "Chromosome",
  /** The 23rd row's key: it names the pair (XX, XY, or XX/XY where not known) and counts X's and Y's records.
   *  One chromosome alone (X, no Y) takes the rows' own key, "Chromosome". */
  sexKey: "Chromosomes",
  /** The pair the 23rd row names when neither the file nor its donor says. */
  sexUnknown: "XX/XY",
  count: (n: number) => `${fmt(n)} variant${n === 1 ? "" : "s"}`,
  /** Under the genes page a row counts its checked genes. */
  genes: (n: number) => `${fmt(n)} gene${n === 1 ? "" : "s"}`,
  /** Where a count would stand on the 23rd row when the file holds no X: shown on hover only. */
  notInFile: "not in this file",
} as const;
