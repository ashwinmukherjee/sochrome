// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The facts stage against the renderer's specimens: two derivations of one fact must agree.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CHAIN_SPECIMENS, FOLD_SPECIMENS } from "../../src/render/specimens";
import { codonFacts, type CodonFacts } from "../../src/spine/facts/codon";
import { chainFacts, foldFacts, type Fold } from "../../src/spine/facts/fold";
import { revcomp, type Edit, type GeneModel, type RefGetter } from "../../src/spine/facts/model";
import { PATHS } from "./paths";
import { chromData, modelFor, refGetter } from "./through";

export interface SpecimenReport {
  ok: number;
  problems: string[];
}

type Want = Partial<Pick<CodonFacts, "kind" | "seam" | "terminator" | "trueEnd" | "netBaseDelta" | "cutCells" | "addCells" | "swapCell" | "lastCodon" | "cut" | "add">>; // prettier-ignore

const FOLD_SITES: Record<string, [string, number]> = {
  anchor: ["P38398", 61],
  "substitution-contacts": ["P38398", 61],
  "sealed-removal": ["P13569", 508],
  "insertion-bulge": ["P13569", 138],
  "stop-loss-extension": ["Q86YC2", 1186],
  registers: ["P38398", 1649],
  absent: ["P38398", 1443],
};
const CHAINS: [string, string][] = [
  ["local-failure", "Q86YC2"],
  ["loose-tails", "P04637"],
  ["solid-ground", "P38398"],
];

