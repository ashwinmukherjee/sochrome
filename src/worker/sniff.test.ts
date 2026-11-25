// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { describe, expect, it } from "vitest";
import { sniff } from "./sniff";

/** A zip's first local file header naming one entry: enough for the sniff, which reads no further. */
function zipOf(entry: string): File {
  const name = new TextEncoder().encode(entry);
  const header = new Uint8Array(30 + name.length);
  header.set([0x50, 0x4b, 0x03, 0x04]);
  header[26] = name.length & 0xff;
  header[27] = name.length >> 8;
  header.set(name, 30);
  return new File([header], "download.zip");
}

describe("the sniff, on a zip", () => {
  it("reads a chip company's zipped .txt or .csv as chip data", async () => {
    for (const entry of ["genome_Jane_Doe_v5_Full_20240101.txt", "AncestryDNA.txt", "MyHeritage_raw_dna_data.csv"])
      expect(await sniff(zipOf(entry))).toMatchObject({ ok: false, reason: "chip" });
  });

  it("asks for any other zip to be unzipped", async () => {
    expect(await sniff(zipOf("sample.vcf.gz"))).toMatchObject({ ok: false, reason: "zip" });
  });
});

describe("the sniff, on files that say what they are by their first bytes", () => {
  const of = (body: string, name = "a.txt") => sniff(new File([body], name));

  it("calls an empty file empty", async () => {
    expect(await of("", "a.vcf")).toMatchObject({ ok: false, reason: "empty" });
  });

  it("reads a chip file whose comment header was stripped as chip data", async () => {
    expect(await of("rs4477212\t1\t82154\tAA\nrs3094315\t1\t752566\tAG\n")).toMatchObject({ reason: "chip" });
    expect(await of("i7001348\t1\t1000\tCC\n")).toMatchObject({ reason: "chip" });
    expect(await of('"rs4477212","1","82154","AA"\n', "a.csv")).toMatchObject({ reason: "chip" });
  });

  it("tells a BCF", async () => {
    expect(await of("BCF\u0002\u0002rest", "a.bcf")).toMatchObject({ ok: false, reason: "bcf" });
  });
});
