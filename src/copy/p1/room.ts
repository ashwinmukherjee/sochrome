// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// P1's half of a room's copy: the saved lines over the drafts, filled for one finding. No DOM.

import type { ClaimCheck, Drawing, Finding, GeneInfo, RoomCopy, VariantFacts } from "../../contracts/app";
import { cellKey, STATES } from "../../render/states";
import { kinds as SAVED_KINDS, voice as SAVED_VOICE } from "../json/copy.json";
import { check } from "./claims";
import { SEED, type KindState, type Line } from "./seed";
import { context, fill, kindOf, type Voice } from "./slots";

const savedKinds = SAVED_KINDS as unknown as Record<string, KindState | undefined>;
const savedVoice = SAVED_VOICE as Record<string, { pick?: number } | undefined>;

/** The voice's live picks: the saved pick, else the first option, which is the recommended one. */
const pick = (id: string): number => savedVoice[id]?.pick ?? 0;
export const VOICE: Voice = {
  opening: pick("opening"),
  variant: pick("who") === 1 ? "your variant" : "this variant",
  numbers: pick("numbers"),
};

/** A kind's lines: the saved ones once edited or ticked, else the draft. A saved line is never reworded here. */
export function linesOf(kind: string): Line[] | undefined {
  const s = savedKinds[kind];
  if (!s || s.status === "seed") return SEED[kind];
  return s.lines.map((l) =>
    l.claims == null ? { ...l, claims: SEED[kind]?.find((d) => d.id === l.id && d.t === l.t)?.claims } : l,
  );
}

/** A kind's reading-time multiplier. */
export const scrubOf = (kind: string): number => savedKinds[kind]?.scrub ?? 1;

/** What the schedule needs of a line beyond its words and its beat: a pause, a cue word, a gap. */
export function timingOf(d: Drawing, id: string): Pick<Line, "lag" | "cue" | "gap"> {
  const l = linesOf(kindOf(d))?.find((x) => x.id === id);
  return l ? { lag: l.lag, cue: l.cue, gap: l.gap } : {};
}

const BUILT = new Map(STATES.map((s) => [cellKey(s), s.beats]));
const beatsOf = (d: Drawing): string[] => d.beats ?? BUILT.get(kindOf(d)) ?? [];

/** The job the opening may name: null for a gene with no honest line, undefined until its line is reviewed. */
const jobOf = (gene: GeneInfo | undefined): string | null | undefined => (gene?.jobReviewed ? gene.job : undefined);

export interface P1Row {
  line: Line;
  text: string;
  missing: string[];
  claims: ClaimCheck;
  /** The room drops it: the drawing has no beat of that name, or it is an entrance line that is not first. */
  noBeat: boolean;
}
export interface P1Read {
  drawing: Drawing;
  kind: string;
  tags: string[];
  /** false: no template covers this kind of drawing. */
  templated: boolean;
  rows: P1Row[];
}

/** Every line P1 shows for one variant, drawing by drawing, with what a check needs to judge it. */
export function read(facts: VariantFacts, gene: GeneInfo | undefined): P1Read[] {
  const job = jobOf(gene);
  return facts.drawings.map((drawing, i) => {
    const c = context(facts, i);
    const lines = linesOf(c.kind);
    const beats = new Set(beatsOf(drawing));
    const rows = (lines ?? [])
      .filter((l) => l.when.every((t) => c.tags.includes(t)))
      .map((line, k) => {
        const f = fill(line.t, c, job, VOICE);
        return {
          line,
          text: f.text,
          missing: f.missing,
          claims: check(line.claims, c),
          noBeat: line.beat == null ? k !== 0 : !beats.has(line.beat),
        };
      });
    return { drawing, kind: c.kind, tags: c.tags, templated: !!lines, rows };
  });
}

/** What stops a drawing's copy from being shown as written. */
export function blockers(r: P1Read): string[] {
  if (!r.templated) return [`${r.kind}: no template`];
  const shown = r.rows.filter((x) => !x.noBeat);
  if (!shown.length) return [`${r.kind}: no line covers [${r.tags.join(" ")}]`];
  return shown.flatMap((x) => [
    ...(x.missing.length ? [`${r.kind}/${x.line.id}: no ${x.missing.join(", ")}`] : []),
    ...(x.claims.untrue.length ? [`${r.kind}/${x.line.id}: untrue here: ${x.claims.untrue.join(", ")}`] : []),
  ]);
}

/** Said in P1's claim spine when there is nothing to draw or its copy can't be filled: never a raw slot. */
export const DECLINED = "We can't draw what this variant does.";

const PROD = (import.meta as { env?: { PROD?: boolean } }).env?.PROD === true;

/** P1's copy for one finding. A blocker throws in dev; in production P1 declines, and the list is empty. */
export function p1Copy(f: Finding, gene: GeneInfo | undefined): RoomCopy["p1"] {
  const reads = read(f.facts, gene);
  const bad = reads.flatMap(blockers);
  if (bad.length) {
    if (!PROD) throw new Error(`${f.facts.gene} ${f.name}: ${bad.join("; ")}`);
    return [];
  }
  return reads.map((r) => ({
    drawing: r.drawing,
    lines: r.rows
      .filter((x) => !x.noBeat)
      .map(({ line, text, claims }) => ({
        id: line.id,
        text,
        beat: line.beat,
        ...(line.at ? { at: line.at } : {}),
        claims,
      })),
  }));
}
