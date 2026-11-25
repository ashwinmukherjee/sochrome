// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// A VCF (BGZF, gzip or plain) read as a stream: the lines the stages can use are kept, the rest only counted.

import pako from "pako";
import type { ChromIndex } from "../contracts/app";
import { CHROMS } from "../contracts/constants";
import { isKept, recordsIn, scanLine, type Covered, type KeepWindows } from "../spine/keep";
import { Refusal } from "./refusal";

interface Scan {
  /** The kept data lines of each chromosome, in ledger order, verbatim. */
  lines: string[][];
  /** Every record of each chromosome, kept or not. */
  parsed: number[];
  /** What the file's reference blocks and records cover of each chromosome's windows. */
  covered: Covered[];
  /** Inflated bytes scanned. */
  bytesOut: number;
  /** Whether any record names an allele in its genotype: without one, the file is no one's genome. */
  called: boolean;
  /** Whether any record is a small variant, its ALT spelled in letters. */
  small: boolean;
  /** Whether any record is a symbolic allele (<DEL>, <DUP>, <CNV>, …) or a breakend: a copy-number or
   *  structural call. A file with these and no small variant is the wrong one of a test's VCFs. */
  structural: boolean;
}

interface StreamOptions {
  windows: KeepWindows;
  /** Each chromosome's length in letters, in ledger order: a position's share of it is the progress. */
  lengths: readonly number[];
  inflatedCap: number;
  keptCap: number;
  onProgress(chromIndex: ChromIndex, fraction: number, records: number, bytesRead: number): void;
  /** `kept`: the chromosome's kept lines, whole now that it is done. */
  onChromDone(chromIndex: ChromIndex, records: number, kept: readonly string[]): void;
}

const TAB = 9;
const NL = 10;
const CR = 13;
const HASH = 35;
const COLON = 58;
const DOT = 46;
const LT = 60;
const OPEN = 91; // [
const CLOSE = 93; // ]
const ZERO = 48;
const NINE = 57;
const G = 71;
const T = 84;

/** Compressed bytes read per slice of the file. */
const SLICE_BYTES = 8 << 20;
/** BGZF members inflating at once; their output is still scanned in order. */
const INFLIGHT = 16;
/** The longest a BGZF member can be, and the header bytes that state its length. */
const BGZF_MAX_BLOCK = 65536;
export const BGZF_HEADER = 18;
/** The empty member every BGZF writer ends on (SAM specification §4.1.2): without it the file was cut short. */
const BGZF_EOF = Uint8Array.from([31, 139, 8, 4, 0, 0, 0, 0, 0, 255, 6, 0, 66, 67, 2, 0, 27, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0]); // prettier-ignore
/** A position is read for progress once in this many lines, and progress is told in steps of this share. */
const PROGRESS_EVERY_LINES = 1024;
const PROGRESS_STEP = 1 / 200;

/** The names each chromosome goes by, in lower case: "1", "chr1", and RefSeq's accession "nc_000001". */
const INDEX = new Map<string, number>(
  CHROMS.flatMap((c, i) => [c.toLowerCase(), `chr${c.toLowerCase()}`, `nc_${String(i + 1).padStart(6, "0")}`].map((n) => [n, i] as const)), // prettier-ignore
);

/**
 * A contig's chromosome in ledger order, or -1 for one outside 1 to 22, X and Y. Case does not count
 * ("Chr1"), nor does a RefSeq accession's version: as for any other name, the header's contig
 * lengths and the file's REF letters decide the build.
 */
export const chromIndex = (name: string): number =>
  INDEX.get(name.toLowerCase().replace(/^(nc_\d+)\.\d+$/, "$1")) ?? -1;

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const o = new Uint8Array(a.length + b.length);
  o.set(a);
  o.set(b, a.length);
  return o;
}

