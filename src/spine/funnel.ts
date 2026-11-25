// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/** Funnel — apply five gates in sequence, then split carriers from survivors.
 *
 *  Gates: all → coding → changes_protein → rare → gene_validity
 *  After gate 5: split carriers (isCarrier): one altered copy in a gene with no dominant
 *  pattern, and a recessive (or, with two copies of X, an X-linked) one. */

import type { JoinedVariant, Absence, InheritanceMode } from "../contracts/types.ts";
import { gate as allGate } from "./gates/all.ts";
import { gate as codingGate } from "./gates/coding.ts";
import { gate as changesProteinGate } from "./gates/changes_protein.ts";
import { gate as rareGate } from "./gates/rare.ts";
import { gate as geneValidityGate, initValidity } from "./gates/gene_validity.ts";

function isAbsent(v: unknown): v is Absence {
  return typeof v === "object" && v !== null && "absent" in v;
}

interface FunnelResult {
  counts: { name: string; count: number }[];
  survivors: JoinedVariant[];
  carriers: JoinedVariant[];
  noModeCount: number;
}

/** Load validity gene set from TSV text. */
export function loadValiditySet(tsvText: string): Set<string> {
  const genes = new Set<string>();
  for (const line of tsvText.split(/\r?\n/)) {
    if (!line || line.startsWith("symbol")) continue;
    const symbol = line.split("\t")[0];
    if (symbol) genes.add(symbol);
  }
  return genes;
}

/** Het = exactly one alt allele, regardless of order or phase
 *  (0/1, 1/0, 0|1, 1|0). */
export function isHet(gt: string): boolean {
  const alleles = gt.split(/[\/|]/);
  if (alleles.length !== 2) return false;
  const refs = alleles.filter((a) => a === "0").length;
  const alts = alleles.filter((a) => a !== "0" && a !== ".").length;
  return refs === 1 && alts === 1;
}

const MODES: ReadonlySet<string> = new Set(["AD", "SD", "AR", "XL", "other"]);

/** Load inheritance map from TSV text: symbol → every pattern the gene has ("AD,AR" → [AD, AR]).
 *  An unknown pattern throws: a new ClinGen code must be placed, never read as recessive. */
export function loadInheritanceMap(tsvText: string): Map<string, InheritanceMode[]> {
  const map = new Map<string, InheritanceMode[]>();
  for (const line of tsvText.split(/\r?\n/)) {
    if (!line || line.startsWith("symbol")) continue;
    const parts = line.split("\t");
    if (parts.length < 2) continue;
    const modes = parts[1].split(",");
    for (const m of modes) if (!MODES.has(m)) throw new Error(`unknown inheritance mode ${m} for ${parts[0]}`);
    map.set(parts[0], modes as InheritanceMode[]);
  }
  return map;
}

/** One altered copy can cause the gene's condition. */
export function isDominant(modes: readonly InheritanceMode[]): boolean {
  return modes.includes("AD") || modes.includes("SD");
}

/** A carrier: one altered copy, in a gene where no condition is caused by one copy. Recessive,
 *  or X-linked with two copies of X. A gene with any dominant pattern never makes a carrier
 *  (BRCA1 is AD and AR: one harmful copy is a cancer risk; the recessive Fanconi anemia needs
 *  two). Two copies, or two changes in one gene with unknown phase, are never carriers either. */
export function isCarrier(modes: readonly InheritanceMode[], gt: string, twoX: boolean): boolean {
  if (!isHet(gt) || isDominant(modes)) return false;
  return modes.includes("AR") || (modes.includes("XL") && twoX);
}

/** The pattern that governs a record given how many altered copies it has: one copy reads the
 *  dominant pattern first; two copies the recessive one first (both apply, and the recessive
 *  condition is the one two copies add). */
export function governingMode(modes: readonly InheritanceMode[], twoCopies: boolean): InheritanceMode {
  const order: InheritanceMode[] = twoCopies ? ["AR", "SD", "AD", "XL"] : ["AD", "SD", "XL", "AR"];
  return order.find((m) => modes.includes(m)) ?? "other";
}

