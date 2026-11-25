// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { describe, expect, it } from "vitest";
import { parseLine } from "./parse";

const line = (ref: string, alt: string, gt = "0/1") => `chr17\t100\t.\t${ref}\t${alt}\t50\tPASS\t.\tGT\t${gt}`;

describe("parseLine", () => {
  it("reads lowercase letters as capitals", () => {
    const [r] = parseLine(line("c", "t"));
    expect([r.ref, r.alt]).toEqual(["C", "T"]);
    expect(parseLine(line("acg", "a,cG", "1/2")).map((x) => [x.ref, x.alt])).toEqual([
      ["ACG", "A"],
      ["ACG", "CG"],
    ]);
  });

  it("leaves a symbolic allele as written", () => {
    const [r] = parseLine(line("a", "<DEL>"));
    expect([r.ref, r.alt]).toEqual(["A", "<DEL>"]);
    expect(parseLine(line("g", "g]chr17:200]"))[0].alt).toBe("g]chr17:200]");
  });
});
