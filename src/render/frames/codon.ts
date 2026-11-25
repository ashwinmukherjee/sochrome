// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The codon lane's frames: a gene's letters as reading-frame cells, and what a change does to them.

import { visual as V } from "../tokens";
import type { StateEntry, BeatName } from "../states";
import { type CodonSpecimen } from "../specimens";
import { type BlockMark, type Channel, type Frame, type Mark, nf, pastOf, span } from "./marks";
import { frame } from "./registry";
import { GENE } from "./transcript";

/* ---- Lane 1: codon ----
   Every derived quantity (pitch, slots per row, block width, row pitch) is a function of the
   tokens, so moving codonCellW moves the whole register.

   The beat grid is the load-bearing rule: ticks sit at reference codon boundaries and never move
   (they are computed from the layout alone), so every off-tick reading is about the content.

   An edit splits into two motions: whole codons (count: content reflows whole slots and lands
   back on tick) and the leftover one or two bases (alignment: displaced by under a slot, off tick
   on every row). 185delAG is pure alignment: everything past the seam moves -2 cells. */

/** The slot: three cells plus the gap before the next group. Every horizontal quantity in this
 *  lane is a multiple of it, and it is the only slot size drawn (no row-wrap, no shrink). */
export const PITCH1 = 3 * V.codonCellW + V.blockGap;
/** Slots in one row (+ blockGap: the last block needs no trailing gap). The anchor's width, and
 *  the ceiling every window stays under. Read at call time: V.stageW is the host's (setStageW). */
export const measure1 = (): number => Math.max(1, Math.floor((V.stageW + V.blockGap) / PITCH1));

/** One row, always: a run that would not fit elides into a break column instead. */
const ROW_HEIGHT = V.blockH + V.datumGap + V.tickLen / 2;

interface Placed {
  c: number;
  /** position in the unit sequence, codons and break columns counted together: the reading
   *  front crosses a break in one step, however many codons it stands for */
  order: number;
  x: number;
  y: number;
  w: number;
}

/** one elided run: a single column standing for `count` reference codons that would render
 *  identically (see codonWindow) */
interface BreakPlaced {
  order: number;
  x: number;
  y: number;
  w: number;
  count: number;
  first: number;
  last: number;
  /** the unit's identity for the datum's keys (unitKey) */
  key: string;
  /** the break stands for the edit's own run (a long cut, or a long insertion's new letters),
   *  not for reading the row skips: material may cross it as the row closes or opens */
  edit?: boolean;
}

interface CodonPlan {
  /** every unit boundary in x, cursor order, length units.length + 1 (not i * pitch: a break
   *  is wider than a slot). Both of a break's boundaries are real reference positions, so
   *  every entry earns a tick. */
  boundaries: number[];
  /** each boundary's identity (the unit after it, or "end"), so a tick keeps its key when a
   *  long indel's row closes or opens */
  keys: string[];
  placed: Placed[];
  breaks: BreakPlaced[];
  cellW: number;
  gap: number;
  pitch: number;
  blockW: number;
  /** whether the datum may bleed past the window's first / last codon: false where that side
   *  is the gene's own edge (codon 1 or spec.lastCodon), with no more reading to imply */
  bleedLeft: boolean;
  bleedRight: boolean;
  /** how far downstream material moves, in px, once it has moved */
  dx: number;
  height: number;
  /** where a reference codon sits, or undefined if it is outside the window
   *  or was elided into a break column */
  at: (c: number) => Placed | undefined;
}

/** Split an edit into its two motions. Truncation toward zero keeps the remainder's sign and
 *  |remainder| <= 2: alignment is always under a slot, count always whole slots. */
function motions(netBaseDelta: number) {
  const whole = Math.trunc(netBaseDelta / 3);
  return { countDelta: whole, alignBases: netBaseDelta - whole * 3 };
}

/** one unit of the window: a reference codon, or a break column standing for a run of them.
 *  The window decides which codons get a block; `codonPlan` turns that into geometry. */
type WindowUnit = ({ c: number } | { first: number; last: number }) & { key?: string; edit?: boolean };
/** a unit's identity: its codon, or its break's first codon, unless the window names it —
 *  a long indel's after-row names its units after the before-row's, so ticks and labels
 *  carry over between the two (pairedPlans) */
const unitKey = (u: WindowUnit) => u.key ?? ("c" in u ? `c${u.c}` : `b${u.first}`);

/* The window is two neighbourhoods:
     event    upstream of the seam (the true end, for a stop loss) it starts at widen()'s lower
              bound and grows toward targetCodons; downstream it stays at flankCodons, an edge
              that belongs to the landing's math, not to how much lead there is to show.
     landing  flankCodons either side of the terminator, only when a stop exists elsewhere. It
              coincides with the event for nonsense and is absent for a kind with no stop.

   A termination is a full strip that ends early: running short is the claim only downstream of
   the stop. Upstream the reading is normal until it isn't, so the lead fills the row.

   Neighbourhoods that touch merge into one window. Where they don't, the codons between are one
   fact repeated ("regrouped, not yet resolved"): up to breakCodons they draw as usual; past that
   they collapse into one break column, which keeps a run of any length on one full-size row.

   The reading ends at the stop, not the message: the ruler bleeds past the last thing drawn
   (bleedRulerIntervals) to say the scale continues.

   A kind with nothing to land on (silent, in-frame) fills to targetCodons: flankCodons alone
   leaves a stranded sliver of context. */

/** grows [center, center] outward one codon at a time, alternating sides, until it spans
 *  `target` codons or the gene runs out. Used whole for a kind with nothing to land on; a
 *  termination reads only its lower bound for its lead-in, then fills upstream. */
function widen(center: number, target: number, lastCodon: number): [number, number] {
  let lo = center,
    hi = center;
  let need = target - 1;
  while (need > 0 && (lo > 1 || hi < lastCodon)) {
    if (hi < lastCodon) {
      hi++;
      need--;
    }
    if (need > 0 && lo > 1) {
      lo--;
      need--;
    }
  }
  return [Math.max(1, lo), Math.min(lastCodon, hi)];
}

/** The row's width in slots: a codon is one, a break column breakCells. The occupancy rule
 *  counts slots, so a strip that elides a long run is already full and is not padded further. */
const slotsOf = (units: WindowUnit[]): number => units.reduce((n, u) => n + ("c" in u ? 1 : V.breakCells), 0);

