// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// What does this variant do? Each drawing in turn, scrubbed by scroll, its lines handing off above it.

import { type ReactNode, useEffect, useRef, useState } from "react";
import type { P1Handle, RoomCopy } from "../../contracts/app";
import { DECLINED } from "../../copy/p1/room";
import { HOLD_VH } from "../../copy/p1/schedule";
import { kindOf } from "../../copy/p1/slots";
import { ROOM } from "../../copy/room";
import { mountVariant } from "../../render/lib";
import { lineOpacity, paceDrawing, refUOf, segmentOpacity, segmentU, track } from "./P1pace";

interface P1PanelProps {
  copy: RoomCopy["p1"];
  /** The room's scroll box, and its height in px. */
  scroller: HTMLElement | null;
  viewH: number;
  /** Stands at the pinned frame's foot. */
  foot?: ReactNode;
}

/** How many frames of a drawing are sampled to find its lowest ink. */
const INK_SAMPLES = 21;
const SLACK_PX = 0.5;
let serial = 0;

/** A claim's sentences, each its own block. */
function sentences(text: string): ReactNode {
  const parts = text.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) ?? [text];
  return parts.map((s, i) => (
    <span className="claim-sent" key={i}>
      {s.trim()}
    </span>
  ));
}

export function P1Panel({ copy, scroller, viewH, foot }: P1PanelProps) {
  const panel = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [stageW, setStageW] = useState(0);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setStageW(el.clientWidth);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const section = panel.current;
    const box = stage.current;
    if (!section || !box || !scroller || !viewH || !stageW) return;
    if (!copy.length) {
      // Nothing to draw: the declined line holds for a beat, then the room moves on.
      section.style.setProperty("--scroll", `${HOLD_VH * viewH}px`);
      return;
    }
    let handles: P1Handle[] = [];
    let stop = () => {};
    let live = true;
    // The renderer paints synchronously, which React refuses inside its own commit: mount once the commit is over.
    queueMicrotask(() => {
      if (!live) return;
      const hosts = [...box.querySelectorAll<HTMLElement>(".p1-host")];
      const wraps = [...box.querySelectorAll<HTMLElement>(".p1-drawing")];
      const refs: number[] = [];
      const paced = copy.map((d, i) => {
        const h = mountVariant(hosts[i], { ...d.drawing, id: `room${++serial}` }, { u: 1, stageW });
        handles.push(h);
        const clock = { beats: h.beats(), duration: h.duration(), settledU: h.settledU() };
        refs.push(refUOf(kindOf(d.drawing), clock));
        return paceDrawing(d.drawing, d.lines, clock, viewH);
      });
      const t = track(paced);
      section.style.setProperty("--scroll", `${t.total}px`);

      let spill = "";
      handles.forEach((h, i) => {
        const cap = h.caption();
        const [name, pos] = wraps[i].querySelectorAll<HTMLElement>(".p1-caption span");
        name.textContent = cap?.name ?? "";
        pos.textContent = cap?.pos ?? "";
        wraps[i].toggleAttribute("data-whole", !cap?.pos);
        // A caption too long for its line beside the drawing stacks, the range under the name, rather than run
        // under the bezel or past the column's edge.
        wraps[i].removeAttribute("data-stack");
        const line = name.parentElement;
        if (line && line.scrollWidth > wraps[i].clientWidth) wraps[i].setAttribute("data-stack", "");
        const top = h.ink(refs[i])?.top ?? 0;
        let lowest = 0;
        for (let k = 0; k < INK_SAMPLES; k++) lowest = Math.max(lowest, h.ink(k / (INK_SAMPLES - 1))?.bottom ?? 0);
        hosts[i].style.setProperty("--ink-top", `${top}px`);
        // The caption hangs under the lowest the ink ever reaches, so it never moves as the drawing plays.
        wraps[i].style.setProperty("--ink-h", `${lowest - top}px`);
        if (hosts[i].offsetTop + lowest > box.clientHeight + SLACK_PX) spill ||= kindOf(copy[i].drawing);
      });
      // Nothing is compressed to fit: a drawing taller than the stage shows, and says so here.
      if (spill) box.dataset.overflow = spill;
      else delete box.dataset.overflow;

      const lines = [...section.querySelectorAll<HTMLElement>(".claim-line")].map((el) => {
        const d = Number(el.dataset.d);
        return { el, d, w: paced[d].ws.findIndex((w) => w.i === Number(el.dataset.k)) };
      });
      const drawn = handles.map(() => -1);
      const show = (el: HTMLElement, o: number) => {
        el.style.opacity = o.toFixed(3);
        el.style.visibility = o > 0 ? "visible" : "hidden";
      };
      const paint = () => {
        const px = Math.max(0, scroller.scrollTop - section.offsetTop);
        handles.forEach((h, i) => {
          const o = segmentOpacity(t, i, px);
          show(wraps[i], o);
          const u = segmentU(t, i, px);
          if (o > 0 && u !== drawn[i]) {
            h.setU(u);
            drawn[i] = u;
          }
        });
        for (const l of lines) show(l.el, l.w < 0 ? 0 : lineOpacity(t, l.d, l.w, px));
      };
      paint();
      scroller.addEventListener("scroll", paint, { passive: true });
      stop = () => scroller.removeEventListener("scroll", paint);
    });
    return () => {
      live = false;
      stop();
      // Unmounting is synchronous too, so it waits for the commit to end as mounting does.
      const old = handles;
      handles = [];
      queueMicrotask(() => old.forEach((h) => h.dispose()));
    };
  }, [copy, scroller, viewH, stageW]);

  return (
    <section className="panel panel-p1" data-station="1" data-panel="p1" ref={panel}>
      <div className="panel-inner">
        <header className="panel-q room-copy">
          <h2 className="q-text">{ROOM.questions.p1}</h2>
        </header>
        <div className="claim-stack room-copy">
          {copy.length ? (
            copy.flatMap((d, i) =>
              d.lines.map((l, k) => (
                <p className="claim claim-line" data-d={i} data-k={k} key={`${i}-${l.id}`}>
                  {sentences(l.text)}
                </p>
              )),
            )
          ) : (
            <p className="claim claim-line" data-declined>
              {DECLINED}
            </p>
          )}
        </div>
        <div className="stage stage-p1" ref={stage}>
          {copy.map((d, i) => (
            <div className="p1-drawing" data-kind={kindOf(d.drawing)} key={i}>
              <div className="p1-host" />
              <p className="p1-caption caption">
                <span />
                <span />
              </p>
            </div>
          ))}
        </div>
        {foot}
      </div>
    </section>
  );
}
