// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { describe, expect, it } from "vitest";
import type { CnvFacts } from "../cnv.ts";
import { gate } from "./dosage.ts";

const change = (over: Partial<CnvFacts>): CnvFacts =>
  ({
    dir: "loss",
    where: "whole",
    inFrame: null,
    region: null,
    rating: { hi: null, ts: null, hiDisease: null, tsDisease: null },
    ...over,
  }) as CnvFacts;
const rated = (hi: string | null, ts: string | null) => ({ hi, ts, hiDisease: null, tsDisease: null });

describe("the dosage cut", () => {
  it("passes a loss of a gene ClinGen rates for losing a copy, dominant or recessive", () => {
    expect(gate(change({ rating: rated("3", null) }), 0, null)).toBe(true);
    expect(gate(change({ rating: rated("30", null) }), 0, null)).toBe(true);
  });
  it("holds back a gain unless an extra copy is a known cause", () => {
    expect(gate(change({ dir: "gain", rating: rated("3", "0") }), 0, null)).toBe(false);
    expect(gate(change({ dir: "gain", rating: rated(null, "3") }), 0, null)).toBe(true);
  });
  it("passes a change that wholly contains a ClinGen region rated 3", () => {
    const region = { id: "ISCA-37446", name: "22q11.2", score: "3", disease: null };
    expect(gate(change({ dir: "gain", region }), 0, null)).toBe(true);
  });
  it("reads an unrated gene by its known cut-short variants, only where the loss takes the gene out", () => {
    expect(gate(change({}), 5, null)).toBe(true);
    expect(gate(change({}), 4, null)).toBe(false);
    expect(gate(change({ where: "inside", inFrame: true }), 50, null)).toBe(false);
    expect(gate(change({ where: "inside", inFrame: false }), 50, null)).toBe(true);
    expect(gate(change({ where: "last-exon" }), 50, null)).toBe(false);
    expect(gate(change({ rating: rated("40", null) }), 50, null)).toBe(false);
  });
  it("never holds back a change a lab records as harmful", () => {
    expect(gate(change({ dir: "gain" }), 0, "Pathogenic")).toBe(true);
    expect(gate(change({ dir: "gain" }), 0, "Benign")).toBe(false);
  });
});
