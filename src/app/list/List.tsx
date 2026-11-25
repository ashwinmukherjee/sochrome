// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The apparatus at the list: two captions, the rows by evidence, "+N more", and the list's sentence at the foot.

import { MOTION } from "../../styles/tokens";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Finding, ListName, ListProps } from "../../contracts/app";
import { LIST_PITCH } from "../../contracts/constants";
import type { From, LedgerIsland } from "../../ledger";
import { Arrow } from "./Arrow";
import { listed } from "./order";
import { useHoverAfterMove } from "./hover";
import { usePager } from "./pager";
import { LIST_WORDS } from "./words";
import "./list.css";

interface ListViewProps extends ListProps {
  /** On a phone, the room last open, shown as the open row on the list it came back to (not a room open). */
  marked?: string | null;
  /** A caption was chosen: the list and the ledger's standing ticks swap. */
  onWhich(which: ListName): void;
  /** The ledger to light and to hear from: one mark, one group. */
  ledger: LedgerIsland | null;
}

/** The first variant's cue waits for the list to land. */
const CUE_AFTER = MOTION["cue-after"];

/** One mark, one group: at the ledger's scale a gene's changes always draw as one mark. */
function groupsOf(rows: readonly Finding[]): Map<string, string[]> {
  const byGene = new Map<string, string[]>();
  for (const f of rows) {
    const g = f.bundle.identity.gene;
    byGene.set(g, [...(byGene.get(g) ?? []), f.key]);
  }
  const out = new Map<string, string[]>();
  for (const f of rows) out.set(f.key, byGene.get(f.bundle.identity.gene) ?? [f.key]);
  return out;
}

const heard = new WeakSet<LedgerIsland>();