/** Scans lines out of byte chunks. Holds at most one partial line between chunks. */
class Scanner {
  private carry: Uint8Array | null = null;
  private readonly dec = new TextDecoder();
  private chromBytes = new Uint8Array(0);
  private chrom = -1;
  /** The kept lines' own name for the chromosome, when the file spells it another way ("Chr1", "NC_000001.11"). */
  private rename: string | null = null;
  private sinceProgress = 0;
  private told = 0;
  private keptBytes = 0;
  /** The last record line, its chromosome and position: a row written twice in a row is read once. Held in the
   *  chunk it came from while that chunk is being read, copied out before the chunk is let go. */
  private prev: { b: Uint8Array; s: number; e: number } | null = null;
  private prevChrom = -1;
  private prevPos = -1;
  /** Compressed bytes read so far, set by whoever feeds the scanner. */
  bytesIn = 0;
  readonly scan: Scan = {
    lines: CHROMS.map(() => []),
    parsed: CHROMS.map(() => 0),
    covered: CHROMS.map(() => ({ bases: 0, blocks: 0 })),
    bytesOut: 0,
    called: false,
    small: false,
    structural: false,
  };

  constructor(private readonly o: StreamOptions) {}

  push(chunk: Uint8Array): void {
    this.scan.bytesOut += chunk.length;
    if (this.scan.bytesOut > this.o.inflatedCap) throw new Refusal("too-large", `more than ${this.o.inflatedCap} bytes inflated`); // prettier-ignore
    let start = 0;
    if (this.carry) {
      const nl = chunk.indexOf(NL);
      if (nl < 0) {
        this.carry = concat(this.carry, chunk);
        return;
      }
      const joined = concat(this.carry, chunk.subarray(0, nl));
      this.line(joined, 0, joined.length);
      this.carry = null;
      start = nl + 1;
    }
    for (;;) {
      const nl = chunk.indexOf(NL, start);
      if (nl < 0) break;
      this.line(chunk, start, nl);
      start = nl + 1;
    }
    // Copied: the chunk is not the scanner's to keep.
    if (start < chunk.length) this.carry = chunk.slice(start);
    const p = this.prev;
    if (p && p.b === chunk) this.prev = { b: chunk.slice(p.s, p.e), s: 0, e: p.e - p.s };
  }

  end(): Scan {
    if (this.carry?.length) this.line(this.carry, 0, this.carry.length);
    this.carry = null;
    this.leave();
    return this.scan;
  }

  private leave(): void {
    if (this.chrom >= 0) this.o.onChromDone(this.chrom, this.scan.parsed[this.chrom], this.scan.lines[this.chrom]);
  }

  private enter(b: Uint8Array, s: number, e: number): void {
    const cb = this.chromBytes;
    if (cb.length === e - s) {
      let same = true;
      for (let i = 0; i < cb.length && same; i++) same = cb[i] === b[s + i];
      if (same) return;
    }
    this.leave();
    this.chromBytes = b.slice(s, e);
    const name = this.dec.decode(this.chromBytes);
    this.chrom = chromIndex(name);
    const own = this.chrom >= 0 ? CHROMS[this.chrom] : "";
    this.rename = this.chrom >= 0 && name !== own && name !== `chr${own}` ? `chr${own}` : null;
    this.sinceProgress = 0;
    this.told = 0;
  }

  /** Whether a record [s, e) is a small variant, or a copy-number or structural call; "." is neither. */
  private kind(b: Uint8Array, s: number, e: number): void {
    const alt = altOf(b, s, e);
    if (!alt || b[alt.at] === DOT) return;
    const bracket = b.subarray(alt.at, alt.end).findIndex((x) => x === OPEN || x === CLOSE) >= 0;
    if (b[alt.at] === LT || bracket) this.scan.structural = true;
    else this.scan.small = true;
  }

