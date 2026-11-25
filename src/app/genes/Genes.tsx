// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The genes page's column: GENES CHECKED (n), the genes A-Z from the first line, "+N more", BACK at the foot.

import { useEffect, useMemo, useRef } from "react";
import type { GenesProps } from "../../contracts/app";
import { GENE_ROW_PITCH } from "../../contracts/constants";
import { Arrow } from "../list/Arrow";
import { useHoverAfterMove } from "../list/hover";
import { usePager } from "../list/pager";
import { LIST_WORDS } from "../list/words";
import "../list/list.css";

/** A swipe this far rightwards, and mostly sideways, goes back. */
const SWIPE = { min: 64, slope: 0.5 } as const;

export function Genes({ genes, onHover, onBack }: GenesProps) {
  /** The genes arrive under the mouse that chose "2,132 genes": none is pointed at until it moves. */
  const hover = useHoverAfterMove();
  const sorted = useMemo(() => [...genes].sort((a, b) => a.symbol.localeCompare(b.symbol, "en")), [genes]);
  const room = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pager = usePager(room, scroller, sorted.length, GENE_ROW_PITCH, GENE_ROW_PITCH);

  const back = useRef(onBack);
  useEffect(() => {
    back.current = onBack;
  });
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && back.current();
    let start: { x: number; y: number } | null = null;
    const down = (e: TouchEvent) => {
      const t = e.touches[0];
      start = t ? { x: t.clientX, y: t.clientY } : null;
    };
    const up = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      if (!start || !t) return;
      const dx = t.clientX - start.x;
      const dy = Math.abs(t.clientY - start.y);
      start = null;
      if (dx >= SWIPE.min && dy <= dx * SWIPE.slope) back.current();
    };
    addEventListener("keydown", key);
    addEventListener("touchstart", down, { passive: true });
    addEventListener("touchend", up, { passive: true });
    return () => {
      removeEventListener("keydown", key);
      removeEventListener("touchstart", down);
      removeEventListener("touchend", up);
    };
  }, []);

  return (
    <div className="genes-page" style={{ "--gene-pitch": `${GENE_ROW_PITCH}px` } as React.CSSProperties}>
      <p className="caption on-rail genes-caption">
        {LIST_WORDS.genes}
        {LIST_WORDS.count(sorted.length)}
      </p>
      <div className="genes-body">
        <div className="genes-room" ref={room}>
          <div className="genes-rows" ref={scroller} style={{ height: pager.height ? `${pager.height}px` : undefined }}>
            {sorted.map((g) => (
              <div
                key={g.symbol}
                className="row genes-row"
                data-gene={g.symbol}
                onPointerEnter={hover.enter(() => onHover(g.symbol))}
                onPointerMove={hover.move(() => onHover(g.symbol))}
                onPointerLeave={() => onHover(null)}
              >
                {g.symbol}
              </div>
            ))}
          </div>
          {pager.more && (
            <button
              type="button"
              className={pager.settling ? "row genes-more settling" : "row genes-more"}
              onClick={pager.page}
            >
              {pager.more.kind === "more" ? LIST_WORDS.more(pager.more.n) : LIST_WORDS.top}
            </button>
          )}
        </div>
        <p className="says list-sentence genes-sentence">{LIST_WORDS.genesSentence}</p>
        <button type="button" className="caption genes-back" onClick={onBack}>
          <Arrow back />
          {LIST_WORDS.back}
        </button>
      </div>
    </div>
  );
}
