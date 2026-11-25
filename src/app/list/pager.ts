// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Whole rows in the room a column leaves, "+N more" in the next slot, and its page down (C8, P2).

import { type RefObject, useCallback, useEffect, useLayoutEffect, useState } from "react";

/** The room counts as settled once its height has held this long: a phone's band animates it open frame by frame. */
const SETTLE_MS = 120;
const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

interface Pager {
  /** Whole rows shown at once. */
  shown: number;
  /** The scrollport's height for those rows. */
  height: number;
  /** "+N more", "Back to top", or nothing. */
  more: { kind: "more"; n: number } | { kind: "top" } | null;
  /** The room's height is still moving: "+N more" waits, so it never counts through the in-between heights. */
  settling: boolean;
  page(): void;
  /** Scroll the least that puts row i fully in the clear. */
  reveal(i: number): void;
}

/** room: the element whose height the rows and the "+N more" slot share. box: a row's own line box. */
export function usePager(
  room: RefObject<HTMLElement>,
  scroller: RefObject<HTMLElement>,
  count: number,
  pitch: number,
  box: number,
): Pager {
  const [space, setSpace] = useState(0);
  const [first, setFirst] = useState(0);
  // Unmeasured at first: until the room has a height, any count would be a guess.
  const [settling, setSettling] = useState(true);

  useLayoutEffect(() => {
    const el = room.current;
    if (!el) return;
    // The content box: the room's padding only keeps the focus ring and the square in view.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setSpace(entry.contentRect.height);
      setSettling(true);
      clearTimeout(timer);
      timer = setTimeout(() => setSettling(false), SETTLE_MS);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      clearTimeout(timer);
    };
  }, [room]);

  const all = count > 0 && (count - 1) * pitch + box <= space;
  const shown = count === 0 ? 0 : all ? count : Math.max(1, Math.floor((space - box) / pitch));
  const height = shown === 0 ? 0 : (shown - 1) * pitch + box;

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const on = () => setFirst(Math.round(el.scrollTop / pitch));
    on();
    el.addEventListener("scroll", on, { passive: true });
    return () => el.removeEventListener("scroll", on);
  }, [scroller, pitch, count]);

  const below = Math.max(0, count - first - shown);
  const more: Pager["more"] = below > 0 ? { kind: "more", n: below } : first > 0 ? { kind: "top" } : null;

  const page = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const top = below > 0 ? (first + Math.max(1, shown - 1)) * pitch : 0;
    el.scrollTo({ top, behavior: still() ? "auto" : "smooth" });
  }, [scroller, below, first, shown, pitch]);

  const reveal = useCallback(
    (i: number) => {
      const el = scroller.current;
      if (!el || i < 0 || shown === 0) return;
      const at = i < first ? i : i >= first + shown ? i - shown + 1 : first;
      if (at !== first) el.scrollTo({ top: at * pitch, behavior: still() ? "auto" : "smooth" });
    },
    [scroller, first, shown, pitch],
  );

  return { shown, height, more, settling, page, reveal };
}
