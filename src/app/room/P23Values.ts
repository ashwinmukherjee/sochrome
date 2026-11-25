// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The decided numbers of P2 and P3, once: the panels hand them to p23.css and the asserts measure against them.

import type { CSSProperties } from "react";
import { BREAKPOINT_PHONE, BREAKPOINT_SHORT } from "../../contracts/constants";

/** P2: bars out from the centre of a rule one point long per 1/48 of its width (16 px on the 768 stage). */
export const P2 = {
  pointsAcross: 48,
  /** Between siblings in an arm, and across the centre seam (half spent by each arm). */
  gap: 2,
  seam: 2,
  /** A bar's ink at rest and when paired; everything else while one is paired. */
  fill: 0.45,
  lit: 1,
  dim: 0.6,
  /** The paired row's ground: this share of its direction's hue. */
  tint: 0.08,
  /** The stage's rows, from its top: the bars, the rule, the poles' baseline under it. */
  barsTop: 24,
  barsHeight: 96,
  rule: 160,
  tick: 12,
  poles: 24,
  /** The poles' names: mono capitals, tracked for capitals. */
  pole: { size: 10, track: 0.08 },
  /** A ledger row: its mark's column, the gap to its text, its square, its padding. */
  row: { mark: 24, gap: 12, square: 9, padY: 4, padX: 6, between: 8 },
} as const;

/** P3: a hundred people, wider apart than they are wide; on a phone, the gap half a square, so the squares
 *  still read as people at 20 across. */
export const P3 = {
  people: 100,
  /** Authored units: the array spans the stage, so only the ratio is drawn. */
  pitch: 51,
  cell: 22.5,
  cellPhone: 34,
  /** One person every waveMs; a person changes half a ramp after the front reaches them. */
  waveMs: 9,
  rampMs: 300,
  /** Each group's ink at rest and when paired: a share of its colour. */
  ink: { baseline: [0.78, 0.9], added: [0.7, 0.9], none: [0.6, 0.82] },
  /** The paired row's ground: this share of its squares' colour. */
  tint: { baseline: 0.14, added: 0.22, none: 0.22 },
  row: { key: 12, gap: 12, padY: 4, padX: 6, between: 16 },
} as const;

/**
 * The screen the room's short stations apply to: its frame has room under P2's chart for one ledger row.
 * A media query cannot read this, so p23.css states it again and the asserts hold the two together.
 */
export const SHORT_SCREEN = `(max-width: ${BREAKPOINT_PHONE}px) and (max-height: ${BREAKPOINT_SHORT}px)`;

/** Both ledgers' rows: sans, two lines of this size. */
export const ROW_TYPE = { size: 12, line: 19 } as const;

/** How long a line holds: a breath for every few words, never fewer than two. */
export const READING = { wordsPerBreath: 5, minBreaths: 2 } as const;

const px = (n: number) => `${n}px`;
const share = (n: number) => `${+(n * 100).toFixed(4)}%`;

/** The custom properties p23.css reads. */
export const P2_VARS = {
  "--p2-half": P2.pointsAcross / 2,
  "--p2-gap": px(P2.gap),
  "--p2-seam": px(P2.seam / 2),
  "--p2-fill": share(P2.fill),
  "--p2-lit": share(P2.lit),
  "--p2-dim": P2.dim,
  "--p2-tint": share(P2.tint),
  "--p2-bars-top": px(P2.barsTop),
  "--p2-bars-h": px(P2.barsHeight),
  "--p2-rule": px(P2.rule),
  "--p2-tick": px(P2.tick),
  "--p2-poles": px(P2.poles),
  "--p2-pole-size": px(P2.pole.size),
  "--p2-pole-track": `${P2.pole.track}em`,
  "--p2-mark": px(P2.row.mark),
  "--p2-square": px(P2.row.square),
  "--p2-between": px(P2.row.between),
  "--p23-row-gap": px(P2.row.gap),
  "--p23-row-pad": `${px(P2.row.padY)} ${px(P2.row.padX)}`,
  "--p23-row-size": px(ROW_TYPE.size),
  "--p23-row-line": px(ROW_TYPE.line),
} as CSSProperties;

export const P3_VARS = {
  "--p3-pitch": P3.pitch,
  "--p3-cell": P3.cell,
  "--p3-cell-phone": P3.cellPhone,
  "--p3-baseline": share(P3.ink.baseline[0]),
  "--p3-baseline-lit": share(P3.ink.baseline[1]),
  "--p3-added": share(P3.ink.added[0]),
  "--p3-added-lit": share(P3.ink.added[1]),
  "--p3-none": share(P3.ink.none[0]),
  "--p3-none-lit": share(P3.ink.none[1]),
  "--p3-tint-baseline": share(P3.tint.baseline),
  "--p3-tint-added": share(P3.tint.added),
  "--p3-tint-none": share(P3.tint.none),
  "--p3-key": px(P3.row.key),
  "--p3-between": px(P3.row.between),
  "--p23-row-gap": px(P3.row.gap),
  "--p23-row-pad": `${px(P3.row.padY)} ${px(P3.row.padX)}`,
  "--p23-row-inset": `-${px(P3.row.padY)} -${px(P3.row.padX)}`,
  "--p23-row-size": px(ROW_TYPE.size),
  "--p23-row-line": px(ROW_TYPE.line),
} as CSSProperties;
