// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The line schedule: when each line of a drawing is up, in px of scroll, and the u the drawing shows there.

import { PACING } from "../../contracts/constants";

export const { HANDOFF_PX, BREATH_PX, AN_READ, AN_SAY, PACE, ANIM_VH, ANIM_SCALE, MEASURE_VH } = PACING;
/** The entrance's share of a scrub, in the schedule the tuned rooms were written against. */
export const ENTER = 0.2;
/** A panel holds its last frame for this share of a screen before it releases. */
export const HOLD_VH = 0.3;
export const ENTER_U = ENTER / (1 - ENTER);

/* `schedule` is the tuned rooms' own rule: each line anchors to its beat's opening (or close,
   `at: "end"`), plus `lag` breaths; the hand-off into it ends one breath before that anchor; both
   clamps spend the previous beat only; an entrance line (beat null, first) sits at -ENTER_U; the line
   on screen at the reference frame opens there. It gives how long each line is fully up, in px of
   scroll, and whether it is ever seen. `pace` below is what a room runs. */

export type Beat = { name: string; u0: number; u1: number };
export type LineIn = { beat: string | null; at?: "start" | "end"; lag?: number; gap?: number };
export type Window = {
  i: number;
  open: number;
  anchor: number;
  in: [number, number] | null;
  out: [number, number] | null;
  upPx: number; // px of scroll the line is fully up for, from the reader's first frame
  seen: boolean; // false: handed off before the reference frame, so never on screen
  opening: boolean; // the line up at the reference frame: read before any scroll (the deck
  // won't scroll above that frame), so its scroll span isn't its reading time
  clamped: boolean;
};

/** px of scroll one unit of u is worth, for a scrub of `mult` x the editorial pace */
export const pxPerU = (vh: number, mult: number) => Math.max(1, vh * PACE * mult * (1 - ENTER));

export function schedule(beats: Beat[], lines: LineIn[], vh: number, mult: number, refU: number): Window[] {
  const ppu = pxPerU(vh, mult);
  const say = HANDOFF_PX / ppu,
    breath = BREATH_PX / ppu,
    lead = breath * (AN_READ / AN_SAY); // priced at the breath, not the hand-off
  const bAt = (n: string, end: boolean) => {
    const b = beats.find((x) => x.name === n);
    return b ? (end ? b.u1 : b.u0) : null;
  };
  type L = { i: number; open: number; say: number; lead: number; anchor: number };
  const live: L[] = [];
  lines.forEach((c, i) => {
    const base = c.beat == null ? null : bAt(c.beat, c.at === "end");
    if (base != null) live.push({ i, open: base + (c.lag || 0) * breath, say: 0, lead: 0, anchor: 0 });
  });
  const ent = lines.length && lines[0].beat == null && (live.length === 0 || live[0].i === 1) ? 0 : -1;
  let entOpen = -ENTER_U;
  let j = -1;
  live.forEach((L, k) => {
    if (L.open <= refU) j = k;
  });
  if (j >= 0) live[j].open = refU;
  else if (ent >= 0) entOpen = refU;
  const openingI = j >= 0 ? live[j].i : ent >= 0 ? 0 : -1;
  live.forEach((L, k) => {
    const prev = k === 0 ? (ent >= 0 ? entOpen : null) : live[k - 1].open;
    const gap = prev == null ? 0 : L.open - prev;
    L.say = prev == null ? 0 : Math.min(say, gap);
    L.lead = prev == null ? 0 : Math.min(lead, Math.max(0, gap - L.say));
    L.anchor = Math.min(1, L.open - L.lead);
  });
  const seq: L[] = (ent >= 0 ? [{ i: 0, open: entOpen, anchor: entOpen, say: 0, lead: 0 }] : []).concat(live);
  const holdU = (HOLD_VH * vh) / ppu;
  return seq.map((L, k) => {
    const n = seq[k + 1];
    const inW: [number, number] | null = k === 0 ? null : [L.anchor - L.say / 2, L.anchor];
    const outW: [number, number] | null = n ? [n.anchor - n.say, n.anchor - n.say / 2] : null;
    const upFrom = Math.max(refU, inW ? inW[1] : refU);
    const upTo = outW ? outW[0] : 1 + holdU;
    return {
      i: L.i,
      open: L.open,
      anchor: L.anchor,
      in: inW,
      out: outW,
      upPx: Math.max(0, (upTo - upFrom) * ppu),
      seen: L.i === openingI || upTo > refU + 1e-6,
      opening: L.i === openingI,
      clamped: k > 0 && (L.say < say - 1e-9 || L.lead < lead - 1e-9),
    };
  });
}