export async function specimens(): Promise<SpecimenReport> {
  const report: SpecimenReport = { ok: 0, problems: [] };
  const eq = (label: string, got: unknown, want: unknown) => {
    if (JSON.stringify(got) === JSON.stringify(want)) report.ok++;
    else report.problems.push(`${label}: ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  };

  const genes: [string, string, string][] = [
    ["BRCA1", "chr17", "NM_007294.4"],
    ["BRCA2", "chr13", "NM_000059.4"],
    ["CFTR", "chr7", "NM_000492.4"],
    ["PALB2", "chr16", "NM_024675.4"],
  ];
  const model: Record<string, GeneModel> = {};
  const ref: Record<string, RefGetter> = {};
  for (const [gene, chrom, transcript] of genes) {
    model[gene] = await modelFor(chrom, transcript);
    ref[gene] = refGetter(await chromData(chrom));
  }
  const { BRCA1, BRCA2, CFTR, PALB2 } = model;

  // Edits named by coding coordinates, built on the model's own map.
  const g = (m: GeneModel, c: number) => m.gpos[c - 1];
  const bases = (m: GeneModel, pos: number, n: number) => {
    const b = ref[m.symbol](pos, n);
    if (b == null) throw new Error(`${m.symbol}: no reference at ${pos}`);
    return b;
  };
  const delC = (m: GeneModel, lo: number, hi: number): Edit => {
    const p = Math.min(g(m, lo), g(m, hi));
    return { pos: p, ref: bases(m, p, Math.abs(g(m, hi) - g(m, lo)) + 1), alt: "" };
  };
  const insC = (m: GeneModel, after: number, sense: string): Edit =>
    m.strand === "+"
      ? { pos: g(m, after) + 1, ref: "", alt: sense }
      : { pos: g(m, after), ref: "", alt: revcomp(sense) };
  const subC = (m: GeneModel, c: number, sense: string): Edit => ({
    pos: g(m, c),
    ref: bases(m, g(m, c), 1),
    alt: m.strand === "+" ? sense : revcomp(sense),
  });

  eq("BRCA1 CDS length", BRCA1.cds.length, 5592);
  eq(
    "BRCA1 coding pieces",
    BRCA1.pieces.map((p) => p.bp),
    [80, 54, 78, 89, 140, 106, 46, 77, 3426, 89, 172, 127, 191, 311, 88, 78, 41, 84, 55, 74, 61, 125],
  );
  eq("BRCA1 residues", BRCA1.protein.length, 1863);
  eq("BRCA2 residues", BRCA2.protein.length, 3418);
  eq("CFTR residues", CFTR.protein.length, 1480);
  eq("PALB2 residues", PALB2.protein.length, 1186);

  const codon = (label: string, m: GeneModel, e: Edit, want: Want) => {
    const f = codonFacts(m, e);
    if (!f) report.problems.push(`${label}: no facts`);
    else for (const k of Object.keys(want) as (keyof Want)[]) eq(`${label} ${k}`, f[k], want[k]);
  };
  const none = { trueEnd: null, cutCells: [], addCells: [], swapCell: null };
  codon("BRCA1 c.68_69del", BRCA1, delC(BRCA1, 68, 69), { ...none, kind: "frameshift", seam: 23, terminator: 39, netBaseDelta: -2, cutCells: [2, 3], lastCodon: 1864, cut: { start: 68, n: 2 } }); // prettier-ignore
  codon("BRCA1 c.5266dup", BRCA1, insC(BRCA1, 5266, BRCA1.orfTail[5265]), { ...none, kind: "frameshift", seam: 1756, terminator: 1829, netBaseDelta: 1, addCells: [2], lastCodon: 1864, add: { after: 5266, n: 1 } }); // prettier-ignore
  codon("BRCA1 c.4308T>C", BRCA1, subC(BRCA1, 4308, "C"), { ...none, kind: "silent", seam: 1436, terminator: null, netBaseDelta: 0, swapCell: 3, lastCodon: 1864 }); // prettier-ignore
  codon("BRCA2 c.9976A>T", BRCA2, subC(BRCA2, 9976, "T"), { ...none, kind: "nonsense", seam: 3326, terminator: 3326, netBaseDelta: 0, swapCell: 1, lastCodon: 3419 }); // prettier-ignore
  codon("CFTR c.1521_1523del", CFTR, delC(CFTR, 1521, 1523), { ...none, kind: "in-frame", seam: 508, terminator: null, netBaseDelta: -3, lastCodon: 1481 }); // prettier-ignore
  codon("CFTR c.413_415dup", CFTR, insC(CFTR, 415, CFTR.cds.slice(412, 415)), { ...none, kind: "in-frame", seam: 139, terminator: null, netBaseDelta: 3, lastCodon: 1481 }); // prettier-ignore
  codon("PALB2 c.3559T>C", PALB2, subC(PALB2, 3559, "C"), { ...none, kind: "stop-loss", seam: 1187, terminator: 1192, trueEnd: 1187, netBaseDelta: 0, swapCell: 1 }); // prettier-ignore

  // The portrait and chain arithmetic on the folds the specimens were made from, then on the bundle's own.
  const load = (dir: string, acc: string): Fold | null => {
    const p = resolve(dir, `${acc}.json`);
    return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Fold) : null;
  };
  const first = resolve(PATHS.render, "reference/fixtures/fold");
  const today = resolve(PATHS.spine, "cache/fold");
  for (const [state, [acc, site]] of Object.entries(FOLD_SITES)) {
    const want = FOLD_SPECIMENS[state];
    for (const dir of [first, today]) {
      const fold = load(dir, acc);
      if (!fold || !want) {
        report.problems.push(`${state}: no fold ${acc} or no specimen`);
        continue;
      }
      const f = foldFacts(fold, site);
      eq(`${state} window`, [f.start, f.end, f.markIdx], [want.start, want.end, want.markIdx]);
      if (dir !== first) continue;
      eq(`${state} contacts`, f.contacts, want.contacts);
      eq(`${state} pLDDT`, f.plddt, want.plddt);
      eq(`${state} explained variance`, f.evr, want.evr);
      const shift = Math.max(...f.points.map((p, i) => Math.hypot(p[0] - want.points[i][0], p[1] - want.points[i][1])));
      eq(`${state} points within 0.002`, shift <= 0.002, true);
    }
  }
  for (const [state, acc] of CHAINS) {
    const want = CHAIN_SPECIMENS[state];
    const fold = load(first, acc);
    if (!fold) {
      report.problems.push(`${state}: no fold ${acc}`);
      continue;
    }
    const c = chainFacts(fold, want.gene, fold.length, want.site, "", "low-confidence");
    eq(`${state} length`, c.length, want.length);
    eq(`${state} pLDDT`, c.plddt, want.plddt);
  }
  const cut = chainFacts(null, "BRCA2", 3418, 3325, "AlphaFold DB has no P51587 entry", "no-model", 3325);
  eq("truncated, unmapped", [cut.unmapped, cut.length, cut.lastResidue, cut.plddt.length, cut.reason], [true, 3418, 3325, 0, "no-model"]); // prettier-ignore
  return report;
}
