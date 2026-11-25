// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Line fit without a browser: the claim box measured from the serif's own advance widths.

/* Advance widths are read out of the WOFF2 (hmtx + cmap), with the claim's letter-spacing (-0.01em)
   and greedy wrapping at spaces and after hyphens. No kerning and no `text-wrap: pretty`, so a line
   within a few pixels of a break can differ from the browser: `fit()` returns the slack so the check
   can call those borderline. Chrome's own counts, where measured, are in browser-fit.json and win. */
import { readFileSync, existsSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";

const TAGS = [
  "cmap",
  "head",
  "hhea",
  "hmtx",
  "maxp",
  "name",
  "OS/2",
  "post",
  "cvt ",
  "fpgm",
  "glyf",
  "loca",
  "prep",
  "CFF ",
  "VORG",
  "EBDT",
  "EBLC",
  "gasp",
  "hdmx",
  "kern",
  "LTSH",
  "PCLT",
  "VDMX",
  "vhea",
  "vmtx",
  "BASE",
  "GDEF",
  "GPOS",
  "GSUB",
  "EBSC",
  "JSTF",
  "MATH",
  "CBDT",
  "CBLC",
  "COLR",
  "CPAL",
  "SVG ",
  "sbix",
  "acnt",
  "avar",
  "bdat",
  "bloc",
  "bsln",
  "cvar",
  "fdsc",
  "feat",
  "fmtx",
  "fvar",
  "gvar",
  "hsty",
  "just",
  "lcar",
  "mort",
  "morx",
  "opbd",
  "prop",
  "trak",
  "Zapf",
  "Silf",
  "Glat",
  "Gloc",
  "Feat",
  "Sill",
];

function readBase128(b: Buffer, o: { i: number }) {
  let v = 0;
  for (let k = 0; k < 5; k++) {
    const x = b[o.i++];
    v = (v << 7) | (x & 0x7f);
    if (!(x & 0x80)) return v >>> 0;
  }
  throw new Error("bad UIntBase128");
}
type Metrics = { upm: number; adv: (cp: number) => number };
function loadWoff2(path: string): Metrics {
  const b = readFileSync(path);
  if (b.toString("latin1", 0, 4) !== "wOF2") throw new Error(`${path}: not WOFF2`);
  const numTables = b.readUInt16BE(12);
  const o = { i: 48 };
  const dir: { tag: string; len: number; tlen: number; ver: number }[] = [];
  for (let t = 0; t < numTables; t++) {
    const flags = b[o.i++];
    const tag = (flags & 0x3f) === 63 ? b.toString("latin1", o.i, (o.i += 4)) : TAGS[flags & 0x3f];
    const ver = (flags >> 6) & 3;
    const len = readBase128(b, o);
    const transformed = tag === "glyf" || tag === "loca" ? ver !== 3 : ver !== 0;
    const tlen = transformed ? readBase128(b, o) : len;
    dir.push({ tag, len, tlen, ver });
  }
  const compLen = b.readUInt32BE(20);
  const data = brotliDecompressSync(b.subarray(o.i, o.i + compLen));
  const tables: Record<string, { d: Buffer; ver: number; transformed: boolean }> = {};
  let at = 0;
  for (const t of dir) {
    const transformed = t.tag === "glyf" || t.tag === "loca" ? t.ver !== 3 : t.ver !== 0;
    tables[t.tag] = { d: data.subarray(at, at + t.tlen), ver: t.ver, transformed };
    at += t.tlen;
  }
  const head = tables.head.d,
    hhea = tables.hhea.d;
  const upm = head.readUInt16BE(18);
  const nh = hhea.readUInt16BE(34);
  const hm = tables.hmtx;
  const advs: number[] = [];
  if (!hm.transformed) for (let g = 0; g < nh; g++) advs.push(hm.d.readUInt16BE(g * 4));
  else for (let g = 0; g < nh; g++) advs.push(hm.d.readUInt16BE(1 + g * 2)); // flags byte, then advanceWidth[nh]
  // cmap: format 4 or 12 subtable for Unicode
  const cm = tables.cmap.d;
  const n = cm.readUInt16BE(2);
  const map = new Map<number, number>();
  for (let k = 0; k < n; k++) {
    const pid = cm.readUInt16BE(4 + k * 8),
      eid = cm.readUInt16BE(6 + k * 8),
      off = cm.readUInt32BE(8 + k * 8);
    if (!(pid === 0 || (pid === 3 && (eid === 1 || eid === 10)))) continue;
    const fmt = cm.readUInt16BE(off);
    if (fmt === 4) {
      const segX2 = cm.readUInt16BE(off + 6),
        ends = off + 14,
        starts = ends + segX2 + 2,
        deltas = starts + segX2,
        ros = deltas + segX2;
      for (let s = 0; s < segX2 / 2; s++) {
        const end = cm.readUInt16BE(ends + 2 * s),
          start = cm.readUInt16BE(starts + 2 * s),
          delta = cm.readInt16BE(deltas + 2 * s),
          ro = cm.readUInt16BE(ros + 2 * s);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let g: number;
          if (ro === 0) g = (c + delta) & 0xffff;
          else {
            const gi = cm.readUInt16BE(ros + 2 * s + ro + 2 * (c - start));
            g = gi === 0 ? 0 : (gi + delta) & 0xffff;
          }
          if (!map.has(c)) map.set(c, g);
        }
      }
    } else if (fmt === 12) {
      const ng = cm.readUInt32BE(off + 12);
      for (let gI = 0; gI < ng; gI++) {
        const s = cm.readUInt32BE(off + 16 + gI * 12),
          e = cm.readUInt32BE(off + 20 + gI * 12),
          g0 = cm.readUInt32BE(off + 24 + gI * 12);
        for (let c = s; c <= e; c++) if (!map.has(c)) map.set(c, g0 + c - s);
      }
    }
  }
  const advOf = (g: number) => advs[Math.min(g, advs.length - 1)];
  return { upm, adv: (cp) => advOf(map.get(cp) ?? 0) };
}

