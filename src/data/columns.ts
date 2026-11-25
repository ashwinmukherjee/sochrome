// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The bundle's tables and folds as columns for the wire, and back: like values sit together so gzip finds them.

import type { FoldSource } from "../contracts/app";

// A packed table (spine/tables.ts) is a count, its sorted positions, each record's offset, then the records end to
// end: ref and alt as uint16-length strings, then the source's own fields. On the wire the positions are gaps, the
// offsets are lengths, an SNV's two letters are one byte, and the fields are transposed: every record's first byte,
// then every second byte. Decoding rebuilds the table byte for byte, so the reader's lookups are untouched.

const TABLE_FORMAT = 1;
/** An SNV's letters as one byte, ref * 4 + alt; anything else follows this byte spelled out. */
const SPELLED = 0xff;
const LETTERS = "ACGT";
const LETTER_CODES = Array.from(LETTERS, (c) => c.charCodeAt(0));

class Writer {
  private bytes = new Uint8Array(1 << 16);
  private size = 0;
  byte(b: number): void {
    if (this.size === this.bytes.length) {
      const grown = new Uint8Array(this.bytes.length * 2);
      grown.set(this.bytes);
      this.bytes = grown;
    }
    this.bytes[this.size++] = b;
  }
  /** An unsigned integer, seven bits a byte. */
  varint(v: number): void {
    if (!Number.isSafeInteger(v) || v < 0) throw new Error(`not a count: ${v}`);
    while (v >= 0x80) {
      this.byte((v % 0x80) | 0x80);
      v = Math.floor(v / 0x80);
    }
    this.byte(v);
  }
  /** A signed integer, zigzagged so small negatives stay short. */
  signed(v: number): void {
    this.varint(v < 0 ? -2 * v - 1 : 2 * v);
  }
  raw(b: Uint8Array): void {
    for (const x of b) this.byte(x);
  }
  done(): Uint8Array {
    return this.bytes.slice(0, this.size);
  }
}

class Reader {
  at = 0;
  constructor(private readonly b: Uint8Array) {}
  byte(): number {
    if (this.at >= this.b.length) throw new Error("a column ends early");
    return this.b[this.at++];
  }
  varint(): number {
    let v = 0;
    let scale = 1;
    for (;;) {
      const b = this.byte();
      v += (b & 0x7f) * scale;
      if (b < 0x80) return v;
      scale *= 0x80;
    }
  }
  signed(): number {
    const z = this.varint();
    return z % 2 ? -(z + 1) / 2 : z / 2;
  }
  take(n: number): Uint8Array {
    if (this.at + n > this.b.length) throw new Error("a column ends early");
    this.at += n;
    return this.b.subarray(this.at - n, this.at);
  }
}

/** Columns one after another, each led by its length. */
function joinColumns(columns: Uint8Array[]): Uint8Array {
  const out = new Writer();
  out.varint(columns.length);
  for (const c of columns) {
    out.varint(c.length);
    out.raw(c);
  }
  return out.done();
}

function splitColumns(b: Uint8Array): Uint8Array[] {
  const r = new Reader(b);
  return Array.from({ length: r.varint() }, () => r.take(r.varint()));
}

/** Record indices by field length, longest first, ties in table order: the records column j holds are a prefix. */
function longestFirst(lengths: Uint32Array): Uint32Array {
  let most = 0;
  for (const l of lengths) most = Math.max(most, l);
  const starts = new Uint32Array(most + 2);
  for (const l of lengths) starts[most - l + 1]++;
  for (let i = 1; i < starts.length; i++) starts[i] += starts[i - 1];
  const order = new Uint32Array(lengths.length);
  lengths.forEach((l, i) => (order[starts[most - l]++] = i));
  return order;
}

const letter = (s: Uint8Array): number => (s.length === 1 ? LETTERS.indexOf(String.fromCharCode(s[0])) : -1);

