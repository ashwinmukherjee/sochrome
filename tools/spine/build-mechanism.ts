// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Writes src/spine/mechanism.json from the mechanism review: which condition a variant names, and the cross genes.
// Run: npx tsx tools/spine/build-mechanism.ts

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { format } from "prettier";
import { PATHS } from "./paths";

type Group = "one" | "two" | "x";
type Kind = "truncating" | "splice" | "missense";
interface Condition {
  label: string;
  mondo: string;
  validity: string;
}
interface SourceGene {
  groups: Partial<Record<Group, { conditions: Condition[]; today: string | null; tiebreak: string | null }>>;
}
type Picks = Partial<Record<Kind | "default", string | null>>;
type Review = Picks & Partial<Record<Group, Picks>> & { class?: string; nmd?: boolean; cross?: boolean };

const json = <T>(path: string) => JSON.parse(readFileSync(path, "utf8")) as T;
const source = json<{ genes: Record<string, SourceGene> }>(
  resolve(PATHS.bench, "copy/sources/mechanism-conditions.json"),
);
const reviewed = json<Record<string, Review>>(resolve(PATHS.bench, "scripts/mechanism/reviewed.json"));
const descendants = json<Record<string, string[]>>(resolve(PATHS.bench, "scripts/mechanism/mondo-descendants.json"));

/**
 * Where the counts alone pick wrongly, the first-listed condition stays the default:
 * CASR's dominant hypocalcaemia collects the submissions for a condition filed elsewhere in MONDO.
 */
const COUNTS_MISLEAD = new Set(["CASR"]);

const KINDS: Kind[] = ["truncating", "splice", "missense"];
const out: {
  cross: string[];
  genes: Record<string, { rule: boolean; decay: boolean; groups: Partial<Record<Group, { conditions: Condition[]; fallback: string | null; picks: Partial<Record<Kind, string>> }>> }>; // prettier-ignore
  under: Record<string, string[]>;
} = { cross: [], genes: {}, under: {} };

for (const [gene, g] of Object.entries(source.genes)) {
  const rv = reviewed[gene] ?? {};
  if (rv.cross) out.cross.push(gene);
  const rule = rv.class === "a";
  const groups: (typeof out.genes)[string]["groups"] = {};
  let differs = false;
  for (const [grp, x] of Object.entries(g.groups) as [Group, NonNullable<SourceGene["groups"][Group]>][]) {
    // A reviewed word names a condition when exactly one of the group's labels holds it.
    const named = (word: string | null | undefined) => {
      if (!word) return null;
      const hits = x.conditions.filter((c) => c.label.toLowerCase().includes(word.toLowerCase()));
      return hits.length === 1 ? hits[0].mondo : null;
    };
    const spec: Picks = { ...Object.fromEntries(KINDS.filter((k) => k in rv).map((k) => [k, rv[k]])), ...rv[grp] };
    const picks: Partial<Record<Kind, string>> = {};
    for (const k of KINDS) {
      const m = named(spec[k]);
      if (m) picks[k] = m;
    }
    if (!("splice" in spec) && picks.truncating) picks.splice = picks.truncating;
    const reviewedDefault = named(rv[grp]?.default ?? rv.default);
    const fallback = reviewedDefault ?? (COUNTS_MISLEAD.has(gene) ? x.today : x.tiebreak) ?? x.today;
    if (fallback !== x.today || (rule && Object.keys(picks).length)) differs = true;
    groups[grp] = {
      conditions: x.conditions.map(({ label, mondo, validity }) => ({ label, mondo, validity })),
      fallback,
      picks: rule ? picks : {},
    };
  }
  if (!differs && !rule) continue;
  out.genes[gene] = { rule, decay: rule && rv.nmd === true, groups };
  if (rule)
    for (const x of Object.values(groups))
      for (const c of x.conditions) if (descendants[c.mondo]?.length) out.under[c.mondo] = descendants[c.mondo];
}
out.cross.sort();

const path = resolve(PATHS.root, "src/spine/mechanism.json");
writeFileSync(path, await format(JSON.stringify(out), { parser: "json", printWidth: 120 }));
console.log(`${out.cross.length} cross genes; ${Object.keys(out.genes).length} genes whose condition can differ from the first listed (${Object.values(out.genes).filter((g) => g.rule).length} by mechanism); ${Object.keys(out.under).length} conditions with narrower terms; ${readFileSync(path).length} bytes`); // prettier-ignore
