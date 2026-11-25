// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Marks to SVG: every lane paints through here, so a block is drawn one way in all of them.
// No geometry is computed here; the only arithmetic is on a mark's own numbers and tokens, noted where it happens.

import React from "react";
import { visual as V } from "../tokens";
import type { Mark, Channel, Reach } from "../frames";

/* The value ladder by role: a mark's rung is chosen by what it means, never by how it should look.
   Every rung resolves through tokens.ts (tokens:check fails on a raw `var(--v-…)` here). */
const RUNG = {
  fill: V.inkFill,
  terminal: V.inkTerminal,
  /** the gene's own stop: dark, and neutral (`BlockMark.own`) */
  ownStop: V.inkTerminalRef,
  /** The whole datum, line and ticks, sits at the faint rung: one instrument, and a scale is quieter than the
   *  material it measures. */
  rule: V.inkFaint,
  tick: V.inkFaint,
  /** A cleared space's edge (§8.56): apparatus, so the faint rung. Named apart from `rule` and `tick` because this
   *  table maps roles, and it is neither. */
  clearing: V.inkFaint,
  ground: V.inkGround,
  text: V.inkText,
} as const;

/* Dash discipline (§8.48): a corner never lands mid-gap, which reads as a break. A block's outline is four
   free-standing rules, each `sideSeq`-anchored to land both its ends on ink; the hollow module keeps one closed
   path, phase-anchored at every corner by `mergeSeqs` and started mid-top (§8.12). */

/** A side's own dash sequence: `n` dashes and `n − 1` gaps, so both ends land on ink. `n` is the whole count of the
 *  token's period nearest the side's length, and one scale factor fits it exactly, keeping the dash:gap ratio.
 *  A side shorter than one period gets one dash spanning it. */
function sideSeq(length: number, d0: number, g0: number): number[] {
  if (length <= 0) return [];
  if (d0 <= 0) return [length];
  const period = d0 + g0;
  const n = Math.max(1, Math.round((length + g0) / period));
  const nominal = n * d0 + (n - 1) * g0;
  const k = nominal > 0 ? length / nominal : 1;
  const d = d0 * k;
  const g = g0 * k;
  const seq: number[] = [];
  for (let idx = 0; idx < n; idx++) {
    seq.push(d);
    if (idx < n - 1) seq.push(g);
  }
  return seq;
}

/** Joins per-side sequences in perimeter order. Each starts and ends on a dash and a dasharray reads on/off by
 *  position, so the two dashes touching at a corner are summed into one; otherwise the second reads as a gap on the
 *  corner. A closed path needs no merge at its start point: it stops mid-dash on both approaches. */
function mergeSeqs(seqs: readonly number[][]): number[] {
  const parts = seqs.filter((s) => s.length > 0);
  if (!parts.length) return [];
  const out = parts[0].slice();
  for (let k = 1; k < parts.length; k++) {
    const next = parts[k];
    out[out.length - 1] += next[0];
    out.push(...next.slice(1));
  }
  return out;
}

/** The let-go register's sequence, tapers included: `dashDissolve3` along the run, except within `taperLen` of an
 *  end abutting a held bar, where the dot keeps its length and the gap shrinks, so the trace gathers into the bar.
 *  The taper is the shape of the run's own end, not a mark of its own. Never ends on a gap, and one factor scales
 *  the whole sequence to fit the run. */