/* Copy leads, the drawing follows. Each line gets its reading time: its words at the tuned rooms'
   median px per word, never under two breaths, times the kind's reading multiplier. Lines run back to
   back with the hand-off between them. Each beat plays under one line: the line that names it, or,
   for a beat no line names, the line before it. A line's beats start as it lands, at their own scroll
   length; the line stays up at least a breath past them. An `at: "end"` line's beat plays first, under
   the line before, and the line lands as it finishes. Scroll then maps to u piecewise (`knots`), held
   flat while a line is read with nothing moving. The first line counts from the resting frame, so it
   gets its reading time on scroll too. */

/** The length in ms of a room of median length: an animation's scroll is its duration at that room's rate. */
const MEDIAN_ROOM_MS = 4230;
export const ANIM_PX_PER_MS = (MEASURE_VH * PACE * (1 - ENTER) * ANIM_SCALE) / MEDIAN_ROOM_MS;
export const BETWEEN_PX = 1.5 * BREATH_PX;
export type PWindow = {
  i: number;
  land: number;
  in: [number, number] | null;
  out: [number, number] | null;
  upPx: number;
  opening: boolean;
  beats: string[];
};
export type Paced = { ws: PWindow[]; knots: [number, number][]; total: number };

export function pace(
  beats: Beat[],
  lines: (LineIn & { words: number; cueAt?: number })[],
  vh: number,
  mult: number,
  refU: number,
  ppw: number,
  ms: number,
): Paced {
  /* px per unit of u, from the room's own length: a fixed rate per ms, scaled with the screen
     as the old rule was (it was linear in vh) */
  const ppu = (ms * ANIM_PX_PER_MS * (vh / MEASURE_VH)) / ANIM_SCALE,
    lead = BREATH_PX * (AN_READ / AN_SAY),
    H = HANDOFF_PX;
  const names = new Set(beats.map((b) => b.name));
  const shown = lines.map((l, i) => ({ l, i })).filter(({ l, i }) => (l.beat == null ? i === 0 : names.has(l.beat)));
  const pre: string[][] = shown.map(() => []),
    post: string[][] = shown.map(() => []);
  const owner = new Map<string, number>();
  shown.forEach((s, k) => {
    if (s.l.beat && !owner.has(s.l.beat)) owner.set(s.l.beat, k);
  });
  let last = 0;
  for (const b of beats) {
    if (b.u1 <= refU + 1e-9 || !shown.length) continue; // played before the room comes to rest
    const o = owner.get(b.name);
    if (o != null) {
      last = Math.max(last, o);
      (shown[o].l.at === "end" ? pre : post)[o].push(b.name);
    } else post[last].push(b.name);
  }
  let px = 0,
    u = refU;
  const knots: [number, number][] = [[0, refU]];
  /* An animation's scroll comes from its duration, capped at ANIM_VH of a screen. A finished beat parks
     on its end: the renderer draws a boundary as the ending beat, complete, so its channel flips show
     and the next beat's arrivals don't. */
  const animate = (n: string) => {
    const b = beats.find((x) => x.name === n)!;
    if (b.u1 <= u) return;
    const to = b.u1;
    // Never less than a breath, so a short beat doesn't pass inside one turn of the wheel.
    px += Math.max(BREATH_PX, Math.min((b.u1 - u) * ppu * ANIM_SCALE, ANIM_VH * vh));
    u = to;
    knots.push([px, u]);
  };
  const ws: PWindow[] = [];
  shown.forEach((s, k) => {
    let land = 0,
      inW: [number, number] | null = null;
    if (k > 0) {
      const readEnd = px + (s.l.lag || 0) * BREATH_PX;
      px = readEnd;
      knots.push([px, u]);
      for (const n of pre[k]) animate(n);
      const hs = Math.max(readEnd, px - H / 2); // an end line lands as its beat finishes
      land = hs + H;
      ws[k - 1].out = [hs, hs + H / 2];
      inW = [hs + H / 2, land];
      // The line's beats start as it begins to fade in, so the two arrive together.
      if (inW[0] > px) {
        px = inW[0];
        knots.push([px, u]);
      }
    }
    // A cue word holds the line's beats until the reader reaches it.
    if (post[k].length) {
      px = Math.max(px, k === 0 ? land + lead : 0, s.l.cueAt != null ? land + s.l.cueAt * ppw * mult : 0);
      knots.push([px, u]);
      post[k].forEach((n, j) => {
        // A pause between two changes under one line, so the first registers before the next; a line
        // may ask for a longer one (`gap`, in breaths).
        if (j > 0) {
          px += s.l.gap != null ? s.l.gap * BREATH_PX : BETWEEN_PX;
          knots.push([px, u]);
        }
        animate(n);
      });
      px += BREATH_PX;
      knots.push([px, u]);
    }
    px = Math.max(px, land + Math.max(2 * BREATH_PX, s.l.words * ppw) * mult);
    knots.push([px, u]);
    ws.push({ i: s.i, land, in: inW, out: null, upPx: 0, opening: k === 0, beats: [...pre[k], ...post[k]] });
  });
  if (u < 1) {
    px += (1 - u) * ppu;
    u = 1;
    knots.push([px, 1]);
  }
  const total = px + HOLD_VH * vh;
  for (const w of ws) w.upPx = (w.out ? w.out[0] : total) - (w.in ? w.in[1] : 0);
  return { ws, knots, total };
}
/** u at a scroll position, from the knots (flat where a line is read with nothing moving) */
export function uAt(knots: [number, number][], px: number): number {
  if (px <= knots[0][0]) return knots[0][1];
  for (let k = 1; k < knots.length; k++) {
    const [x1, u1] = knots[k],
      [x0, u0] = knots[k - 1];
    if (px <= x1) return x1 > x0 ? u0 + ((px - x0) / (x1 - x0)) * (u1 - u0) : u1;
  }
  return knots[knots.length - 1][1];
}
/** a line's opacity at a scroll position */
export const opacityPx = (w: PWindow, px: number) =>
  (w.in ? smooth(w.in[0], w.in[1], px) : 1) * (w.out ? 1 - smooth(w.out[0], w.out[1], px) : 1);

