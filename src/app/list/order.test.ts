// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { describe, expect, it } from "vitest";
import type { Finding } from "../../contracts/app";
import { order } from "./order";

/** Only what the order reads: ClinVar's class and stars, AlphaMissense's score, the key. */
function made(key: string, clnsig: string | null, stars: number, score: number | null): Finding {
  const p =
    clnsig === null ? { absent: true, reason: "not_in_table" } : { clnsig, qualifiers: [], review_stars: stars };
  const am = score === null ? { absent: true, reason: "not_missense" } : { score, am_class: "x" };
  return {
    key,
    bundle: {
      identity: { normalized_key: key, gene: key },
      claims: [
        { kind: "pathogenicity", value: p },
        { kind: "frequency" },
        { kind: "computational", value: am },
        { kind: "penetrance" },
      ],
    },
  } as unknown as Finding;
}

describe("order", () => {
  it("ranks class, then stars, then AlphaMissense, then genome order", () => {
    const f = [
      made("chr2:5:A:T", "Benign", 3, 0.9),
      made("chr1:9:A:T", null, 0, null),
      made("chr1:8:A:T", "Uncertain_significance", 1, 0.2),
      made("chr1:7:A:T", "Uncertain_significance", 2, 0.1),
      made("chrX:1:A:T", "Uncertain_significance", 1, null),
      made("chr3:1:A:T", "Uncertain_significance", 1, 0.6),
      made("chr10:1:A:T", "Likely_benign", 1, 0.5),
      made("chr2:1:A:T", "Likely_benign", 1, 0.5),
      made("chr4:1:A:T", "Pathogenic", 0, null),
      made("chr5:1:A:T", "Conflicting_classifications_of_pathogenicity", 1, 0.99),
      made("chr6:1:A:T", "Pathogenic/Likely_pathogenic", 1, null),
      made("chr7:1:A:T", "Likely_pathogenic", 3, null),
    ];
    expect(order(f).map((x) => x.key)).toEqual([
      "chr4:1:A:T",
      "chr6:1:A:T",
      "chr7:1:A:T",
      "chr5:1:A:T",
      "chr1:7:A:T",
      "chr3:1:A:T",
      "chrX:1:A:T",
      "chr1:8:A:T",
      "chr1:9:A:T",
      "chr2:1:A:T",
      "chr10:1:A:T",
      "chr2:5:A:T",
    ]);
  });

  it("keeps every finding and leaves its input alone", () => {
    const input = [
      made("chr2:1:A:T", "Benign", 1, 0.1),
      made("chr1:1:A:T", "Pathogenic", 2, null),
      made("chr3:1:A:T", null, 0, 0.9),
    ];
    const before = input.map((f) => f.key);
    const out = order(input);
    expect(new Set(out.map((f) => f.key))).toEqual(new Set(before));
    expect(input.map((f) => f.key)).toEqual(before);
  });
});