export function letGoSeq(
  length: number,
  d0: number,
  g0: number,
  taperLen: number,
  taperStart: boolean,
  taperEnd: boolean,
): number[] {
  if (length <= 0) return [];
  const p = d0 + g0;
  if (p <= 0) return [length];
  const nT = Math.max(1, Math.round(taperLen / p));
  let nIn = taperStart ? nT : 0;
  let nOut = taperEnd ? nT : 0;
  /* Two dots is the floor (§7.10a): one would collapse to a solid dash the size of the run, a nick between two bars.
     The fit-to-length scale below keeps both ends on ink at any count. Below `2 × d0` the run should merge into its
     neighbour's taper instead; no specimen is near that, and the smoke asserts it. */
  const n = Math.max(2, Math.round(length / p));
  // the body is never allowed to vanish: a run that cannot hold both tapers
  // and one steady period gives the tapers back, longest first
  while (nIn + nOut + 1 > n && (nIn > 0 || nOut > 0)) {
    if (nIn >= nOut) nIn -= 1;
    else nOut -= 1;
  }
  /* The gaps ramp and the dots do not: the gap nearest a bar is smallest, opening to `g0` across the taper.
     Interior samples, so even a one-period taper gets a real intermediate gap. */
  const gapAt = (i: number, nRamp: number) => g0 * ((i + 1) / (nRamp + 1));
  const gaps: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    if (i < nIn) gaps.push(gapAt(i, nIn));
    else if (i >= n - 1 - nOut) gaps.push(gapAt(n - 2 - i, nOut));
    else gaps.push(g0);
  }

  const seq: number[] = [];
  for (let i = 0; i < n; i++) {
    seq.push(d0);
    if (i < n - 1) seq.push(gaps[i]);
  }
  const sum = seq.reduce((a, b) => a + b, 0);
  const k = sum > 0 ? length / sum : 1;
  return seq.map((v) => v * k);
}

/** The sequence as a `stroke-dasharray`, or none when it says solid: a one-value dasharray means "n on, n off" and
 *  paints solid only by accident. The paint probe relies on every emitted dasharray showing more than one dash. */
function dashAttr(seq: readonly number[]): string | undefined {
  return seq.length > 1 ? seq.join(" ") : undefined;
}

/* The read/unread axis (§7.10c), the only place a stroked mark's rung is chosen. Reach first: unread material takes
   an unread rung (`faint` picks which) and nothing raises it. Read material that is dashed (a hollow or arrived
   outline, a manufactured or damaged seam) shares `inkQuiet`: one claim, "not here as the reference has it".
   Everything else is `inkFull`. */
function ink(ch?: Channel, reach?: Reach, faint?: boolean): string {
  /* `faint` lifts unread material one rung, to `inkFill`: just above the datum and clear of `inkQuiet`. Both lanes'
     unread marks set it (RULES.md §8.9, §3.3). */
  if (reach === "unread") return faint ? V.inkFill : V.inkFaint;
  if (ch === "hollow" || ch === "arrived") return V.inkQuiet;
  return V.inkFull;
}

/** Channel to how the block is made: solid is filled, hollow an outline, black a fill with no style choice (it says
 *  "the message stops here", and an outline would be a second claim on it).
 *  Never-read material loses its fill whatever its channel: a fill below the lightest rung is no block, while an
 *  outline at the unread rung is legible (open decision 2). No builder makes black unread: reading stops at it. */
function blockStyle(ch: Channel, reach?: Reach, faint?: boolean, own?: boolean) {
  const stroke = ink(ch, reach, faint);
  /* The arrived channel takes the seam's dash (§8.48): an admitted box's verticals are its seams, so the box and its
     seams are one assembly with one tick vocabulary. Fills carry no dash. */
  const dash = ch === "arrived" ? V.dashGhost : null;
  if (reach === "unread") {
    /* Unread material is an outline at the same weight as every other, told apart by its ink alone: a thinner line
       is too hard to see, and holding the weight keeps edges still where material turns unread. Both lanes. */
    return { fill: "none", stroke, dash, inset: V.strokeHeavy / 2, width: V.strokeHeavy };
  }
  switch (ch) {
    case "solid":
      return { fill: RUNG.fill, stroke: "none", dash: null, inset: 0, width: V.strokeHeavy };
    case "black":
      return { fill: own ? RUNG.ownStop : RUNG.terminal, stroke: "none", dash: null, inset: 0, width: V.strokeHeavy };
    case "hollow":
      return { fill: "none", stroke, dash, inset: V.strokeHeavy / 2, width: V.strokeHeavy };
    case "arrived":
      /* The seam's weight, not `strokeHeavy` (§8.48): an admitted box's verticals are seams, so its whole outline
         matches them. The misread `hollow` keeps `strokeHeavy`; no seam stands in for its edges. */
      return { fill: "none", stroke, dash, inset: V.seamStroke / 2, width: V.seamStroke };
  }
}

