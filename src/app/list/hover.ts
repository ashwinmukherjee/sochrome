// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Hover that waits for the mouse to move: rows that arrive under a resting pointer (a page just swapped in) are
// not pointed at, so the ledger keeps every tick as it stood. The first real move answers for the row it is on.

import { type PointerEvent, useRef } from "react";

interface HoverAfterMove {
  /** For a row's onPointerEnter: answers only once the mouse has moved on this page. */
  enter(run: () => void): (e: PointerEvent) => void;
  /** For a row's onPointerMove: the first real move answers for the row under it. */
  move(run: () => void): (e: PointerEvent) => void;
}

/** A touch or pen points where it lands; only a mouse can rest over rows that arrive under it. */
export function useHoverAfterMove(): HoverAfterMove {
  const moved = useRef(false);
  return {
    enter: (run) => (e) => {
      if (moved.current || e.pointerType !== "mouse") run();
    },
    move: (run) => (e) => {
      // A browser's own pointer events after a layout change carry no movement.
      if (moved.current || e.pointerType !== "mouse" || (e.movementX === 0 && e.movementY === 0)) return;
      moved.current = true;
      run();
    },
  };
}
