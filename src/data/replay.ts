// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// A finished result as the read events that would have produced it: how a sample plays, and how the descent is tested.

import type { GenomeResult, ReadEvent } from "../contracts/app";

/** Steps per chromosome: enough for a smooth fill, few enough to post. */
const STEPS = 24;

/** The events of reading `r`, in order, each with the time it lands (ms from the start) for a read `ms` long. */
export function replay(r: GenomeResult, ms: number): { at: number; event: ReadEvent }[] {
  const all = r.counts.all || 1;
  const out: { at: number; event: ReadEvent }[] = [
    { at: 0, event: { type: "start", displayName: r.displayName, bytesTotal: all } },
  ];
  let before = 0;
  r.parsed.forEach((records, chromIndex) => {
    if (!records) return;
    for (let s = 1; s <= STEPS; s++) {
      const fraction = s / STEPS;
      const read = before + records * fraction;
      out.push({
        at: (ms * read) / all,
        event: {
          type: "progress",
          chromIndex,
          fraction,
          records: Math.round(records * fraction),
          bytesRead: Math.round(read),
        },
      });
    }
    before += records;
    out.push({ at: (ms * before) / all, event: { type: "chrom-done", chromIndex, records } });
  });
  out.push(
    { at: ms, event: { type: "sex", copiesX: r.copiesX, pair: r.sexPair } },
    { at: ms, event: { type: "done", result: r } },
  );
  return out;
}