function Block({ m }: { m: Extract<Mark, { kind: "block" }> }) {
  const s = blockStyle(m.ch, m.reach, m.faint, m.own);
  const op = m.op ?? 1;
  /* a lane-set outline weight (`sw`) replaces the style's own, inset by half of it */
  const outlined = s.stroke !== "none" && s.fill === "none";
  const sw = outlined && m.sw ? m.sw : s.width;
  const i = outlined && m.sw ? m.sw / 2 : s.inset;

  /* A side shared with a neighbour (`edgeJoint`) draws no edge of its own: two inset outlines side by side read as
     two lines with a gap, so the top and bottom run flush and the joint line below divides them once. `openEdge`
     suppresses the side with no substitute: the mark standing at that boundary (a stop sliver) owns it. */
  const noLeft = s.stroke !== "none" && (!!m.edgeJoint?.includes("start") || !!m.openEdge?.includes("start"));
  const noRight = s.stroke !== "none" && (!!m.edgeJoint?.includes("end") || !!m.openEdge?.includes("end"));
  const nodes: React.ReactNode[] = [];
  if (s.fill !== "none") {
    nodes.push(
      <rect
        key="r"
        x={m.x + i}
        y={m.y + i}
        width={Math.max(0, m.w - 2 * i)}
        height={Math.max(0, m.h - 2 * i)}
        fill={s.fill}
        stroke="none"
      />,
    );
  } else if (s.stroke !== "none" && m.w >= V.minInk) {
    /* An outline is four free-standing rules (§8.48), so a box edge and a seam are one object and a corner is two
       identical tick-runs meeting (F1). Butt ends: a square cap fattens every dash and overshoots onto the mark at
       an open edge (B5). Rules run full width and verticals full height, inset only across their own stroke, so
       corners close by span and a box's ticks don't change when it seats. Below `minInk` nothing is drawn (B1). */
    /* An outlined element in the variant's ink carries that ink as a faint interior: a rect under
       the four rules, gated on the outline's own token so an unread or ghost outline never gains it. */
    if (s.stroke === V.inkQuiet) {
      nodes.push(<rect key="wash" x={m.x} y={m.y} width={m.w} height={m.h} fill={V.inkWash} stroke="none" />);
    }
    const top = m.y + i;
    const bottom = m.y + m.h - i;
    /* The dash pattern comes from resting geometry (`restW`), not this frame's (B2), so ticks don't reflow under a
       width tween; mid-tween the edge sweeps across the resting pattern. Verticals pattern on `m.h`, which never
       tweens here. */
    const rowDash = s.dash ? dashAttr(sideSeq(m.restW ?? m.w, s.dash[0], s.dash[1])) : undefined;
    const colDash = s.dash ? dashAttr(sideSeq(m.h, s.dash[0], s.dash[1])) : undefined;
    /* Where this mark starts in its own pattern (§8.49): nonzero only on the far half of a box the stop cut in two,
       so the halves read as one dashed outline. Omitted when zero. */
    const rowOffset = m.restFrom ? m.restFrom : undefined;
    /* Where the inset exceeds half the stroke, full-length rules and verticals overrun each other at the corners by
       `over`, so both stop short by it. Zero for every outline inset by half its own stroke. An open side's rule
       runs to the box edge, where the mark owning the boundary is. */
    const over = Math.max(0, i - sw / 2);
    const rx0 = m.x + (noLeft ? 0 : over),
      rx1 = m.x + m.w - (noRight ? 0 : over);
    const vy0 = m.y + over,
      vy1 = m.y + m.h - over;
    nodes.push(
      <line
        key="top"
        x1={rx0}
        y1={top}
        x2={rx1}
        y2={top}
        stroke={s.stroke}
        strokeWidth={sw}
        strokeDasharray={rowDash}
        strokeDashoffset={rowOffset}
      />,
      <line
        key="bottom"
        x1={rx0}
        y1={bottom}
        x2={rx1}
        y2={bottom}
        stroke={s.stroke}
        strokeWidth={sw}
        strokeDasharray={rowDash}
        strokeDashoffset={rowOffset}
      />,
    );
    if (!noLeft) {
      nodes.push(
        <line
          key="left"
          x1={m.x + i}
          y1={vy0}
          x2={m.x + i}
          y2={vy1}
          stroke={s.stroke}
          strokeWidth={sw}
          strokeDasharray={colDash}
        />,
      );
    }
    if (!noRight) {
      nodes.push(
        <line
          key="right"
          x1={m.x + m.w - i}
          y1={vy0}
          x2={m.x + m.w - i}
          y2={vy1}
          stroke={s.stroke}
          strokeWidth={sw}
          strokeDasharray={colDash}
        />,
      );
    }
  }

  /* Joints: a codon is three bases, and the block says so. A joint is a subtraction (a ground cut in a fill, an ink
     line in an outline), omitted below the detail threshold rather than squeezed or faded. An outline's joints take
     its dash: one codon makes one claim, so its inner divisions can't be surer than its edge. */
  const parts = m.parts ?? 0;
  const cellW = parts > 1 ? m.w / parts : m.w;
  const detailed = parts > 1 && cellW >= V.detailMin;
  const filled = s.fill !== "none";
  const jointLine = (jx: number, key: string) => (
    <line
      key={key}
      x1={jx}
      y1={m.y}
      x2={jx}
      y2={m.y + m.h}
      stroke={filled ? RUNG.ground : s.stroke}
      strokeWidth={filled ? V.strokeHairline : sw}
      strokeDasharray={!filled && s.dash ? s.dash.join(" ") : undefined}
    />
  );
  if (detailed) {
    for (let k = 1; k < parts; k++) nodes.push(jointLine(m.x + cellW * k, `j${k}`));
  }
  /* Edge joints: a codon split across marks still needs a joint where they meet, or two same-fill rects paint as one
     block. */
  if (m.edgeJoint) {
    for (const side of m.edgeJoint) {
      nodes.push(jointLine(side === "start" ? m.x : m.x + m.w, `e-${side}`));
    }
  }

  /* One hollow cell inside a solid codon: letter swapped, grouping intact. A subtraction from the fill, and not drawn
     below the detail threshold, where the codon stays solid, as a silent change looks from far enough away. */
  /* a single-letter block (the junction close-up's changed letter) takes the mark too: the whole block is the cell */
  if (m.swap && (detailed || (parts <= 1 && m.w >= V.detailMin))) {
    const i2 = V.strokeHeavy / 2;
    nodes.push(
      <rect
        key="swap"
        /* The swapped cell is the mark this register is about: its outline takes the terminal
           rung, and render.css fills it by `data-mark` with the halo's ink (SPEC: every YOU frame
           shows the colour). Unread material keeps its faint ink: reach outranks everything. */
        data-mark="swap"
        x={m.x + cellW * (m.swap - 1) + i2}
        y={m.y + i2}
        width={Math.max(0, cellW - V.strokeHeavy)}
        height={Math.max(0, m.h - V.strokeHeavy)}
        fill={RUNG.ground}
        stroke={m.reach === "unread" ? ink(m.ch, m.reach) : RUNG.terminal}
        strokeWidth={V.strokeHeavy}
      />,
    );
  }
  return <g opacity={op < 1 ? op.toFixed(3) : undefined}>{nodes}</g>;
}

