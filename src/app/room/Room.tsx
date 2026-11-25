// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// A finding's room: three panels that pin in sequence, the bezel, the scroll cue, and the way on to the next.

import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RoomProps } from "../../contracts/app";
import { PACING } from "../../contracts/constants";
import { HOLD_VH } from "../../copy/p1/schedule";
import { context as p23Context } from "../../copy/p23/model";
import { ROOM } from "../../copy/room";
import "../../render/render.css";
import { P1Panel } from "./P1Panel";
import { P2Panel } from "./P2Panel";
import { P3Panel } from "./P3Panel";
import { setProgress } from "./RoomProgress";
import "./room.css";

/** Switching rooms: clear, change while the stage is empty, arrive (the graphic alone), say (the copy), rest. */
type Phase = "clearing" | "empty" | "arriving" | "saying" | "rest";
type Shown = Pick<RoomProps, "finding" | "copy" | "list" | "next">;

/** The scroll cue is dismissed once the room has scrolled this far. */
const CUE_DISMISS_PX = 24;
/** P3's scrub scales with what it says: this share of the full scrub for one sentence, a step more for each. */
const P3_SCRUB = { min: 0.34, step: 0.22 } as const;
/** The way on arrives over this share of the last panel's hold, after everything else on the panel. */
const NEXT_ARRIVES = 0.5;
const LANDED = 0.999;
/** The room's own three panels, whatever is drawn inside them. */
const PANELS = ":scope > .room-pane > [data-station]";

/** The first-use cue on the way on is retired for good on first use: for as long as the page lives. */
let nextUsed = false;
/** The scroll cue stands in the first room opened, and only until the next opens: by then the reader knows the
 *  way. The first room's key, or false once another has opened, for as long as the page lives. */
let cueRoom: string | false | null = null;

