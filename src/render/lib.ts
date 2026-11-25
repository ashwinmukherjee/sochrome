// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// One drawing in a host's element: the host hands it a position, and reads back its beats, caption and ink.

import React from "react";
import { flushSync } from "react-dom";
import ReactDOM from "react-dom/client";
import { sample, stageCaption, timeline, type StageCaption } from "./frames";
import { inkOf } from "./ink";
import { paintFrame } from "./lanes/stage";
import { cellKey, type StateEntry } from "./states";
import { setStageW, visual as V } from "./tokens";
import { builtEntry, clockOf, variantEntry, type P1Beat, type P1Variant } from "./variant";

export type { P1Beat, P1Variant } from "./variant";

export interface P1Handle {
  /** A position in [0, 1] across the whole beat sequence. Pure: the same u draws the same frame. */
  setU(u: number): void;
  /** The drawing's phases, in the units `setU` takes. */
  beats(): P1Beat[];
  /** What the stage shows, for the host to set above it, from the window drawn at this stage width. */
  caption(): StageCaption | null;
  /** The whole timeline, in ms. */
  duration(): number;
  /** The first u at which the opening fade has landed: rest a room here or later. */
  settledU(): number;
  /** The top and bottom of the ink at u, in the stage's own px, so a host can stand it on a station. */
  ink(u: number): { top: number; bottom: number } | null;
  /** Unmounts and removes the node. Safe to call twice. */
  dispose(): void;
}

export interface P1Options {
  /** Where to open, in [0, 1]. Defaults to rest. */
  u?: number;
  /** The host's stage width in px. The drawing keeps its pitch, strokes and type; only how much fits changes. */
  stageW?: number;
}

/** Rest is the last beat complete: a cold mount and a finished scrub are the same frame. */
const REST = 1;
const STAGE_W_DEFAULT = V.stageW;

const clampU = (u: number): number => (Number.isFinite(u) ? Math.min(REST, Math.max(0, u)) : REST);

function beatAt(entry: StateEntry, t: number): string {
  const { phases } = timeline(entry);
  for (const p of phases) if (t < p.at + p.dur) return p.beat;
  return entry.beats[entry.beats.length - 1];
}

/** No ground rect: the host owns the ground, so the drawing can sit on any of them. */
function Cell({ entry, u }: { entry: StateEntry; u: number }): React.ReactElement {
  const t = clampU(u) * timeline(entry).total;
  const f = sample(entry, t);
  return React.createElement(
    "svg",
    {
      className: "mk-svg",
      width: V.stageW,
      height: f.h,
      viewBox: `0 0 ${V.stageW} ${f.h}`,
      "aria-hidden": true,
      "data-cell": cellKey(entry),
      "data-beat": beatAt(entry, t),
      "data-marks": f.marks.length,
    },
    paintFrame(f),
  );
}

/** One of the built cells, by name. */
export function mount(el: HTMLElement, cellName: string, opts: P1Options = {}): P1Handle {
  return mountEntry(el, builtEntry(cellName), opts);
}

/** A variant from its own facts. */
export function mountVariant(el: HTMLElement, v: P1Variant, opts: P1Options = {}): P1Handle {
  return mountEntry(el, variantEntry(v), opts);
}

function mountEntry(el: HTMLElement, entry: StateEntry, opts: P1Options): P1Handle {
  // The drawing owns a child, not the host's element: React clears what it renders into.
  const host = document.createElement("div");
  host.className = "p1-root";
  host.dataset.cell = cellKey(entry);
  el.appendChild(host);

  const root = ReactDOM.createRoot(host);
  let live = true;

  // Painted in the caller's own tick: a scheduled render would land a frame behind the scroll that asked for it.
  const draw = (u: number): void => {
    if (live) flushSync(() => root.render(React.createElement(Cell, { entry, u })));
  };
  setStageW(opts.stageW ?? STAGE_W_DEFAULT);
  draw(opts.u ?? REST);

  const clock = clockOf(entry);

  return {
    setU: draw,
    beats: () => clock.beats.map((b) => ({ ...b })),
    caption: () => stageCaption(entry),
    duration: () => clock.duration,
    settledU: () => clock.settledU,
    ink: (u) => inkOf(sample(entry, clampU(u) * clock.duration)),
    dispose(): void {
      if (!live) return;
      live = false;
      root.unmount();
      host.remove();
    },
  };
}
