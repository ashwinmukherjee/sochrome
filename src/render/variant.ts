// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// A variant's drawing from its facts, and that drawing's clock: no DOM, so the room and the checks share one table.

import type { CodonRecord, Drawing } from "../contracts/app";
import { registerVariant, settledAt, timeline } from "./frames";
import type { CodonKind, CodonSpecimen } from "./specimens";
import { cellKey, STATES, type StateEntry } from "./states";

/** One phase of a drawing's timeline, in the units `setU` takes. */
export interface P1Beat {
  name: string;
  u0: number;
  u1: number;
}

/** A drawing as the facts stage hands it over, with the id its cell is registered under. A kind with
 *  no built cell is drawable when it brings its own beats. */
export interface P1Variant extends Pick<
  Drawing,
  "lane" | "kind" | "beats" | "codon" | "fold" | "chain" | "transcript" | "fate"
> {
  id: string;
  label?: string;
}

export interface P1Clock {
  /** Ordered and contiguous: the first opens at 0, the last closes at 1. */
  beats: P1Beat[];
  /** The whole timeline, in ms. */
  duration: number;
  /** The first u at which the opening fade has landed: rest a room here or later. */
  settledU: number;
}

const REGISTRY: Map<string, StateEntry> = new Map(STATES.map((s) => [cellKey(s), s]));

/** A built cell by name; throws with the names there are. */
export function builtEntry(cellName: string): StateEntry {
  const entry = REGISTRY.get(cellName);
  if (!entry) throw new Error(`no cell "${cellName}". Known: ${[...REGISTRY.keys()].join(", ")}`);
  return entry;
}

/** The codon lane's drawings, by the operation each performs on the reading. */
const DRAWN: Record<CodonKind, true> = {
  anchor: true,
  frameshift: true,
  "in-frame": true,
  nonsense: true,
  silent: true,
  "stop-loss": true,
  "start-loss": true,
};
const isDrawn = (kind: string): kind is CodonKind => kind in DRAWN;

/** The facts stage knows codon changes no codon drawing takes (a swapped amino acid goes to the protein lanes). */
function codonSpecimen(c: CodonRecord): CodonSpecimen {
  if (!isDrawn(c.kind)) throw new Error(`the codon lane has no drawing for a ${c.kind} change`);
  return { ...c, kind: c.kind };
}

/** Registers a variant's records and returns its entry. */
export function variantEntry(v: P1Variant): StateEntry {
  const base = REGISTRY.get(`${v.lane}--${v.kind}`);
  const beats = v.beats ?? base?.beats.slice();
  if (!beats) throw new Error(`no ${v.lane} drawing "${v.kind}" and no beats given`);
  const entry: StateEntry = {
    lane: v.lane,
    state: `v:${v.id}`,
    kind: base ? (base.kind ?? base.state) : v.kind,
    specimen: { id: v.id, label: v.label ?? v.id },
    notes: "",
    beats,
  };
  registerVariant(entry, {
    codon: v.codon && codonSpecimen(v.codon),
    transcript: v.transcript,
    fold: v.fold,
    chain: v.chain,
    fate: v.fate,
  });
  return entry;
}

/** The drawing's phases over [0, 1], from the same timeline `sample` reads, so a boundary here is the u that draws it. */
export function clockOf(entry: StateEntry): P1Clock {
  const { phases, total } = timeline(entry);
  return {
    beats: phases.map((p) => ({ name: p.beat, u0: p.at / total, u1: (p.at + p.dur) / total })),
    duration: total,
    settledU: Math.min(1, settledAt(entry) / total),
  };
}
