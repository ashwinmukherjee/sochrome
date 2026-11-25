// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { CHROMS } from "../contracts/constants";
import { Refusal } from "./refusal";
import { chromIndex, readVcf } from "./stream";

/** `n` chr1 records from `from` on, varied enough that deflate reaches far back. */
const records = (from: number, n: number) =>
  Array.from({ length: n }, (_, i) => `chr1\t${from + i * 7}\t.\tA\tG\t${(i * 37) % 99}\tPASS\tDP=${(i * 13) % 71}\tGT\t0/1\n`).join(""); // prettier-ignore

/** No windows: nothing kept, nothing compared, every record counted. */
const options = {
  windows: CHROMS.map(() => undefined),
  lengths: CHROMS.map(() => 0),
  inflatedCap: Infinity,
  keptCap: Infinity,
  onProgress: () => undefined,
  onChromDone: () => undefined,
};

/** Every record on chr1, or the reason the read was refused. */
async function count(bytes: Uint8Array): Promise<number | string> {
  try {
    return (await readVcf(new Blob([bytes as Uint8Array<ArrayBuffer>]), options)).parsed[0];
  } catch (e) {
    return e instanceof Refusal ? e.reason : String(e);
  }
}

describe("readVcf, plain gzip", () => {
  const first = gzipSync(records(1, 20_000));
  const second = gzipSync(records(200_000, 20_000));

  it("reads every member of a file in several", async () => {
    expect(await count(Buffer.concat([first, second]))).toBe(40_000);
  });

  it("reads past zero bytes after the last member", async () => {
    expect(await count(Buffer.concat([first, Buffer.alloc(16)]))).toBe(20_000);
  });

  it("refuses a file cut inside a member, or one whose check fails", async () => {
    expect(await count(Buffer.concat([first, second.subarray(0, second.length - 4)]))).toBe("broken");
    const bad = Buffer.from(first);
    bad[bad.length - 8] ^= 1;
    expect(await count(bad)).toBe("broken");
  });
});

describe("chromIndex", () => {
  it("reads a chromosome's name in any case, and RefSeq's accession of any version", () => {
    expect(["1", "chr1", "Chr1", "CHR1", "NC_000001.11", "NC_000001.10"].map(chromIndex)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(["X", "chrx", "NC_000023.11", "Y", "NC_000024.10"].map(chromIndex)).toEqual([22, 22, 22, 23, 23]);
  });

  it("knows no other contig", () => {
    expect(["chrM", "MT", "chr1_KI270706v1_random", "NC_012920.1", "chr23", "NC_000025.1"].map(chromIndex)).toEqual([-1, -1, -1, -1, -1, -1]); // prettier-ignore
  });
});

describe("readVcf, genotypes", () => {
  const called = async (format: string, sample: string) =>
    (await readVcf(new Blob([`chr1\t100\t.\tA\tG\t50\tPASS\t.\t${format}\t${sample}\n`]), options)).called;

  it("finds a genotype that names an allele, wherever GT sits", async () => {
    expect(await called("GT:DP", "0/1:30")).toBe(true);
    expect(await called("DP:GT", "30:1")).toBe(true);
    expect(await called("GT", "0|0")).toBe(true);
  });

  it("finds none where GT is missing or names no allele", async () => {
    expect(await called("DP:AD", "30:10,20")).toBe(false);
    expect(await called("GT:DP", "./.:30")).toBe(false);
    expect(await called("DP:GT", "30:.")).toBe(false);
  });
});

describe("readVcf, small variants and large changes", () => {
  const kinds = async (...alts: string[]) => {
    const rows = alts.map((alt, i) => `chr1\t${100 + i * 10}\t.\tA\t${alt}\t50\tPASS\tEND=${200 + i * 10}\tGT\t0/1\n`);
    const { small, structural } = await readVcf(new Blob([rows.join("")]), options);
    return { small, structural };
  };

  it("tells a file of copy-number or structural calls alone", async () => {
    expect(await kinds("<DEL>", "<DUP>", "<CNV>", "A]chr2:500]")).toEqual({ small: false, structural: true });
  });

  it("tells small variants, beside large changes or not", async () => {
    expect(await kinds("G")).toEqual({ small: true, structural: false });
    expect(await kinds("<DEL>", "G", "T")).toEqual({ small: true, structural: true });
    expect(await kinds("G,<NON_REF>")).toEqual({ small: true, structural: false });
  });
});

describe("readVcf, a row written twice", () => {
  it("counts a row once when the next is the same, byte for byte, across chunk edges too", async () => {
    const row = "chr1\t100\t.\tA\tG\t50\tPASS\t.\tGT\t0/1\n";
    const other = "chr1\t100\t.\tA\tT\t50\tPASS\t.\tGT\t0/1\n";
    const counted = async (...parts: string[]) => (await readVcf(new Blob(parts), options)).parsed[0];
    expect(await counted(row, row, other)).toBe(2);
    expect(await counted(row, other, row)).toBe(3);
    // A chunk edge inside the second copy: Blob parts stream as separate chunks.
    expect(await counted(row + row.slice(0, 7), row.slice(7))).toBe(1);
  });
});
