// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Dev page only: every built cell of the renderer, in registry order, each resting on its last frame.

import React from "react";
import { isBuilt } from "./frames";
import Chain from "./lanes/Chain";
import Codon from "./lanes/Codon";
import Portrait from "./lanes/Portrait";
import { FreezeContext, Strip, type Freeze } from "./lanes/stage";
import Transcript from "./lanes/Transcript";
import { probe } from "./probe";
import { cellKey, LANES, STATES, statesFor } from "./states";
import "./render.css";
import "./system.css";

const LANE_COMPONENT = { codon: Codon, transcript: Transcript, chain: Chain, portrait: Portrait } as const;
/** Frames in a strip, when none is asked for. */
const STRIP_FRAMES = 12;

/** The sheet's options are controls on the sheet: a harness sets them as a person would, never through the address. */
export default function System() {
  const built = STATES.filter(isBuilt);
  const [strip, setStrip] = React.useState("");
  const [frames, setFrames] = React.useState(STRIP_FRAMES);
  const [freezeMs, setFreezeMs] = React.useState("");
  const [freezeCell, setFreezeCell] = React.useState("");
  const freeze: Freeze | null = freezeMs === "" ? null : { ms: Number(freezeMs), cell: freezeCell || null };
  const entry = STATES.find((s) => cellKey(s) === strip);

  const cells = (label: string, value: string, set: (v: string) => void, none: string) => (
    <label>
      {label}{" "}
      <select value={value} onChange={(e) => set(e.target.value)} data-option={label}>
        <option value="">{none}</option>
        {built.map((s) => (
          <option key={cellKey(s)}>{cellKey(s)}</option>
        ))}
      </select>
    </label>
  );

  return (
    <FreezeContext.Provider value={freeze}>
      <header className="sheet-head">
        <p className="sheet-sub">P1 renderer, dev sheet</p>
        <h1 className="sheet-title">
          {STATES.length} cells in four lanes, {built.length} built
        </h1>
        <div className="sheet-options">
          {cells("strip", strip, setStrip, "the whole sheet")}
          <label>
            frames{" "}
            <input
              type="number"
              min={2}
              value={frames}
              onChange={(e) => setFrames(Number(e.target.value))}
              data-option="frames"
            />
          </label>
          <label>
            freeze at ms{" "}
            <input
              type="number"
              min={0}
              value={freezeMs}
              onChange={(e) => setFreezeMs(e.target.value)}
              data-option="freeze"
            />
          </label>
          {cells("freeze cell", freezeCell, setFreezeCell, "every cell")}
          <button type="button" onClick={probe} data-option="measure">
            Measure
          </button>
        </div>
      </header>

      {entry ? (
        <Strip entry={entry} n={frames} />
      ) : (
        LANES.map((lane) => {
          const Comp = LANE_COMPONENT[lane.id];
          const inLane = statesFor(lane.id);
          return (
            <section className="lane" key={lane.id} id={`lane-${lane.id}`}>
              <div className="lane-head">
                <span className="lane-num">{String(lane.index).padStart(2, "0")}</span>
                <h2 className="lane-name">{lane.title}</h2>
                <p className="lane-note">{lane.note}</p>
                <span className="lane-count">
                  {inLane.filter(isBuilt).length} of {inLane.length} built
                </span>
              </div>
              <div className="lane-cells">
                {inLane.map((s) => (
                  <Comp key={cellKey(s)} entry={s} />
                ))}
              </div>
            </section>
          );
        })
      )}
    </FreezeContext.Provider>
  );
}
