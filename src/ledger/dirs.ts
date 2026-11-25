// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The ledger's drawing: one <svg> in CSS pixels, so marks land on whole pixels and its type never scales. State is CSS classes.

import type { ChromIndex, Mark, Rulers } from "../contracts/app";
import { CHROM_X, CHROM_Y, LEDGER_PHONE, LEDGER_PITCH, LEDGER_ROWS } from "../contracts/constants";
import { columns } from "./marks";
import { NBSP, WORDS } from "./words";

const NS = "http://www.w3.org/2000/svg";
type Attrs = Record<string, string | number>;

export function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Attrs,
  parent?: Element,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (lo: number, v: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The drawing's own measures, in px unless a share. */
const GEOMETRY = {
  /** Air above row 1. */
  top: 16,
  /** Where the tracks start: the ledger's one exact vertical. */
  gutter: 96,
  /** Between the numbers and the tracks, and between a track's end and what follows it. */
  air: 16,
  /** The numbers' column: two digits at the smallest rung. */
  numbers: 16,
  bar: { min: 6, share: 0.3, max: 11 },
  /** How far a rare mark reaches past its track, each side, as a share of the track. */
  grow: { min: 2, share: 0.25 },
  /** A lit mark reaches this many times further than a rare one. */
  lit: 2.5,
  /** A row's hover band: this far before its number, this far past its track. */
  band: { before: 4, after: 48 },
  /** A tick's reach for the pointer, either side of it. */
  hit: 6,
  /** At phone width: the numbers' column in the margin, and the footnote's air under the last row. */
  narrow: LEDGER_PHONE,
} as const;

/**
 * Loading's paint, by chromosome index: how much of each bar is solid from the left (f), how opaque that solid
 * is (o), and whether the chromosome has been read (done).
 */
export interface Fill {
  f: number[];
  o: number[];
  done: boolean[];
  /** The read found no X in the file: the sex row turns to its outline. */
  noX: boolean;
}

/** Nothing read yet. */
export const unread = (): Fill => ({
  f: Array<number>(LEDGER_ROWS + 1).fill(0),
  o: Array<number>(LEDGER_ROWS + 1).fill(0),
  done: Array<boolean>(LEDGER_ROWS + 1).fill(false),
  noX: false,
});

/** The read is over: every chromosome the file holds is solid. */
export const settled = (parsed: readonly number[], noX: boolean): Fill => ({
  f: parsed.map((n) => (n > 0 ? 1 : 0)),
  o: parsed.map((n) => (n > 0 ? 1 : 0)),
  done: parsed.map(() => true),
  noX,
});

export interface Fit {
  w: number;
  /** Row to row. */
  pitch: number;
  /** Track thickness. */
  bar: number;
  /** How far a rare mark reaches past the track, each side. */
  grow: number;
  /** How far a lit mark does. */
  reach: number;
  h: number;
  /** Where the tracks start. */
  gutter: number;
  /** The chromosome numbers' right edge. */
  label: number;
  /** The first track's centre from the drawing's top, on a whole pixel. */
  y1: number;
  /** The room either side of the drawing that a row's key may stand in: left of the numbers, right of the bars. */
  lead: number;
  air: number;
  narrow: boolean;
}

/** The geometry from the width the drawing gets, the frame's pitch and the room either side of it. */
export function fit(w: number, pitch: number, narrow: boolean, room = { lead: 0, air: 0 }): Fit {
  const G = GEOMETRY;
  const p = clamp(narrow ? LEDGER_PITCH.phoneMin : LEDGER_PITCH.min, Math.floor(pitch), LEDGER_PITCH.max);
  const bar = clamp(G.bar.min, Math.round(p * G.bar.share), G.bar.max);
  const grow = Math.max(G.grow.min, Math.round(bar * G.grow.share));
  const inset = Math.round((p - bar) / 2);
  return {
    w: Math.round(w),
    pitch: p,
    bar,
    grow,
    reach: Math.round(grow * G.lit),
    h: G.top + LEDGER_ROWS * p,
    gutter: narrow ? G.narrow.col + G.narrow.gut : G.gutter,
    label: narrow ? G.narrow.col : G.gutter - G.air,
    y1: G.top + inset + Math.floor(bar / 2),
    lead: Math.max(0, Math.floor(room.lead)),
    air: Math.max(0, Math.floor(room.air)),
    narrow,
  };
}

/** Where a checked gene sits. */
export interface GeneSite {
  symbol: string;
  chromIndex: ChromIndex;
  pos: number;
}

/** A rare mark as drawn. */
export interface Tick {
  mark: Mark;
  rect: SVGRectElement;
  row: number;
  x: number;
}

export interface Row {
  g: SVGGElement;
  band: SVGRectElement;
}

export interface Drawn {
  svg: SVGSVGElement;
  paint(fill: Fill): void;
  /** By chromosome index, 0 to 22. */
  rows: Row[];
  /** Names the row pointed at, in words where they fit whole. */
  key(row: number): void;
  /** The room left of the drawing the longest row name needs, past the numbers' own column. */
  keyRoom(): number;
  /** Writes a row's count and stands it where it fits whole. */
  count(row: number, text: string): void;
  ticks: Tick[];
  genes: Map<string, SVGRectElement>;
  /** A pointer target over one mark, 3 times its height, reaching either side of it. */
  hit(layer: SVGGElement, t: Tick): SVGRectElement;
  /** The sex row's pair while it is not yet known, in three parts ("XX/", "X", "Y") so the known pair can
   *  settle out of it with its right edge still: null once the pair is known. */
  unknownSex: { lead: SVGTSpanElement; mid: SVGTSpanElement; last: SVGTSpanElement } | null;
}

/** Marks per chromosome, ordered by level so survivors paint over the fallen. */
function byChrom(marks: readonly Mark[]): Mark[][] {
  const out: Mark[][] = Array.from({ length: LEDGER_ROWS + 1 }, () => []);
  for (const m of marks) out[m[0]]?.push(m);
  for (const ms of out) ms.sort((a, b) => a[3] - b[3] || a[1] - b[1]);
  return out;
}

export function ledger(
  input: { marks: readonly Mark[]; rulers: Rulers; genes: readonly GeneSite[]; sex: string },
  f: Fit,
): Drawn {
  const G = GEOMETRY;
  const { w, pitch, bar, grow, reach, h, gutter, label } = f;
  const scale = (reaches: number) => r2((bar + 2 * reaches) / bar);
  const svg = el("svg", {
    viewBox: `0 0 ${w} ${h}`,
    width: w,
    height: h,
    class: "ledger-svg",
    role: "img",
    "aria-label": WORDS.alt,
    style: `--g:${scale(grow)};--e:${grow}px;--g2:${scale(reach)};--e2:${reach}px`,
  });
  const chroms = input.rulers.chroms;
  // One scale for every row, the longest chromosome's, so the bars keep true proportion.
  const k = (w - gutter) / Math.max(...input.rulers.genomic.slice(0, LEDGER_ROWS));
  const marks = byChrom(input.marks);
  const top = (c: number) => G.top + c * pitch + Math.round((pitch - bar) / 2);
  const length = (c: number) => Math.round(input.rulers.genomic[c] * k);
  /** A mark is one pixel at its position, kept inside the bar. */
  const column = (c: number, pos: number) => gutter + Math.min(length(c) - 1, Math.round(pos * k));

  const rows: Row[] = [];
  const names: SVGTextElement[] = [];
  const counts: SVGTextElement[] = [];
  const ticks: Tick[] = [];
  const bands = el("g", { class: "bands" });
  let unknownSex: Drawn["unknownSex"] = null;
  for (let c = 0; c < LEDGER_ROWS; c++) {
    const y = top(c);
    const mid = y + bar / 2;
    const len = length(c);
    const g = el("g", { class: c === CHROM_X ? "row sex" : "row", "data-c": c }, svg);
    const number = el("text", { x: label, y: mid, class: "chr" }, g);
    // The 23rd row is the sex-chromosome pair, named by what the file (or a sample's donor) shows.
    const sex = c === CHROM_X;
    el("tspan", { class: "key" }, number).textContent = `${sex && input.sex !== "X" ? WORDS.sexKey : WORDS.key}${NBSP}`;
    if (sex && input.sex === WORDS.sexUnknown) {
      const [lead, mid, last] = ["XX/", "X", "Y"].map((t, i) => {
        const span = el("tspan", { class: ["sex-lead", "sex-mid", "sex-last"][i] }, number);
        span.textContent = t;
        return span;
      });
      unknownSex = { lead, mid, last };
    } else number.append(sex ? input.sex : chroms[c]);
    names.push(number);
    el("rect", { x: gutter, y, width: len, height: bar, class: "base" }, g);
    // Every row's outline: no records drawn here. All rows before and during the read; the sex row after it
    // when the file holds no X (what that means is said on hover only). Inset half a pixel, so a 1 px line
    // stands exactly on the bar's footprint. Under the ink, which covers it as the read reaches it.
    const none = el("g", { class: "absent" }, g);
    el("rect", { x: gutter + 0.5, y: y + 0.5, width: len - 1, height: bar - 1 }, none);
    const snapped = columns(marks[c], (m) => column(c, m[1]));
    for (const m of marks[c]) {
      const x = snapped.get(m) ?? column(c, m[1]);
      const rect = el("rect", { x, y, width: 1, height: bar, class: `m l${m[3]}${m[4] ? " c" : ""}` }, g);
      if (m[3] === 3) ticks.push({ mark: m, rect, row: c, x });
    }
    el("rect", { x: gutter, y, width: len, height: bar, class: "solid" }, g);
    el("rect", { x: gutter, y, width: len, height: bar, class: "ink" }, g);
    counts.push(el("text", { x: gutter + len + G.air, y: mid, class: "count" }, g));
    const from = label - G.numbers - G.band.before;
    const band = el(
      "rect",
      {
        x: from,
        y: mid - pitch / 2,
        width: gutter + len + G.band.after - from,
        height: pitch,
        class: "band",
        "data-c": c,
      },
      bands,
    );
    rows.push({ g, band });
  }

  // The genes checked, one tick each on its chromosome, on the marks' own scale: one layer over the genome.
  const genes = new Map<string, SVGRectElement>();
  const layer = el("g", { class: "genes" }, svg);
  for (const site of input.genes) {
    if (site.chromIndex < 0 || site.chromIndex >= LEDGER_ROWS) continue;
    const at = { x: column(site.chromIndex, site.pos), y: top(site.chromIndex), width: 1, height: bar };
    genes.set(site.symbol, el("rect", at, layer));
  }
  svg.append(bands);

  return {
    svg,
    rows,
    ticks,
    unknownSex,
    genes,
    key(c) {
      const g = rows[c]?.g;
      const name = names[c];
      if (!g || !name) return;
      // The words stand left of the number only where they fit whole; a row with no room answers by its number alone.
      g.classList.remove("tight");
      g.classList.toggle("tight", Math.ceil(name.getComputedTextLength()) > label + f.lead);
    },
    keyRoom: () => {
      // The sex row's name at its longest ("Chromosomes XX/XY"), whatever it says now: the room stays the same
      // as the pair settles, so the drawing never moves when the read ends.
      const widest = el("text", { class: "chr", visibility: "hidden" }, rows[CHROM_X].g);
      widest.textContent = `${WORDS.sexKey}${NBSP}${WORDS.sexUnknown}`;
      const room = Math.max(...[...names, widest].map((n) => Math.ceil(n.getComputedTextLength()))) - label;
      widest.remove();
      return Math.max(0, room);
    },
    count(c, text) {
      const t = counts[c];
      if (!t) return;
      t.textContent = text;
      // Right of the bar at the numbers' gap while that fits in the drawing and the room beside it; a bar that
      // reaches too far carries its count over its own end instead, in the air above it, so it is never cut.
      const end = gutter + length(c);
      const wide = Math.ceil(t.getComputedTextLength());
      const beside = end + G.air + wide <= w + f.air;
      const mid = top(c) + bar / 2;
      t.setAttribute("x", String(beside ? end + G.air : Math.max(end, wide)));
      t.setAttribute("y", String(beside ? mid : mid - pitch / 2));
      t.classList.toggle("over", !beside);
    },
    paint(fill) {
      rows.forEach(({ g }, c) => {
        g.style.setProperty("--f", String(fill.f[c] ?? 0));
        g.style.setProperty("--o", String(fill.o[c] ?? 0));
        g.classList.toggle("done", !!fill.done[c]);
        g.classList.toggle("read", (fill.f[c] ?? 0) >= 1 && (fill.o[c] ?? 0) >= 1);
      });
      svg.classList.toggle("no-x", fill.noX);
    },
    hit: (parent, t) =>
      el("rect", { x: t.x - G.hit, y: top(t.row) - bar, width: 2 * G.hit + 1, height: 3 * bar, class: "hit" }, parent),
  };
}