  /** One line, bytes [s, e) of b, without its newline. */
  private line(b: Uint8Array, s: number, e: number): void {
    if (e > s && b[e - 1] === CR) e--;
    if (e <= s || b[s] === HASH) return;
    const t1 = b.indexOf(TAB, s);
    if (t1 < 0 || t1 >= e) return;
    this.enter(b, s, t1);
    const c = this.chrom;
    // A contig outside 1 to 22, X and Y is not part of the count.
    if (c < 0) return;
    // The same row twice in a row is one record: compared in full only when the position repeats.
    let pos = 0;
    for (let i = t1 + 1; i < e && b[i] !== TAB; i++) pos = pos * 10 + (b[i] - ZERO);
    if (c === this.prevChrom && pos === this.prevPos && this.prev && same(this.prev, b, s, e)) return;
    this.prev = { b, s, e };
    this.prevChrom = c;
    this.prevPos = pos;
    // Looked for until the first is found: in a genome, that is the first record.
    if (!this.scan.called) this.scan.called = called(b, s, e);
    const verdict = scanLine(b, s, e, this.o.windows[c], this.scan.covered[c]);
    this.scan.parsed[c] += recordsIn(verdict);
    // Looked for until the first small variant: in a genome of small variants, that is the first record.
    if (!this.scan.small && recordsIn(verdict) > 0) this.kind(b, s, e);
    if (isKept(verdict)) {
      this.keptBytes += e - s;
      if (this.keptBytes > this.o.keptCap) throw new Refusal("too-large", `more than ${this.o.keptCap} bytes of lines to read`); // prettier-ignore
      // A line is kept under the reader's own name, so every later stage reads one spelling.
      const text = this.rename ? this.rename + this.dec.decode(b.subarray(t1, e)) : this.dec.decode(b.subarray(s, e));
      this.scan.lines[c].push(text);
    }
    if (++this.sinceProgress >= PROGRESS_EVERY_LINES) {
      this.sinceProgress = 0;
      const fraction = Math.min(1, pos / (this.o.lengths[c] || pos || 1));
      if (fraction - this.told >= PROGRESS_STEP) {
        this.told = fraction;
        this.o.onProgress(c, fraction, this.scan.parsed[c], this.bytesIn);
      }
    }
  }
}

/** Whether the line [s, e) of `b` is byte for byte the line `p` holds. */
function same(p: { b: Uint8Array; s: number; e: number }, b: Uint8Array, s: number, e: number): boolean {
  if (p.e - p.s !== e - s) return false;
  for (let i = 0; i < e - s; i++) if (p.b[p.s + i] !== b[s + i]) return false;
  return true;
}

/** The first byte of ALT, the fifth column, of the data line [s, e) of `b`; and where ALT ends. */
function altOf(b: Uint8Array, s: number, e: number): { at: number; end: number } | null {
  let at = s;
  for (let col = 0; col < 4; col++) {
    at = b.indexOf(TAB, at) + 1;
    if (at <= 0 || at >= e) return null;
  }
  const end = b.indexOf(TAB, at);
  return { at, end: end < 0 || end > e ? e : end };
}

/** Whether the data line [s, e) of `b` names an allele in its sample's GT: "0/1" or "0/0" does, "./." does not. */
function called(b: Uint8Array, s: number, e: number): boolean {
  // FORMAT is the ninth column, the sample the tenth.
  let f = s;
  for (let col = 0; col < 8; col++) {
    f = b.indexOf(TAB, f) + 1;
    if (f <= 0 || f >= e) return false;
  }
  const g = b.indexOf(TAB, f);
  if (g < 0 || g >= e) return false;
  let gt = 0;
  for (let at = f; ; gt++) {
    let z = at;
    while (z < g && b[z] !== COLON) z++;
    if (z - at === 2 && b[at] === G && b[at + 1] === T) break;
    if (z >= g) return false;
    at = z + 1;
  }
  let p = g + 1;
  for (let i = 0; i < gt && p < e; i++) {
    while (p < e && b[p] !== COLON && b[p] !== TAB) p++;
    p++;
  }
  for (; p < e && b[p] !== COLON && b[p] !== TAB; p++) if (b[p] >= ZERO && b[p] <= NINE) return true;
  return false;
}

/** A BGZF member's length from its header at `at`, or -1 when it is not one (SAM specification §4.1: BSIZE in the "BC" subfield). */
export function bgzfBlockLength(h: Uint8Array, at: number): number {
  if (h[at] !== 0x1f || h[at + 1] !== 0x8b || h[at + 2] !== 8 || !(h[at + 3] & 4)) return -1;
  const xlen = h[at + 10] | (h[at + 11] << 8);
  for (let p = at + 12; p + 4 <= at + 12 + xlen;) {
    const slen = h[p + 2] | (h[p + 3] << 8);
    if (h[p] === 66 && h[p + 1] === 67 && slen === 2) return (h[p + 4] | (h[p + 5] << 8)) + 1;
    p += 4 + slen;
  }
  return -1;
}