/** Whether the room with this key shows the scroll cue: the first opened does, and no other after it. */
function cueIn(key: string): boolean {
  if (cueRoom === null) cueRoom = key;
  else if (cueRoom !== key) cueRoom = false;
  return cueRoom === key;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const smooth = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const fadeMs = (el: HTMLElement): number => parseFloat(getComputedStyle(el).getPropertyValue("--an-fade"));

const Arrow = ({ down }: { down?: boolean }) => (
  <span className="arr">
    {down ? (
      <svg className="arrow" width="10" height="12" viewBox="0 0 10 12" aria-hidden="true">
        <path d="M5 0.5V11.2M1 7.2L5 11.2L9 7.2" />
      </svg>
    ) : (
      <svg className="arrow" width="12" height="10" viewBox="0 0 12 10" aria-hidden="true">
        <path d="M0.5 5H11.2M7.2 1L11.2 5L7.2 9" />
      </svg>
    )}
  </span>
);

/** The host keeps one Room mounted and hands it the next finding: the room sequences the switch itself. */
export function Room({ finding, copy, list, next, onNext, onClose }: RoomProps) {
  const [shown, setShown] = useState<Shown>({ finding, copy, list, next });
  const [phase, setPhase] = useState<Phase>("empty");
  const [room, setRoom] = useState<HTMLElement | null>(null);
  const [viewH, setViewH] = useState(0);
  const nextBtn = useRef<HTMLButtonElement>(null);
  const bezel = useRef<HTMLElement>(null);
  const timer = useRef(0);
  const at = useRef<Phase>("empty");
  const latest = useRef<Shown>(shown);
  /** The finding a switch is already under way to. */
  const heading = useRef<string | null>(null);

  const step = useCallback((p: Phase, ms = 0, then?: () => void) => {
    at.current = p;
    setPhase(p);
    if (then) timer.current = window.setTimeout(then, ms);
  }, []);

  /** Beats 3 and 4, then rest. */
  const arrive = useCallback(
    (ms: number) => step("arriving", ms, () => step("saying", ms, () => step("rest"))),
    [step],
  );

  /** The four beats; `change` runs once the stage is empty. The latest call wins. */
  const swap = useCallback(
    (change: () => void, stays: boolean) => {
      window.clearTimeout(timer.current);
      if (!room || reducedMotion()) {
        change();
        if (stays) step("rest");
        return;
      }
      const ms = fadeMs(room);
      step("clearing", ms, () => {
        if (stays) step("empty", ms, () => arrive(ms));
        change();
      });
    },
    [room, step, arrive],
  );

  // The room arrives: the graphic alone, then the copy.
  useEffect(() => {
    if (!room) return;
    if (reducedMotion()) step("rest");
    else {
      // The empty stage has to be styled before the pane can fade up from it.
      void room.offsetWidth;
      arrive(fadeMs(room));
    }
    return () => window.clearTimeout(timer.current);
  }, [room, step, arrive]);

  // A new finding from the host. While the stage is empty it is simply taken; otherwise the room clears first.
  useEffect(() => {
    latest.current = { finding, copy, list, next };
    if (finding.key === shown.finding.key) {
      heading.current = null;
      if (copy !== shown.copy || list !== shown.list || next !== shown.next) setShown(latest.current);
      return;
    }
    if (at.current === "empty") {
      setShown(latest.current);
      return;
    }
    if (heading.current === finding.key) return;
    heading.current = finding.key;
    swap(() => setShown(latest.current), true);
  }, [finding, copy, list, next, shown, swap]);

  // A room opens fresh: at scroll 0, on the reference frame, unscrolled.
  useLayoutEffect(() => {
    if (!room) return;
    room.scrollTop = 0;
    delete room.dataset.scrolled;
    // Opened from the list with the keys, focus follows into the room, so Space, PageDown and the arrows read it
    // instead of paging the list.
    if (document.activeElement?.closest(".list")) room.focus({ preventScroll: true });
  }, [room, shown.finding.key]);

  useEffect(() => {
    if (!room) return;
    const measure = () => setViewH(room.clientHeight);
    const ro = new ResizeObserver(measure);
    ro.observe(room);
    measure();
    return () => ro.disconnect();
  }, [room]);

  const p3Scale = Math.min(1, P3_SCRUB.min + P3_SCRUB.step * Math.max(0, shown.copy.p3.lines.length - 1));

  // Scroll drives everything that moves, with no state per frame.
  useEffect(() => {
    if (!room || !viewH) return;
    const panels = [...room.querySelectorAll<HTMLElement>(PANELS)];
    const items = [...(bezel.current?.querySelectorAll<HTMLElement>(".bz-item") ?? [])];
    let tops: number[] = [];
    let spans: number[] = [];
    const paint = () => {
      const y = room.scrollTop;
      if (y > CUE_DISMISS_PX) room.dataset.scrolled = "on";
      let active = 0;
      tops.forEach((top, i) => {
        if (y >= top - 1) active = i;
      });
      panels.forEach((panel, i) => {
        const item = items[i];
        if (item) {
          item.dataset.state = i < active ? "done" : i === active ? "active" : "ahead";
          item.style.setProperty("--bz-p", i === active ? clamp01((y - tops[i]) / spans[i]).toFixed(4) : "0");
        }
        if (i === 0) return;
        const scrub = viewH * PACING.PACE * (i === 2 ? p3Scale : 1);
        setProgress(panel, clamp01((y - tops[i]) / scrub));
        const btn = nextBtn.current;
        if (i !== 2 || !btn) return;
        const o = smooth((y - tops[i] - scrub) / (HOLD_VH * viewH * NEXT_ARRIVES));
        btn.style.opacity = o.toFixed(3);
        btn.disabled = o < LANDED;
        btn.classList.toggle("cue", o >= LANDED && !nextUsed);
      });
    };
    const measure = () => {
      tops = panels.map((p) => p.offsetTop);
      spans = panels.map((p) => Math.max(1, p.offsetHeight - viewH));
      paint();
    };
    const ro = new ResizeObserver(measure);
    panels.forEach((p) => ro.observe(p));
    measure();
    room.addEventListener("scroll", paint, { passive: true });
    return () => {
      ro.disconnect();
      room.removeEventListener("scroll", paint);
    };
  }, [room, viewH, p3Scale, shown]);

  const ctx = useMemo(() => p23Context(shown.finding.p23), [shown.finding]);
  const unpaired = useCallback(() => {}, []);

  const jump = (i: number) => {
    const panel = room?.querySelectorAll<HTMLElement>(PANELS)[i];
    if (room && panel) room.scrollTo({ top: panel.offsetTop, behavior: reducedMotion() ? "auto" : "smooth" });
  };
  const onward = () => {
    nextUsed = true;
    nextBtn.current?.classList.remove("cue");
    if (shown.next === null) swap(onClose, false);
    else swap(onNext, true);
  };

  const vars = { "--pace": PACING.PACE, "--hold-vh": HOLD_VH } as CSSProperties;
  const stations = [ROOM.stations.p1, ROOM.stations.p2, ROOM.stations.p3];

  return (
    <article className="room" data-phase={phase} data-list={shown.list} style={vars} ref={setRoom} tabIndex={-1}>
      <div className="room-pane">
        <div className="bezel-anchor">
          <nav className="bezel" aria-label={ROOM.stationsLabel} ref={bezel}>
            {stations.map((label, i) => (
              // The mark alone, no label beside it; its station is named to a screen reader.
              <button className="bz-item" type="button" key={label} aria-label={label} onClick={() => jump(i)}>
                <span className="bz-mark" aria-hidden="true" />
              </button>
            ))}
          </nav>
        </div>
        <P1Panel
          key={shown.finding.key}
          copy={shown.copy.p1}
          scroller={room}
          viewH={viewH}
          foot={
            !cueIn(shown.finding.key) ? null : (
              <div className="room-cue" aria-hidden="true">
                <span className="caption">{ROOM.scroll}</span>
                <Arrow down />
              </div>
            )
          }
        />
        <section className="panel panel-p2" data-station="2">
          <div className="panel-inner">
            <header className="panel-q">
              <h2 className="q-text">{ROOM.questions.p2}</h2>
            </header>
            <P2Panel ctx={ctx} copy={shown.copy.p2} onPair={unpaired} />
          </div>
        </section>
        <section className="panel panel-p3" data-station="3" style={{ "--scrub-scale": p3Scale } as CSSProperties}>
          <div className="panel-inner">
            <header className="panel-q">
              <h2 className="q-text">{ROOM.questions.p3}</h2>
            </header>
            <P3Panel ctx={ctx} copy={shown.copy.p3} onPair={unpaired} />
            <button className="room-next caption" type="button" onClick={onward} ref={nextBtn}>
              {shown.next === null ? ROOM.back : ROOM.next}
              <Arrow />
            </button>
          </div>
        </section>
      </div>
    </article>
  );
}