function codonWindow(spec: CodonSpecimen): WindowUnit[] {
  // the anchor and a start loss (E7) open on codon 1 and fill the row: the anchor states a
  // condition, not an event, so there is no seam to window onto
  if (spec.kind === "anchor" || spec.kind === "start-loss") {
    return Array.from({ length: Math.min(measure1(), spec.lastCodon) }, (_, i) => ({ c: i + 1 }));
  }

  const push = (out: WindowUnit[], lo: number, hi: number) => {
    for (let c = lo; c <= hi; c++) out.push({ c });
  };

  /* The occupancy target is bounded by the row: a host's narrower stage (setStageW) holds fewer
     slots than targetCodons. This never shrinks a window below what its neighbourhoods need;
     the compact window below handles a row too narrow for those. */
  const target = Math.min(V.targetCodons, measure1());
  const cut = cutOf(spec),
    add = addOf(spec),
    span = editSpan(spec);
  // a run too long for the row: a cut's before-row elides its stretch; an insertion's before-row
  // is plain reading from the edit, and its after-row elides (afterWindow)
  if (cut && elides(cut.c0, cut.cEnd)) return stretchWindow(spec, cut, target);
  if (add && elides(add.c0, add.vEnd)) {
    const out: WindowUnit[] = [];
    const lo = Math.max(1, add.c0 - V.flankCodons);
    for (let c = lo; c <= spec.lastCodon && slotsOf(out) < target; c++) out.push({ c });
    return out;
  }
  if (spec.terminator == null && span) {
    // a frameshift reading no stop: every codon the edit spans stays on the row
    const [lo, hi] = widen(span[0] + Math.floor((span[1] - span[0]) / 2), target, spec.lastCodon);
    const out: WindowUnit[] = [];
    push(out, lo, hi);
    return out;
  }
  if (spec.terminator == null) {
    // an in-frame removal of N words is centred on the N, so every word that leaves is on the row
    const span = spec.kind === "in-frame" && spec.netBaseDelta < 0 ? -Math.trunc(spec.netBaseDelta / 3) : 1;
    /* A removal longer than the row keeps its flanks: two words at each end of the stretch, the
       rest in a break column, a flank of reading either side, the lead filling the row upstream. */
    const f = V.flankCodons,
      k = 2;
    if (span > target - 2 * f) {
      const hiC = Math.min(spec.lastCodon, spec.seam + span - 1 + f);
      const build = (lo: number): WindowUnit[] => {
        const out: WindowUnit[] = [];
        for (let c = lo; c <= spec.seam + k - 1; c++) out.push({ c });
        out.push({ first: spec.seam + k, last: spec.seam + span - k - 1 });
        for (let c = spec.seam + span - k; c <= hiC; c++) out.push({ c });
        return out;
      };
      let lo = Math.max(1, spec.seam - f);
      let units = build(lo);
      while (lo > 1 && slotsOf(build(lo - 1)) <= target) units = build(--lo);
      return units;
    }
    const [lo, hi] = widen(spec.seam + Math.floor((span - 1) / 2), target, spec.lastCodon);
    const out: WindowUnit[] = [];
    push(out, lo, hi);
    return out;
  }

  const around = (center: number): [number, number] => [
    Math.max(1, center - V.flankCodons),
    Math.min(spec.lastCodon, center + V.flankCodons),
  ];
  /* The event is the true end where there is one: `trueEnd` is non-null only for a stop loss,
     whose operation is at the reference terminator. A deletion's event is the first codon it
     cuts, which can come before the seam. */
  const eventCenter = spec.trueEnd ?? (span ? span[0] : spec.seam);
  // downstream of the event stays at flankCodons (it belongs to the landing math below); a cut
  // across codons keeps every codon it cuts on the row
  const eventHi = Math.max(around(eventCenter)[1], span ? Math.min(spec.lastCodon, span[1]) : 0);
  const landing = around(spec.terminator);

  /** the window, given a lead-in from `lo`: merged where the neighbourhoods touch, elided where
   *  the run between them is long */
  const build = (lo: number): WindowUnit[] => {
    const out: WindowUnit[] = [];
    if (landing[0] <= eventHi + 1) {
      // touching or overlapping: one neighbourhood, nothing to elide
      push(out, Math.min(lo, landing[0]), Math.max(eventHi, landing[1]));
      return out;
    }
    push(out, lo, eventHi);
    const gapFirst = eventHi + 1;
    const gapLast = landing[0] - 1;
    if (gapLast - gapFirst + 1 > V.breakCodons) out.push({ first: gapFirst, last: gapLast });
    else push(out, gapFirst, gapLast);
    push(out, landing[0], landing[1]);
    return out;
  };

  /* The occupancy rule: start the lead where widen() puts it, then take one more codon of lead
     until the row is targetCodons wide or the gene runs out. Growth is upstream only, because
     emptiness is the claim downstream of a stop and nowhere else (nonsense, whose seam is its
     terminator, would otherwise read as clipped rather than terminated). */
  let lead = widen(eventCenter, target, spec.lastCodon)[0];
  let units = build(lead);
  while (lead > 1 && slotsOf(units) < target) {
    lead--;
    units = build(lead);
  }
  // give back lead before giving up the landing: lead is the cheap part of the row
  while (slotsOf(units) > measure1() && lead < eventCenter) units = build(++lead);
  if (slotsOf(units) <= measure1()) return units;

  /* The compact window, for a row too narrow for the flank-1 window (a 350px stage holds five
     slots): downstream of the event only the first misread codon, and the landing is the stop
     alone. What survives is the seam, the first codon read wrong, the break and the stop; the
     after-stop emptiness is the cost, chosen over a second row or a narrower pitch. Lead still
     fills upstream. Never reached at 768. */
  const T = spec.terminator; // non-null here: the null case returned above
  // the edit's own codons are never given up
  const eventHiC = Math.max(Math.min(eventCenter + 1, T), span ? Math.min(spec.lastCodon, span[1]) : 0);
  const buildC = (lo: number): WindowUnit[] => {
    const out: WindowUnit[] = [];
    if (T <= eventHiC + 1) {
      push(out, lo, Math.max(T, eventHiC));
      return out;
    } // touching: one run to the stop
    push(out, lo, eventHiC);
    const gapFirst = eventHiC + 1,
      gapLast = T - 1;
    if (gapLast - gapFirst + 1 > V.breakCodons) out.push({ first: gapFirst, last: gapLast });
    else push(out, gapFirst, gapLast);
    out.push({ c: T });
    return out;
  };
  lead = eventCenter;
  units = buildC(lead);
  while (lead > 1 && slotsOf(buildC(lead - 1)) <= measure1()) {
    lead--;
    units = buildC(lead);
  }
  return units;
}

/** The before-row of a long frameshift deletion: the in-frame removal's window, with the
 *  reading's landing after it when a stop is read. All in reference codons, so the stop is found
 *  where its letters sit in the gene (refSpanOf); afterWindow is the row once it has closed. */
function stretchWindow(spec: CodonSpecimen, cut: Cut, target: number): WindowUnit[] {
  const f = V.flankCodons,
    k = 2;
  const push = (out: WindowUnit[], lo: number, hi: number) => {
    for (let c = lo; c <= hi; c++) out.push({ c });
  };
  const last = spec.lastCodon;
  // the stretch: every codon it cuts, or two at each end and a break column between when the
  // hidden run would be longer than breakCodons (a break wider than what it hides misleads)
  const elide = elides(cut.c0, cut.cEnd);
  const stop = spec.terminator == null ? null : refSpanOf(cut, spec.terminator);
  /** the window, given its lead, its flank after the stretch, the landing's own flank, and
   *  (no stop) how many misread codons follow */
  const build = (lo: number, after: number, landF: number, tail: number): WindowUnit[] => {
    const out: WindowUnit[] = [];
    const eHi = Math.min(last, cut.cEnd + after);
    if (elide) {
      push(out, lo, cut.c0 + k - 1);
      out.push({ first: cut.c0 + k, last: cut.cEnd - k, edit: true });
      push(out, cut.cEnd - k + 1, eHi);
    } else push(out, lo, eHi);
    if (stop) {
      const a = Math.max(eHi + 1, stop[0] - landF),
        b = Math.min(last, stop[1] + landF);
      if (a > eHi + 1) {
        if (a - eHi - 1 > V.breakCodons) out.push({ first: eHi + 1, last: a - 1 });
        else push(out, eHi + 1, a - 1);
      }
      push(out, a, b);
    } else push(out, eHi + 1, Math.min(last, eHi + tail));
    return out;
  };
  // the full window first; then, as the codon window's compact rule does, the landing's flank
  // and the stretch's own flank are given up before the row overruns
  const lo0 = Math.max(1, cut.c0 - f);
  let after: number = f,
    landF: number = f;
  const fits = (u: WindowUnit[]) => slotsOf(u) <= measure1();
  if (stop && !fits(build(lo0, after, landF, 0))) landF = 0;
  if (stop && !fits(build(lo0, after, landF, 0))) after = 0;
  // no stop: the misreading runs off the row, filled to the target after the stretch
  let tail = 0;
  if (!stop) while (cut.cEnd + after + tail < last && slotsOf(build(lo0, after, landF, tail + 1)) <= target) tail++;
  let lo = lo0;
  let units = build(lo, after, landF, tail);
  while (lo > 1 && slotsOf(build(lo - 1, after, landF, tail)) <= target) units = build(--lo, after, landF, tail);
  while (!fits(units) && lo < cut.c0) units = build(++lo, after, landF, tail);
  return units;
}