/** A packed table as columns. Throws on a table this layout can't rebuild exactly. */
export function encodeTable(table: Uint8Array): Uint8Array {
  const dv = new DataView(table.buffer, table.byteOffset, table.byteLength);
  const n = dv.getUint32(0, true);
  const payStart = 4 + 8 * n;
  const pay = table.subarray(payStart);
  const head = new Writer();
  const gaps = new Writer();
  const lengths = new Writer();
  const letters = new Writer();
  const bodies: Uint8Array[] = [];
  head.byte(TABLE_FORMAT);
  head.varint(n);
  let pos = 0;
  let next = 0;
  for (let i = 0; i < n; i++) {
    const p = dv.getUint32(4 + 4 * i, true);
    const o = dv.getUint32(4 + 4 * n + 4 * i, true);
    if (p < pos) throw new Error("a table's positions are out of order");
    if (o !== next) throw new Error("a table's records are not end to end");
    const end = i + 1 < n ? dv.getUint32(4 + 4 * n + 4 * (i + 1), true) : pay.length;
    gaps.varint(p - pos);
    lengths.varint(end - o);
    pos = p;
    next = end;
    const rl = pay[o] | (pay[o + 1] << 8);
    const ref = pay.subarray(o + 2, o + 2 + rl);
    const al = pay[o + 2 + rl] | (pay[o + 3 + rl] << 8);
    const alt = pay.subarray(o + 4 + rl, o + 4 + rl + al);
    const [r, a] = [letter(ref), letter(alt)];
    if (r >= 0 && a >= 0) letters.byte(r * 4 + a);
    else {
      letters.byte(SPELLED);
      letters.varint(rl);
      letters.raw(ref);
      letters.varint(al);
      letters.raw(alt);
    }
    const body = pay.subarray(o + 4 + rl + al, end);
    if (o + 4 + rl + al > end) throw new Error("a table's record is shorter than its letters");
    bodies.push(body);
  }
  if (next !== pay.length) throw new Error("a table's payload runs past its last record");
  const fields = new Writer();
  const order = longestFirst(Uint32Array.from(bodies, (b) => b.length));
  for (let j = 0, k = order.length; k > 0; j++) {
    while (k > 0 && bodies[order[k - 1]].length <= j) k--;
    for (let m = 0; m < k; m++) fields.byte(bodies[order[m]][j]);
  }
  return joinColumns([head.done(), gaps.done(), lengths.done(), letters.done(), fields.done()]);
}

/** The packed table, byte for byte, from its columns. */
export function decodeTable(wire: Uint8Array): ArrayBuffer {
  const [headCol, gapsCol, lengthsCol, lettersCol, fieldsCol] = splitColumns(wire);
  const head = new Reader(headCol);
  if (head.byte() !== TABLE_FORMAT) throw new Error("a table in a format this reader doesn't know");
  const n = head.varint();
  // The hot loop of a read's data arriving: varints are read in place rather than through a Reader.
  const letters = new Reader(lettersCol);
  const positions = new Uint32Array(n);
  const offsets = new Uint32Array(n);
  const spelled: [Uint8Array, Uint8Array][] = [];
  const codes = new Uint8Array(n);
  const bodyLength = new Uint32Array(n);
  let pos = 0;
  let size = 0;
  let g = 0;
  let l = 0;
  for (let i = 0; i < n; i++) {
    let gap = 0;
    for (let scale = 1, b = 0x80; b >= 0x80; scale *= 0x80) gap += ((b = gapsCol[g++]) & 0x7f) * scale;
    let length = 0;
    for (let scale = 1, b = 0x80; b >= 0x80; scale *= 0x80) length += ((b = lengthsCol[l++]) & 0x7f) * scale;
    pos += gap;
    positions[i] = pos;
    offsets[i] = size;
    size += length;
    const code = letters.byte();
    codes[i] = code;
    let letterBytes = 6;
    if (code === SPELLED) {
      const ref = letters.take(letters.varint());
      const alt = letters.take(letters.varint());
      spelled.push([ref, alt]);
      letterBytes = 4 + ref.length + alt.length;
    }
    bodyLength[i] = length - letterBytes;
  }
  if (g !== gapsCol.length || l !== lengthsCol.length) throw new Error("a table's columns don't match its count");
  const out = new Uint8Array(4 + 8 * n + size);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, n, true);
  for (let i = 0; i < n; i++) {
    dv.setUint32(4 + 4 * i, positions[i], true);
    dv.setUint32(4 + 4 * n + 4 * i, offsets[i], true);
  }
  const payStart = 4 + 8 * n;
  const bodyAt = new Uint32Array(n);
  for (let i = 0, s = 0; i < n; i++) {
    let at = payStart + offsets[i];
    if (codes[i] === SPELLED) {
      for (const b of spelled[s++]) {
        dv.setUint16(at, b.length, true);
        out.set(b, at + 2);
        at += 2 + b.length;
      }
    } else {
      for (const c of [codes[i] >> 2, codes[i] & 3]) {
        dv.setUint16(at, 1, true);
        out[at + 2] = LETTER_CODES[c];
        at += 3;
      }
    }
    bodyAt[i] = at;
  }
  const order = longestFirst(bodyLength);
  let f = 0;
  for (let j = 0, k = n; k > 0; j++) {
    while (k > 0 && bodyLength[order[k - 1]] <= j) k--;
    if (f + k > fieldsCol.length) throw new Error("a column ends early");
    for (let m = 0; m < k; m++) out[bodyAt[order[m]] + j] = fieldsCol[f++];
  }
  return out.buffer;
}