const smooth = (a: number, b: number, x: number) => {
  if (b <= a) return x >= b ? 1 : 0;
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/* The tuned rooms' lines, with the reference frame each room opens on. Their px per word is the band
   every line is read against. */
export const TUNED: { cell: string; refU: number; lines: (LineIn & { t: string })[] }[] = [
  {
    cell: "codon--frameshift-del",
    refU: 0.12,
    lines: [
      { beat: "establish", t: "BRCA1 spells out a protein that repairs damaged DNA." },
      { beat: "delete", t: "This variant deletes two DNA letters, an A and a G." },
      { beat: "regroup", t: "With two letters gone, every triplet after them is misread." },
      { beat: "reveal-stop", at: "end", t: "The misreading hits a stop signal sixteen codons early." },
      { beat: "settle", at: "end", t: "Nothing past that point is read, and no working protein is made." },
    ],
  },
  {
    cell: "portrait--substitution-contacts",
    refU: 0.2,
    lines: [
      { beat: "establish", t: "BRCA1's job is to repair damaged DNA." },
      { beat: "substitute", t: "This variant swaps a single amino acid." },
      { beat: "contacts", t: "That one amino acid holds a key part of the protein in shape." },
      { beat: "settle", at: "end", t: "Without it, that shape doesn't form, and the protein can't do the repair." },
    ],
  },
  {
    cell: "chain--local-failure",
    refU: 0.055,
    lines: [
      { beat: null, t: "PALB2 spells out a protein that helps repair damaged DNA." },
      { beat: "establish", lag: 4, t: "Only parts of it fold into a shape that can be pinned down." },
      {
        beat: "locate",
        t: "This variant lands in a long stretch between those parts, where the protein has no settled shape.",
      },
      { beat: "settle", t: "While we know where this variant is, we can't say what it does to the protein." },
    ],
  },
  {
    cell: "transcript--skip-frame-broken",
    refU: 0.095,
    lines: [
      { beat: "establish", t: "BRCA1 spells out a protein that repairs damaged DNA." },
      {
        beat: "break-seam",
        at: "end",
        t: "This variant breaks the signal that joins one block of the message to the next.",
      },
      { beat: "skip-fade", t: "That block is skipped, and the blocks on either side join straight across." },
      { beat: "regroup", t: "The join throws off the reading of every triplet after it." },
      {
        beat: "reveal-stop",
        at: "end",
        t: "The misreading hits a stop signal far too early, and no working protein is made.",
      },
    ],
  },
  {
    cell: "transcript--deep-intronic",
    refU: 0.057,
    lines: [
      { beat: "establish", t: "BRCA1 spells out a protein that repairs damaged DNA." },
      {
        beat: "reveal",
        t: "This variant lands deep in the filler between two blocks, where nothing is normally read.",
      },
      { beat: "mark-chunk", t: "It forges a brand-new edge there, and a scrap of filler is pulled into the message." },
      {
        beat: "reveal-stop",
        t: "The scrap brings a stop signal in with it, the message ends there, and no working protein is made.",
      },
    ],
  },
];

export const words = (t: string) => (t.trim().match(/\S+/g) || []).length;
