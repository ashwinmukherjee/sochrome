// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Animation as interpolation between frames: the phases, their timing, and the tween.

import { visual as V, motion as M, type Ease } from "../tokens";
import type { StateEntry, BeatName } from "../states";
import { type BlockMark, type Frame, type Mark, type ModuleMark, span } from "./marks";
import { frame } from "./registry";
import { transcriptSpec } from "./transcript";

/* ---- The engine: interpolation between frames ---- */

export interface Phase {
  beat: BeatName;
  /** ms from the start of the replay */
  at: number;
  dur: number;
  ease: Ease;
  /** the largest rank in this phase's field; a front's duration is a property
   *  of how much material it has to cross */
  span: number;
  /** per unit: when it starts, and how long its own transition runs. Absent on
   *  a phase with no front — there the one unit gets the whole phase, which is
   *  what makes the transcript zoom one continuous move rather than a wave. */
  units?: Map<string, { start: number; dur: number }>;
}

/** Beat durations come from the motion tokens by name (tokens.ts `beatDur`); anything unnamed is
 *  an ordinary beat, or a settle if last. A `qualifier` is a fact about the specimen: the table is
 *  asked for `<beat>/<qualifier>` first, so every duration stays named in the sheet. */
function baseDur(beat: BeatName, index: number, count: number, qualifier?: string): number {
  const named = (qualifier != null ? M.beatDur[`${beat}/${qualifier}`] : undefined) ?? M.beatDur[beat];
  if (named != null) return named;
  return index === count - 1 ? M.durSettle : M.durBeat;
}

/** How far a mark travels along the register between two frames: x only, because the front is a
 *  reading front. A mark dropping in from off the register (an inserted base) has no distance and
 *  takes the ordinary durMove, so it moves as one with the slide that opens its slot. */
function travel(a: Mark | undefined, b: Mark | undefined): number {
  if (!a || !b || a.kind !== b.kind) return 0;
  const ax = (a as any).x,
    bx = (b as any).x;
  if (typeof ax !== "number" || typeof bx !== "number") return 0;
  return Math.abs(bx - ax);
}

/* The cascade is a speed, not a shared duration: the median distance a phase's moving units
   cover takes durMove, and every unit crosses its own distance at that px/ms, so a cell coming out
   of a long elided run arrives late rather than fast. A unit with no distance (a fade, a flip in
   place) takes durMove. */
function frontPlan(from: Frame, to: Frame): Map<string, { start: number; dur: number }> {
  const fa = new Map(from.marks.map((m) => [m.key, m]));
  const fb = new Map(to.marks.map((m) => [m.key, m]));
  const keys = new Set<string>([...fa.keys(), ...fb.keys()]);

  const dist = new Map<string, number>();
  keys.forEach((k) => dist.set(k, travel(fa.get(k), fb.get(k))));

  const moving = [...dist.values()].filter((d) => d > V.minInk).sort((p, q) => p - q);
  const typical = moving.length ? moving[Math.floor(moving.length / 2)] : 0;

  const out = new Map<string, { start: number; dur: number }>();
  keys.forEach((k) => {
    const m = fb.get(k) ?? fa.get(k)!;
    const d = dist.get(k) ?? 0;
    const dur = typical > 0 && d > 0 && !m.sync ? (M.durMove * d) / typical : M.durMove;
    out.set(k, { start: (m.rank ?? 0) * M.staggerPitch, dur: Math.max(M.durMicro, dur) });
  });
  return out;
}