/** The row once a long run has closed or opened, or null where the row is one plan throughout.
 *  It keeps the before-row's lead exactly, and is in variant codons from the edit on (an
 *  in-frame deletion's are named by the reference codon each wholly holds). Units are keyed
 *  after the before-row's where they are the same material, so ticks and labels travel:
 *    an in-frame deletion   the codons after the removed words, from where the first one was
 *    a frameshift deletion  the shifted reading from c0, to the stop's landing or the row's end
 *    an insertion           the new letters (two codons each end, a break between), then the
 *                           shifted reading to the stop's landing */
function afterWindow(spec: CodonSpecimen, before: WindowUnit[]): WindowUnit[] | null {
  const f = V.flankCodons,
    k = ELIDE_KEEP,
    last = spec.lastCodon;
  const cut = cutOf(spec),
    add = addOf(spec);
  const words = spec.kind === "in-frame" && spec.netBaseDelta < 0 ? -Math.trunc(spec.netBaseDelta / 3) : 0;
  const inFrameLong =
    words > 0 && before.some((u) => "first" in u && u.first >= spec.seam && u.last < spec.seam + words);
  const longCut = cut != null && elides(cut.c0, cut.cEnd);
  const longAdd = add != null && elides(add.c0, add.vEnd);
  if (!inFrameLong && !longCut && !longAdd) return null;
  const c0 = inFrameLong ? spec.seam : (cut ?? add)!.c0;
  const lead = before.filter((u) => "c" in u && u.c < c0);
  const room = Math.max(slotsOf(before), Math.min(V.targetCodons, measure1()));
  const push = (out: WindowUnit[], lo: number, hi: number, key: (c: number) => string) => {
    for (let c = lo; c <= hi; c++) out.push({ c, key: key(c) });
  };

  if (inFrameLong) {
    const out = [...lead];
    for (let r = spec.seam + words; r <= last && slotsOf(out) < room; r++) out.push({ c: r });
    return out;
  }

  // the shifted reading in variant codons, named after the reference codons it mostly holds
  const Q = Math.floor((cut ? cut.n : add!.n) / 3);
  const dn = (v: number) => (cut ? `c${v + Q}` : `c${v - Q}`);
  const T = spec.terminator;
  /** from `from` (a variant codon) to the landing, or filling the row */
  const tail = (out: WindowUnit[], from: number, landF: number, after: number) => {
    if (T == null) {
      for (let v = from; v <= last && slotsOf(out) < room; v++) out.push({ c: v, key: dn(v) });
      return out;
    }
    const hi = Math.min(T, from + after - 1);
    push(out, from, hi, dn);
    const a = Math.max(hi + 1, T - landF),
      b = Math.min(last, T + landF);
    if (a > hi + 1) {
      if (a - hi - 1 > V.breakCodons) out.push({ first: hi + 1, last: a - 1, key: `b${dn(hi + 1)}` });
      else push(out, hi + 1, a - 1, dn);
    }
    push(out, Math.max(a, hi + 1), b, dn);
    return out;
  };
  const fits = (u: WindowUnit[]) => slotsOf(u) <= measure1();

  if (cut) {
    // the closed row: the shifted reading straight on from c0, growing toward the landing
    let after = f + 1,
      units = tail([...lead], c0, f, after);
    while (T != null && c0 + after < T - f - 1 && fits(tail([...lead], c0, f, after + 1)) && slotsOf(units) < room)
      units = tail([...lead], c0, f, ++after);
    if (!fits(units)) units = tail([...lead], c0, 0, after);
    return units;
  }

  // the opened row: the new letters' codons, elided, then the shifted reading
  const a0 = add!;
  /* A stop inside the new letters ends the row there: two codons, the break, then the codon
     before the stop, the stop and one past it. Nothing after is read or drawn. */
  if (T != null && T <= a0.vEnd) {
    const key = (v: number) => (v <= a0.vEnd ? `i${v}` : dn(v));
    const out = [...lead];
    if (elides(a0.c0, T)) {
      push(out, a0.c0, a0.c0 + k - 1, key);
      out.push({ first: a0.c0 + k, last: T - k, key: `ib${a0.c0}`, edit: true });
      push(out, T - k + 1, Math.min(last, T + f), key);
    } else push(out, a0.c0, Math.min(last, T + f), key);
    return out;
  }
  const build = (landF: number, flank: number) => {
    const out = [...lead];
    push(out, a0.c0, a0.c0 + k - 1, (v) => `i${v}`);
    out.push({ first: a0.c0 + k, last: a0.vEnd - k, key: `ib${a0.c0}`, edit: true });
    push(out, a0.vEnd - k + 1, a0.vEnd, (v) => `i${v}`);
    return tail(out, a0.vEnd + 1, landF, flank);
  };
  let units = build(f, f);
  if (!fits(units)) units = build(0, f);
  if (!fits(units)) units = build(0, 0);
  return units;
}

/** The row before and after: one plan for every cell but a long run's, whose row closes or
 *  opens; `post` is drawn from the move on. */
function pairedPlans(spec: CodonSpecimen): { pre: CodonPlan; post: CodonPlan } {
  const units = codonWindow(spec);
  const pre = codonPlan(spec, units);
  const after = afterWindow(spec, units);
  return { pre, post: after ? codonPlan(spec, after) : pre };
}

function codonPlan(spec: CodonSpecimen, units: WindowUnit[] = codonWindow(spec)): CodonPlan {
  const pitch = PITCH1;
  const cellW = V.codonCellW;
  const gap = V.blockGap;
  const blockW = pitch - gap;
  // wider than a slot, so a break never reads as one missing codon; units are therefore
  // cursor-placed rather than order * pitch
  const breakW = V.breakCells * pitch;

  const placed: Placed[] = [];
  const breaks: BreakPlaced[] = [];
  const boundaries: number[] = [0];
  const keys: string[] = units.map(unitKey).concat("end");
  let x = 0;
  units.forEach((u, order) => {
    if ("c" in u) {
      placed.push({ c: u.c, order, x, y: 0, w: blockW });
      x += pitch;
    } else {
      breaks.push({
        order,
        x,
        y: 0,
        w: breakW,
        count: u.last - u.first + 1,
        first: u.first,
        last: u.last,
        key: unitKey(u),
        edit: u.edit,
      });
      x += breakW;
    }
    boundaries.push(x);
  });

  const m = motions(spec.netBaseDelta);
  const byCodon = new Map(placed.map((p) => [p.c, p]));

  // a window opens and closes on a codon (a break sits between neighbourhoods), so the first
  // and last units' codons are the edges to check
  const first = units[0];
  const last = units[units.length - 1];
  const firstC = "c" in first ? first.c : null;
  const lastC = "c" in last ? last.c : null;

  return {
    boundaries,
    keys,
    placed,
    breaks,
    cellW,
    gap,
    pitch,
    blockW,
    bleedLeft: firstC !== 1,
    bleedRight: lastC !== spec.lastCodon,
    dx: m.countDelta * pitch + m.alignBases * cellW,
    height: ROW_HEIGHT,
    at: (c: number) => byCodon.get(c),
  };
}

