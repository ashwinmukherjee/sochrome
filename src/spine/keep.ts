// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Which lines of a file the stages can use. The reader calls this on every data line, so it works on bytes and allocates nothing.

const TAB = 9;
const COMMA = 44;
const ZERO = 48;
const NINE = 57;
const MINUS = 45;
const SEMICOLON = 59;
const LT = 60;
const STAR = 42;
const DOT = 46;

/** Does the field at [s, e) start with the letters of `word`? */
function startsWith(b: Uint8Array, s: number, e: number, word: string): boolean {
  if (e - s < word.length) return false;
  for (let i = 0; i < word.length; i++) if (b[s + i] !== word.charCodeAt(i)) return false;
  return true;
}

/** The whole number after `key` ("END=", its "=" included) in the INFO field [s, e), a leading minus dropped; -1 when the key is not there. */
function infoNumber(b: Uint8Array, s: number, e: number, key: string): number {
  for (let i = s; i < e; i++) {
    if ((i === s || b[i - 1] === SEMICOLON) && startsWith(b, i, e, key)) {
      let j = i + key.length;
      if (b[j] === MINUS) j++;
      let n = 0;
      let digits = 0;
      for (; j < e && b[j] >= ZERO && b[j] <= NINE; j++, digits++) n = n * 10 + (b[j] - ZERO);
      return digits ? n : -1;
    }
  }
  return -1;
}

/** One chromosome's reference windows, merged: 1-based inclusive, flattened [s0, e0, s1, e1, …], sorted. */
export type Windows = Int32Array;
/** Windows per chromosome, in ledger order; none for a chromosome the bundle doesn't cover. */
export type KeepWindows = (Windows | undefined)[];

/** Merged keep windows from a chromosome's reference index. */
export function windowsOf(index: readonly { start: number; end: number }[]): Windows {
  const sorted = [...index].sort((a, b) => a.start - b.start);
  const out: number[] = [];
  for (const { start, end } of sorted) {
    const n = out.length;
    if (n && start <= out[n - 1] + 1) out[n - 1] = Math.max(out[n - 1], end);
    else out.push(start, end);
  }
  return Int32Array.from(out);
}

/** Does [lo, hi] touch a window? */
function touches(w: Windows, lo: number, hi: number): boolean {
  let a = 0;
  let b = w.length >> 1;
  while (a < b) {
    const m = (a + b) >>> 1;
    if (w[2 * m + 1] < lo) a = m + 1;
    else b = m;
  }
  return a < w.length >> 1 && w[2 * a] <= hi;
}

/** How many of [lo, hi]'s positions lie in the windows. */
function overlap(w: Windows, lo: number, hi: number): number {
  let a = 0;
  let b = w.length >> 1;
  while (a < b) {
    const m = (a + b) >>> 1;
    if (w[2 * m + 1] < lo) a = m + 1;
    else b = m;
  }
  let n = 0;
  for (; a < w.length >> 1 && w[2 * a] <= hi; a++) n += Math.min(hi, w[2 * a + 1]) - Math.max(lo, w[2 * a]) + 1;
  return n;
}

/** How many positions the windows hold. */
export function windowBases(w: Windows | undefined): number {
  let n = 0;
  if (w) for (let i = 0; i < w.length; i += 2) n += w[i + 1] - w[i] + 1;
  return n;
}

/** What a file says it read of one chromosome's windows, added up line by line. */
export interface Covered {
  /** Window positions inside a called reference block or a record's REF. */
  bases: number;
  /** Reference blocks seen: only a gVCF has any. */
  blocks: number;
}

/** A gVCF's stand-in for any allele not seen: <NON_REF> or <*>. It is never a change the person carries. */
function isNonRef(b: Uint8Array, a: number, z: number): boolean {
  return b[a] === LT && ((z - a === 9 && startsWith(b, a, z, "<NON_REF>")) || (z - a === 3 && b[a + 1] === STAR));
}

/** A line's verdict, packed so the reader's loop allocates nothing: see `recordsIn` and `isKept`. */
export type LineVerdict = number;
export const recordsIn = (v: LineVerdict): number => v >> 1;
export const isKept = (v: LineVerdict): boolean => (v & 1) === 1;

/**
 * One data line, bytes [s, e) of `b` with no newline: how many records it holds (one per ALT
 * allele, as the parse stage splits them) and whether the stages can use it.
 *
 * Kept when [POS - 1, POS + len(REF)] touches a reference window. That is everything normalize can
 * read: a substitution stays inside its REF; an indel is left-aligned from the base before it, and
 * left-alignment stops where the reference does. A symbolic deletion, duplication or copy-number
 * allele (<DEL>, <DUP>, <CNV>) is kept when its whole span, POS to INFO's END (or POS + |SVLEN|),
 * touches one: it can start far from the gene it takes. A line with fewer than ten columns holds nothing.
 *
 * A gVCF's <NON_REF> (or <*>) allele is not a record, and a line with no other ALT is a reference
 * block: no record, never kept. With `covered`, each line adds the window positions it speaks for:
 * a block's POS to END where the genotype was called, a record's REF.
 */
export function scanLine(b: Uint8Array, s: number, e: number, w: Windows | undefined, covered?: Covered): LineVerdict {
  const t1 = b.indexOf(TAB, s);
  if (t1 < 0 || t1 >= e) return 0;
  const t2 = b.indexOf(TAB, t1 + 1);
  const t3 = b.indexOf(TAB, t2 + 1);
  const t4 = b.indexOf(TAB, t3 + 1);
  const t5 = b.indexOf(TAB, t4 + 1);
  if (t2 < 0 || t3 < 0 || t4 < 0 || t5 < 0 || t5 >= e) return 0;
  let t = t5;
  let t7 = -1;
  let t8 = -1;
  for (let col = 6; col <= 9; col++) {
    t = b.indexOf(TAB, t + 1);
    if (t < 0 || t >= e) return 0;
    if (col === 7) t7 = t;
    if (col === 8) t8 = t;
  }
  let records = 0;
  for (let a0 = t4 + 1; a0 < t5;) {
    let z = a0;
    while (z < t5 && b[z] !== COMMA) z++;
    if (!isNonRef(b, a0, z)) records++;
    a0 = z + 1;
  }
  if (!w) return records << 1;
  let pos = 0;
  for (let i = t1 + 1; i < t2; i++) pos = pos * 10 + (b[i] - ZERO);
  const refLen = t4 - t3 - 1;
  if (records === 0) {
    // A reference block speaks for POS to END, when its genotype was called at all.
    const called = !(startsWith(b, t8 + 1, t, "GT") && b[t + 1] === DOT);
    if (covered && called) {
      const end = infoNumber(b, t7 + 1, t8, "END=");
      covered.bases += overlap(w, pos, end >= 0 ? end : pos + refLen - 1);
      covered.blocks++;
    }
    return 0;
  }
  if (covered) covered.bases += overlap(w, pos, pos + refLen - 1);
  let hi = pos + refLen;
  const a = t4 + 1;
  if (b[a] === LT && (startsWith(b, a, t5, "<DEL") || startsWith(b, a, t5, "<DUP") || startsWith(b, a, t5, "<CNV"))) {
    const end = infoNumber(b, t7 + 1, t8, "END=");
    const len = end < 0 ? infoNumber(b, t7 + 1, t8, "SVLEN=") : -1;
    hi = Math.max(hi, end >= 0 ? end : len >= 0 ? pos + len : hi);
  }
  return (records << 1) | (touches(w, pos - 1, hi) ? 1 : 0);
}
