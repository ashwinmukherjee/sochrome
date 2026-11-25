// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The tally in the apparatus: one count and its caption per cut, then the step forward.

import { useEffect, useReducer } from "react";
import type { GenomeResult, TallyProps } from "../../contracts/app";
import { Arrow } from "../list/Arrow";
import "./tally.css";
import { CUTS, fmt, TALLY_WORDS as W, WIDEST, countsOf } from "./words";

/** The genomes whose step forward has been found: its first-sight cue is retired for good. */
const found = new WeakSet<GenomeResult>();

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName));

export function Tally({ result, state, counting, reference, onGenes, onGenesPreview, onNext, onBack }: TallyProps) {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const on = state === "loading" ? 0 : CUTS.indexOf(state);
  /** The first count runs through the read; its caption waits until it has landed. */
  const landed = state !== "loading" || reference !== null;
  const last = result && (result.counts.rare === 0 ? "rare" : "yours");
  const forward = !!result && state !== "loading" && reference === null;
  const back = forward && on > 0;
  const fresh = !!result && !found.has(result);

  const step = () => {
    if (!result || !forward) return;
    found.add(result);
    redraw();
    onNext();
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || typing(e.target)) return;
      if (e.key === "ArrowRight") step();
      else if (e.key === "ArrowLeft" && back) onBack();
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  });

  const cls = (...names: (string | false)[]) => names.filter(Boolean).join(" ");
  /** A cut's line; the second's genes count is the way to the genes page, as the landing's is. */
  const says = (cut: (typeof CUTS)[number], r: GenomeResult) => {
    if (cut !== "coding" || !onGenes) return W.says[cut](countsOf(r));
    const [before, genes, after] = W.codingLine(countsOf(r));
    return (
      <>
        {before}
        <button
          type="button"
          className="tally-genes"
          onClick={onGenes}
          onPointerEnter={() => onGenesPreview?.(true)}
          onPointerLeave={() => onGenesPreview?.(false)}
          onFocus={() => onGenesPreview?.(true)}
          onBlur={() => onGenesPreview?.(false)}
        >
          {genes}
        </button>
        {after}
      </>
    );
  };
  return (
    <div className="tally" data-state={state}>
      <p className="caption on-rail tally-caption">{W.caption}</p>
      <ol className="tally-cuts" aria-label={W.label}>
        {/* The phone's band holds every cut in one cell: this unseen one, each cut's longest line, sizes it before
            the read has anything to say, so nothing under it moves when the result lands. */}
        <li className="tally-sizer" aria-hidden>
          <span className="row tally-n">{fmt(WIDEST.all)}</span>
          {CUTS.map((cut) => (
            <p key={cut} className="says tally-says">
              {W.says[cut](WIDEST)}
            </p>
          ))}
        </li>
        {CUTS.map((cut, i) => {
          const seen = i <= on;
          const count = !result ? (i === 0 ? counting : null) : W.count(cut, countsOf(result));
          return (
            <li
              key={cut}
              className={cls(
                "tally-cut",
                seen && "seen",
                i === on && "now",
                i === 0 && !landed && "counting",
                i === 0 && !landed && counting === 0 && "unread",
              )}
              data-cut={cut}
              aria-hidden={!seen}
            >
              <span className="row tally-n">{count === null ? "" : fmt(count)}</span>
              <p className="says tally-says">{result ? says(cut, result) : i === 0 ? W.says.all() : ""}</p>
            </li>
          );
        })}
      </ol>
      <div className="tally-nav">
        {reference !== null && <span className="caption tally-reference">{W.reference(reference)}</span>}
        <button
          type="button"
          className={cls("caption tally-next", forward && "on", fresh && "fresh", state === last && "last")}
          onClick={step}
          tabIndex={forward ? 0 : -1}
          aria-hidden={!forward}
          aria-label={state === last ? W.explore : W.next}
        >
          <span className="tally-words" aria-hidden="true">
            <span className="tally-word-next">{W.next}</span>
            <span className="tally-word-last">{W.explore}</span>
          </span>
          <span className="tally-arrow">
            <Arrow />
          </span>
        </button>
      </div>
    </div>
  );
}
