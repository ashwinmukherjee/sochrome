// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { GeneInfo, GenomeResult } from "../../contracts/app";

const SAVED_LINE = { id: "u1", beat: null, when: ["first"], t: "Saved words about {gene}.", claims: [] };
vi.mock("../json/copy.json", () => ({
  voice: {},
  kinds: {
    "codon--silent": { status: "done", scrub: 1.2, note: "", lines: [SAVED_LINE] },
    "codon--nonsense": { status: "seed", scrub: 1, note: "", lines: [SAVED_LINE] },
  },
}));

const { linesOf, p1Copy, read, scrubOf } = await import("./room");
const { SEED } = await import("./seed");

const result = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../../test/fixtures/hg002.result.json"), "utf8"),
) as GenomeResult;
const finding = result.yours[0];
const gene = (job: string | null, jobReviewed: boolean): GeneInfo => ({
  symbol: finding.facts.gene,
  chrom: "",
  pos: 0,
  transcript: "",
  modes: [],
  conditions: {},
  job,
  jobReviewed,
  dosage: { hi: null, lofKnown: 0 },
  optIn: null,
});
const opening = (g: GeneInfo | undefined) => read(finding.facts, g)[0].rows[0].text;

describe("P1's copy", () => {
  it("takes a kind's saved lines once they are edited, and the draft until then", () => {
    expect(linesOf("codon--silent")).toEqual([SAVED_LINE]);
    expect(scrubOf("codon--silent")).toBe(1.2);
    expect(linesOf("codon--nonsense")).toBe(SEED["codon--nonsense"]);
    expect(linesOf("portrait--truncated")).toBe(SEED["portrait--truncated"]);
    expect(linesOf("portrait--absent")).toBeUndefined();
  });

  it("names a gene's job only once its line is reviewed", () => {
    const name = finding.facts.gene;
    expect(opening(gene("does a thing", true))).toBe(`The ${name} gene spells out a protein that does a thing.`);
    expect(opening(gene(null, true))).toBe(
      `The ${name} gene spells out a protein whose job isn't yet well understood.`,
    );
    expect(opening(gene("does a thing", false))).toBe(`The ${name} gene spells out a protein.`);
    expect(opening(undefined)).toBe(`The ${name} gene spells out a protein.`);
  });

  it("gives the room every shown line with its beat and its claims checked", () => {
    const copy = p1Copy(finding, gene(null, false));
    expect(copy).toHaveLength(finding.facts.drawings.length);
    expect(copy[0].lines[0]).toMatchObject({ beat: null, text: opening(undefined) });
    for (const d of copy) for (const l of d.lines) expect(l.claims.untrue).toEqual([]);
  });
});
