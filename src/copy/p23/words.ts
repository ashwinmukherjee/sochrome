// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Words and classes the small-change and copy-number models share.

/** ClinVar's classes the labs' call counts as harmful, and as harmless. */
export const HARMFUL = ["pathogenic", "likely-pathogenic", "pathogenic-likely"];
export const HARMLESS = ["benign", "likely-benign", "benign-likely"];

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
/** AP style: one to nine in words, 10 up in numerals. */
export const num = (n: number): string => (n < 10 ? WORDS[n] : n.toLocaleString("en-US"));

/** A share of the protein in words. */
export const pct = (x: number): string =>
  x < 0.01 ? "less than 1%" : x >= 0.5 ? `about ${Math.round(x * 10) * 10}%` : `about ${Math.round(x * 100)}%`;
