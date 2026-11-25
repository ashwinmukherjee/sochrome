// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The pacing of P1: each drawing's line windows and its scroll-to-u map, one table for the room and check C1. No DOM.

import type { Drawing, FilledLine } from "../../contracts/app";
import { PACING } from "../../contracts/constants";
import { scrubOf, timingOf } from "../../copy/p1/room";
import { opacityPx, pace, schedule, TUNED, uAt, words, type Paced } from "../../copy/p1/schedule";
import { kindOf } from "../../copy/p1/slots";
import { builtEntry, clockOf, type P1Clock } from "../../render/variant";

interface Band {
  min: number;
  med: number;
  max: number;
  /** The rate every line is read at (PACING.READ_AT). */
  read: number;
}

let BAND: Band | null = null;

/** Px of scroll per word in the tuned rooms: every line is read at `read`. */
export function band(): Band {
  if (BAND) return BAND;
  const all: number[] = [];
  for (const t of TUNED) {
    const ws = schedule(clockOf(builtEntry(t.cell)).beats, t.lines, PACING.MEASURE_VH, 1, t.refU);
    for (const w of ws) if (w.seen && !w.opening) all.push(w.upPx / words(t.lines[w.i].t));
  }
  all.sort((a, b) => a - b);
  const at = (q: number) => all[Math.min(all.length - 1, Math.floor(all.length * q))];
  BAND = { min: all[0], med: at(0.5), max: all[all.length - 1], read: at(PACING.READ_AT) };
  return BAND;
}

const TUNED_REF = new Map(TUNED.map((t) => [t.cell, t.refU]));
/** An untuned drawing rests no later than this, inside the tuned rooms' range. */
const REF_U_MAX = 0.12;

/** Where a drawing rests when its room opens: its reference frame, never before its opening fade has landed. */
export const refUOf = (kind: string, clock: P1Clock): number =>
  Math.max(TUNED_REF.get(kind) ?? Math.min(REF_U_MAX, clock.beats[0].u1 * 0.5), clock.settledU);

/** Words before the cue word, or undefined when the line has no cue or doesn't contain it. */
function cueAt(text: string, cue: string | undefined): number | undefined {
  if (!cue) return undefined;
  const at = text
    .trim()
    .split(/\s+/)
    .findIndex((w) =>
      w
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .startsWith(cue.toLowerCase()),
    );
  return at < 0 ? undefined : at;
}

/** One drawing's schedule on a screen `vh` tall: copy leads, the drawing follows. */
export function paceDrawing(drawing: Drawing, lines: FilledLine[], clock: P1Clock, vh: number): Paced {
  const kind = kindOf(drawing);
  const timed = lines.map((l) => {
    const t = timingOf(drawing, l.id);
    return {
      beat: l.beat ?? null,
      at: l.at,
      lag: t.lag,
      gap: t.gap,
      words: words(l.text),
      cueAt: cueAt(l.text, t.cue),
    };
  });
  return pace(clock.beats, timed, vh, scrubOf(kind), refUOf(kind, clock), band().read, clock.duration);
}

interface Segment {
  /** Where this drawing's own scroll begins and ends, in px of P1's scroll. */
  start: number;
  end: number;
  paced: Paced;
}
interface Track {
  segments: Segment[];
  /** P1's whole scroll, in px. */
  total: number;
}

/** A room's drawings play one after another, a hand-off of scroll between them. */
export function track(paced: Paced[]): Track {
  const segments: Segment[] = [];
  let at = 0;
  for (const p of paced) {
    segments.push({ start: at, end: at + p.total, paced: p });
    at += p.total + PACING.HANDOFF_PX;
  }
  return { segments, total: segments.length ? segments[segments.length - 1].end : 0 };
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const HALF = PACING.HANDOFF_PX / 2;

/** A drawing's opacity at a scroll position: the outgoing one leaves over half a hand-off, then the next arrives. */
export function segmentOpacity(t: Track, i: number, px: number): number {
  const s = t.segments[i];
  const arrive = i === 0 ? 1 : smooth(s.start - HALF, s.start, px);
  const leave = i === t.segments.length - 1 ? 1 : 1 - smooth(s.end, s.end + HALF, px);
  return arrive * leave;
}

/** A line's opacity at a scroll position: its own windows, inside its drawing's. */
export const lineOpacity = (t: Track, i: number, window: number, px: number): number =>
  opacityPx(t.segments[i].paced.ws[window], px - t.segments[i].start) * segmentOpacity(t, i, px);

/** The u a drawing shows at a scroll position. */
export const segmentU = (t: Track, i: number, px: number): number =>
  uAt(t.segments[i].paced.knots, px - t.segments[i].start);
