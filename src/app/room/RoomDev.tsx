// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Dev page only: a room on a fixture's finding, in the frame's specimen column. Open /src/app/room/RoomDev.html on the dev server.

import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Finding, GeneInfo, GenomeResult, ListName, RoomCopy } from "../../contracts/app";
import { genes as SAVED_GENES } from "../../copy/json/copy.json";
import { p1Copy } from "../../copy/p1/room";
import { p23Copy } from "../../copy/p23/room";
import "../../styles/tokens.css";
import "../../styles/typeface.css";
import "../../styles/type.css";
import "../../styles/grid.css";
import { Room } from "./Room";

const FIXTURES = Object.entries(
  import.meta.glob<GenomeResult>("/test/fixtures/*.result.json", { eager: true, import: "default" }),
)
  .map(([path, result]) => ({ name: path.replace(/^.*\/|\.result\.json$/g, ""), result }))
  .filter((f) => f.result.yours.length + f.result.carriers.length > 0);

const saved = SAVED_GENES as Record<string, { job: string | null; ok?: boolean } | undefined>;
const geneOf = (symbol: string, reviewed: boolean): GeneInfo => ({
  symbol,
  chrom: "",
  pos: 0,
  transcript: "",
  modes: [],
  conditions: {},
  job: saved[symbol]?.job ?? null,
  jobReviewed: reviewed || !!saved[symbol]?.ok,
  dosage: { hi: null, lofKnown: 0 },
  optIn: null,
});

/** Until the other panels' copy is merged in, they stand empty. */
function copyFor(f: Finding, gene: GeneInfo): RoomCopy {
  const p1 = p1Copy(f, gene);
  try {
    return { p1, ...p23Copy(f, gene) };
  } catch {
    return { p1, p2: { open: "", bars: {}, verdict: "" }, p3: { kind: "", lines: [] } };
  }
}

/** The page's options are controls on the page: a harness sets them as a person would, never through the address. */
function RoomDev() {
  const [fixture, setFixture] = useState(FIXTURES[0].name);
  const [list, setList] = useState<ListName>("yours");
  const [index, setIndex] = useState(0);
  const [reviewed, setReviewed] = useState(false);
  const [open, setOpen] = useState(true);
  const result = (FIXTURES.find((f) => f.name === fixture) ?? FIXTURES[0]).result;
  const findings = result[list];
  const finding = findings[Math.min(index, findings.length - 1)];
  const copy = useMemo(() => copyFor(finding, geneOf(finding.facts.gene, reviewed)), [finding, reviewed]);
  const at = findings.indexOf(finding);
  const next = findings[at + 1]?.key ?? null;
  const pick = (set: () => void) => {
    set();
    setOpen(true);
  };

  return (
    <div className="frame">
      <div className="frame-apparatus">
        <div className="room-dev says">
          <select
            value={fixture}
            data-option="fixture"
            onChange={(e) => pick(() => (setFixture(e.target.value), setIndex(0)))}
          >
            {FIXTURES.map((f) => (
              <option key={f.name}>{f.name}</option>
            ))}
          </select>
          <select
            value={list}
            data-option="list"
            onChange={(e) => pick(() => (setList(e.target.value as ListName), setIndex(0)))}
          >
            <option>yours</option>
            <option>carriers</option>
          </select>
          <select value={at} data-option="finding" onChange={(e) => pick(() => setIndex(Number(e.target.value)))}>
            {findings.map((f, i) => (
              <option key={f.key} value={i}>
                {f.facts.gene} {f.name}: {f.facts.drawings.map((d) => `${d.lane}--${d.kind}`).join(", ")}
              </option>
            ))}
          </select>
          <label>
            <input
              type="checkbox"
              checked={reviewed}
              data-option="reviewed"
              onChange={(e) => setReviewed(e.target.checked)}
            />{" "}
            gene lines reviewed
          </label>
        </div>
      </div>
      <div className="frame-specimen">
        {open ? (
          <Room
            finding={finding}
            copy={copy}
            list={list}
            next={next}
            onNext={() => setIndex(at + 1)}
            onClose={() => setOpen(false)}
          />
        ) : (
          <p className="says" data-closed>
            The list.
          </p>
        )}
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("no #root");
createRoot(root).render(
  <StrictMode>
    <RoomDev />
  </StrictMode>,
);
