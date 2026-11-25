// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { describe, expect, it } from "vitest";
import { LANDING_WORDS as W } from "./words";

describe("the landing's words", () => {
  it("are the decided lines", () => {
    expect([W.does, W.scope.before + W.scope.count(2132) + W.scope.after, W.known, W.notATest, W.privacy]).toEqual([
      "This tool reads your genome and finds the few variants that could affect you.",
      "It checks 2,132 genes known to be linked to a condition.",
      "For each one, it shows what is known about it, and what is not.",
      "It isn't a medical test, and nothing it shows is a diagnosis.",
      "Your genome is read on this device, and nothing about it is sent anywhere.",
    ]);
    expect(W.question(145)).toEqual([
      "145 of the genes are linked to cancer, serious heart conditions, or brain diseases like Parkinson's and ALS.",
    ]);
    expect(W.next).toBe("You'll choose your file next.");
    expect(W.download).toBe(
      "The first time, this downloads 90 MB of reference data, which can take a few minutes on mobile data.",
    );
  });

  it("word each decided refusal as decided, naming the product only through its slot", () => {
    const says = (reason: Parameters<typeof W.refusal>[0]) => W.refusal(reason, "{name}").says;
    expect(says("chip")).toEqual([
      "This is raw data from a chip-based test, like 23andMe's.",
      "A chip reads a few hundred thousand set places, not a whole genome, so {name} can't read it.",
    ]);
    expect(says("raw")).toEqual([
      "This file holds sequencing reads, before the variants in them have been found.",
      "{name} reads the VCF file made from them. Most providers offer one to download.",
    ]);
    expect(says("grch37")).toEqual([
      "This file is mapped to an older version of the reference genome, GRCh37.",
      "{name} reads files mapped to the current one, GRCh38. Some providers offer both.",
    ]);
    expect(says("no-build")).toEqual([
      "This file doesn't say which version of the reference genome it's mapped to.",
      "{name} reads files mapped to GRCh38, and can't check this one.",
    ]);
    expect(says("multi")).toEqual([
      "This file holds more than one person's genome.",
      "{name} reads one person at a time. A file with only yours will work.",
    ]);
    expect(says("no-sample")).toEqual([
      "This file lists variants, but not anyone's genome.",
      "{name} needs a VCF file of one person's genome.",
    ]);
    expect(says("structural")).toEqual([
      "This file holds only copy-number and structural calls, where long stretches of DNA are lost, gained or moved.",
      "{name} reads the small variants. Most providers put them in a separate VCF file.",
    ]);
    expect(says("no-variants")).toEqual([
      "None of this file's rows are on a chromosome {name} reads.",
      "{name} reads chromosomes 1 to 22, X and Y. A whole-genome VCF has millions of rows on them.",
    ]);
    expect(says("empty")).toEqual(["This file is empty.", "Downloading it again usually fixes this."]);
    expect(says("zip")).toEqual([
      "This file is a zip archive.",
      "{name} reads the VCF inside it. Unzip it first, then choose the .vcf or .vcf.gz file.",
    ]);
    expect(says("bcf")).toEqual([
      "This file is a BCF, a compressed binary form of a VCF.",
      "{name} reads the text form, ending in .vcf or .vcf.gz. Most providers offer one.",
    ]);
    expect(says("unreadable")).toEqual([
      "{name} can't read this file.",
      "It reads VCF files from whole-genome sequencing, ending in .vcf or .vcf.gz.",
    ]);
    expect(says("broken")).toEqual([
      "{name} stopped partway through this file, which looks damaged or cut short.",
      "Nothing from it was kept. Downloading it again usually fixes this.",
    ]);
  });

  it("never lay a failed download at the file's door", () => {
    const r = W.refusal("no-data", "{name}");
    expect(r.way).toBe("again");
    expect(r.says.join(" ")).not.toMatch(/this file|damaged|can't read/i);
    expect(W.refusal("old-browser", "{name}").way).toBe("none");
  });
});
