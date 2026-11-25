// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// For checks and screenshots only: P2 or P3 for one set of facts, seated as the room seats them. No build imports it.

import type { CSSProperties } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { P23Facts } from "../../contracts/app";
import { BREAKPOINT_PHONE, PACING } from "../../contracts/constants";
import { HOLD_VH } from "../../copy/p1/schedule";
import { context } from "../../copy/p23/model";
import { p23CopyOf } from "../../copy/p23/room";
import { P2Panel } from "./P2Panel";
import { p23Asserts } from "./P23Asserts";
import { P3Panel } from "./P3Panel";

export type HarnessPanel = "p2" | "p3";

// The room's shell as Room.tsx and room.css build it, restated so a panel can be judged before the two meet:
// a scroll box one screen tall, a panel one screen plus its scrub and hold, a frame pinned in it between the
// walls, the question on its station, and the panel's place written on it as it scrolls.
const QUESTIONS = { p2: "How sure are we?", p3: "What does it mean for you?" } as const;
const STATION = { p2: 2, p3: 3 } as const;
const P3_SCRUB = { min: 0.34, step: 0.22 } as const;
const SHELL: Record<"room" | "inner" | "q" | "strut" | "qText", CSSProperties> = {
  room: { position: "relative", gridRow: "1 / -1", blockSize: "100dvh", overflow: "hidden auto" },
  inner: {
    position: "sticky",
    top: 0,
    display: "flex",
    flexDirection: "column",
    minBlockSize: "100dvh",
    padding: "0 var(--wall) var(--sp-5)",
  },
  q: { display: "flex", alignItems: "baseline", flex: "none", blockSize: "var(--station-c)", margin: 0 },
  strut: { inlineSize: 0, blockSize: "var(--station-q)" },
  qText: {
    maxInlineSize: "var(--w-spine)",
    margin: 0,
    fontFamily: "var(--serif)",
    fontWeight: 400,
    fontSize: "var(--t-serif-l)",
    lineHeight: "var(--lh-serif-l)",
    color: "var(--v-uncertain)",
    opacity: 0.78,
  },
};

let root: Root | null = null;
let pairs: (string | null)[] = [];
let scrubScale = 1;

const room = () => {
  const el = document.querySelector<HTMLElement>("[data-harness-room]");
  if (!el) throw new Error("no panel is mounted");
  return el;
};
const station = () => {
  const el = room().querySelector<HTMLElement>("[data-station]");
  if (!el) throw new Error("no panel is mounted");
  return el;
};
const scrub = () => room().clientHeight * PACING.PACE * scrubScale;
/** The room's setProgress: the panel's place in its scrub, 0 to 1, written where its content reads it. */
const place = () => {
  const p = Math.min(1, Math.max(0, (room().scrollTop - station().offsetTop) / scrub()));
  station().style.setProperty("--p", p.toFixed(4));
};

/** Replace the page with one panel in the room's shell, beside an empty apparatus. */
function mount(facts: P23Facts, panel: HarnessPanel): void {
  root?.unmount();
  pairs = [];
  const host = document.createElement("div");
  document.body.replaceChildren(host);
  const ctx = context(facts);
  const copy = p23CopyOf(facts, undefined);
  scrubScale = panel === "p2" ? 1 : Math.min(1, P3_SCRUB.min + P3_SCRUB.step * Math.max(0, copy.p3.lines.length - 1));
  const length = `calc(100dvh * ${1 + PACING.PACE * scrubScale + HOLD_VH})`;
  const told = (id: string | null) => pairs.push(id);
  root = createRoot(host);
  root.render(
    <div className="frame">
      {window.matchMedia(`(max-width: ${BREAKPOINT_PHONE}px)`).matches || <div className="frame-apparatus" />}
      <div className="frame-specimen">
        <article style={SHELL.room} data-harness-room="" onScroll={place}>
          <section style={{ position: "relative", blockSize: length }} data-station={STATION[panel]}>
            <div style={SHELL.inner}>
              <header style={SHELL.q}>
                <span style={SHELL.strut} />
                <h2 style={SHELL.qText}>{QUESTIONS[panel]}</h2>
              </header>
              {panel === "p2" ? (
                <P2Panel ctx={ctx} copy={copy.p2} onPair={told} />
              ) : (
                <P3Panel ctx={ctx} copy={copy.p3} onPair={told} />
              )}
            </div>
          </section>
        </article>
      </div>
    </div>,
  );
}

const marks = (panel: HarnessPanel): number[] => {
  const el = document.querySelector<HTMLElement>(`[data-panel="${panel}"]`);
  if (!el) throw new Error(`no ${panel} panel is mounted`);
  return (el.dataset.marks ?? "").split(" ").map(Number);
};

/** How many beats a panel has. */
const beats = (panel: HarnessPanel): number => marks(panel).length;

/** Scroll the room to the middle of a beat's share of the scrub. */
function seek(panel: HarnessPanel, beat: number): void {
  const at = marks(panel);
  if (beat < 0 || beat >= at.length) throw new Error(`${panel} has no beat ${beat}`);
  const middle = (at[beat] + (at[beat + 1] ?? 1)) / 2;
  room().scrollTop = station().offsetTop + scrub() * middle;
  place();
}

/** What the panel told the room about pairing, in order. */
const told = (): (string | null)[] => pairs;

const asserts = (): string[] => p23Asserts(document.body);

/** What a check may call in the page. */
export const harness = { mount, beats, seek, told, asserts };