/** A break column's count in reference codons, beneath the datum: it names a span of the ruler,
 *  so it reads as an annotation on it. Baseline is gap + labelSize past the hairline, as the
 *  chain lane's site label. */
function breakLabel(b: BreakPlaced, top: number): Mark {
  return {
    kind: "label",
    key: `break-${b.key}`,
    x: b.x + b.w / 2,
    anchor: "middle",
    y: top + V.blockH + V.datumGap + V.breakLabelGap + V.labelSize,
    text: `${b.count} codons`,
    static: true,
  };
}

/** The datum: a tick at every unit boundary. A break contributes its two boundary ticks and no
 *  interior one, so the run is unticked through the gap without the generator knowing.
 *
 *  The rule runs past its outer ticks where the window stops short of the gene's edge (there is
 *  more reading that side); at a true edge it stops on the tick. The bleed is line only: a tick
 *  claims a reference position and the bleed has none.
 *
 *  The rule does not split or dash at a break: it is the instrument the content is measured
 *  against, and the scale is as continuous there as anywhere (the column's width says the reading
 *  is not). The transcript lane does the same, and dashGhost already owns dashes on this register.
 *
 *  Every mark is `static`: the scale is not part of what arrives, so it skips the establish fade
 *  (a faint mark fading at a solid block's rate reads as lagging). */
function codonDatum(plan: CodonPlan, top: number): Mark[] {
  const out: Mark[] = [];
  const y = top + V.blockH + V.datumGap;

  // ticks stand in the gaps (a boundary between two codons is the gap between them), so each
  // codon sits centred between two and a deletion's join lands on its tick
  const half = plan.gap / 2;
  // keyed by identity, not index, so ticks travel with their codons when a long indel's row
  // closes or opens
  plan.boundaries.forEach((x, i) =>
    out.push({ kind: "tick", key: `tick-${plan.keys[i]}`, x: x - half, y, len: V.tickLen, static: true }),
  );

  const bleed = V.bleedRulerIntervals * plan.pitch;
  /* The rule runs past its end ticks on both sides, unclamped by the stage: clamped, the last
     ticks stand on nothing. This is the one register that leaves the stage on the left. */
  const x1 = plan.boundaries[0] - half - (plan.bleedLeft ? bleed : 0);
  const x2 = plan.boundaries[plan.boundaries.length - 1] - half + (plan.bleedRight ? bleed : 0);

  // one rule end to end, under the break columns as under everything else
  out.push({ kind: "rule", key: "rule", x1, x2, y, static: true });

  plan.breaks.forEach((b) => out.push(breakLabel(b, top)));
  return out;
}

/** one cell of the shifted reading frame's source: a specific base of the
 *  reference, or newly-inserted material with no reference source at all. */
type SourceCell = { kind: "old"; codon: number; cell: 1 | 2 | 3 } | { kind: "new" };

/** The mechanism of a frameshift, made literal: which letters end up reading together, not just
 *  the net effect. Enumerates reference letters from the edit on, applies the cut or splices in
 *  the new letters, and re-chunks the result into threes.
 *
 *  Every new group lands on the reference slot grid (plan.dx is exactly the displacement that
 *  puts a shifted reading back on pitch), so this decides only which cells, never where. */
function regroupedSlots(spec: CodonSpecimen, lastCodon: number): Map<number, SourceCell[]> {
  /* A deletion is enumerated from the first codon it cuts, skipping every cut letter however
     many codons it runs across. New group k is variant codon c0 + k. */
  const cut = cutOf(spec),
    add = addOf(spec);
  const c0 = cut ? cut.c0 : add ? add.c0 : spec.seam;
  const cells: SourceCell[] = [];
  for (let c = c0; c <= lastCodon; c++) {
    for (let k0 = 0; k0 < 3; k0++) {
      // every new letter, however many codons they fill
      if (add && c === add.c0 && k0 === add.from) {
        for (let i = 0; i < add.n; i++) cells.push({ kind: "new" });
      }
      if (cut && isCut(cut, c, k0 + 1)) continue;
      cells.push({ kind: "old", codon: c, cell: (k0 + 1) as 1 | 2 | 3 });
    }
  }
  const slots = new Map<number, SourceCell[]>();
  for (let i = 0; i + 2 < cells.length; i += 3) {
    slots.set(c0 + i / 3, cells.slice(i, i + 3));
  }
  return slots;
}

/** A frameshift deletion's cut, in reference letters. c0 is the first codon cut; s the first cut
 *  letter's index from c0's first letter (0..2); n how many letters leave; cEnd the codon of the
 *  last. Built specimens carry no `cut`: theirs is the seam codon's cutCells. */
interface Cut {
  c0: number;
  s: number;
  n: number;
  cEnd: number;
}
function cutOf(spec: CodonSpecimen): Cut | null {
  if (spec.kind !== "frameshift" || spec.netBaseDelta >= 0) return null;
  const n = -spec.netBaseDelta;
  const start = spec.cut?.start ?? (spec.seam - 1) * 3 + (spec.cutCells[0] ?? 1);
  const c0 = Math.floor((start - 1) / 3) + 1;
  return { c0, s: (start - 1) % 3, n, cEnd: Math.floor((start - 1 + n - 1) / 3) + 1 };
}
/** letter index from c0's first letter */
const cutIdx = (cut: Cut, c: number, cell: number) => (c - cut.c0) * 3 + cell - 1;
const isCut = (cut: Cut, c: number, cell: number) => {
  const r = cutIdx(cut, c, cell);
  return r >= cut.s && r < cut.s + cut.n;
};
/** A run too long for the row is elided, not ghosted: every deletion fades and closes up, every
 *  insertion opens up and drops in, whatever its length. A long run keeps two codons at each end
 *  on the row, the rest in a break column, and is drawn as two plans (pairedPlans). */
const ELIDE_KEEP = 2;
/* over six codons: up to six, the row holds the run with a codon of lead, a flank and a landing;
   past that the run pushes the reading either side off the row */
const elides = (first: number, last: number) => last - first + 1 > 2 * ELIDE_KEEP + 2;

/** A frameshift insertion, in letters. The new letters go in before letter
 *  `from` (0..2) of codon c0; n of them; vEnd is the variant codon holding the last. Built
 *  specimens carry no `add`: theirs is the seam codon's addCells. */
interface Add {
  c0: number;
  from: number;
  n: number;
  vEnd: number;
}
function addOf(spec: CodonSpecimen): Add | null {
  if (spec.kind !== "frameshift" || spec.netBaseDelta <= 0) return null;
  const n = spec.netBaseDelta;
  const c0 = spec.add ? Math.floor(spec.add.after / 3) + 1 : spec.seam;
  const from = spec.add ? spec.add.after % 3 : (spec.addCells[0] ?? 1) - 1;
  return { c0, from, n, vEnd: c0 + Math.floor((from + n - 1) / 3) };
}
/** the codons an edit spans on its row: a cut's reference codons, an insertion's variant ones */
function editSpan(spec: CodonSpecimen): [number, number] | null {
  const cut = cutOf(spec),
    add = addOf(spec);
  return cut ? [cut.c0, cut.cEnd] : add ? [add.c0, add.vEnd] : null;
}
/** reference codon holding a variant codon's first and last letters */
function refSpanOf(cut: Cut, vc: number): [number, number] {
  const ref = (j: number) => cut.c0 + Math.floor((j < cut.s ? j : j + cut.n) / 3);
  const j0 = (vc - cut.c0) * 3;
  return [ref(j0), ref(j0 + 2)];
}