/** The variant's own material carries a halo: a `delta` mark is painted over an underlay of the
 *  halo's ink, `markHalo` proud on every side, and its group says `data-delta` so render.css inks
 *  the mark itself in the variant's ink. */
export function paint(m: Mark, key: string): React.ReactNode {
  const node = paintMark(m, key);
  if (!m.delta) return node;
  const op = m.op ?? 1;
  const o = op < 1 ? op.toFixed(3) : undefined;
  const halo = V.inkHalo;
  let under: React.ReactNode = null;
  if (m.bare) {
    /* delta ink, no halo */
  } else if (m.kind === "path") {
    const d = m.pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" ");
    under = (
      <path
        d={d}
        fill="none"
        stroke={halo}
        strokeWidth={m.w + 2 * V.markHalo}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={o}
        data-halo="1"
      />
    );
  } else if (m.kind === "module") {
    const s = m.size + 2 * V.markHalo;
    under = (
      <rect x={m.x - s / 2} y={m.y - s / 2} width={s} height={s} fill={halo} stroke="none" opacity={o} data-halo="1" />
    );
  }
  return (
    <g key={key} data-delta="1">
      {under}
      {node}
    </g>
  );
}

function paintMark(m: Mark, key: string): React.ReactNode {
  const op = m.op ?? 1;
  const o = op < 1 ? op.toFixed(3) : undefined;

  switch (m.kind) {
    /* Edge crossing: a clipped block is drawn whole and cut by a fixed rect. Clipping is per frame, which the
       geometry layer has no notion of. */
    case "block":
      if (m.clip) {
        const [lo, hi] = m.clip;
        const clipId = `clip-${key}`;
        return (
          <g key={key}>
            <clipPath id={clipId}>
              <rect x={lo} y={m.y} width={Math.max(0, hi - lo)} height={m.h} />
            </clipPath>
            <g clipPath={`url(#${clipId})`}>
              <Block m={m} />
            </g>
          </g>
        );
      }
      return <Block key={key} m={m} />;

    /* The datum is one unbroken hairline in both lanes, even under a break column: the break's width says the
       reading is broken, and a rule that changed pattern would be the instrument reporting on the specimen. */
    case "rule":
      return (
        <line
          key={key}
          x1={m.x1}
          y1={m.y}
          x2={m.x2}
          y2={m.y}
          stroke={RUNG.rule}
          strokeWidth={V.strokeHairline}
          opacity={o}
        />
      );

    /* A tick is a plain address, never dashed (§7.10b): the seam on the same base already carries damage, and a
       scale that changes pattern to describe what it measures repeats the elided-rule mistake (§8.2). */
    case "tick":
      return (
        <line
          key={key}
          x1={m.x}
          y1={m.y - m.len / 2}
          x2={m.x}
          y2={m.y + m.len / 2}
          stroke={RUNG.tick}
          strokeWidth={V.tickW}
          opacity={o}
        />
      );

    /* The address bead: a small filled square centred on the line, so it sits on it rather than crossing it as a
       tick does. One fixed ink, because it makes one claim ("here"): `inkTerminal`, the rung for the mark a
       register is about, so it holds on the chain's bar without relying on size (RULES.md §7.16). */
    case "bead": {
      if (V.identifierUnified) {
        /* One identifier glyph in every lane: the core keeps its size and only the clear square follows the bead's
           tween, so locating is one motion everywhere. */
        const k = m.size / V.beadSize;
        /* The ring clears what is around it: on a line there is only the line, so `markHalo`; the portrait's residue
           keeps its wider ground among crowded neighbours. */
        const core = V.moduleSize,
          outer = (V.moduleSize + 2 * V.markHalo) * k;
        return (
          <g key={key} opacity={o}>
            <rect
              data-mark="clearing"
              x={m.x - outer / 2}
              y={m.y - outer / 2}
              width={outer}
              height={outer}
              fill={RUNG.ground}
              stroke="none"
            />
            <rect
              data-mark="bead-core"
              x={m.x - core / 2}
              y={m.y - core / 2}
              width={core}
              height={core}
              fill={RUNG.terminal}
            />
          </g>
        );
      }
      const half = m.size / 2;
      return (
        <rect
          key={key}
          /* Named in the DOM: a bead and a module paint as identical squares, so the paint probe
             (`tools/system-smoke.sh`) reads this to tell them apart. */
          data-mark="bead"
          x={m.x - half}
          y={m.y - half}
          width={m.size}
          height={m.size}
          fill={RUNG.terminal}
          opacity={o}
        />
      );
    }

    /* Termination at true proportion: one codon wide, in line, at any scale, no zoom required. */
    case "sliver":
      return (
        <rect key={key} x={m.x} y={m.y} width={Math.max(V.minInk, m.w)} height={m.h} fill={RUNG.terminal} opacity={o} />
      );

    /* Every join gets a seam: blocks abut, so an undrawn join would read as one block. Weight never changes with
       `real`; the pattern says which: solid where the join is in the gene and undamaged (a skip's closure included),
       `dashGhost` where it is manufactured or damaged in place. Ink comes from `ink()` with the seam's facts mapped
       onto its axes: `faint` is this mark's `reach: "unread"`, and an unreal join is `arrived`'s claim about a line. */
    case "seam": {
      /* The dash is anchored to the seam's own length, as a block side's is, so both ends land on ink where it stands
         in for a block edge (`blockH` is not a whole number of `dashGhost` periods). No linecap: a cap would stretch
         the seam past the row's height, and the anchored end dash already reaches past the block's inset edge. */
      const [d0, g0] = V.dashGhost;
      const seamDash = m.real ? undefined : dashAttr(sideSeq(m.h, d0, g0));
      return (
        <line
          key={key}
          /* not where the seam is unread (faint, past a stop): there it takes the unread rung like the material around it */
          data-delta-seam={m.lds && !m.faint ? "1" : undefined}
          x1={m.x}
          y1={m.y}
          x2={m.x}
          y2={m.y + m.h}
          stroke={ink(m.real ? "solid" : "arrived", m.faint ? "unread" : "read", m.faint)}
          strokeWidth={m.sw ?? (m.faint ? V.strokeHairline : V.seamStroke)}
          strokeDasharray={seamDash}
          /* stroke-opacity, not opacity: `opacity` draws the line through its own layer, where a ~1px line scaled
             into the room rasterises thinner as it fades. */
          strokeOpacity={o}
        />
      );
    }

    /* The chain's two registers and the portrait's backbone. `reg: "hold"` is a filled bar `barH` tall; `reg:
       "let-go"` is a `dashDissolve3` hairline on the centreline whose dots densify into an abutting bar (`letGoSeq`);
       no `reg` is the fold's smoothed Ca trace, never dashed. Area against trace tells the registers apart. A let-go
       run too short for one period paints solid (F5) and is still plainly not a bar. */
    case "path": {
      if (m.clear) {
        /* E2's clear ground: a band in the halo's ink along the run (square ends). */
        const d = m.pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" ");
        return (
          <path
            key={key}
            d={d}
            fill="none"
            stroke={V.inkHalo}
            strokeWidth={m.w}
            strokeLinecap="square"
            strokeLinejoin="miter"
            opacity={o}
            data-mark="clear-run"
          />
        );
      }
      const letGo = m.reg === "let-go";
      /* The run's length, summed along its own points. */
      let len = 0;
      for (let i = 1; i < m.pts.length; i++) {
        len += Math.hypot(m.pts[i][0] - m.pts[i - 1][0], m.pts[i][1] - m.pts[i - 1][1]);
      }

      /* The held register is a filled rect, not a stroke: its claim is extent the map holds. `m.w` is the transverse
         extent either way (a weight for a trace, a height for a bar), and a rect has no caps, so its ends stay true
         (§8.20). The portrait's backbone has no `reg` and stays a stroked path. */
      if (m.reg === "hold") {
        /* One rect, nothing on its ends: the register is centred with clear ground either side, so it can't read as
           cropped (§5.14). Its extent, `barMinW` floor included, comes from `chainRegister` (§8.50); this layer draws
           exactly what the mark says. */
        const x0 = Math.min(m.pts[0][0], m.pts[m.pts.length - 1][0]);
        return (
          <rect
            key={key}
            x={x0}
            y={m.pts[0][1] - m.w / 2}
            width={len}
            height={m.w}
            /* A rung lighter than the trace: a bar carries far more ink per length, so its fill steps down to weigh
               the same, as every filled block does. Value still doesn't encode confidence (§7.14), and reference
               structure is grey like the codon blocks. Never `inkTerminal`, which is the bead's. */
            fill={V.inkFill}
            stroke="none"
            opacity={o}
          />
        );
      }

      const d = m.pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" ");

      /* A tether: `ch: "arrived"` on a path is chain nobody measured (the insertion's detour, the stop-loss
         extension). Solid thread is measured, dashed thread is claimed; the modules at either end don't repeat it.
         Full weight and ink, since the chain's continuity isn't in doubt, only where it goes. `dashModule`, because
         the module already sets the scale at which an outline reads as broken. */
      if (m.ch === "arrived") {
        const [td, tg] = V.dashModule;
        return (
          <path
            key={key}
            d={d}
            fill="none"
            stroke={V.inkFull}
            strokeWidth={m.w}
            strokeDasharray={dashAttr(sideSeq(len, td, tg))}
            opacity={o}
          />
        );
      }

      const [d0, g0] = V.dashDissolve3;
      const seq =
        letGo && m.dash
          ? letGoSeq(len, m.dash[0], m.dash[1], 0, false, false)
          : letGo
            ? letGoSeq(len, d0, g0, m.taperLen ?? 0, !!m.taper?.includes("start"), !!m.taper?.includes("end"))
            : [];
      return (
        <path
          key={key}
          d={d}
          fill="none"
          /* The trace stays `inkFull`: a 0.5px dotted hairline is the least ink on the sheet and carries "the protein
             is continuous". A join the reference does not have (`quiet`, the sealed removal's seal) takes `inkQuiet`,
             as manufactured joins do in the transcript lane. */
          stroke={m.quiet ? V.inkQuiet : V.inkFull}
          strokeWidth={m.w}
          /* round, so `[1, 3]` reads as dots rather than very short dashes */
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={dashAttr(m.unread ? V.dashDissolve3 : seq)}
          opacity={o}
        />
      );
    }

    /* Modules: filled above the confidence cut, hollow below; one chain may straddle. `dark` is the substituted
       residue at `inkTerminal`, off the material ladder, and no stop renders at this scale to collide with it.
       Size comes from the mark (§2.9): a marked module is one `markStep` larger, centred on its residue. */
    case "module": {
      const half = m.size / 2;
      /* The identifier's clear ground (`markHalo`, which says why it exists): a treatment, so computed here, not in
         frames.ts. One element: a stroke straddles its edge, so a `size + halo` square stroked `halo` wide in ground
         paints a core of exactly `size` with a ring `halo` proud. The ring is constant and the outer extent follows
         the core, so the ground arrives at the residue's size and grows with it rather than announcing the growth. */
      const halo = m.halo != null ? m.halo : m.dark ? V.markHalo : 0;
      /* Three channels, two treatments. Solid is filled: placed, and confident. Hollow and arrived are a dashed
         outline: the position is not asserted. They paint identically on purpose; the thread carries the difference
         (see `case "path"`). `hollow` stays `inkFull` here, against `ink()`: in this lane it is a confidence register
         (the residue is real, only its position is uncertain), not misread material. */
      const hollow = m.ch === "hollow" || m.ch === "arrived";
      if (!hollow) {
        return (
          <rect
            key={key}
            /* Named in the DOM so the probe can exclude it: check (iii) finds a terminated strip by a rect at the
               terminal rung, and the dark module is that rung's third claimant. */
            data-mark="module"
            x={m.x - (m.size + halo) / 2}
            y={m.y - (m.size + halo) / 2}
            width={m.size + halo}
            height={m.size + halo}
            fill={m.dark ? RUNG.terminal : V.inkFull}
            stroke={halo ? RUNG.ground : "none"}
            strokeWidth={halo}
            opacity={o}
          />
        );
      }
      /* A low-confidence module is hollow and dashed, anchored like every dash (§7.10b): one closed path, each side
         `sideSeq`-scaled, merged at the corners, started mid-top (§8.12). `dashModule` is derived from `moduleSize`
         so the pattern is a proportion of the square; a chain-register period collapses to one solid dash. */
      const s = m.size - V.strokeHairline;
      const left = m.x - half + V.strokeHairline / 2;
      const top = m.y - half + V.strokeHairline / 2;
      const right = left + s;
      const bottom = top + s;
      const [d0, g0] = V.dashModule;
      const midX = (left + right) / 2;
      const seq = mergeSeqs([
        sideSeq(right - midX, d0, g0),
        sideSeq(s, d0, g0),
        sideSeq(s, d0, g0),
        sideSeq(s, d0, g0),
        sideSeq(midX - left, d0, g0),
      ]);
      return (
        <path
          key={key}
          /* Named in the DOM so the module's own check starts from the module: the dash probe only sees elements
             that have a dasharray, so it is blind to one never emitted (B2). */
          data-mark="module"
          d={`M${midX},${top} L${right},${top} L${right},${bottom} L${left},${bottom} L${left},${top} L${midX},${top}`}
          /* `dark` wins the fill whatever the confidence. Unexercised: every marked residue is above `plddtSolid`.
             If one ever is not, this outline gets the size step but not the clear ground (RULES.md §1.4). */
          fill={m.dark ? RUNG.terminal : "none"}
          stroke={V.inkFull}
          strokeWidth={V.strokeHairline}
          strokeDasharray={dashAttr(seq)}
          opacity={o}
        />
      );
    }

    /* The cleared ground (§8.55, §8.56): a ground-filled square centred on the residue, hiding what it covers, with
       a hairline edge at the instrument rung that says "this space was made" and gives a partly covered neighbour
       something to be cut off by. Named in the DOM so the portrait's field check can excuse it. */
    case "clearing":
      return (
        <rect
          key={key}
          data-mark="clearing"
          x={m.x - m.size / 2}
          y={m.y - m.size / 2}
          width={m.size}
          height={m.size}
          fill={RUNG.ground}
          stroke={RUNG.clearing}
          strokeWidth={V.strokeHairline}
          opacity={o}
        />
      );

    /* A hairline takes the read/unread axis too, via `faint`, as a seam does: `deep-intronic`'s foreshortened
       intron is unread material, so `inkFill`. */
    case "hair":
      return (
        <line
          key={key}
          x1={m.x1}
          y1={m.y1}
          x2={m.x2}
          y2={m.y2}
          stroke={m.axis ? RUNG.tick : m.faint ? V.inkFill : V.inkFull}
          strokeWidth={m.w ?? V.strokeHairline}
          opacity={o}
        />
      );

    case "label":
      return (
        <text
          key={key}
          x={m.x}
          y={m.y}
          textAnchor={m.anchor ?? "start"}
          fontSize={m.size ?? V.labelSize}
          fill={RUNG.text}
          className="mono"
          opacity={o}
        >
          {m.text}
        </text>
      );
  }
}
