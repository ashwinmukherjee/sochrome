// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// A drawing's frame painted, and the dev sheet's clock: a cell rests on its last frame and replays on a click.

import React from "react";
import { visual as V } from "../tokens";
import type { StateEntry } from "../states";
import { cellKey } from "../states";
import { sample, timeline, isBuilt, type Frame } from "../frames";
import { paint } from "./paint";

/** The dev sheet can hold cells at one millisecond, so a moving thing can be photographed reproducibly. */
export interface Freeze {
  ms: number;
  /** One cell's name, or null for every cell. */
  cell: string | null;
}
export const FreezeContext = React.createContext<Freeze | null>(null);

/** Paints a frame's marks. While a drawing arrives, its veil (`Frame.fade`) is spent on one group, never
 *  per mark: overlapping ink faded mark by mark shows through itself. Marks that stand outside the veil
 *  (`static`: the ruler) break the group into runs, so paint order survives. */
export function paintFrame(frame: Frame): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let run: React.ReactNode[] = [];
  const flush = () => {
    if (!run.length) return;
    out.push(
      <g key={`fade-${out.length}`} opacity={(frame.fade ?? 1).toFixed(3)}>
        {run}
      </g>,
    );
    run = [];
  };
  for (const m of frame.marks) {
    if (frame.fade == null || m.static) {
      flush();
      out.push(paint(m, m.key));
    } else run.push(paint(m, m.key));
  }
  flush();
  return out;
}

const prefersReduced = () =>
  typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function useReplay(entry: StateEntry) {
  const { total } = timeline(entry);
  const freeze = React.useContext(FreezeContext);
  const frozen = freeze != null && (freeze.cell == null || freeze.cell === cellKey(entry));
  const [played, setT] = React.useState<number>(total);
  const t = frozen ? freeze.ms : played;
  const raf = React.useRef<number>(0);

  const replay = React.useCallback(() => {
    if (frozen || prefersReduced() || entry.beats.length < 2) return;
    cancelAnimationFrame(raf.current);
    const t0 = performance.now();
    const step = () => {
      const dt = performance.now() - t0;
      if (dt >= total) {
        setT(total);
        return;
      }
      setT(dt);
      raf.current = requestAnimationFrame(step);
    };
    setT(0);
    raf.current = requestAnimationFrame(step);
  }, [entry, total, frozen]);

  React.useEffect(() => () => cancelAnimationFrame(raf.current), []);
  return { t, replay, total, frozen };
}

function beatAt(entry: StateEntry, t: number): string {
  const { phases } = timeline(entry);
  for (const p of phases) if (t < p.at + p.dur) return p.beat;
  return entry.beats[entry.beats.length - 1];
}

/** `address`: a fact the lane puts in the cell's caption because its register carries no type (the chain's residue). */
export function Stage({ entry, address }: { entry: StateEntry; address?: string }) {
  const { t, replay, frozen } = useReplay(entry);
  const built = isBuilt(entry);
  const frame = built ? sample(entry, t) : null;
  const key = cellKey(entry);

  return (
    <figure className="cell" data-cell={key} data-built={built ? "1" : "0"}>
      <figcaption className="cell-id">
        <span className="cell-state">{entry.state}</span>
        <span className="cell-spec" data-unresolved={entry.specimen.unresolved ? "1" : undefined}>
          {entry.specimen.label}
        </span>
        {address && <span className="cell-addr">{address}</span>}
        {entry.docOnly && <span className="cell-flag">docOnly</span>}
        {entry.reference && <span className="cell-flag">reference</span>}
        {entry.openDecision && <span className="cell-flag">open · {entry.openDecision}</span>}
      </figcaption>

      <div
        className="stage"
        style={{ width: V.stageW, height: V.stageH }}
        onClick={replay}
        role={built && entry.beats.length > 1 ? "button" : undefined}
        tabIndex={built && entry.beats.length > 1 ? 0 : undefined}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            replay();
          }
        }}
        title={built ? "click to replay" : undefined}
      >
        {frame ? (
          <svg
            className="mk-svg"
            width={V.stageW}
            height={V.stageH}
            viewBox={`0 0 ${V.stageW} ${V.stageH}`}
            data-beat={beatAt(entry, t)}
            data-marks={frame.marks.length}
          >
            {/* Marks are keyed by their own key, stable across beats, so a replay updates them in place. */}
            {paintFrame(frame)}
          </svg>
        ) : null}
      </div>

      <p className="cell-note">{entry.notes}</p>
      <p className="cell-beats">
        {entry.beats.map((b, i) => (
          <span key={b} className="beat" data-live={built && b === beatAt(entry, t) ? "1" : undefined}>
            {i ? " · " : ""}
            {b}
          </span>
        ))}
        {!built && <span className="beat-stub"> — not built this pass</span>}
        {frozen && <span className="beat-stub"> — frozen at {Math.round(t)}ms</span>}
      </p>
    </figure>
  );
}

/** One cell's replay laid down the page, each frame pinned to its own millisecond: one screenshot
 *  holds the whole replay. Every frame is `sample(entry, t)` at a t the played cell also passes through. */
export function Strip({ entry, n }: { entry: StateEntry; n: number }) {
  const { total } = timeline(entry);
  const count = Number.isFinite(n) ? Math.max(2, Math.floor(n)) : 2;
  const frames = Array.from({ length: count }, (_, i) => (i * total) / (count - 1));
  return (
    <div className="strip" data-cell={cellKey(entry)} data-total={Math.round(total)}>
      {frames.map((t, i) => {
        const f = sample(entry, t);
        return (
          <svg
            key={i}
            className="mk-svg"
            width={V.stageW}
            height={V.stageH}
            viewBox={`0 0 ${V.stageW} ${V.stageH}`}
            data-t={Math.round(t)}
            data-beat={beatAt(entry, t)}
          >
            <rect x={0} y={0} width={V.stageW} height={V.stageH} fill={V.inkGround} />
            {paintFrame(f)}
          </svg>
        );
      })}
    </div>
  );
}
