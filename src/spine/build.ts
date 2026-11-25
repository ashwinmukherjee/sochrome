// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Whether a file is on the reference the bundle was built on, told from its own REF letters.

import type { ChromData } from "../contracts/app.ts";
import { getRefBases } from "./tables.ts";

/** REF letters compared with the reference, and how many records agreed in every letter. */
export interface RefTally {
  checked: number;
  matched: number;
}

/** At or over `matches` of the records agreeing, the file is on this reference; at or under `differs`, it is not. */
export const REF_SHARE = { matches: 0.9, differs: 0.6 } as const;
/** Fewer records than this decide nothing. */
export const REF_MIN_RECORDS = 50;

/**
 * Add a chromosome's kept data lines to the tally. A record is checked when its whole REF lies in
 * the shipped reference and is spelled in A, C, G and T. On another build a position holds an
 * unrelated letter, so about a quarter of single letters agree by chance and longer REFs almost never.
 */
export function checkRefLetters(
  lines: readonly string[],
  reference: ChromData["reference"],
  tally: RefTally = { checked: 0, matched: 0 },
): RefTally {
  for (const line of lines) {
    const [, pos, , ref] = line.split("\t", 4);
    if (!ref || !/^[ACGTacgt]+$/.test(ref)) continue;
    const letters = getRefBases(reference.bin, reference.index, Number(pos), ref.length);
    if (letters === null) continue;
    tally.checked++;
    if (letters === ref.toUpperCase()) tally.matched++;
  }
  return tally;
}

/** What the tally says: the file is on this reference, on another, or has too few records to say. */
export function referenceVerdict(t: RefTally): "matches" | "differs" | "undecided" {
  if (t.checked < REF_MIN_RECORDS) return "undecided";
  const share = t.matched / t.checked;
  return share >= REF_SHARE.matches ? "matches" : share <= REF_SHARE.differs ? "differs" : "undecided";
}
