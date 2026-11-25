// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// What does it mean for you? A hundred people where the gene has a figure; where it has none, the lines alone.

import { useEffect, useRef, useState } from "react";
import type { P3Props } from "../../contracts/app";
import { figureFor } from "../../copy/p23/model";
import { DECLINED, P3_GROUPS, p3Layout, type P3Group } from "../../copy/p23/room";
import { claimWeight, P23Frame, useBeat, usePair, type Step } from "./P23Frame";
import { P3, P3_VARS } from "./P23Values";

/** The figure's beats, in the order its claims are said: the hundred, the baseline, the variant's share. */
const BEAT = { baseline: 1, added: 2 } as const;

const stillness = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * How many of a group have arrived: none before its beat, all after it, and during it one whole person
 * at a time. Coming back to the beat from after it leaves them as they stand.
 */
function useArrivals(n: number, beat: number, at: number): number {
  const [count, setCount] = useState(beat > at ? n : 0);
  const now = useRef(count);
  now.current = count;
  useEffect(() => {
    if (beat < at) return setCount(0);
    if (beat > at || stillness() || now.current >= n) return setCount(n);
    const from = now.current;
    const start = performance.now();
    let frame = requestAnimationFrame(function step(t) {
      const arrived = Math.floor((t - start - P3.rampMs / 2) / P3.waveMs) + 1;
      setCount(Math.min(n, Math.max(from, arrived)));
      if (arrived < n) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [n, beat, at]);
  return count;
}

export function P3Panel({ ctx, copy, onPair }: P3Props) {
  const said = p3Layout(copy);
  const fig = said.rows.length ? figureFor(ctx.f) : undefined;
  // A figure's rows with no figure to draw: loud in dev, declined in production, never half a panel.
  const lost = said.rows.length > 0 && !fig;
  if (lost && !import.meta.env.PROD) throw new Error(`${ctx.title}: P3 has a figure's rows and no figure`);
  const { claims, rows } = lost ? { claims: [DECLINED.p3], rows: [] } : said;
  const steps: Step[] = claims.map((text, claim) => ({ claim, weight: claimWeight(text) }));

  const at = useBeat(steps);
  const { beat } = at;
  const baseline = useArrivals(fig?.baseline ?? 0, beat, BEAT.baseline);
  const added = useArrivals(fig?.added ?? 0, beat, BEAT.added);
  const complete = !!fig && (beat > BEAT.added || (beat === BEAT.added && added >= fig.added));
  // A group can be paired once its squares are coloured; the unaffected once the array is complete.
  const live: Record<P3Group, boolean> = { baseline: baseline > 0, added: added > 0, none: complete };
  const pair = usePair(onPair, (id) => P3_GROUPS.some((g) => g.id === id && live[g.id]));
  const { paired } = pair;

  const groupOf = (i: number): P3Group =>
    !fig ? "none" : i < fig.baseline ? "baseline" : i < fig.baseline + fig.added ? "added" : "none";
  const arrived = (i: number) => !!fig && (i < fig.baseline ? i < baseline : i - fig.baseline < added);

  return (
    <P23Frame
      panel="p3"
      claims={claims}
      steps={steps}
      at={at}
      vars={P3_VARS}
      pair={pair}
      data={{ "data-kind": copy.kind }}
    >
      {fig && (
        <div className="p23-stage p3-figure">
          <div className="p3-array" aria-hidden="true">
            {Array.from({ length: P3.people }, (_, i) => (
              <i key={i} className="p3-cell" data-pair={groupOf(i)} data-on={arrived(i) ? "" : undefined} />
            ))}
          </div>
          <ol className="p23-ledger p3-ledger">
            {P3_GROUPS.map((g, k) => (
              <li
                key={g.id}
                className="p23-row p3-row"
                tabIndex={0}
                data-pair={g.id}
                data-on={(g.id === "none" ? complete : beat >= BEAT[g.id]) ? "" : undefined}
                data-lit={paired === g.id ? "" : undefined}
              >
                <span className="p3-key" data-pair={g.id} />
                <span className="p23-row-text">
                  <span className="p23-row-name">{g.label}</span>
                  <span className="p23-row-says">{rows[k]}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </P23Frame>
  );
}