/** One gzip member through its own native stream, written directly: about twice as fast as piping a Blob through. */
export async function inflateMember(member: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("gzip");
  const w = ds.writable.getWriter();
  // A write that fails also fails the read below, which is where it is reported.
  w.write(member as Uint8Array<ArrayBuffer>).catch(() => undefined);
  w.close().catch(() => undefined);
  const rd = ds.readable.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    parts.push(value);
    n += value.length;
  }
  if (parts.length === 1) return parts[0];
  const o = new Uint8Array(n);
  let k = 0;
  for (const p of parts) {
    o.set(p, k);
    k += p.length;
  }
  return o;
}

/**
 * BGZF is a run of gzip members, and a native stream stops after the first: the members are cut
 * by the length each states and inflated one stream apiece.
 */
async function readBgzf(file: Blob, sc: Scanner): Promise<void> {
  let off = 0;
  let buf: Uint8Array = new Uint8Array(0);
  let last: Uint8Array = new Uint8Array(0);
  const queue: Promise<Uint8Array>[] = [];
  const drain = async (keep: number) => {
    while (queue.length > keep) {
      const next = queue.shift();
      if (next) sc.push(await next);
    }
  };
  for (;;) {
    if (buf.length < BGZF_MAX_BLOCK + BGZF_HEADER && off < file.size) {
      const s = new Uint8Array(await file.slice(off, Math.min(file.size, off + SLICE_BYTES)).arrayBuffer());
      off += s.length;
      buf = buf.length ? concat(buf, s) : s;
      sc.bytesIn = off;
    }
    if (buf.length === 0) break;
    if (buf.length < BGZF_HEADER) throw new Error("the file ends inside a block's header");
    const length = bgzfBlockLength(buf, 0);
    if (length < 0) throw new Error(`not a BGZF block at compressed byte ${off - buf.length}`);
    if (buf.length < length) throw new Error("the file ends inside a block");
    const member = inflateMember(buf.subarray(0, length));
    // A member that fails while an earlier one is awaited is reported when its turn comes.
    member.catch(() => undefined);
    queue.push(member);
    last = buf.subarray(0, length);
    buf = buf.subarray(length);
    await drain(INFLIGHT);
  }
  await drain(0);
  // A file cut exactly between blocks inflates cleanly: only the missing end block shows it.
  if (last.length !== BGZF_EOF.length || last.some((b, i) => b !== BGZF_EOF[i]))
    throw new Error("the file ends without BGZF's end-of-file block");
}

/** What pako's inflater exposes beyond its typings: how much of the last chunk it left unread. */
interface Inflater extends pako.Inflate {
  ended: boolean;
  strm: { avail_in: number };
}

/** CRC-32 (RFC 1952 §8), the check a gzip member's trailer states: four tables, so four bytes go per step (about three times as fast). */
const CRC_TABLE = new Int32Array(1024);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
for (let n = 256; n < 1024; n++) CRC_TABLE[n] = (CRC_TABLE[n - 256] >>> 8) ^ CRC_TABLE[CRC_TABLE[n - 256] & 255];
function crc32(crc: number, b: Uint8Array): number {
  const t = CRC_TABLE;
  let c = ~crc;
  let i = 0;
  for (const n4 = b.length & ~3; i < n4; i += 4) {
    c ^= b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24);
    c = t[768 + (c & 255)] ^ t[512 + ((c >>> 8) & 255)] ^ t[256 + ((c >>> 16) & 255)] ^ t[c >>> 24];
  }
  for (; i < b.length; i++) c = t[(c ^ b[i]) & 255] ^ (c >>> 8);
  return ~c >>> 0;
}

