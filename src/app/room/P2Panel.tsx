// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// How sure are we? Each piece of evidence as a bar out from the centre, with its row; then the verdict. A piece that
// carries no weight is a bar of no length, so the chart draws nothing for it and its row alone tells it.

import type { CSSProperties } from "react";
import type { Bar, P2Props } from "../../contracts/app";
import { POLES, tierWord } from "../../copy/p23/room";
import { claimWeight, P23Frame, rowWeight, useBeat, usePair, type Step } from "./P23Frame";
import { P2_VARS } from "./P23Values";

const DIRS = [-1, 0, 1] as const;
const POLE_OF = { "-1": POLES.harmless, "0": POLES.open, "1": POLES.harmful } as const;

export function P2Panel({ ctx, copy, onPair }: P2Props) {
  const bars = ctx.bars.filter((b) => copy.bars[b.id] !== undefined);
  const pair = usePair(onPair, () => true);
  const { paired } = pair;

  // The opening stays up while the bars land; the verdict follows them, and the condition the verdict.
  const claims = [copy.open, copy.verdict, copy.condition ?? ""].filter((text) => text !== "");
  const steps: Step[] = [
    { claim: 0, weight: claimWeight(copy.open) },
    ...bars.map((b) => ({ claim: 0, weight: rowWeight(copy.bars[b.id] ?? "") })),
    ...claims.slice(1).map((text, i) => ({ claim: i + 1, weight: claimWeight(text) })),
  ];

  const at = useBeat(steps);
  const { beat } = at;

  // Where the frame has room for one ledger row, it is the paired bar's once landed, else the last to land.
  const landed = bars.slice(0, beat);
  const now = (landed.find((b) => b.id === paired) ?? landed.at(-1))?.id;

  const lead = (b: Bar) => (bars.find((x) => x.dir === b.dir) === b ? "var(--p2-seam)" : "var(--p2-gap)");
  const marks = (b: Bar) => ({
    "data-pair": b.id,
    "data-on": beat > bars.indexOf(b) ? "" : undefined,
    "data-lit": paired === b.id ? "" : undefined,
  });

  return (
    <P23Frame
      panel="p2"
      claims={claims}
      steps={steps}
      at={at}
      vars={P2_VARS}
      pair={pair}
      data={{ "data-chart": ctx.chart, "data-points": String(ctx.points) }}
    >
      <div className="p23-stage p2-chart" aria-hidden="true">
        {([-1, 1] as const).map((dir) => (
          <div key={dir} className="p2-arm" data-dir={dir}>
            {bars
              .filter((b) => b.dir === dir)
              .map((b) => (
                <div
                  key={b.id}
                  className="p2-bar"
                  style={{ "--pts": b.pts, "--lead": lead(b) } as CSSProperties}
                  {...marks(b)}
                />
              ))}
          </div>
        ))}
        <div className="p2-rule" />
        <div className="p2-tick" />
        <div className="p2-poles">
          {DIRS.map((dir) => (
            <span key={dir} className="p2-pole" data-dir={dir}>
              {POLE_OF[dir]}
            </span>
          ))}
        </div>
      </div>
      <ol className="p23-ledger p2-ledger">
        {bars.map((b) => (
          <li
            key={b.id}
            className="p23-row p2-row"
            data-dir={b.dir}
            data-now={now === b.id ? "" : undefined}
            tabIndex={0}
            {...marks(b)}
          >
            {/* One square for every row, in its direction's hue: the neutral grey says it points nowhere. */}
            {b.dir === 0 ? (
              <span className="p2-square" aria-hidden="true" />
            ) : (
              <span className="p2-square" role="img" aria-label={POLE_OF[b.dir]} />
            )}
            <span className="p23-row-text">
              <span className="p23-row-name">{tierWord(b.tier)}</span>
              <span className="p23-row-says">{copy.bars[b.id]}</span>
            </span>
          </li>
        ))}
      </ol>
    </P23Frame>
  );
}
