// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// What P2 and P3 share: the claim box and stage on the room's stations, the beats the room's scroll steps through, and pairing.

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { PACING } from "../../contracts/constants";
import { READING } from "./P23Values";
import "./p23.css";

/** One beat of a panel: which claim is up, and its share of the panel's scrub. */
export interface Step {
  claim: number;
  weight: number;
}

const breaths = (text: string) =>
  Math.max(READING.minBreaths, Math.ceil(text.trim().split(/\s+/).length / READING.wordsPerBreath));
/** A claim weighs the hand-off into it and the breaths to read it; a ledger row only the breaths. */
export const claimWeight = (text: string) => PACING.HANDOFF_PX + breaths(text) * PACING.BREATH_PX;
export const rowWeight = (text: string) => breaths(text) * PACING.BREATH_PX;

/** The custom property the room writes on a panel as it scrolls: 0 to 1 over the scrub, 1 through the hold. */
const PLACE = "--p";

/**
 * The beat the room's scroll has reached. The room owns the panel's length and its place in it; the beats
 * divide that by their weights, so the first is up as the panel arrives and the last holds to its end.
 */
export function useBeat(steps: Step[]) {
  const host = useRef<HTMLDivElement>(null);
  const [beat, setBeat] = useState(0);
  const total = steps.reduce((sum, s) => sum + s.weight, 0);
  let before = 0;
  const marks = steps.map((s) => {
    const mark = before / total;
    before += s.weight;
    return +mark.toFixed(4);
  });
  const key = marks.join(" ");
  useEffect(() => {
    const starts = key.split(" ").map(Number);
    const panel = host.current?.closest<HTMLElement>("[data-station]");
    if (!panel) {
      // Outside a room there is no scroll to follow: loud in dev, and at rest on the last beat in production.
      if (!import.meta.env.PROD) throw new Error("a P2 or P3 panel is not inside a room's panel");
      return setBeat(starts.length - 1);
    }
    const read = () => {
      const p = parseFloat(panel.style.getPropertyValue(PLACE)) || 0;
      setBeat(Math.max(0, starts.filter((mark) => p >= mark).length - 1));
    };
    const watch = new MutationObserver(read);
    watch.observe(panel, { attributes: true, attributeFilter: ["style"] });
    read();
    return () => watch.disconnect();
  }, [key]);
  return { host, beat: Math.max(0, Math.min(beat, steps.length - 1)), marks: key };
}

/**
 * Pairing, one rule for hover, focus and tap: pointing at anything marked data-pair pairs its id. A tap
 * holds the pairing until the next tap; a mouse only while it points.
 */
export function usePair(onPair: (id: string | null) => void, live: (id: string) => boolean) {
  const [pointed, setPointed] = useState<string | null>(null);
  const [held, setHeld] = useState<string | null>(null);
  const pointer = useRef("mouse");
  const told = useRef<string | null>(null);
  const tell = useRef(onPair);
  tell.current = onPair;

  const wanted = pointed ?? held;
  const paired = wanted && live(wanted) ? wanted : null;
  useEffect(() => {
    // A pairing that stopped being live is forgotten, so it can't return by itself.
    if (pointed && !live(pointed)) setPointed(null);
    if (held && !live(held)) setHeld(null);
    if (told.current === paired) return;
    told.current = paired;
    tell.current(paired);
  }, [pointed, held, paired, live]);
  useEffect(() => {
    if (!held) return;
    const release = (e: Event) => {
      if (!(e.target instanceof Element) || !e.target.closest("[data-pair]")) setHeld(null);
    };
    document.addEventListener("pointerdown", release);
    return () => document.removeEventListener("pointerdown", release);
  }, [held]);

  const idOf = (target: EventTarget) =>
    target instanceof Element ? (target.closest<HTMLElement>("[data-pair]")?.dataset.pair ?? null) : null;
  const bind = {
    onPointerDown: (e: PointerEvent) => {
      pointer.current = e.pointerType;
    },
    onPointerOver: (e: PointerEvent) => {
      if (e.pointerType === "mouse") setPointed(idOf(e.target));
    },
    onPointerLeave: (e: PointerEvent) => {
      if (e.pointerType === "mouse") setPointed(null);
    },
    onClick: (e: MouseEvent) => {
      if (pointer.current === "mouse") return;
      const id = idOf(e.target);
      setHeld((was) => (id && id !== was ? id : null));
    },
    onFocus: (e: FocusEvent) => {
      if (e.target.matches(":focus-visible")) setPointed(idOf(e.target));
    },
    onBlur: () => setPointed(null),
  };
  return { paired, bind };
}

interface FrameProps {
  panel: "p2" | "p3";
  claims: string[];
  steps: Step[];
  /** From useBeat: the beat reached, and the element that finds the room's panel. */
  at: ReturnType<typeof useBeat>;
  /** The panel's numbers, as the custom properties its styles read. */
  vars: CSSProperties;
  pair: ReturnType<typeof usePair>;
  /** Extra data attributes, for styles and checks. */
  data?: Record<`data-${string}`, string | undefined>;
  /** Under the claim, in the air above the stage. */
  children?: ReactNode;
}

/**
 * What a panel puts in the room's pinned frame, under the room's question: its claims swapping in the
 * claim box, then its stage. Each stands on its station because the boxes above it are the stations' sizes.
 */
export function P23Frame({ panel, claims, steps, at, vars, pair, data, children }: FrameProps) {
  const up = steps[at.beat]?.claim ?? 0;
  return (
    <div
      className="p23"
      data-panel={panel}
      data-beat={at.beat}
      data-marks={at.marks}
      data-paired={pair.paired ?? undefined}
      style={vars}
      ref={at.host}
      {...pair.bind}
      {...data}
    >
      <div className="p23-claims">
        {claims.map((text, i) => (
          <p key={i} className="claim p23-claim" data-on={i === up ? "" : undefined}>
            {text}
          </p>
        ))}
      </div>
      <div className="p23-aside" />
      {children}
    </div>
  );
}