export function timeline(entry: StateEntry): { phases: Phase[]; total: number } {
  const frames = entry.beats.map((b) => frame(entry, b));
  const phases: Phase[] = [];
  let at = 0;
  entry.beats.forEach((beat, i) => {
    const to = frames[i];
    const span = to.marks.reduce((m, k) => Math.max(m, k.rank ?? 0), 0);
    // a staggered front gets easeSettle: easeStandard's punchy start, layered, reads as a ratchet
    const ease = beat === "settle" || span > 0 ? M.easeSettle : M.easeStandard;
    /* `reveal-stop` is a micro beat, except where the stop also cuts material that has just
       arrived (an admitted specimen): there the reader is watching that material change. Decided
       on the specimen, never a state name; the duration is `reveal-stop/cuts-admitted` in tokens. */
    const cutsAdmitted =
      beat === "reveal-stop" && entry.lane === "transcript" && transcriptSpec(entry.state)?.admitted != null;
    /* Likewise a `locate` that opens a clearing (§8.55) is watched happen, so it is not micro.
       Decided on the marks, never a cell name. */
    const opensGround = beat === "locate" && entry.lane === "portrait" && to.marks.some((m) => m.kind === "clearing");
    // still `let`: a phase never ends before its own slowest unit does, below.
    let dur =
      baseDur(beat, i, entry.beats.length, cutsAdmitted ? "cuts-admitted" : opensGround ? "clearing" : undefined) +
      span * M.staggerPitch;
    let units: Phase["units"];
    if (i > 0 && span > 0) {
      units = frontPlan(frames[i - 1], to);
      /* A phase is never shorter than its slowest unit, or that unit would jump at the next
         phase's FROM frame. */
      units.forEach((u) => {
        dur = Math.max(dur, u.start + u.dur);
      });
    }
    phases.push({ beat, at, dur, ease, span, units });
    at += dur;
  });
  return { phases, total: at };
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

function tweenMark(a: Mark | undefined, b: Mark | undefined, u: number): Mark | null {
  /* Arrival and departure fade, unless the mark is `discrete`: then existence is held like a
     channel, the FROM state until u = 1, then the flip. */
  if (!a && b) return b.discrete ? (u < 1 ? null : { ...b, op: b.op ?? 1 }) : { ...b, op: (b.op ?? 1) * u };
  if (a && !b) return a.discrete ? (u < 1 ? { ...a, op: a.op ?? 1 } : null) : { ...a, op: (a.op ?? 1) * (1 - u) };
  if (!a || !b) return null;
  if (a.kind !== b.kind) return u < 1 ? a : b;

  const out: any = { ...b };
  const numeric = ["x", "y", "w", "h", "x1", "y1", "x2", "y2", "len", "r", "size", "op"];
  for (const f of numeric) {
    const av = (a as any)[f];
    const bv = (b as any)[f];
    if (typeof av === "number" && typeof bv === "number") out[f] = lerp(av, bv, u);
  }
  if (a.kind === "path" && b.kind === "path" && a.pts.length === b.pts.length) {
    out.pts = a.pts.map((p, i) => [lerp(p[0], b.pts[i][0], u), lerp(p[1], b.pts[i][1], u)]);
  }
  /* Channels do not tween: each holds its FROM value until this unit's transition completes.
     Every hold is unconditional, because absence is a FROM value too and a presence guard misses
     whichever push site omits the key. */
  if (u < 1) {
    if ("ch" in a) out.ch = (a as any).ch;
    // `own` picks which ink a `black` block takes, so it is half of the channel
    out.own = (a as any).own;
    // the flank past a stop must not dim ahead of the stop's own flip
    out.reach = (a as any).reach;
    // a seam's delta ink lands with its unit, so the joins colour in reading order
    if (a.kind === "seam") out.lds = (a as any).lds;
    // a seam reads `faint` for its own ink, so it must dim with the stop, not ahead of it
    out.faint = (a as any).faint;
    /* The chain's register and taper: a run is held or let go, never partly. No chain beat
       changes a run yet (asserted in probe.ts); the hold is ready for one that does. */
    out.reg = (a as any).reg;
    out.taper = (a as any).taper;
    // the ink flags land with their unit too, so a ranked sweep sweeps
    out.unread = (a as any).unread;
    out.delta = (a as any).delta;
    out.bare = (a as any).bare;
    if ("real" in a && (a as any).real != null) out.real = (a as any).real;
    if (a.kind === "block") {
      out.swap = (a as BlockMark).swap;
      out.edgeJoint = (a as BlockMark).edgeJoint;
      // a moving block must not lose its ends before the seams that replace them arrive
      out.openEdge = (a as BlockMark).openEdge;
      out.unjoined = (a as BlockMark).unjoined;
    }
    if (a.kind === "module") {
      out.dark = (a as ModuleMark).dark;
      /* The size step (§2.9) is the same event as the ink, so where `dark` flips, size is held
         with it rather than swelling at the material rung. Where `dark` does not change, size
         is the whole event and tweens (C3: the identifier growing, dark at both ends). */
      if ((a as ModuleMark).dark !== (b as ModuleMark).dark) {
        out.size = (a as ModuleMark).size;
      }
    }
  }
  return out as Mark;
}

/** How long the opening beat's arrival takes: the veil's ramp (or a staggered front's per-mark
 *  ramp), `durMove` or the phase, whichever is shorter. */
function arrivalMs(ph: Phase): number {
  return Math.max(1, Math.min(M.durMove, ph.dur - ph.span * M.staggerPitch));
}
/** When the opening arrival has landed, in ms. A host that rests a room on a frame should rest it
 *  here or later, or the resting picture is still under the veil. */
export function settledAt(entry: StateEntry): number {
  if (entry.beats.length === 1) return 0;
  const ph = timeline(entry).phases[0];
  return ph.at + arrivalMs(ph) + (ph.span > 0 ? ph.span * M.staggerPitch : 0);
}

/** Sample the whole animation at t ms. t >= total is the resting state, identical to
 *  frame(entry, lastBeat). */
export function sample(entry: StateEntry, t: number): Frame {
  const { phases, total } = timeline(entry);
  const beats = entry.beats;
  if (beats.length === 1) return frame(entry, beats[0]);
  if (t >= total) return frame(entry, beats[beats.length - 1]);

  let i = 0;
  /* A boundary belongs to the beat it ends: a host parked on it shows that beat's flips landed
     and not the next beat's discrete arrivals. */
  while (i < phases.length - 1 && t > phases[i].at + phases[i].dur + 1e-6) i++;
  const ph = phases[i];
  const from = frame(entry, i === 0 ? beats[0] : beats[i - 1]);
  const to = frame(entry, beats[i]);
  if (i === 0) {
    /* The first beat has nothing to come from: it arrives, except a static mark (the datum).
       Every other mark, seams included, shares one linear veil (§8.46, §8.47): fading marks
       separately is what made the arrival jitter, and an eased veil would decelerate a thing
       that is not moving. The veil takes `durMove`, and the rest of the phase is reading time.
       A staggered first beat keeps per-mark opacity instead: a front is read in sequence, not
       as one picture. No cell has one today. */
    const base = arrivalMs(ph);
    if (ph.span > 0) {
      return {
        ...to,
        marks: to.marks.flatMap((m) => {
          if (m.static) return [m];
          const start = (m.rank ?? 0) * M.staggerPitch;
          const op = (m.op ?? 1) * Math.max(0, Math.min(1, (t - ph.at - start) / base));
          // below the floor a mark is not emitted, as in the tweened branch
          return op > V.opVanish ? [{ ...m, op }] : [];
        }),
      };
    }
    const fade = Math.max(0, Math.min(1, (t - ph.at) / base));
    // the whole object is below the ink floor: draw the instrument alone
    if (fade <= V.opVanish) return { ...to, marks: to.marks.filter((m) => m.static) };
    return { ...to, fade: fade < 1 ? fade : undefined };
  }

  const local = Math.max(0, t - ph.at);

  const fa = new Map(from.marks.map((m) => [m.key, m]));
  const fb = new Map(to.marks.map((m) => [m.key, m]));

  /* Paint in the TO frame's order, which its builder chose (contact hairlines sit under the
     residues). A departing mark keeps its place after the nearest preceding FROM key that
     survives, or first if none does, so it does not jump layers while it fades. */
  const leaving = new Map<string | null, string[]>();
  let anchor: string | null = null;
  for (const m of from.marks) {
    if (fb.has(m.key)) {
      anchor = m.key;
      continue;
    }
    const bucket = leaving.get(anchor);
    if (bucket) bucket.push(m.key);
    else leaving.set(anchor, [m.key]);
  }
  const keys: string[] = [...(leaving.get(null) ?? [])];
  for (const m of to.marks) {
    keys.push(m.key);
    const bucket = leaving.get(m.key);
    if (bucket) keys.push(...bucket);
  }

  const marks: Mark[] = [];
  keys.forEach((key) => {
    const a = fa.get(key);
    const b = fb.get(key);
    /* When this unit moves and for how long, from the front plan; with no front, the whole
       phase. An existence fade is a unit transition and takes `durMove`, so it does not land on
       a beat boundary. A discrete mark keeps the whole phase: its flip at u = 1 is placed. */
    const u = ph.units?.get(key);
    const start = u ? u.start : 0;
    const whole = Math.max(1, u ? u.dur : ph.dur);
    const fades = (!a || !b) && !(a ?? b)!.discrete;
    const unitDur = fades ? Math.min(whole, M.durMove) : whole;
    // a unit's own transition is eased; an existence fade runs linearly (§8.46)
    const raw = Math.max(0, Math.min(1, (local - start) / unitDur));
    /* On the last beat only, a block or seam that goes faint crossfades instead of flipping,
       since the hard swap read as the mark nudging. Earlier `reach` changes keep the held flip. */
    const goesFaint =
      a &&
      b &&
      ((a.kind === "block" && b.kind === "block" && a.reach !== b.reach) ||
        (a.kind === "seam" && b.kind === "seam" && !!a.faint !== !!b.faint));
    if (a && b && goesFaint && ph.beat === beats[beats.length - 1] && raw > 0 && raw < 1) {
      const e = ph.ease(raw);
      marks.push({ ...a, key: `${key}~was`, op: (a.op ?? 1) * (1 - e) });
      marks.push({ ...b, op: (b.op ?? 1) * e });
      return;
    }
    const m = tweenMark(a, b, fades ? raw : ph.ease(raw));
    // below the floor a mark is gone and no node is emitted, rather than an invisible ghost
    if (m && (m.op ?? 1) > V.opVanish) marks.push(m);
  });

  return { w: to.w, h: to.h, marks };
}
