// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The landing, in the apparatus: the explanation and its two actions; then the question, or a refusal, in the
// explanation's place with its answers under it. The way to the credits, or back, stands at the column's foot.
// The specimen beside it is the shell's: the empty ledger the read will fill.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BRAND } from "../../brand";
import type { LandingProps, RefusalReason } from "../../contracts/app";
import { CREDITS } from "../links";
import { Arrow } from "../list/Arrow";
import "./landing.css";
import { LANDING_WORDS as W } from "./words";

/** What stands in the actions' place. */
type Face = { kind: "actions" } | { kind: "question" } | { kind: "refusal"; reason: RefusalReason };

// Chip files (.txt, .csv, .zip) are let through so the chip refusal can explain itself.
const ACCEPT = ".vcf,.vcf.gz,.gz,.txt,.csv,.zip";
const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const keyOf = (f: Face) => (f.kind === "refusal" ? `refusal ${f.reason}` : f.kind);

/** One face leaves before the next arrives: the actions' own fade, out and in. */
function useSwap(want: Face, frame: React.RefObject<HTMLElement>): { shown: Face; out: boolean } {
  const [shown, setShown] = useState(want);
  const out = keyOf(shown) !== keyOf(want);
  useEffect(() => {
    if (!out) return;
    const swap = frame.current ? Number.parseFloat(getComputedStyle(frame.current).getPropertyValue("--t-swap")) : 0;
    const timer = setTimeout(() => setShown(want), still() ? 0 : swap || 0);
    return () => clearTimeout(timer);
  }, [want, out, frame]);
  return { shown, out };
}

export function Landing({
  genes,
  refusal,
  onSample,
  onLoadChosen,
  onLoadDropped,
  onFile,
  onGenes,
  onGenesPreview,
}: LandingProps) {
  const frame = useRef<HTMLDivElement>(null);
  const face = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [panel, setPanel] = useState<Face["kind"]>(refusal ? "refusal" : "actions");
  /** The question's answer, once given: true leaves the opt-in genes out. */
  const leaveOut = useRef<boolean | null>(null);
  /** The file last handed on, so a failed download can be tried again without choosing it twice. */
  const last = useRef<File | null>(null);
  const chosen = useRef(false);

  useEffect(() => {
    if (refusal) setPanel("refusal");
  }, [refusal]);

  const want = useMemo<Face>(
    () =>
      panel === "refusal" ? (refusal ? { kind: "refusal", reason: refusal } : { kind: "actions" }) : { kind: panel },
    [panel, refusal],
  );
  const { shown, out } = useSwap(want, frame);

  // The keyboard's place follows the swap: the button that was pressed is gone with its face. It lands on the
  // new face's first choice, not on the explanation's link.
  const held = useRef(false);
  useLayoutEffect(() => {
    if (out) held.current = !!frame.current?.contains(document.activeElement);
    else if (held.current) face.current?.querySelector<HTMLButtonElement>(".landing-line button")?.focus();
  }, [out]);

  useEffect(() => {
    const input = picker.current;
    const back = () => setPanel((p) => (p === "question" ? "actions" : p));
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanel("actions");
    };
    input?.addEventListener("cancel", back);
    addEventListener("keydown", esc);
    return () => {
      input?.removeEventListener("cancel", back);
      removeEventListener("keydown", esc);
    };
  }, []);

  const start = () => {
    if (!chosen.current) onLoadChosen();
    chosen.current = true;
  };
  // Back on the actions without a file (Escape, the picker cancelled, the way back): nothing is downloaded for
  // a choice taken back. Most phones hold no genome file, so this is the common path there.
  const drop = useRef(onLoadDropped);
  useLayoutEffect(() => {
    drop.current = onLoadDropped;
  });
  useEffect(() => {
    if (panel !== "actions" || !chosen.current) return;
    chosen.current = false;
    drop.current();
  }, [panel]);
  const load = () => {
    start();
    setPanel("question");
  };
  const answer = (leave: boolean) => () => {
    leaveOut.current = leave;
    picker.current?.click();
  };
  /** Another file is read as the question was answered; unanswered, the question comes first. */
  const another = () => {
    start();
    if (leaveOut.current === null) setPanel("question");
    else picker.current?.click();
  };
  const again = () => {
    if (last.current && leaveOut.current !== null) onFile(last.current, leaveOut.current);
    else another();
  };
  const picked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || leaveOut.current === null) return;
    last.current = file;
    // A refusal still standing is the answer if this file is turned away for the same reason.
    if (refusal) setPanel("refusal");
    onFile(file, leaveOut.current);
  };

  const asked = genes.filter((g) => g.optIn).length;
  const button = (label: string, act: () => void) => (
    <button type="button" onClick={act}>
      {label}
    </button>
  );
  const line = (first: React.ReactNode, second: React.ReactNode) => (
    <p className="caption landing-line">
      {first}
      {first && second ? <span className="landing-or"> {W.or} </span> : null}
      {second}
    </p>
  );
  const says = (lines: readonly string[]) => lines.map((t) => <p key={t}>{t}</p>);

  const explanation = (
    <div className="says landing-says">
      <p>{W.does}</p>
      <p>
        {W.scope.before}
        <button
          type="button"
          className="landing-link"
          onClick={onGenes}
          onPointerEnter={() => onGenesPreview?.(true)}
          onPointerLeave={() => onGenesPreview?.(false)}
          onFocus={() => onGenesPreview?.(true)}
          onBlur={() => onGenesPreview?.(false)}
        >
          {W.scope.count(genes.length)}
        </button>
        {W.scope.after}
      </p>
      <p>{W.known}</p>
      <p>{W.notATest}</p>
      <p>{W.privacy}</p>
    </div>
  );

  let body: React.ReactNode;
  if (shown.kind === "actions")
    body = (
      <>
        {explanation}
        {line(button(W.load, load), button(W.sample, onSample))}
      </>
    );
  else if (shown.kind === "question")
    body = (
      <>
        <div className="says landing-says landing-ask">
          {says(W.question(asked))}
          <div className="landing-before">
            <p>{W.next}</p>
            <p className="landing-phone">{W.download}</p>
          </div>
        </div>
        {line(button(W.include, answer(false)), button(W.leave, answer(true)))}
      </>
    );
  else {
    const r = W.refusal(shown.reason, BRAND.name);
    const way = r.way === "file" ? button(W.another, another) : r.way === "again" ? button(W.again, again) : null;
    body = (
      <>
        <div className="says landing-says landing-ask">{says(r.says)}</div>
        {line(way, button(W.sample, onSample))}
      </>
    );
  }

  // The column's foot: from the question, the way back to the explanation; elsewhere, the credits.
  const foot =
    shown.kind === "question" ? (
      <button type="button" className="caption landing-back" onClick={() => setPanel("actions")}>
        <Arrow back />
        {W.back}
      </button>
    ) : (
      // A page of its own: it opens beside the app, so the read in this tab stays where it is.
      <a className="caption landing-credits" href={CREDITS} target="_blank" rel="noopener noreferrer">
        {W.credits}
      </a>
    );

  return (
    <div className="landing" ref={frame}>
      <div className={out ? "landing-face out" : "landing-face"} data-face={shown.kind} ref={face} aria-live="polite">
        {body}
      </div>
      <div className={out ? "landing-foot out" : "landing-foot"}>{foot}</div>
      <input ref={picker} type="file" accept={ACCEPT} hidden onChange={picked} />
    </div>
  );
}
