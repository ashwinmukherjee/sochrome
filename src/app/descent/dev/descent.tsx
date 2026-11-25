// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// A dev page: the landing, then the descent driven by a fixture's read events, composed as the shell will.

import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { GeneInfo, GenomeResult, ReadEvent, RefusalReason, Rulers } from "../../../contracts/app";
import { replay } from "../../../data/replay";
import type { GeneSite, LedgerIsland } from "../../../ledger";
import rulers from "../../../ledger/rulers.json";
import "../../../styles/tokens.css";
import "../../../styles/typeface.css";
import "../../../styles/type.css";
import "../../../styles/grid.css";
import { Landing } from "../../landing/Landing";
import { List } from "../../list/List";
import { createDescent, type Descent, type DescentView, stepFrom } from "../controller";
import { Ledger } from "../Ledger";
import { Tally } from "../Tally";
import { useDescent, useDescentLedger } from "../useDescent";
import genes from "./genes.dev.json";

const FIXTURES = import.meta.glob<GenomeResult>("/test/fixtures/*.result.json", { import: "default" });
const ROWS = genes as [string, number, number, GeneInfo["optIn"]][];
const SITES: GeneSite[] = ROWS.map(([symbol, chromIndex, pos]) => ({ symbol, chromIndex, pos }));
const GENES: GeneInfo[] = ROWS.map(([symbol, chromIndex, , optIn]) => ({
  symbol,
  chrom: (rulers as Rulers).chroms[chromIndex],
  pos: 0,
  transcript: "",
  modes: [],
  conditions: {},
  job: null,
  jobReviewed: false,
  dosage: { hi: null, lofKnown: 0 },
  optIn,
}));

type Timeline = { at: number; event: ReadEvent }[];

interface PlayOptions {
  /** The read's length in ms. */
  ms?: number;
  /** The file breaks this far through its events (0-1). */
  breakAt?: number;
  /** The reference data arrives with the read, or trails it by this many ms. */
  reference?: "with" | number;
}

/** A fixture's events, with the reference data's own events laid among them as the reader sends them. */
async function timeline(name: string, o: PlayOptions): Promise<Timeline> {
  const ms = o.ms ?? 2400;
  const events: Timeline = replay(await FIXTURES[`/test/fixtures/${name}.result.json`](), ms);
  const end = events.findIndex((t) => t.event.type === "sex");
  const out: Timeline = [];
  events.forEach((t, i) => {
    if (o.reference === "with" && i > 0 && i < end && i % 40 === 0)
      out.push({ at: t.at, event: { type: "reference", fraction: i / end } });
    if (i === end && o.reference === "with") out.push({ at: t.at, event: { type: "reference", fraction: 1 } });
    if (i === end && typeof o.reference === "number") {
      const trail = o.reference;
      for (let s = 0; s <= 10; s++)
        out.push({ at: ms + (trail * s) / 10, event: { type: "reference", fraction: 0.37 + (0.63 * s) / 10 } });
    }
    const late = i >= end && typeof o.reference === "number" ? o.reference : 0;
    out.push({ at: t.at + late, event: t.event });
  });
  if (typeof o.reference === "number") out.splice(1, 0, { at: 0, event: { type: "reference", fraction: 0.2 } });
  if (o.breakAt === undefined) return out;
  const cut = Math.floor(out.length * o.breakAt);
  return [...out.slice(0, cut), { at: out[cut].at, event: { type: "error", reason: "broken", detail: "dev" } }];
}

declare global {
  interface Window {
    descent?: {
      controller: Descent;
      view(): DescentView;
      ledger: LedgerIsland | null;
      play(name: string, o?: PlayOptions): Promise<void>;
      /** What the landing asked of its parent, in order. */
      calls: string[];
    };
  }
}

const REASONS: RefusalReason[] = [
  "chip",
  "raw",
  "grch37",
  "no-build",
  "wrong-build",
  "multi",
  "no-sample",
  "unreadable",
  "broken",
  "too-large",
  "old-browser",
  "no-data",
];

function Page() {
  const [descent] = useState(() => createDescent());
  const view = useDescent(descent);
  const [ledger, setLedger] = useState<LedgerIsland | null>(null);
  useDescentLedger(ledger, view);
  const play = async (name: string, o: PlayOptions = {}) => descent.play(await timeline(name, o));
  const calls = window.descent?.calls ?? [];
  window.descent = { controller: descent, view: descent.get, ledger, play, calls };
  const step = (by: 1 | -1) => () => {
    const to = stepFrom(view.at, by, view.result);
    if (to) descent.go(to);
  };

  const { result } = view;
  // As the shell composes it: the landing in the apparatus beside the empty ledger the read will fill.
  const landing = (
    <Landing
      genes={GENES}
      refusal={view.refusal}
      onSample={() => {
        calls.push("sample");
        void play("hg002");
      }}
      onLoadChosen={() => calls.push("load-chosen")}
      onLoadDropped={() => calls.push("load-dropped")}
      onGenes={() => calls.push("genes")}
      onFile={(file, leaveOut) => {
        calls.push(`file ${file.name} ${leaveOut ? "leave-out" : "include"}`);
        // No reader here: a file named for a fixture plays it, one named for a refusal is turned away.
        const stem = file.name.replace(/\.vcf(\.gz)?$/, "");
        const reason = REASONS.find((r) => r === stem);
        if (reason) descent.feed({ type: "error", reason, detail: "dev" });
        else void play(stem);
      }}
    />
  );
  return (
    <div className="frame">
      <div className="frame-apparatus">
        {view.at === "landing" ? (
          landing
        ) : view.at === "list" && result ? (
          <List
            result={result}
            which="yours"
            current={null}
            ledger={ledger}
            onWhich={() => undefined}
            onOpen={() => undefined}
            onHover={(keys) => ledger?.light(keys)}
          />
        ) : (
          <Tally
            result={result}
            state={view.at === "list" ? "yours" : view.at}
            counting={view.counting}
            reference={view.reference}
            onNext={step(1)}
            onBack={step(-1)}
          />
        )}
      </div>
      <div className="frame-specimen">
        <Ledger result={result} rulers={rulers as Rulers} genes={SITES} name={view.name} onHandle={setLedger} />
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("no #root");
createRoot(root).render(<Page />);
