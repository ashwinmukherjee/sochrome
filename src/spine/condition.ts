// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Which of a gene's conditions a change is about, where loss and gain of the gene cause different ones.

import type { Consequence, InheritanceMode } from "../contracts/types.ts";
import table from "./mechanism.json" with { type: "json" };

/** What a change does to the gene, as the condition rules read it. */
export type Mechanism = "truncating" | "splice" | "missense" | "other";

export function mechanismOf(c: Consequence): Mechanism {
  if (c === "stop_gained" || c === "frameshift" || c === "start_lost") return "truncating";
  if (c === "splice_donor" || c === "splice_acceptor") return "splice";
  return c === "missense" ? "missense" : "other";
}

const CROSS: ReadonlySet<string> = new Set(table.cross);

/**
 * One copy of a change that takes the gene out, in a gene whose dominant condition comes from a
 * gain or one specific change while loss causes the recessive one (GJB2, KCNJ11, RYR1, NEB): it is
 * one copy of the recessive condition, a carrier, not the dominant condition.
 */
export function isCrossCarrier(
  gene: string,
  modes: readonly InheritanceMode[],
  consequence: Consequence,
  oneCopy: boolean,
): boolean {
  const mechanism = mechanismOf(consequence);
  return oneCopy && CROSS.has(gene) && modes.includes("AR") && (mechanism === "truncating" || mechanism === "splice");
}

type Group = "one" | "two" | "x";
interface Condition {
  mondo: string;
  label: string;
  validity: string;
}
interface GeneRule {
  /** Loss and gain cause different conditions: the variant's own condition and its mechanism are read. */
  rule: boolean;
  /** Only a truncation the message does not survive takes the loss condition; one that escapes causes the other. */
  decay: boolean;
  groups: Partial<
    Record<Group, { conditions: Condition[]; fallback: string | null; picks: Partial<Record<Mechanism, string>> }>
  >;
}
const GENES: Record<string, GeneRule> = table.genes;
const UNDER: Record<string, string[]> = table.under;
const GROUP_OF: Partial<Record<string, Group>> = { AD: "one", SD: "one", AR: "two", XL: "x" };

/** The patterns a person's copies are read under, as the copy model picks them: one copy, two copies, or X. */
export function groupOf(
  chrom: string,
  patterns: readonly string[],
  zygosity: string,
  mode: string | null,
): Group | null {
  const has = (m: string) => patterns.includes(m);
  if (chrom === "X" || has("XL")) return has("XL") ? "x" : (GROUP_OF[patterns[0] ?? ""] ?? null);
  if ((zygosity === "hom" || zygosity === "compound_het_unphased") && has("AR")) return "two";
  if (has("AD") || has("SD")) return "one";
  if (has("AR")) return "two";
  return GROUP_OF[mode ?? ""] ?? null;
}

const HARMFUL = /^(Pathogenic|Likely_pathogenic|Pathogenic\/Likely_pathogenic)(,_low_penetrance)?(\||$)/;

/** The gene's curated condition a MONDO term names: itself, else the narrowest curated condition it falls under. */
function curated(g: GeneRule, mondo: string): string | null {
  let best: string | null = null;
  for (const x of Object.values(g.groups))
    for (const c of x.conditions) {
      if (c.mondo === mondo) return mondo;
      const under = UNDER[c.mondo];
      if (under?.includes(mondo) && (best === null || under.length < UNDER[best].length)) best = c.mondo;
    }
  return best;
}

export interface ConditionPick extends Condition {
  /** own: ClinVar names it for this variant. mechanism: what the change does to the gene. default: the reviewed or most-named one. */
  step: "own" | "mechanism" | "default";
}

/**
 * The condition a variant is told under, within the patterns its copies meet, or null to keep the gene's first-listed one.
 * First the variant's own: the conditions labs called it harmful for, when they name exactly one of the group's.
 * Then the mechanism, in a gene where loss and gain differ: a truncation takes the loss condition, a missense the
 * reviewed missense one. Otherwise the reviewed default, or the condition ClinVar names most.
 */
export function conditionFor(
  gene: string,
  group: Group,
  mechanism: Mechanism,
  fate: "destroyed" | "no-stop" | null,
  clnsig: string | null,
  own: readonly string[],
): ConditionPick | null {
  const g = GENES[gene];
  const x = g?.groups[group];
  if (!g || !x) return null;
  const pick = (mondo: string | null | undefined, step: ConditionPick["step"]): ConditionPick | null => {
    const c = x.conditions.find((k) => k.mondo === mondo);
    return c ? { ...c, step } : null;
  };
  const fallback = pick(x.fallback, "default");
  if (!g.rule) return fallback;
  if (clnsig !== null && HARMFUL.test(clnsig)) {
    const named = new Set(own.map((m) => curated(g, m)).filter((m) => x.conditions.some((c) => c.mondo === m)));
    if (named.size === 1) return pick([...named][0], "own");
  }
  if (g.decay && mechanism === "truncating" && fate !== "destroyed") return fallback;
  return pick(x.picks[mechanism], "mechanism") ?? fallback;
}