/* One function for every cell. The lane draws from the specimen's kind, never its state name:
   what differs between states of one kind (which codon, how many bases, where the stop is) is
   fact, in specimens.ts.

   Beats are read by name, not position: `past("regroup")` is true from that beat on and false in
   a state without it, which is how kinds with and without a regroup share this function. */
export function codonFrame(spec: CodonSpecimen, entry: StateEntry, beat: BeatName): Frame {
  // `plan` is the row before the edit; `post` the row after, the same plan but for a long run
  const { pre: plan, post } = pairedPlans(spec);
  const top = Math.max(0, (V.stageH - plan.height) / 2);
  const past = pastOf(entry, beat);
  // the datum follows the row: it changes when the row closes or opens
  const moveBeat = spec.kind === "in-frame" ? "reflow" : "regroup";
  const marks: Mark[] = codonDatum(post !== plan && past(moveBeat) ? post : plan, top);

  const yOf = (u: Placed) => top + u.y;

  /* The reading front: how far reading has got in the frame being drawn. Everything past it is
     unread and takes the faint rung; nothing else does. Faint is what "not read yet" looks like,
     not a property of the last beat.

       · the reference terminator holds the front until the beat that shows reading run past it.
         It is non-null only for a stop loss, which is why that cell is faint downstream from
         its first frame.
       · the variant terminator takes the front from `reachBeat`, the cell's last beat, one beat
         after the stop turns black: "the stop appears" and "nothing past it was read" are two
         facts (RULES.md §8.9; the transcript lane splits its stop the same way, §8.5/§8.7). In a
         stop loss `read-past` moves the front first, so `reachBeat` never decides there.
       · with neither, nothing has stopped the reading and nothing is unread. */
  const reachBeat = entry.beats[entry.beats.length - 1];
  const stopNow = past("read-past") || past(reachBeat) ? spec.terminator : spec.trueEnd;
  const unread = (c: number) => stopNow != null && c > stopNow;

  /* The gene's own stop (the protein's length plus one) is drawn as a stop, in the neutral ink:
     dark because it is a stop, neutral because the variant didn't make it. It applies wherever a
     builder leaves the channel alone; a builder that sets one decides for itself. */
  const ownStop = (spec.residues ?? (spec.trueEnd ? spec.trueEnd - 1 : spec.lastCodon - 1)) + 1;
  const solid = (u: Placed, extra: Partial<BlockMark> = {}): BlockMark => ({
    kind: "block",
    key: `c${u.c}`,
    x: u.x,
    y: yOf(u),
    w: u.w,
    h: V.blockH,
    ch: "solid",
    parts: 3,
    ...(u.c === ownStop && extra.ch === undefined && extra.own !== false ? { ch: "black" as Channel, own: true } : {}),
    ...extra,
  });

  /** An inserted base or codon. It starts one row above its place and descends the same beat
   *  the strip shifts by plan.dx to make room, so the gap opens as the new material drops in;
   *  one key throughout, so the descent is a tween, not an arrival fade. `settledCh` is the
   *  channel once landed: a frameshift insert turns with its group (hollow, or black at the stop). */
  const inserted = (
    x: number,
    y: number,
    w: number,
    parts: number | undefined,
    moved: boolean,
    edgeJoint?: readonly ("start" | "end")[],
    settledCh: Channel = "solid",
  ): BlockMark => ({
    kind: "block",
    key: "intrusion",
    x,
    y: moved ? y : y - V.blockH - V.insertGap,
    w,
    h: V.blockH,
    ch: moved ? settledCh : "solid",
    parts,
    edgeJoint,
  });

  const breakFor = (c: number) => plan.breaks.find((b) => c >= b.first && c <= b.last);
  /* The strip's trailing edge, for a codon past the last one drawn: one pitch past the last
     placed unit. Shared, because frameshift and in-frame material both cross it. */
  const lastPlaced = plan.placed[plan.placed.length - 1];
  const stripEdge = lastPlaced ? lastPlaced.x + plan.pitch : undefined;
  const pastStrip = (c: number) =>
    lastPlaced && stripEdge != null && c > lastPlaced.c
      ? { x: stripEdge + (c - lastPlaced.c - 1) * plan.pitch, order: lastPlaced.order + (c - lastPlaced.c) }
      : undefined;

  /* Edge crossing: material passes through edges; claims never do. Strip and break edges are
     viewports: a mark with an honest position at only one end slides to or from the hidden
     region at the cascade's speed, cut hard at the boundary nearest its known end. No fade, no
     shrink. [lo, hi] rather than a BreakPlaced because the strip's end is the same kind of
     boundary, one line wide. A left-hand cut sits at the block's drawn end (lo - gap), so no
     sliver shows across the gap. */
  const edgeClip = (knownX: number, lo: number, hi: number): readonly [number, number] =>
    knownX < lo ? [-V.stageBleed, lo - plan.gap] : [hi, V.stageW + V.stageBleed];

  switch (spec.kind) {
    // the reading as it is meant to go: every group solid and on the beat
    case "anchor": {
      for (const u of plan.placed) marks.push(solid(u));
      break;
    }

    /* The grouping breaks, literally: letters regroup into new threes (regroupedSlots). Every
       cell from the edit through the landing keeps one key at every beat, establish included, so
       the cut has a mark to fade from and nothing crossfades. Each beat changes one thing:
         delete/intrude   the cut fades out (or the new letters appear), alone
         regroup          every moving cell moves, one rank per destination group so a group
                          assembles in one step; the only beat positions change
         reveal-stop      the terminator's triple alone turns black

       The flank past the terminator is a regrouped triple too: the stop's triple borrows the
       next codon's first letters, so drawing that codon whole would draw them twice. */
    case "frameshift": {
      const opBeat = spec.netBaseDelta < 0 ? "delete" : "intrude";
      const applied = past(opBeat);
      const moved = past("regroup");
      const stopped = past("reveal-stop");
      const cut = cutOf(spec),
        add = addOf(spec);
      // the first codon the edit touches: a deletion's first cut codon, an insertion's, else the seam
      const c0 = cut ? cut.c0 : add ? add.c0 : spec.seam;
      /* Sources are read off the row before, destinations off the row after (pairedPlans): a
         letter leaves its place in `plan` and lands in its group's place in `post`. */
      const postBreakFor = (c: number) => post.breaks.find((b) => c >= b.first && c <= b.last);
      const postLast = post.placed[post.placed.length - 1];
      const postEdge = postLast ? postLast.x + post.pitch : undefined;
      const postPast = (c: number) =>
        postLast && postEdge != null && c > postLast.c
          ? { x: postEdge + (c - postLast.c - 1) * post.pitch, order: postLast.order + (c - postLast.c) }
          : undefined;

      /* With a stop, the regroup ends a flank past it. With none, it ends a codon past the row's
         end: regrouping to the gene's end would spread the front over unseen groups, rushing the
         visible ones. */
      const lastRegrouped =
        spec.terminator == null
          ? Math.min(spec.lastCodon, post.placed[post.placed.length - 1].c + 1)
          : Math.min(spec.lastCodon, spec.terminator + V.flankCodons + 1);
      // an insertion pushes the row's letters right: every letter drawn before the move has a
      // group to go to, even beyond the landing (it slides out past the edge)
      const lastSource = add
        ? Math.min(spec.lastCodon, plan.placed[plan.placed.length - 1].c + Math.ceil(add.n / 3) + 1)
        : 0;
      // the letters are enumerated in reference codons: a cut of a codon's worth or more must
      // reach past itself to fill the variant groups up to lastRegrouped (under that, the
      // groups are those the built cells always drew)
      const slots = regroupedSlots(
        spec,
        Math.min(
          spec.lastCodon,
          Math.max(lastRegrouped, lastSource) + (cut && cut.n >= 3 ? Math.ceil(cut.n / 3) + 1 : 0),
        ),
      );
      /* How far the moving material travels, for a hidden end's slide: one plan, its own dx; two,
         the largest move of any letter drawn at both ends. */
      let shift = plan.dx;
      if (post !== plan) {
        let best = 0;
        for (const [v, triple] of slots) {
          const d = post.at(v);
          if (!d) continue;
          triple.forEach((src, i) => {
            const h = src.kind === "old" ? plan.at(src.codon) : undefined;
            if (!h || src.kind !== "old") return;
            const m = d.x + i * plan.cellW - (h.x + (src.cell - 1) * plan.cellW);
            if (Math.abs(m) > Math.abs(best)) best = m;
          });
        }
        shift = best || plan.dx;
      }
      // ranked by order, not codon number: the front crosses a break in one step, as it is drawn
      const seamOrder = post.at(c0)?.order ?? 0;
      /* An insertion clears from the far end: everything moves right, so seam-first would send
         each codon into a slot its neighbour still holds. The new letters drop after the last
         has moved, into the slot opened. A deletion runs seam-first, into space already vacated. */
      const arriving = spec.netBaseDelta > 0;
      let farRank = 0;
      for (let c = c0; c <= lastRegrouped; c++) {
        const o = post.at(c)?.order ?? postBreakFor(c)?.order ?? postPast(c)?.order;
        if (o != null) farRank = Math.max(farRank, o - seamOrder);
      }
      const frontRank = (r: number) => (arriving ? farRank - r : r);
      /* The colour has its own beat where the cell declares `misread`: on an insertion the slide
         runs from the far end but the misreading from the seam, so `regroup` moves everything and
         `misread` then turns the groups hollow from the new letters on. Otherwise it is `regroup`. */
      const recolours = entry.beats.includes("misread");
      const colored = recolours ? past("misread") : moved;

      for (const u of plan.placed) {
        if (u.c < c0) marks.push(solid(u));
      }

      /* The cut, before it is made: one block per codon it takes letters from, at those letters'
         places. Present at establish, split so nothing looks different yet; gone from the
         operating beat on. */
      if (cut && !applied) {
        for (let c = cut.c0; c <= cut.cEnd; c++) {
          const u = plan.at(c);
          if (!u) continue;
          const gone = [1, 2, 3].filter((cell) => isCut(cut, c, cell));
          const from = gone[0] - 1,
            n = gone.length;
          const edges: ("start" | "end")[] = [];
          if (from > 0) edges.push("start");
          if (from + n < 3) edges.push("end");
          marks.push({
            kind: "block",
            key: `c${c}-cut`,
            x: u.x + from * plan.cellW,
            y: yOf(u),
            w: n * plan.cellW,
            h: V.blockH,
            ch: "solid",
            parts: n,
            edgeJoint: edges,
          });
        }
      }

      /* By destination slot, not plan.placed: a triple landing inside a break or past the strip is
         as real as any, and may hold visible cells (a landing codon's first letters, the last
         drawn codon's trailing one) that have nowhere else to be drawn. */
      for (let destC = c0; destC <= Math.max(lastRegrouped, lastSource); destC++) {
        const triple = slots.get(destC);
        if (!triple) continue;
        const destPlaced = post.at(destC);
        const destBreak = destPlaced ? undefined : postBreakFor(destC);
        const destVirtual = destPlaced || destBreak ? undefined : postPast(destC);
        if (!destPlaced && !destBreak && !destVirtual) continue;
        const destX = destPlaced ? destPlaced.x : destBreak ? destBreak.x : destVirtual!.x;
        const destOrder = destPlaced ? destPlaced.order : destBreak ? destBreak.order : destVirtual!.order;
        const y = top;
        const rank = beat === "misread" ? destOrder - seamOrder : frontRank(destOrder - seamOrder);

        const isStop = destC === spec.terminator && stopped;
        const isUnread = unread(destC);
        const ch: Channel = isStop ? "black" : "hollow";

        // the hidden region this triple lands in, if it has no drawn destination: a break, or
        // past the strip's trailing edge
        const destRegion0: readonly [number, number] | null = destPlaced
          ? null
          : destBreak
            ? [destBreak.x, destBreak.x + destBreak.w]
            : [postEdge!, postEdge!];
        /* Across two rows a letter can stand, before the move, right of where its hidden region
           begins in the row after (an insertion opens a break where the row before has letters).
           It is cut at its own far edge then, so it doesn't vanish before it moves. */
        const destRegion: readonly [number, number] | null =
          destRegion0 && post !== plan && !destBreak
            ? (() => {
                const reach = Math.max(
                  -Infinity,
                  ...triple.map((src) => {
                    const h = src.kind === "old" ? plan.at(src.codon) : undefined;
                    return h && src.kind === "old" ? h.x + src.cell * plan.cellW : -Infinity;
                  }),
                );
                // (+ gap: edgeClip takes the gap back off a left-hand cut)
                return reach > destRegion0[0]
                  ? ([reach + plan.gap, Math.max(reach + plan.gap, destRegion0[1])] as const)
                  : destRegion0;
              })()
            : destRegion0;

        /* First pass: each cell's drawn end, and which hidden region its other end sits behind.
           Two passes because what a hidden end does belongs to the group crossing the edge, not
           to one cell. */
        const cells = triple.map((src, i) => {
          const cellX = destX + i * plan.cellW;
          const home = src.kind === "old" ? plan.at(src.codon) : undefined;
          const realX = src.kind === "old" && home ? home.x + (src.cell - 1) * plan.cellW : null;
          /* a source codon with no block: inside a break, or past the strip's trailing edge (the
             flank's extra codon, enumerated only to complete the last triple). Either way it
             slides in from behind that edge. */
          const srcRegion: readonly [number, number] | null =
            src.kind === "new" || home
              ? null
              : (() => {
                  const b = breakFor(src.codon);
                  if (b) return [b.x, b.x + b.w] as readonly [number, number];
                  // past the row's end: the row after may end further out, and a letter landing
                  // there is cut at the later edge
                  const E = post !== plan && postEdge != null ? Math.max(stripEdge!, postEdge) : stripEdge!;
                  return pastStrip(src.codon) ? ([E, E] as readonly [number, number]) : null;
                })();
          return { src, i, cellX, home, realX, region: home ? destRegion : srcRegion };
        });

        /* The shift a hidden end takes is the group's, not the cell's: adjacent letters cross an
           edge rigidly, by the strip's own displacement (so at the cascade's speed), or exactly
           far enough to put the whole group out of sight if that is further. */
        const shiftFor = (xs: number[], region: readonly [number, number], step: number) =>
          Math.min(...xs) < region[0]
            ? Math.max(step, region[0] - Math.min(...xs))
            : Math.min(step, region[1] - plan.cellW - Math.max(...xs));

        const rk = (r: readonly [number, number]) => `${r[0]},${r[1]}`;
        const outShift =
          destRegion && cells.some((c) => c.realX != null)
            ? shiftFor(
                cells.filter((c) => c.realX != null).map((c) => c.realX!),
                destRegion,
                shift,
              )
            : 0;
        const inShift = new Map<string, number>();
        for (const c of cells) {
          if (c.realX != null || !c.region) continue;
          const k = rk(c.region);
          if (inShift.has(k)) continue;
          const xs = cells.filter((d) => d.realX == null && d.region && rk(d.region) === k).map((d) => d.cellX);
          inShift.set(k, shiftFor(xs, c.region, -shift));
        }

        for (const c of cells) {
          const { src, i, cellX } = c;
          const postEdges: ("start" | "end")[] = [];
          if (i > 0) postEdges.push("start");
          if (i < 2) postEdges.push("end");

          if (src.kind === "new") {
            // nothing until the operating beat
            if (!destPlaced || !applied) continue;
            marks.push({
              // the new letter turns with its group (the arrived look is for in-frame insertions);
              // raised, it keeps its dividers with the new letters beside it, so several don't
              // read as one block
              ...inserted(
                cellX,
                y,
                plan.cellW,
                undefined,
                moved,
                moved
                  ? postEdges
                  : ([
                      ...(i > 0 && triple[i - 1].kind === "new" ? ["start"] : []),
                      ...(i < 2 && triple[i + 1].kind === "new" ? ["end"] : []),
                    ] as ("start" | "end")[]),
                colored ? ch : "solid",
              ),
              // one key per new letter: there can be any number
              key: `intrusion-${destC}-${i}`,
              rank: moved && !stopped ? (beat === "misread" ? rank : farRank + 1) : undefined,
            });
            continue;
          }

          // both ends hidden: never on screen, implied only by the break's count
          if (!c.home && !destPlaced) continue;
          // no drawn end on either side
          if (c.realX == null && !c.region) continue;

          let clip: readonly [number, number] | undefined;
          let fromX: number;
          let toX = cellX;
          /* Across two rows, a letter that crosses a break fades in place: the row after puts its
             breaks where the row before had letters, so a cut there would mean nothing in the row
             it came from. It fades out if headed into a break, in at its place if coming out of
             one. Letters with both ends on the row slide; the strip's own ends still cut. */
          const pair = post !== plan;
          // a clear path: both ends on the rows, and no break column (before or after) between
          const clear =
            c.realX != null &&
            destPlaced != null &&
            (() => {
              const lo = Math.min(c.realX!, cellX),
                hi = Math.max(c.realX!, cellX) + plan.cellW;
              // the edit's own run is what the row closes or opens across, so crossing it is the move
              return ![...plan.breaks, ...post.breaks].some((b) => !b.edit && hi > b.x && lo < b.x + b.w);
            })();
          const crossfade = pair && !clear;
          let op: number | undefined;
          if (crossfade) {
            // before the move: at its place if it has one; after: at its group's place if that is
            // drawn, under a new key, so the engine fades one out and the other in
            const there = moved ? (destPlaced ? cellX : null) : c.realX;
            if (there == null) continue;
            fromX = toX = there;
            op = undefined;
          } else if (c.realX != null) {
            fromX = c.realX;
            if (c.region) {
              clip = edgeClip(c.home!.x, c.region[0], c.region[1]);
              toX = fromX + outShift;
            }
          } else {
            fromX = cellX + inShift.get(rk(c.region!))!;
            clip = edgeClip(cellX, c.region![0], c.region![1]);
          }

          // before the move, joints follow the reference codon the cell is still part of; a cut
          // neighbour stops counting once the cut is gone, so no joint points at nothing
          const cutAdjacent = (cell: number) => cut != null && applied && isCut(cut, src.codon, cell);
          const preEdges: ("start" | "end")[] = [];
          if (src.cell > 1 && !cutAdjacent(src.cell - 1)) preEdges.push("start");
          if (src.cell < 3 && !cutAdjacent(src.cell + 1)) preEdges.push("end");

          marks.push({
            kind: "block",
            key: `b${src.codon}-${src.cell}${crossfade && moved ? "~" : ""}`,
            x: moved ? toX : fromX,
            y,
            w: plan.cellW,
            h: V.blockH,
            ...(op != null ? { op } : {}),
            ch: colored ? ch : "solid",
            reach: isUnread ? "unread" : undefined,
            // unread takes the transcript lane's `inkFill` rung, a step above the datum's
            // (BlockMark `faint`, RULES.md §8.9)
            faint: isUnread,
            edgeJoint: moved ? postEdges : preEdges,
            /* rank paces the move, it is not an address: cleared once `stopped`, when nothing
               travels, or the timeline would stagger the flank's reach flip behind the stop's. */
            rank: moved && !stopped ? rank : undefined,
            clip,
            ...(clip ? { sync: true } : {}),
          });
        }
      }
      break;
    }

    /* Whole groups leave or arrive. Nothing is misread: the displacement is whole slots, so
       downstream lands back on the beat and stays solid. The datum is the landing: the claim is
       that material moved by exactly whole ticks. */
    case "in-frame": {
      const leaving = spec.netBaseDelta < 0;
      const applied = past(leaving ? "delete" : "admit");
      const moved = past("reflow");
      const seat = plan.at(spec.seam);
      // N whole words (|netBaseDelta| / 3): every rule below is the one-word rule over a run of N
      const words = Math.abs(Math.trunc(spec.netBaseDelta / 3));
      const lastGone = spec.seam + words - 1;
      // O3's in-place ghosting is off: every removal fades and closes up, whatever its length
      const ghosted = false;

      /* A removal longer than the row closes across its break. Its row is two plans
         (pairedPlans): before, two words at each end of the stretch and a break column between;
         after, the codons past the stretch standing from where its first word stood. The words
         on the row fade on `delete` (the break and its count go with the ruler on `reflow`); on
         `reflow` everything past the stretch slides back as one, the codons beyond the row's end
         sliding in behind it, and the join is drawn where the two sides now meet. */
      if (leaving && post !== plan) {
        const first = post.at(lastGone + 1);
        const was = plan.at(lastGone + 1);
        const D = first && was ? first.x - was.x : 0;
        const firstOrder = first?.order ?? 0;
        for (const u of plan.placed) {
          if (u.c < spec.seam) {
            marks.push(solid(u));
            continue;
          }
          if (u.c <= lastGone && !applied) marks.push(solid(u));
        }
        for (const p of post.placed) {
          if (p.c < spec.seam) continue;
          const home = plan.at(p.c);
          marks.push(
            solid(p, {
              x: moved ? p.x : home ? home.x : p.x - D,
              rank: moved ? p.order - firstOrder : undefined,
              // entering from past the row's end: cut at whichever row ends further out
              ...(home || stripEdge == null
                ? {}
                : (() => {
                    const pl = post.placed[post.placed.length - 1],
                      E = Math.max(stripEdge, pl.x + post.pitch);
                    return { clip: edgeClip(lastPlaced.x, E, E) };
                  })()),
            }),
          );
        }
        const before = post.at(spec.seam - 1);
        if (moved && before && first) {
          marks.push({
            kind: "seam",
            key: "seam-del",
            x: (before.x + before.w + first.x) / 2,
            y: yOf(before),
            h: V.blockH,
            lds: true,
            discrete: true,
            rank: 0,
          });
        }
        break;
      }
      const lastOrder = lastPlaced?.order ?? 0;
      // by order, as seamOrder above, so a break in the run counts as one front step
      const firstMoved = plan.placed.find((p) => (leaving ? p.c > lastGone : p.c >= spec.seam))?.order ?? 0;

      for (const u of plan.placed) {
        // the group that leaves is absent from the next frame; the engine fades an absence in
        if (leaving && u.c >= spec.seam && u.c <= lastGone) {
          if (!applied) marks.push(solid(u));
          else if (ghosted) marks.push(solid(u, { key: `c${u.c}-ghost`, ch: "arrived", reach: "unread", faint: true }));
          continue;
        }
        const downstream = leaving ? u.c > lastGone : u.c >= spec.seam;
        const dx = moved && downstream && !ghosted ? plan.dx : 0;
        // edge crossing: an insertion pushes the last N drawn codons past the strip's trailing
        // edge, cut there as everything crossing an edge is
        const clip =
          !leaving && downstream && stripEdge != null && u.x + plan.dx + u.w > stripEdge
            ? edgeClip(u.x, stripEdge, stripEdge)
            : undefined;
        marks.push(
          solid(u, {
            x: u.x + dx,
            // far end first on an insertion, as in the frameshift branch
            rank: moved && downstream ? (leaving ? u.order - firstMoved : lastOrder - u.order) : undefined,
            clip,
          }),
        );
      }

      /* The join a deletion makes: once downstream has closed up, the codons either side of the
         removal abut, a join not in the gene and the deletion's only mark at rest. Drawn as the
         transcript lane's dashed seam, centred in the gap, `lds` so the host inks it as delta. */
      if (leaving && moved && !ghosted) {
        const before = plan.at(spec.seam - 1),
          after = plan.at(lastGone + 1);
        if (before && after) {
          const sx = (before.x + before.w + after.x + plan.dx) / 2;
          // snaps in when the first codon after the gap lands
          marks.push({
            kind: "seam",
            key: "seam-del",
            x: sx,
            y: yOf(before),
            h: V.blockH,
            lds: true,
            discrete: true,
            rank: 0,
          });
        }
      }

      // a deletion opens slots at the strip's end that the window never drew: the codons that
      // belong there slide in from one pitch past the last drawn, clipped until they enter
      if (leaving && lastPlaced && stripEdge != null && !ghosted) {
        // N words leave, N codons enter from the edge, each one pitch further out
        for (let k = 1; k <= words; k++) {
          marks.push({
            kind: "block",
            key: `c${lastPlaced.c + k}`,
            x: moved ? lastPlaced.x + k * plan.pitch + plan.dx : stripEdge + (k - 1) * plan.pitch,
            y: yOf(lastPlaced),
            w: lastPlaced.w,
            h: V.blockH,
            ch: "solid",
            parts: 3,
            rank: moved ? lastPlaced.order + k - firstMoved : undefined,
            clip: edgeClip(lastPlaced.x, stripEdge, stripEdge),
          });
        }
      }

      // no join marks on an in-frame insertion: the arrived words show where they begin and end
      if (!leaving && seat && applied) {
        for (let k = 0; k < words; k++) {
          /* arrived material once landed (pale verdigris fill, dashed outline), as a retained
             intron in the transcript lane and an inserted residue on the fold: the row says
             which words are new at rest */
          const m0 = inserted(seat.x + k * plan.pitch, yOf(seat), seat.w, 3, moved);
          const m: BlockMark = moved ? { ...m0, ch: "arrived" } : m0;
          // drops after the last codon has cleared its slot
          const r = moved ? { rank: lastOrder - firstMoved + 1 } : {};
          marks.push(k === 0 ? { ...m, ...r } : { ...m, ...r, key: `intrusion-${k + 1}` });
        }
      }
      break;
    }

    // one group flips directly to stop: nothing moves, so the only change is a channel
    case "nonsense": {
      const flipped = past("flip-stop"),
        swapped = past("swap-cell");
      for (const u of plan.placed) {
        const isStop = u.c === spec.terminator;
        marks.push(
          solid(u, {
            ch: (isStop && flipped) || u.c === ownStop ? "black" : "solid",
            own: !isStop && u.c === ownStop ? true : undefined,
            // the changed letter's mark until the codon reads as a stop; then the whole codon is the stop
            swap: swapped && !flipped && isStop && spec.swapCell ? spec.swapCell : undefined,
            reach: unread(u.c) ? "unread" : undefined,
            faint: unread(u.c),
          }),
        );
      }
      break;
    }

    /* E7, start loss: the row opens on codon 1; on `locate` the start word's changed letter takes
       its mark; on `hold`, the foreclosure (what changed, and that where reading begins instead
       isn't known). */
    case "start-loss": {
      const located = past("locate");
      for (const u of plan.placed) {
        marks.push(solid(u, { swap: located && u.c === 1 && spec.swapCell ? spec.swapCell : undefined }));
      }
      // no words on the stage: the serif narrative says what changed and what isn't known
      break;
    }

    /* One letter changes inside a group that still spells the same thing. The settle beat is
       identical to the one before: nothing else reacts, and a register that moved would say
       otherwise. */
    case "silent": {
      const swapped = past("swap-cell");
      for (const u of plan.placed) {
        marks.push(
          solid(u, {
            swap: swapped && u.c === spec.seam && spec.swapCell ? spec.swapCell : undefined,
          }),
        );
      }
      break;
    }

    /* The final stop dissolves and reading runs on. Nothing is displaced: the material past the
       true end was always there, unread, so the operation is one of reach. */
    case "stop-loss": {
      const trueEnd = spec.trueEnd ?? spec.seam;
      // no new stop read: reading runs on off the row and nothing turns black
      const chance = spec.terminator ?? Infinity;
      const dissolved = past("dissolve-stop");
      const reading = past("read-past");
      const stopped = past("reveal-stop");

      /* The whole window is present from the first frame, unread and faint: the material was
         always there, so being read is a channel flip, not an arrival. Three beats:
           dissolve-stop  the true stop alone flips solid
           read-past      what the reading now covers flips to read, one codon at a time
                          (ranked by distance from the true end), on the lane's reading front
           reveal-stop    the chance stop alone flips black
         Nothing past the chance stop ever flips. Reach comes from the reading front, the same
         rule as the frameshift cells. Never-reached material stays `solid`, not `hollow`: hollow
         means wrong frame and nothing else (the two paint the same when unread). */
      for (const u of plan.placed) {
        if (u.c < trueEnd) {
          marks.push(solid(u));
          continue;
        }

        if (u.c === trueEnd) {
          // the gene's own stop: neutral dark until it breaks, then it keeps its changed letter's
          // mark, as every changed letter does
          marks.push(
            solid(
              u,
              dissolved
                ? { own: false, ...(spec.swapCell ? { swap: spec.swapCell } : {}) }
                : { ch: "black", own: true },
            ),
          );
          continue;
        }

        /* The chance stop is never a normally read codon: the front reaches it at `read-past`,
           but a stop is never translated, and a filled beat would say a residue was made here.
           It holds unread until it turns black. Excluded from the front, not reordered in it:
           the ranks (u.c - trueEnd - 1) stay 0..n-1 contiguous. */
        if (u.c === chance) {
          marks.push(solid(u, stopped ? { ch: "black" } : { reach: "unread", faint: true }));
          continue;
        }

        marks.push(
          solid(u, unread(u.c) ? { reach: "unread", faint: true } : { rank: reading ? u.c - trueEnd - 1 : undefined }),
        );
      }
      break;
    }
  }

  // codons counted to the last amino acid (the stop is drawn, not counted)
  // an elided stretch (a break column) is not shown, so the runs either side are named apart
  const cs = plan.placed.map((u) => u.c).sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const c of cs) {
    const r = runs[runs.length - 1];
    if (r && c === r[1] + 1) r[1] = c;
    else runs.push([c, c]);
  }
  const aa = spec.residues ?? (spec.trueEnd ? spec.trueEnd - 1 : spec.lastCodon - 1);
  const runTxt = runs.map(([a, b]) => (a === b ? nf(a) : `${nf(a)}–${nf(b)}`)).join(" AND ");
  // a row that reaches past the protein's last amino acid (a run-on, a stop loss, the stop
  // itself) drops "OF N": "codons 706–708 of 656" would read as an error
  const beyond = cs[cs.length - 1] > aa;
  const caption = runs.length
    ? {
        name: `${spec.gene} GENE`,
        pos: `${cs.length === 1 ? "CODON" : "CODONS"} ${runTxt}${beyond ? "" : ` OF ${nf(aa)}`}`,
      }
    : undefined;
  return { w: V.stageW, h: V.stageH, marks, caption };
}
