// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// A pinned panel's place in its scrub, set as a style property with no React state per frame.

const LAST = new WeakMap<Element, number>();

/** The room calls this on scroll: `p` runs 0 to 1 over the panel's scrub and rests at 1 through its hold. */
export function setProgress(panel: HTMLElement, p: number): void {
  if (LAST.get(panel) === p) return;
  LAST.set(panel, p);
  panel.style.setProperty("--p", p.toFixed(4));
}