/** Run the full funnel. */
export function runFunnel(
  variants: JoinedVariant[],
  validityTsv: string,
  inheritanceTsv: string,
  isFemale: boolean = true,
): FunnelResult {
  const validGenes = loadValiditySet(validityTsv);
  initValidity(validGenes);
  const inheritance = loadInheritanceMap(inheritanceTsv);

  const gates: { name: string; fn: (v: JoinedVariant) => boolean }[] = [
    { name: "all", fn: allGate },
    { name: "coding", fn: codingGate },
    { name: "changes_protein", fn: changesProteinGate },
    { name: "rare", fn: rareGate },
    { name: "gene_validity", fn: geneValidityGate },
  ];

  const counts: { name: string; count: number }[] = [];
  let current = variants;

  for (const { name, fn } of gates) {
    current = current.filter(fn);
    counts.push({ name, count: current.length });
  }

  // Split carriers from survivors.
  // Carrier = AR gene + het, or XL gene + het in female.
  const carriers: JoinedVariant[] = [];
  const survivors: JoinedVariant[] = [];
  let noModeCount = 0;

  for (const v of current) {
    const gene = v.gene;
    if (!gene) {
      survivors.push(v);
      continue;
    }
    const modes = inheritance.get(gene);
    if (!modes) {
      noModeCount++;
      survivors.push(v);
      continue;
    }

    if (isCarrier(modes, v.gt, isFemale)) carriers.push(v);
    else survivors.push(v);
  }

  return { counts, survivors, carriers, noModeCount };
}

/** Format the survivor list for printing. */
export function formatSurvivorList(survivors: JoinedVariant[], inheritance: Map<string, InheritanceMode[]>): string {
  // Sort by chromosome and position.
  const sorted = [...survivors].sort((a, b) => {
    const chrA = a.chrom.replace("chr", "");
    const chrB = b.chrom.replace("chr", "");
    const numA = chrA === "X" ? 23 : chrA === "Y" ? 24 : parseInt(chrA);
    const numB = chrB === "X" ? 23 : chrB === "Y" ? 24 : parseInt(chrB);
    if (numA !== numB) return numA - numB;
    return a.pos - b.pos;
  });

  const lines: string[] = [];
  lines.push(
    [
      "chr",
      "pos",
      "gene",
      "hgvs_c",
      "consequence",
      "gt",
      "zygosity",
      "af_grpmax",
      "af_global",
      "gnomad_filter",
      "clinvar",
      "am_score",
    ].join("\t"),
  );

  for (const v of sorted) {
    const afStr = isAbsent(v.gnomad)
      ? `absent(${v.gnomad.reason})`
      : v.gnomad.af_grpmax === null
        ? "-"
        : v.gnomad.af_grpmax.toExponential(2);
    const afGlobalStr = isAbsent(v.gnomad) || v.gnomad.af_global === null ? "-" : v.gnomad.af_global.toExponential(2);
    const filterStr = isAbsent(v.gnomad) ? "-" : v.gnomad.filter;
    const [a1, a2] = v.gt.split(/[\/|]/);
    const zygosity = isHet(v.gt) ? "het" : a1 === a2 && a1 !== "0" && a1 !== "." ? "hom" : v.gt;

    const cvStr = isAbsent(v.clinvar)
      ? `absent(${v.clinvar.reason})`
      : `${v.clinvar.clnsig}/${v.clinvar.review_stars}★`;

    const amStr = isAbsent(v.alphamissense) ? `absent(${v.alphamissense.reason})` : v.alphamissense.score.toFixed(4);

    lines.push(
      [
        v.chrom,
        v.pos,
        v.gene ?? "-",
        v.hgvs_c ?? "-",
        v.consequence,
        v.gt,
        zygosity,
        afStr,
        afGlobalStr,
        filterStr,
        cvStr,
        amStr,
      ].join("\t"),
    );
  }

  return lines.join("\n");
}