export function List({ result, which, current, marked = null, onOpen, onHover, onWhich, ledger }: ListViewProps) {
  const rows = useMemo(() => listed(result, which), [result, which]);
  const group = useMemo(() => groupsOf(rows), [rows]);
  const nothing = result.counts.rare === 0;

  const room = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState(0);
  /** Row to row as drawn: LIST_PITCH on desktop, a thumb's height on a phone. */
  const [pitch, setPitch] = useState(LIST_PITCH);
  useLayoutEffect(() => {
    const [first, second] = [...(scroller.current?.children ?? [])];
    if (first instanceof HTMLElement) setBox(first.offsetHeight);
    if (first instanceof HTMLElement && second instanceof HTMLElement)
      setPitch(second.offsetTop - first.offsetTop || LIST_PITCH);
  }, [rows]);
  const pager = usePager(room, scroller, rows.length, pitch, box);

  const [lit, setLit] = useState<string[] | null>(null);
  const [cue, setCue] = useState<"pending" | "on" | "done">("pending");
  if (current !== null && cue !== "done") setCue("done");

  // The list's state for the ledger's listeners, which outlive a render.
  const live = useRef({ rows, group, pager, onOpen, onHover, setLit });
  useLayoutEffect(() => {
    live.current = { rows, group, pager, onOpen, onHover, setLit };
  }, [rows, group, pager, onOpen, onHover]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!ledger || heard.has(ledger)) return;
    heard.add(ledger);
    ledger.on("enter", (keys: string[], from: From) => {
      if (!mounted.current) return;
      const l = live.current;
      l.setLit(keys);
      l.onHover?.(keys);
      const first = keys[0];
      if (from === "tick" && first) l.pager.reveal(l.rows.findIndex((f) => f.key === first));
    });
    ledger.on("leave", () => {
      if (!mounted.current) return;
      live.current.setLit(null);
      live.current.onHover?.(null);
    });
    ledger.on("click", (keys: string[]) => {
      const first = keys[0];
      if (mounted.current && first) live.current.onOpen(first);
    });
  }, [ledger]);

  useEffect(() => {
    ledger?.list(which);
  }, [ledger, which]);
  // Another list starts at its top; the ledger drawn anew (a phone back from a room) keeps the rows' place.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
    kept.current = 0;
  }, [which]);

  // Where the rows were scrolled, while they scroll: on a phone, a room folds the list into the band's flow and
  // the scroll is lost, so coming back to the list puts the rows back where they were. The rows grow back over
  // the fold's motion, so the place is asked for again each frame until it holds (or the fold is long over).
  const kept = useRef(0);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const keep = () => {
      if (el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).overflowY !== "visible")
        kept.current = el.scrollTop;
    };
    el.addEventListener("scroll", keep, { passive: true });
    return () => el.removeEventListener("scroll", keep);
  }, []);
  useLayoutEffect(() => {
    const el = scroller.current;
    const top = kept.current;
    if (current !== null || !el || top === 0) return;
    let frame = 0;
    const until = performance.now() + 1500;
    const put = () => {
      el.scrollTop = top;
      if (Math.abs(el.scrollTop - top) > 1 && performance.now() < until) frame = requestAnimationFrame(put);
    };
    put();
    return () => cancelAnimationFrame(frame);
  }, [current]);

  useEffect(() => {
    if (cue !== "pending" || rows.length === 0) return;
    const t = setTimeout(() => setCue("on"), CUE_AFTER);
    return () => clearTimeout(t);
  }, [cue, rows.length]);

  const cued = cue === "on" ? rows[0] : undefined;

  /** Rows that arrive under a resting mouse (EXPLORE, a list swap) are not pointed at until it moves. */
  const hover = useHoverAfterMove();
  /** A row lights itself and its mark, never its siblings; the mark stands for its gene's whole group, so a tick
   *  lights every row of it. */
  const point = (row: string | null, keys: string[] | null) => {
    setLit(row ? [row] : null);
    ledger?.light(keys);
    onHover?.(keys);
  };

  const caption = (name: ListName, n: number) => (
    <button
      type="button"
      className={`list-tab list-tab-${name}`}
      aria-pressed={which === name}
      onClick={() => which !== name && onWhich(name)}
    >
      {LIST_WORDS.caption[name]}
      {LIST_WORDS.count(n)}
    </button>
  );

  const sentence = nothing ? LIST_WORDS.nothing(result.checked.genes) : LIST_WORDS.sentence[which];
  const linking = !!lit?.length;

  return (
    <div className="list">
      <p className="caption on-rail list-captions">
        {caption("yours", result.counts.yours)}
        {!nothing && result.counts.carriers > 0 && caption("carriers", result.counts.carriers)}
      </p>
      <div className={nothing ? "list-body nothing" : "list-body"}>
        {nothing ? (
          <p className="says list-sentence">{sentence}</p>
        ) : (
          <>
            <div className="list-room" ref={room}>
              <div
                className={["list-rows", linking && "linking", current !== null && "in-room"].filter(Boolean).join(" ")}
                ref={scroller}
                style={{ height: pager.height ? `${pager.height}px` : undefined }}
              >
                {rows.map((f) => {
                  const cls = ["row", "list-row"];
                  if (f.key === (current ?? marked)) cls.push("is-current");
                  if (lit?.includes(f.key)) cls.push("is-hot");
                  if (f === cued) cls.push("is-cue");
                  const keys = group.get(f.key) ?? [f.key];
                  return (
                    <button
                      key={f.key}
                      type="button"
                      className={cls.join(" ")}
                      data-key={f.key}
                      aria-current={f.key === current || undefined}
                      onPointerEnter={hover.enter(() => point(f.key, keys))}
                      onPointerMove={hover.move(() => point(f.key, keys))}
                      onPointerLeave={() => point(null, null)}
                      onFocus={() => point(f.key, keys)}
                      onBlur={() => point(null, null)}
                      // A double click's second click would read as "the open row again" and close the room.
                      onClick={(e) => e.detail < 2 && onOpen(f.key)}
                    >
                      <span className="list-gene">{f.bundle.identity.gene}</span>
                      <span className="list-variant">
                        {f.name}
                        {f === cued && (
                          <span className="cue-arr">
                            <Arrow />
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
              {pager.more && (
                <button
                  type="button"
                  className={pager.settling ? "row list-more settling" : "row list-more"}
                  onClick={pager.page}
                >
                  {pager.more.kind === "more" ? LIST_WORDS.more(pager.more.n) : LIST_WORDS.top}
                </button>
              )}
            </div>
            <p className="says list-sentence">{sentence}</p>
          </>
        )}
      </div>
    </div>
  );
}
