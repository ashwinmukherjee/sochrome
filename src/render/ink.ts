// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Where a frame's marks sit, from their own numbers: no DOM, so a host and a check read the same box.

import type { Frame, Mark } from "./frames";
import { visual as V } from "./tokens";

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A mark fainter than this is not yet, or no longer, ink. */
const VISIBLE = 0.05;
/** A label's advance per character, as a share of its size: the mono face's. */
const MONO_ADVANCE = 0.6;

/** The identifier's clear square on a line: the bead's core and its ring, following the bead's own size. */
export function clearSquare(bead: { size: number }): number {
  return (V.moduleSize + 2 * V.markHalo) * (bead.size / V.beadSize);
}

/** The box a mark paints into; null for a mark with no extent of its own. */
export function markBox(m: Mark): Box | null {
  switch (m.kind) {
    case "block":
    case "sliver":
      return { x0: m.x, y0: m.y, x1: m.x + Math.max(m.w, 0), y1: m.y + m.h };
    case "bead": {
      const half = (V.identifierUnified ? clearSquare(m) : m.size) / 2;
      return { x0: m.x - half, y0: m.y - half, x1: m.x + half, y1: m.y + half };
    }
    case "module":
    case "clearing": {
      const half = m.size / 2;
      return { x0: m.x - half, y0: m.y - half, x1: m.x + half, y1: m.y + half };
    }
    case "path": {
      const xs = m.pts.map((p) => p[0]);
      const ys = m.pts.map((p) => p[1]);
      return { x0: Math.min(...xs), y0: Math.min(...ys) - m.w / 2, x1: Math.max(...xs), y1: Math.max(...ys) + m.w / 2 };
    }
    case "hair":
      return { x0: Math.min(m.x1, m.x2), y0: Math.min(m.y1, m.y2), x1: Math.max(m.x1, m.x2), y1: Math.max(m.y1, m.y2) };
    case "seam":
      return { x0: m.x, y0: m.y, x1: m.x, y1: m.y + m.h };
    case "tick":
      return { x0: m.x, y0: m.y, x1: m.x, y1: m.y + m.len };
    case "label": {
      const size = m.size ?? V.labelSize;
      const w = MONO_ADVANCE * size * m.text.length;
      const x0 = m.anchor === "middle" ? m.x - w / 2 : m.anchor === "end" ? m.x - w : m.x;
      return { x0, y0: m.y - size, x1: x0 + w, y1: m.y };
    }
    case "rule":
      return null;
  }
}

/** The marks of a frame a reader can see. */
export const visible = (f: Frame): Mark[] => f.marks.filter((m) => (m.op ?? 1) > VISIBLE);

/** The top and bottom of a frame's visible ink, in the stage's own px; null for an empty frame. */
export function inkOf(f: Frame): { top: number; bottom: number } | null {
  let top = Infinity;
  let bottom = -Infinity;
  for (const m of visible(f)) {
    // The ruler is ink too, though it has no box of its own.
    const b = m.kind === "rule" ? { y0: m.y, y1: m.y } : markBox(m);
    if (!b) continue;
    top = Math.min(top, b.y0);
    bottom = Math.max(bottom, b.y1);
  }
  return Number.isFinite(top) ? { top, bottom } : null;
}
