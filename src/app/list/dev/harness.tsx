// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// A dev page: the list and the genes page beside the ledger, on a fixture.

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { GeneInfo, GenomeResult, ListName, Rulers } from "../../../contracts/app";
import type { GeneSite, LedgerIsland } from "../../../ledger";
import rulers from "../../../ledger/rulers.json";
import "../../../styles/tokens.css";
import "../../../styles/typeface.css";
import "../../../styles/type.css";
import "../../../styles/grid.css";
import { Ledger } from "../../descent/Ledger";
import genes from "../../descent/dev/genes.dev.json";
import { Genes } from "../../genes/Genes";
import { List } from "../List";

const FIXTURES = import.meta.glob<GenomeResult>("/test/fixtures/*.result.json", { import: "default" });
const RAW = genes as [string, number, number, string | null][];
const SITES: GeneSite[] = RAW.map(([symbol, chromIndex, pos]) => ({ symbol, chromIndex, pos }));
const INFO = RAW.map(([symbol]) => ({ symbol }) as GeneInfo);

type View = "list" | "genes";

declare global {
  interface Window {
    lists?: {
      load(name: string | null): Promise<void>;
      view(v: View): void;
      ledger: LedgerIsland | null;
      events: string[];
    };
  }
}

function Page() {
  const [result, setResult] = useState<GenomeResult | null>(null);
  const [which, setWhich] = useState<ListName>("yours");
  const [current, setCurrent] = useState<string | null>(null);
  const [view, setView] = useState<View>("list");
  const [ledger, setLedger] = useState<LedgerIsland | null>(null);
  const events = window.lists?.events ?? [];
  window.lists = {
    ledger,
    events,
    load: async (name) => {
      const r = name ? await FIXTURES[`/test/fixtures/${name}.result.json`]() : null;
      setResult(r);
      setWhich("yours");
      setCurrent(null);
      setView(r ? "list" : "genes");
    },
    view: setView,
  };

  const genesPage = view === "genes";
  useEffect(() => {
    if (!ledger) return;
    void ledger.state(genesPage ? "genes" : "list", { animate: false });
    ledger.genes(genesPage ? (result ? "overlay" : "reference") : "off");
  }, [ledger, genesPage, result]);

  return (
    <div className="frame">
      <div className="frame-apparatus">
        {genesPage ? (
          <Genes
            genes={INFO}
            leftOut={result?.checked.leftOut ?? 0}
            from={result ? "results" : "landing"}
            onHover={(g) => {
              events.push(`gene ${g ?? "-"}`);
              ledger?.light(g ? [g] : null);
            }}
            onBack={() => {
              events.push("back");
              setView("list");
            }}
          />
        ) : (
          result && (
            <List
              key={result.displayName}
              result={result}
              which={which}
              current={current}
              ledger={ledger}
              onWhich={setWhich}
              onOpen={(k) => {
                events.push(`open ${k}`);
                setCurrent((c) => (c === k ? null : k));
              }}
              onHover={(keys) => events.push(`hover ${keys?.join(",") ?? "-"}`)}
            />
          )
        )}
      </div>
      <div className="frame-specimen">
        <Ledger
          result={result}
          rulers={rulers as Rulers}
          genes={SITES}
          name={result?.displayName ?? null}
          reference={!result}
          onHandle={setLedger}
        />
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("no #root");
createRoot(root).render(<Page />);
