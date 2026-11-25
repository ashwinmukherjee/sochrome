// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The mechanism review's own examples: each ClinVar variant read as a file's record, held to the condition the review proposed.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PATHS } from "./paths";
import { readRows, type Row } from "./proofs";

interface Example {
  clinvar: string;
  key: string;
  mech: string;
  group: "one" | "two" | "x";
  today: string;
  proposed: string;
  step: string;
}

interface LabEntry extends Omit<Example, "clinvar" | "mech"> {
  gene: string;
  zygosity: string;
  mech: string;
}

export interface MechanismReport {
  examples: number;
  /** Examples whose finding names the proposed condition. */
  agree: number;
  /** By the step that picked the condition. */
  steps: Record<string, number>;
  /** Examples that are not coding changes: no finding to name a condition for. */
  notRead: number;
  /** One lost copy of a cross gene: told under the recessive condition, which the review listed apart. */
  crossCarriers: number;
  /** Where the review kept the first-listed condition and the rule takes the one ClinVar names most: that one is named. */
  tieBreaks: number;
  problems: string[];
}

const PATTERNS = { one: ["AD", "SD"], two: ["AR"], x: ["XL"] };

export async function mechanismCases(): Promise<MechanismReport> {
  const file = JSON.parse(readFileSync(resolve(PATHS.bench, "copy/sources/mechanism-conditions.json"), "utf8")) as { examples: Record<string, Example[]>; lab: LabEntry[]; genes: Record<string, { groups: Record<string, { conditions: { mondo: string; label: string }[]; tiebreak: string }> }> }; // prettier-ignore
  const report: MechanismReport = { examples: 0, agree: 0, steps: {}, notRead: 0, crossCarriers: 0, tieBreaks: 0, problems: [] }; // prettier-ignore
  /** The condition ClinVar names most among the group's best-rated ones. */
  const mostNamed = (gene: string, group: string) => {
    const g = file.genes[gene]?.groups[group];
    return g?.conditions.find((c) => c.mondo === g.tiebreak)?.label;
  };
  const cases = [
    ...Object.entries(file.examples).flatMap(([gene, list]) => list.map((e) => ({ ...e, gene, gt: e.group === "two" ? "1/1" : "0/1", from: `ClinVar ${e.clinvar}` }))), // prettier-ignore
    ...file.lab.map((e) => ({ ...e, gt: e.zygosity === "hom" ? "1/1" : "0/1", from: "the lab's" })),
  ];
  for (const e of cases) {
    report.examples++;
    const [chrom, pos, ref, alt] = e.key.split(":");
    const row: Row = [chrom, Number(pos), ref, alt, e.gt];
    const r = await readRows([row]);
    const f = [...r.yours, ...r.carriers].find((x) => x.bundle.identity.gene === e.gene);
    const say = (what: string) => report.problems.push(`${e.gene} ${e.from} ${e.key} (${e.mech}, ${e.step}): ${what}`);
    if (!f) {
      if (r.throws.length) say(`threw: ${r.throws.map((t) => t.message).join("; ")}`);
      else report.notRead++;
      continue;
    }
    const labels = new Set(PATTERNS[e.group].map((p) => f.p23.patterns[p]?.label).filter(Boolean));
    if (labels.size === 1 && labels.has(e.proposed)) {
      report.agree++;
      report.steps[e.step] = (report.steps[e.step] ?? 0) + 1;
    } else if (e.step === "today" && labels.size === 1 && labels.has(mostNamed(e.gene, e.group) ?? "")) report.tieBreaks++;
    else if (r.carriers.includes(f) && e.group === "one" && Object.keys(f.p23.patterns).join() === "AR") report.crossCarriers++;
    else say(`names ${JSON.stringify([...labels])}, the review proposed ${JSON.stringify(e.proposed)} over ${JSON.stringify(e.today)}`); // prettier-ignore
  }
  return report;
}
