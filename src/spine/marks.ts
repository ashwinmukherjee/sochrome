// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The ledger's marks: where each coding-cut survivor sits on its chromosome's coding ruler.

import { CDS_PADDING } from "../contracts/constants.ts";
import type { GnomadWindow } from "./join.ts";

/** A merged run of coding sequence: [start, end) 0-based, and the coding bases before it. */
type Run = [start: number, end: number, before: number];

/** The chromosome's coding ruler: its CDS windows with the padding taken off each side, merged. */
export function codingRuler(windows: readonly GnomadWindow[]): (pos: number) => number {
  const spans = windows
    .map((w): [number, number] => [w.start + CDS_PADDING, w.end - CDS_PADDING])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const runs: Run[] = [];
  let before = 0;
  for (const [a, b] of spans) {
    const last = runs[runs.length - 1];
    if (last && a <= last[1]) {
      before += Math.max(0, b - last[1]);
      last[1] = Math.max(last[1], b);
    } else {
      runs.push([a, b, before]);
      before += b - a;
    }
  }
  /** Coding bases before a 1-based position; one in the padding snaps to the nearest coding edge. */
  return (pos) => {
    if (!runs.length) return 0;
    const p = pos - 1;
    let lo = 0;
    let hi = runs.length - 1;
    let at = 0;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (runs[m][0] <= p) {
        at = m;
        lo = m + 1;
      } else hi = m - 1;
    }
    const [a, b, cum] = runs[at];
    return p < a ? cum : cum + Math.min(p - a, b - a);
  };
}
