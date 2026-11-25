// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Every built cell's frame builder, and the frame for one entry at one beat.

import type { StateEntry, BeatName } from "../states";
import { cellKey, STATES } from "../states";
import {
  CODON_SPECIMENS,
  TRANSCRIPT_SPECIMENS,
  FOLD_SPECIMENS,
  CHAIN_SPECIMENS,
  type CodonSpecimen,
  type TranscriptSpecimen,
  type FoldSpecimen,
  type ChainSpecimen,
} from "../specimens";
import { chainFrame } from "./chain";
import { codonFrame } from "./codon";
import { foldAnchorFrame, foldFrame } from "./fold";
import { type Frame, type StageCaption, emptyFrame } from "./marks";
import { transcriptFrame } from "./transcript";

/* ---- Dispatch ---- */

/** Each lane is one builder over its specimens, so cells are registered by iterating rather than
 *  listing: a new state needs no line here. A cell with no builder renders an empty stage. */
const codonCell = (state: string) => (beat: BeatName, entry: StateEntry) =>
  codonFrame(CODON_SPECIMENS[state], entry, beat);

const BUILDERS: Record<string, (beat: BeatName, entry: StateEntry) => Frame> = {
  ...Object.fromEntries(Object.keys(CODON_SPECIMENS).map((state) => [`codon--${state}`, codonCell(state)])),
  /** Iterates the registry, not the specimen table: the registry is the contract, the table a fixture. */
  ...Object.fromEntries(STATES.filter((s) => s.lane === "transcript").map((s) => [cellKey(s), transcriptFrame])),
  /** Registered only where a chain specimen exists. `solid-ground` is `docOnly`: it renders on
   *  the sheet, and the flag keeps it out of production dispatch. */
  ...Object.fromEntries(
    STATES.filter((s) => s.lane === "chain" && CHAIN_SPECIMENS[s.state.replace(/-[ab]$/, "")]).map((s) => [
      cellKey(s),
      chainFrame,
    ]),
  ),
  "portrait--anchor": foldAnchorFrame,
  /** The anchor keeps its own builder: it is the drawing every other portrait cell starts from. */
  ...Object.fromEntries(
    STATES.filter((s) => s.lane === "portrait" && s.state !== "anchor").map((s) => [cellKey(s), foldFrame]),
  ),
};

export const isBuilt = (entry: StateEntry): boolean => cellKey(entry) in BUILDERS;

/** A variant from facts: its records go into the specimen tables under its own state, `v:<id>`,
 *  and its cell takes its lane's builder. Re-registering an id replaces it. */
export interface VariantRecords {
  codon?: CodonSpecimen;
  transcript?: TranscriptSpecimen;
  fold?: FoldSpecimen;
  chain?: ChainSpecimen;
  /** no protein follows: the message is destroyed (NMD) or never meets a stop (a facts-stage
   *  rule). Read by the copy only; the drawing ends on its stop either way. */
  fate?: "destroyed" | "no-stop";
}

export function registerVariant(entry: StateEntry, rec: VariantRecords): void {
  const st = entry.state;
  if (rec.codon) CODON_SPECIMENS[st] = rec.codon;
  if (rec.transcript) TRANSCRIPT_SPECIMENS[st] = rec.transcript;
  if (rec.fold) FOLD_SPECIMENS[st] = rec.fold;
  if (rec.chain) CHAIN_SPECIMENS[st] = rec.chain;
  BUILDERS[cellKey(entry)] =
    entry.lane === "codon"
      ? codonCell(st)
      : entry.lane === "transcript"
        ? transcriptFrame
        : entry.lane === "chain"
          ? chainFrame
          : foldFrame;
}

/** The stage's caption at rest, at the current stage width. */
export function stageCaption(entry: StateEntry): StageCaption | null {
  return frame(entry, entry.beats[entry.beats.length - 1]).caption ?? null;
}

/** The pure function: (specimen, beat) -> geometry. No clock, no DOM. */
export function frame(entry: StateEntry, beat: BeatName): Frame {
  const b = BUILDERS[cellKey(entry)];
  return b ? b(beat, entry) : emptyFrame();
}
