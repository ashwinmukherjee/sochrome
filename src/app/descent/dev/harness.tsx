// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// A dev page: the ledger on a fixture (first cut of the harness).

import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { GenomeResult, Rulers } from "../../../contracts/app";
import { CHROM_Y } from "../../../contracts/constants";
import type { GeneSite, LedgerIsland } from "../../../ledger";
import rulers from "../../../ledger/rulers.json";
import { sexPairOf } from "../../../spine/pipeline";
import "../../../styles/tokens.css";
import "../../../styles/typeface.css";
import "../../../styles/type.css";
import "../../../styles/grid.css";
import { Ledger } from "../Ledger";
import genes from "./genes.dev.json";

const FIXTURES = import.meta.glob<GenomeResult>("/test/fixtures/*.result.json", { import: "default" });
const SITES: GeneSite[] = (genes as [string, number, number, string | null][]).map(([symbol, chromIndex, pos]) => ({
  symbol,
  chromIndex,
  pos,
}));

declare global {
  interface Window {
    harness?: {
      ledger: LedgerIsland | null;
      /** `y`: a made-up genome, the fixture with this many records on Y. */
      load(name: string | null, y?: number): Promise<void>;
      events: string[];
    };
  }
}

function Page() {
  const [result, setResult] = useState<GenomeResult | null>(null);
  window.harness = {
    ledger: window.harness?.ledger ?? null,
    events: window.harness?.events ?? [],
    load: async (name, y = 0) => {
      const r = name ? await FIXTURES[`/test/fixtures/${name}.result.json`]() : null;
      const parsed = r?.parsed.map((n, c) => (c === CHROM_Y ? n + y : n));
      // Made-up Y records change the pair the sex row names (one X and a Y is XY), as a read would;
      // without them the fixture's own pair stands (a sample's comes from its donor, which the fixture doesn't carry).
      const sexPair = r && y ? sexPairOf(r.copiesX, (r.parsed[CHROM_Y] ?? 0) + y) : (r?.sexPair ?? null);
      setResult(r && parsed ? { ...r, parsed, sexPair, counts: { ...r.counts, all: r.counts.all + y } } : null);
    },
  };
  return (
    <div className="frame">
      <div className="frame-apparatus" />
      <div className="frame-specimen">
        <Ledger
          result={result}
          rulers={rulers as Rulers}
          genes={SITES}
          name={result?.displayName ?? null}
          onHandle={(h) => {
            if (!window.harness) return;
            window.harness.ledger = h;
            for (const ev of ["enter", "leave", "click"] as const)
              h?.on(ev, (keys, from) => window.harness?.events.push(`${ev} ${from} ${keys.join(",")}`));
          }}
        />
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("no #root");
createRoot(root).render(<Page />);