/** The length of the gzip member header at the start of `b` (RFC 1952 §2.3); 0 when `b` ends inside it, -1 when it is not one. */
function gzipHeaderLength(b: Uint8Array): number {
  if (b.length < 10) return b.length && b[0] !== 0x1f ? -1 : 0;
  if (b[0] !== 0x1f || b[1] !== 0x8b || b[2] !== 8) return -1;
  const flags = b[3];
  let at = 10;
  if (flags & 4) {
    if (b.length < at + 2) return 0;
    at += 2 + (b[at] | (b[at + 1] << 8));
  }
  // FNAME, then FCOMMENT: each runs to a zero byte.
  for (const bit of [8, 16])
    if (flags & bit) {
      const z = b.indexOf(0, at);
      if (z < 0) return 0;
      at = z + 1;
    }
  if (flags & 2) at += 2;
  return b.length < at ? 0 : at;
}

/**
 * Plain gzip, which may be several members end to end. pako's own step into a following member
 * fails ("invalid distance too far back"), so each member's header and trailer are read here and
 * only its deflate stream goes to a fresh raw inflater. The trailer's CRC-32 and length are checked.
 */
async function readGzip(file: Blob, sc: Scanner): Promise<void> {
  let crc = 0;
  let size = 0;
  const fresh = (): Inflater => {
    const inf = new pako.Inflate({ raw: true }) as Inflater;
    inf.onData = (chunk) => {
      const c = chunk as Uint8Array;
      crc = crc32(crc, c);
      size += c.length;
      sc.push(c);
    };
    return inf;
  };
  let inf = fresh();
  let at: "header" | "body" | "trailer" = "header";
  let members = 0;
  let rest: Uint8Array = new Uint8Array(0);
  const rd = file.stream().getReader();
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    sc.bytesIn += value.length;
    rest = rest.length ? concat(rest, value) : value;
    for (;;) {
      if (at === "body") {
        if (!rest.length) break;
        inf.push(rest, false);
        if (inf.err) throw new Error(`gzip: ${inf.msg}`);
        rest = rest.subarray(rest.length - inf.strm.avail_in);
        if (!inf.ended) break;
        at = "trailer";
      }
      if (at === "trailer") {
        if (rest.length < 8) break;
        const t = new DataView(rest.buffer, rest.byteOffset, 8);
        if (t.getUint32(0, true) !== crc || t.getUint32(4, true) !== size >>> 0)
          throw new Error(`gzip: member ${members} fails its check`);
        rest = rest.subarray(8);
        at = "header";
      }
      // Zero bytes after the last member are padding, as gzip itself allows.
      if (members > 0 && rest.every((b) => b === 0)) break;
      const head = gzipHeaderLength(rest);
      if (head < 0) throw new Error(`not a gzip member at compressed byte ${sc.bytesIn - rest.length}`);
      if (head === 0) break;
      rest = rest.subarray(head);
      inf = fresh();
      crc = 0;
      size = 0;
      members++;
      at = "body";
    }
  }
  if (at !== "header" || members === 0 || rest.some((b) => b !== 0))
    throw new Error("the file ends inside its compressed stream");
}

async function readPlain(file: Blob, sc: Scanner): Promise<void> {
  const rd = file.stream().getReader();
  for (;;) {
    const { done, value } = await rd.read();
    if (done) return;
    sc.bytesIn += value.length;
    sc.push(value);
  }
}

/** Read a VCF, keeping the lines that touch the windows. A file that stops making sense part-way is `broken`. */
export async function readVcf(file: Blob, options: StreamOptions): Promise<Scan> {
  const head = new Uint8Array(await file.slice(0, BGZF_HEADER).arrayBuffer());
  const gz = head[0] === 0x1f && head[1] === 0x8b;
  const sc = new Scanner(options);
  try {
    if (gz && head.length >= BGZF_HEADER && bgzfBlockLength(head, 0) >= 0) await readBgzf(file, sc);
    else if (gz) await readGzip(file, sc);
    else await readPlain(file, sc);
    return sc.end();
  } catch (e) {
    if (e instanceof Refusal) throw e;
    throw new Refusal("broken", e instanceof Error ? e.message : String(e));
  }
}