const FONT = new URL("../../fonts/SuisseWorks-Regular.woff2", import.meta.url).pathname;
let M: Metrics | null = null;
const LS = -0.01; // letter-spacing, em
/* Calibrated against Chrome on 3,559 sentences: at 1.0 the model agrees on 97.6%
   (desktop) and 96.6% (phone), never under-counts, and over-counts 8 and 26 overflows; scaling
   down trades those for missed overflows. browser-fit.json (measure.mjs) settles known sentences. */
const SCALE = 1;
export const BOXES = [
  { label: "desktop", w: 540, size: 24, max: 3 },
  { label: "phone", w: 320, size: 20, max: 4 },
];

function width(s: string, size: number) {
  M ??= loadWoff2(FONT);
  let w = 0;
  for (const ch of s) w += (M.adv(ch.codePointAt(0)!) / M.upm + LS) * size;
  return w * SCALE;
}
/** Lines the text wraps to in a box, and how much room the last line's break had: `slack` is the
 *  smallest margin (px) by which any break decision went the way it did. Small slack: borderline. */
export function wrap(text: string, w: number, size: number): { lines: number; slack: number } {
  // break opportunities: after spaces, and after a hyphen inside a word
  const tokens = text.split(/(?<=\s)|(?<=-)(?=\w)/);
  let lines = 1,
    cur = "",
    slack = Infinity;
  for (const t of tokens) {
    const trial = cur + t;
    const tw = width(trial.trimEnd(), size);
    if (tw <= w || cur === "") {
      cur = trial;
      slack = Math.min(slack, w - tw >= 0 ? w - tw + 0 : Infinity);
      continue;
    }
    slack = Math.min(slack, tw - w); // it broke: by how much the word overflowed
    lines++;
    cur = t;
  }
  return { lines, slack: Number.isFinite(slack) ? slack : w };
}
/** The lab's fit check: lines on desktop and phone, and whether either is within `near` px of
 *  changing its line count. */
const CACHE_PATH = new URL("./browser-fit.json", import.meta.url).pathname;
const BROWSER: Record<string, number[]> = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, "utf8")) : {};
export function fit(text: string, near = 6) {
  const known = BROWSER[text];
  if (known)
    return BOXES.map((b, i) => ({
      ...b,
      lines: known[i],
      over: known[i] > b.max,
      borderline: false,
      measured: "browser" as const,
    }));
  return BOXES.map((b) => {
    const r = wrap(text, b.w, b.size);
    return {
      ...b,
      lines: r.lines,
      over: r.lines > b.max,
      borderline: r.slack < near && Math.abs(r.lines - b.max) <= 1,
      measured: "font" as const,
    };
  });
}