// A fold is JSON whose residues are the bulk: a letter, a CA position in Å to three places, and pLDDT to two.
// On the wire they are columns of whole numbers, each CA a step from the residue before (neighbours sit ~3.8 Å
// apart). A fold that doesn't keep that shape exactly stays JSON.

const FOLD_JSON = 0;
const FOLD_COLUMNS = 1;
const CA_SCALE = 1000;
const PLDDT_SCALE = 100;

interface Residue {
  aa1: string;
  ca: [number, number, number];
  plddt: number;
}

const scaled = (v: number, scale: number): number | null => {
  const q = Math.round(v * scale);
  return Object.is(q / scale, v) ? q : null;
};

const isResidue = (r: unknown): r is Residue => {
  if (!r || typeof r !== "object") return false;
  const keys = Object.keys(r).join();
  const { aa1, ca, plddt } = r as Residue;
  return (
    keys === "aa1,ca,plddt" &&
    typeof aa1 === "string" &&
    aa1.length === 1 &&
    aa1.charCodeAt(0) < 0x80 &&
    Array.isArray(ca) &&
    ca.length === 3 &&
    ca.every((v) => typeof v === "number" && scaled(v, CA_SCALE) !== null) &&
    typeof plddt === "number" &&
    plddt >= 0 &&
    scaled(plddt, PLDDT_SCALE) !== null
  );
};

const asJson = (json: Uint8Array): Uint8Array => joinColumns([Uint8Array.of(FOLD_JSON), json]);

/** A fold's JSON as columns, or as itself when its residues don't fit them exactly. */
export function encodeFold(json: Uint8Array): Uint8Array {
  const source = JSON.parse(new TextDecoder().decode(json)) as { fold?: { residues?: unknown } | null };
  const residues = source.fold?.residues;
  if (!Array.isArray(residues) || !residues.every(isResidue)) return asJson(json);
  // The residues' place in the fold is kept, so the decoded fold has the same key order.
  const rest = JSON.stringify({ ...source, fold: { ...source.fold, residues: null } });
  const letters = new Writer();
  const ca = new Writer();
  const plddt = new Writer();
  const before = [0, 0, 0];
  for (const r of residues as Residue[]) {
    letters.byte(r.aa1.charCodeAt(0));
    r.ca.forEach((v, k) => {
      const q = scaled(v, CA_SCALE) ?? 0;
      ca.signed(q - before[k]);
      before[k] = q;
    });
    plddt.varint(scaled(r.plddt, PLDDT_SCALE) ?? 0);
  }
  return joinColumns([Uint8Array.of(FOLD_COLUMNS), new TextEncoder().encode(rest), letters.done(), ca.done(), plddt.done()]); // prettier-ignore
}

export function decodeFold(wire: Uint8Array): FoldSource {
  const [kind, json, lettersCol, caCol, plddtCol] = splitColumns(wire);
  const source = JSON.parse(new TextDecoder().decode(json)) as FoldSource & { fold: { residues: Residue[] | null } | null }; // prettier-ignore
  if (kind[0] === FOLD_JSON) return source;
  if (kind[0] !== FOLD_COLUMNS || !source.fold) throw new Error("a fold in a format this reader doesn't know");
  const ca = new Reader(caCol);
  const plddt = new Reader(plddtCol);
  const at = [0, 0, 0];
  source.fold.residues = Array.from(lettersCol, (code) => ({
    aa1: String.fromCharCode(code),
    ca: [0, 1, 2].map((k) => (at[k] += ca.signed()) / CA_SCALE) as Residue["ca"],
    plddt: plddt.varint() / PLDDT_SCALE,
  }));
  return source;
}
