// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The ledger in the specimen: its caption on the rail, the drawing on the first line.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { GenomeResult, Rulers } from "../../contracts/app";
import { type GeneSite, type LedgerIsland, mountLedger, NBSP, WORDS } from "../../ledger";
import "../../ledger/ledger.css";

interface LedgerProps {
  /** null: no genome yet (the read is running), or the reference. */
  result: GenomeResult | null;
  rulers: Rulers;
  /** Where each checked gene sits: the genes' layer. */
  genes?: readonly GeneSite[];
  /** YOUR GENOME's parentheses: the genome's name, once it has one. */
  name: string | null;
  /** The reference stands in a person's genome's place: the genes page reached from the landing. */
  reference?: boolean;
  /** The sex row's pair, known before the result: a sample's donor's, told as the sample is chosen. */
  sex?: string | null;
  /** The handle, each time the ledger is drawn anew; null when it goes. */
  onHandle(handle: LedgerIsland | null): void;
}

const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A name change fades out and in. */
function useName(name: string | null, frame: React.RefObject<HTMLElement>): { shown: string | null; out: boolean } {
  const [shown, setShown] = useState(name);
  const [out, setOut] = useState(false);
  useEffect(() => {
    if (name === shown) return setOut(false);
    const beat = frame.current ? Number.parseFloat(getComputedStyle(frame.current).getPropertyValue("--t-beat")) : 0;
    if (!shown || !beat || still()) return setShown(name);
    setOut(true);
    const timer = setTimeout(() => setShown(name), beat);
    return () => clearTimeout(timer);
  }, [name, shown, frame]);
  return { shown, out };
}

export function Ledger({ result, rulers, genes, name, sex = null, reference = false, onHandle }: LedgerProps) {
  const frame = useRef<HTMLElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<LedgerIsland | null>(null);
  const report = useRef(onHandle);
  useLayoutEffect(() => {
    report.current = onHandle;
  });

  /** The last drawing was the unread one, its pair not yet told: the next, with the result, settles the sex row's
   *  pair out of it. */
  const wasUnread = useRef(false);
  const told = useRef<string | null>(null);
  useLayoutEffect(() => {
    const el = host.current;
    const section = frame.current;
    if (!el || !section) return;
    const island = mountLedger(el, result, rulers, {
      genes,
      settleSex: wasUnread.current && !!result && told.current === null,
      onFit: (f) => {
        section.style.setProperty("--ledger-gutter", `${f.gutter}px`);
        section.style.setProperty("--ledger-y1", `${f.y1}px`);
      },
      onKeyRoom: (px) => section.style.setProperty("--ledger-key", `${px}px`),
    });
    handle.current = island;
    wasUnread.current = !result;
    if (!result) told.current = null;
    report.current(island);
    return () => {
      handle.current = null;
      report.current(null);
      island.dispose();
    };
  }, [result, rulers, genes]);

  // A pair known ahead of the result settles on the drawing standing now.
  useLayoutEffect(() => {
    if (!sex || result) return;
    told.current = sex;
    handle.current?.sex(sex);
  }, [sex, result]);

  const { shown, out } = useName(name, frame);
  const label = reference ? WORDS.reference : WORDS.genome;
  return (
    <section className="ledger" ref={frame} aria-label={label}>
      <p className="caption ledger-caption">
        {label}
        <span className={out ? "ledger-name out" : "ledger-name"}>{shown ? `${NBSP}(${shown})` : ""}</span>
      </p>
      <div className="ledger-host" ref={host} />
    </section>
  );
}
