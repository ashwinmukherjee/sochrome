// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// A Node stand-in for the reader worker: streams a VCF once and keeps the lines the spine can use, per chromosome.

import { createReadStream, openSync, readSync, closeSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { CHROMS } from "../../src/contracts/constants";
import { isKept, recordsIn, scanLine, type Covered, type KeepWindows } from "../../src/spine/keep";

const TAB = 9;
const NL = 10;
const CR = 13;
const HASH = 35;

export interface Kept {
  /** The kept data lines per chromosome, in ledger order. */
  lines: string[][];
  /** Every record per chromosome, kept or not. */
  parsed: number[];
  /** The header's lines. */
  headers: string[];
  /** What the file's reference blocks and records cover of each chromosome's windows. */
  covered: Covered[];
}

const INDEX = new Map<string, number>(CHROMS.flatMap((c, i) => [[c, i] as const, [`chr${c}`, i] as const]));

function isGzip(path: string): boolean {
  const fd = openSync(path, "r");
  const head = Buffer.alloc(2);
  readSync(fd, head, 0, 2, 0);
  closeSync(fd);
  return head[0] === 0x1f && head[1] === 0x8b;
}

/** Read `path` (plain, gzip or BGZF) and keep the lines the spine's keep rule keeps. */
export async function readKept(path: string, windows: KeepWindows): Promise<Kept> {
  const out: Kept = { lines: CHROMS.map(() => []), parsed: CHROMS.map(() => 0), headers: [], covered: CHROMS.map(() => ({ bases: 0, blocks: 0 })) }; // prettier-ignore
  let chromBytes = Buffer.alloc(0);
  let chrom = -1;

  const line = (b: Buffer, s: number, e: number): void => {
    if (e > s && b[e - 1] === CR) e--;
    if (e <= s) return;
    if (b[s] === HASH) {
      out.headers.push(b.toString("utf8", s, e));
      return;
    }
    const t1 = b.indexOf(TAB, s);
    if (t1 < 0 || t1 >= e) return;
    if (chromBytes.length !== t1 - s || chromBytes.compare(b, s, t1) !== 0) {
      chromBytes = Buffer.from(b.subarray(s, t1));
      chrom = INDEX.get(chromBytes.toString("utf8")) ?? -1;
    }
    if (chrom < 0) return;
    const verdict = scanLine(b, s, e, windows[chrom], out.covered[chrom]);
    out.parsed[chrom] += recordsIn(verdict);
    if (isKept(verdict)) out.lines[chrom].push(b.toString("utf8", s, e));
  };

  const source = createReadStream(path, { highWaterMark: 1 << 20 });
  const stream = isGzip(path) ? source.pipe(createGunzip()) : source;
  let carry: Buffer | null = null;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    let start = 0;
    if (carry) {
      const nl = chunk.indexOf(NL);
      if (nl < 0) {
        carry = Buffer.concat([carry, chunk]);
        continue;
      }
      const joined = Buffer.concat([carry, chunk.subarray(0, nl)]);
      line(joined, 0, joined.length);
      carry = null;
      start = nl + 1;
    }
    for (;;) {
      const nl = chunk.indexOf(NL, start);
      if (nl < 0) break;
      line(chunk, start, nl);
      start = nl + 1;
    }
    if (start < chunk.length) carry = Buffer.from(chunk.subarray(start));
  }
  if (carry?.length) line(carry, 0, carry.length);
  return out;
}
