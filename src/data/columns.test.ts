// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { describe, expect, it } from "vitest";
import { decodeFold, decodeTable, encodeFold, encodeTable } from "./columns";

/** A packed table as spine/tables.ts reads it, from [position, ref, alt, fields] rows. */
function packed(rows: [number, string, string, number[]][]): Uint8Array {
  const records = rows.map(([, ref, alt, fields]) => {
    const r = new TextEncoder().encode(ref);
    const a = new TextEncoder().encode(alt);
    return Uint8Array.from([r.length & 0xff, r.length >> 8, ...r, a.length & 0xff, a.length >> 8, ...a, ...fields]);
  });
  const n = rows.length;
  const size = records.reduce((s, r) => s + r.length, 0);
  const out = new Uint8Array(4 + 8 * n + size);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, n, true);
  let at = 0;
  rows.forEach(([pos], i) => {
    dv.setUint32(4 + 4 * i, pos, true);
    dv.setUint32(4 + 4 * n + 4 * i, at, true);
    out.set(records[i], 4 + 8 * n + at);
    at += records[i].length;
  });
  return out;
}

describe("a table's columns", () => {
  it("decode to the table byte for byte: SNVs, an indel, a format marker, records of any field length", () => {
    const table = packed([
      [0, "clinvar", "2", []],
      [43_044_295, "A", "G", [7, 1, 2]],
      [43_044_295, "A", "T", [255]],
      [43_044_296, "CTT", "C", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]],
      [43_045_000, "G", "GA", []],
      [4_000_000_000, "T", "C", [0, 0]],
    ]);
    expect(new Uint8Array(decodeTable(encodeTable(table)))).toEqual(table);
  });
  it("decode an empty table", () => {
    const table = packed([]);
    expect(new Uint8Array(decodeTable(encodeTable(table)))).toEqual(table);
  });
  it("refuse a table whose positions are out of order", () => {
    expect(() =>
      encodeTable(
        packed([
          [9, "A", "G", []],
          [8, "A", "G", []],
        ]),
      ),
    ).toThrow(/out of order/);
  });
});

describe("a fold's columns", () => {
  const json = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
  it("decode to the same fold, key order included", () => {
    const fold = {
      fold: { gene: "G", residues: [{ aa1: "M", ca: [-30.229, 1.145, -0.121], plddt: 41.44 }, { aa1: "D", ca: [-33.031, -1.354, 0], plddt: 61 }], length: 2 }, // prettier-ignore
      sites: [],
    };
    expect(JSON.stringify(decodeFold(encodeFold(json(fold))))).toBe(JSON.stringify(fold));
  });
  it("keep a fold whose numbers don't fit the columns exactly as JSON", () => {
    const fold = { fold: { residues: [{ aa1: "M", ca: [1.2345, 0, 0], plddt: 50 }] } };
    expect(JSON.stringify(decodeFold(encodeFold(json(fold))))).toBe(JSON.stringify(fold));
    const none = { fold: null, reason: "not-fetched" };
    expect(decodeFold(encodeFold(json(none)))).toEqual(none);
  });
});
