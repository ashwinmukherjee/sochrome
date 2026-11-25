// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { describe, expect, it } from "vitest";
import type { ReferenceIndex, VcfRecord } from "../contracts/types";
import { normalize, type Dropped } from "./normalize";

/** A one-window reference spelling `letters` from position `start`, packed as the bundle packs it. */
function reference(start: number, letters: string): { bin: ArrayBuffer; index: ReferenceIndex } {
  const bytes = new Uint8Array(8 + Math.ceil(letters.length / 4));
  for (let i = 0; i < letters.length; i++) bytes[8 + (i >> 2)] |= "ACGT".indexOf(letters[i]) << (6 - (i % 4) * 2);
  const index = [{ start, end: start + letters.length - 1, symbol: "G1", offset: 0, bytes: bytes.length }];
  return { bin: bytes.buffer, index };
}

const rec = (pos: number, ref: string, alt: string): VcfRecord => ({
  chrom: "chr17",
  pos,
  id: ".",
  ref,
  alt,
  qual: 50,
  filter: "PASS",
  info: ".",
  gt: "0/1",
});

describe("normalize", () => {
  const { bin, index } = reference(100, "ACGTACGTAC");

  it("keeps a change written against the reference", () => {
    const dropped: Dropped[] = [];
    expect(normalize([rec(101, "C", "T")], bin, index, dropped).map((v) => v.alt)).toEqual(["T"]);
    expect(dropped).toEqual([]);
  });

  it("leaves out a record whose REF and ALT are the same, and says so", () => {
    const dropped: Dropped[] = [];
    expect(normalize([rec(101, "C", "C")], bin, index, dropped)).toEqual([]);
    expect(dropped.map((d) => d.key)).toEqual(["chr17:101:C:C"]);
  });
});
