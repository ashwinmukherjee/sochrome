// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The suite's Node loaders: the packs, the gene tables and the fold cache, read from the archives beside this repo.

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { P23Facts } from "../../src/contracts/app";
import type { InheritanceMode, PackedTable, ReferenceIndex, TranscriptModel } from "../../src/contracts/types";
import type { FoldSource } from "../../src/spine/facts/dispatch";
import { buildModel, type GeneModel, type Piece, translate } from "../../src/spine/facts/model";
import { governingMode, loadInheritanceMap } from "../../src/spine/funnel";
import { type GnomadWindow, parseGnomadWindows } from "../../src/spine/join";
import { getRefBases, loadPackedTable, loadReferenceIndex } from "../../src/spine/tables";
import { NMD_LETTERS } from "../../src/contracts/constants";
import { ROOT } from "../checks/_check";

const NAME = ["mi", "zen"].join("");
/** The folder that holds the archives: the first one above this repo with the data packs in it. */
function archives(): string {
  for (let dir = ROOT; dir !== dirname(dir); dir = dirname(dir))
    if (existsSync(resolve(dir, `${NAME}-data/out/manifest.json`))) return dir;
  throw new Error("the data archives are not beside this repo: the suite needs the packs, the fold cache and raw/");
}
const UP = archives();
const DATA = resolve(UP, `${NAME}-data`);
const SPINE = resolve(UP, `${NAME}-spine`);
const RAW = resolve(UP, "raw");

const read = (path: string) => readFileSync(path, "utf8");
const json = <T>(path: string) => JSON.parse(read(path)) as T;
const buffer = (path: string): ArrayBuffer => {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

export const packDate = () => json<{ pack_date: string }>(resolve(DATA, "out/manifest.json")).pack_date;

export interface ChromInputs {
  refBin: ArrayBuffer;
  refIdx: ReferenceIndex;
  tx: TranscriptModel[];
  clinvar: PackedTable;
  gnomad: PackedTable;
  am: PackedTable;
  windows: GnomadWindow[];
  get: (pos: number, length: number) => string | null;
}
let held: { chrom: string; inputs: ChromInputs } | null = null;
/** One chromosome at a time: the suite walks its variants in chromosome order. */
export function inputs(chrom: string): ChromInputs {
  if (held?.chrom === chrom) return held.inputs;
  const out = (kind: string, ext: string) => resolve(DATA, `out/${kind}.chr${chrom}.${ext}`);
  const refBin = buffer(out("reference", "bin"));
  const refIdx = loadReferenceIndex(read(out("reference", "json")));
  held = {
    chrom,
    inputs: {
      refBin,
      refIdx,
      tx: json<TranscriptModel[]>(out("transcripts", "json")),
      clinvar: loadPackedTable(buffer(out("clinvar2", "bin"))),
      gnomad: loadPackedTable(buffer(out("gnomad", "bin"))),
      am: loadPackedTable(buffer(out("alphamissense", "bin"))),
      windows: parseGnomadWindows(read(out("cds_windows", "bed"))),
      get: (pos, length) => getRefBases(refBin, refIdx, pos, length),
    },
  };
  return held.inputs;
}
export function modelFor(chrom: string, transcript: string): GeneModel {
  const d = inputs(chrom);
  const t = d.tx.find((x) => x.transcript === transcript);
  if (!t) throw new Error(`no ${transcript} on chr${chrom}`);
  return buildModel(t, d.get);
}

export const genesInSet = () =>
  new Set(
    read(resolve(DATA, "validity.tsv"))
      .trim()
      .split("\n")
      .slice(1)
      .map((l) => l.split("\t")[0]),
  );
/** Every pattern a gene has. */
export const modesMap = () => loadInheritanceMap(read(resolve(DATA, "inheritance.tsv")));
/** The pattern that governs a record: two copies meet a recessive one first. */
export const governing = (modes: InheritanceMode[] | undefined, twoCopies: boolean): string | null =>
  modes && modes.length ? governingMode(modes, twoCopies) : null;

/** ClinVar's review status, in the P2/P3 model's levels. */
export const REVIEW = (r: string) =>
  /practice.guideline/.test(r)
    ? "guideline"
    : /expert.panel/.test(r)
      ? "expert"
      : /multiple.submitters, no.conflicts|multiple_submitters,_no_conflicts/.test(r)
        ? "multiple"
        : /conflicting/.test(r)
          ? "conflicting"
          : /single.submitter/.test(r)
            ? "single"
            : "none";
const CLASSES: Record<string, string> = {
  Pathogenic: "pathogenic",
  Likely_pathogenic: "likely-pathogenic",
  "Pathogenic/Likely_pathogenic": "pathogenic-likely",
  Uncertain_significance: "uncertain",
  Conflicting_classifications_of_pathogenicity: "conflicting",
  Likely_benign: "likely-benign",
  Benign: "benign",
  "Benign/Likely_benign": "benign-likely",
};
/** ClinVar's classification, in the model's classes: the part before "|" classifies, the rest qualifies. */
export const CLASS = (raw: string) => {
  const s = raw.split("|")[0];
  if (/^(VUS-(low|mid|high)|Uncertain_significance\/.*)$/.test(s)) return "uncertain";
  return CLASSES[s] ?? "other";
};
export const conflictCounts = (conf: string): Record<string, number> | null =>
  !conf || conf === "."
    ? null
    : Object.fromEntries(
        conf.split("|").map((x): [string, number] => {
          const m = /^(.*)_\((\d+)\)$/.exec(x);
          return m ? [m[1], +m[2]] : [x, 1];
        }),
      );

const RANK = ["Definitive", "Strong", "Moderate", "Limited", "Disputed", "Refuted", "No Known Disease Relationship"];
export type Patterns = Record<string, { label: string; validity: string }>;
/** Each gene's best-supported ClinGen condition per pattern, moderate or better. */
export function patternsMap(): Map<string, Patterns> {
  const rows = read(resolve(RAW, "clingen_gene_disease_validity.csv"))
    .split("\n")
    .slice(6)
    .map((l) => (l.match(/"([^"]*)"/g) ?? []).map((x) => x.slice(1, -1)))
    .filter((r) => r.length >= 7);
  const by = new Map<string, string[][]>();
  for (const r of rows) by.set(r[0], [...(by.get(r[0]) ?? []), r]);
  const out = new Map<string, Patterns>();
  for (const [gene, rs] of by) {
    const per: Patterns = {};
    for (const r of [...rs].sort((a, b) => RANK.indexOf(a[6]) - RANK.indexOf(b[6])))
      if (RANK.indexOf(r[6]) <= 2 && ["AD", "AR", "XL", "SD"].includes(r[4]) && !per[r[4]])
        per[r[4]] = { label: r[2], validity: r[6] };
    out.set(gene, per);
  }
  return out;
}

/** ClinGen's haploinsufficiency rating per gene. */
export function dosageMap(): Map<string, string> {
  const dosage = new Map<string, string>();
  const lines = read(resolve(RAW, "clingen_dosage_GRCh38.tsv")).split("\n");
  const header = lines.find((l) => l.startsWith("#Gene Symbol"));
  if (!header) throw new Error("the dosage table has no header");
  const hi = header.slice(1).split("\t").indexOf("Haploinsufficiency Score");
  for (const l of lines) {
    if (!l || l.startsWith("#")) continue;
    const c = l.split("\t");
    dosage.set(c[0], c[hi]);
  }
  return dosage;
}

/** ClinVar's harmful cut-short variants per gene: the fallback evidence that losing the gene causes disease. */
export async function lofKnownMap(genes: Set<string>): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  const query = spawn("bcftools", [
    "query",
    "-i",
    '(MC~"nonsense" || MC~"frameshift") && (CLNSIG="Pathogenic" || CLNSIG="Likely_pathogenic" || CLNSIG="Pathogenic/Likely_pathogenic")',
    "-f",
    "%INFO/GENEINFO\t%INFO/MC\n",
    resolve(RAW, "clinvar/clinvar.vcf.gz"),
  ]);
  for await (const line of createInterface({ input: query.stdout })) {
    const [gi, mc] = line.split("\t");
    const gene = gi.split("|")[0].split(":")[0];
    const first = (mc.split(",")[0] ?? "").split("|")[1] ?? "";
    if (genes.has(gene) && /nonsense|frameshift/.test(first)) m.set(gene, (m.get(gene) ?? 0) + 1);
  }
  return m;
}

/** Whether skipping a piece destroys the message: read to its first stop, against the last join moved up by the piece. */
function skipNmd(m: GeneModel, piece: Piece): boolean {
  if (piece.bp % 3 === 0 || m.lastJunctionC == null) return false;
  if (piece.cLo > m.lastJunctionC) return false;
  const aa = translate(m.orfTail.slice(0, piece.cLo - 1) + m.orfTail.slice(piece.cHi));
  if (!aa.endsWith("*")) return false;
  return m.lastJunctionC - piece.bp - aa.length * 3 > NMD_LETTERS;
}

/** P1's facts as P2's protein bar reads them, from the annotation and the gene's model. */
export function p1Lab(
  a: { consequence: string; hgvs_c: string | null; hgvs_p: string | null },
  m: GeneModel,
  pos: number,
  fate: "destroyed" | "no-stop" | null,
  terminator: number | null,
): NonNullable<P23Facts["p1"]> {
  const plen = m.protein.length;
  const at = typeof a.hgvs_p === "string" ? +((/(\d+)/.exec(a.hgvs_p) ?? [])[1] ?? NaN) : NaN;
  let skip: NonNullable<P23Facts["p1"]>["skip"] = null;
  if (/splice_(donor|acceptor)/.test(a.consequence)) {
    const gap = m.gaps.find((g) => pos >= g.gLo - 3 && pos <= g.gHi + 3);
    if (gap && gap.afterC != null) {
      const after = gap.afterC;
      const piece =
        a.consequence === "splice_donor"
          ? m.pieces.find((p) => p.cHi === after)
          : m.pieces.find((p) => p.cLo === after + 1);
      if (piece)
        skip = {
          exon: piece.exon,
          bp: piece.bp,
          inFrame: piece.bp % 3 === 0,
          share: piece.bp / m.cds.length,
          exons: m.exonCount,
          nmd: skipNmd(m, piece),
        };
    }
  }
  return {
    consequence: a.consequence,
    hgvs_c: a.hgvs_c ?? "",
    hgvs_p: typeof a.hgvs_p === "string" ? a.hgvs_p : null,
    fate,
    plen,
    runsOn: /frameshift/.test(a.consequence) && terminator != null && terminator - 1 > plen,
    lost: Number.isFinite(at) && /stop_gained|frameshift/.test(a.consequence) ? Math.max(0, 1 - at / plen) : null,
    skip,
  };
}

interface FoldMapEntry {
  status: string;
  uniprot: string | null;
  note: string;
}
export type FoldFound = FoldSource & { status: string; uniprot: string | null; note: string };
let foldMap: Record<string, FoldMapEntry | undefined> | null = null;
/** AlphaFold for one transcript, from the fold cache. */
export function foldSource(transcript: string): FoldFound {
  foldMap ??= json<Record<string, FoldMapEntry | undefined>>(resolve(SPINE, "cache/fold/map.json"));
  const me = foldMap[transcript];
  const fold =
    me?.status === "matched" && me.uniprot
      ? json<NonNullable<FoldSource["fold"]>>(resolve(SPINE, `cache/fold/${me.uniprot}.json`))
      : null;
  const why = !me
    ? "AlphaFold not fetched for this gene"
    : me.status === "no-uniprot-match"
      ? `the MANE protein is not UniProt's canonical sequence (${me.note})`
      : me.status === "no-alphafold-model"
        ? me.note
        : "";
  const reason = !me
    ? "not-fetched"
    : me.status === "no-uniprot-match"
      ? "other-isoform"
      : me.status === "no-alphafold-model"
        ? /^AlphaFold model sequence/.test(me.note)
          ? "partial-model"
          : "no-model"
        : "not-fetched";
  const sitesPath = fold ? resolve(SPINE, `cache/sites/${fold.uniprot}.json`) : "";
  const sitesChecked = !!fold && existsSync(sitesPath);
  return {
    fold,
    why,
    reason: reason as FoldSource["reason"],
    sites: sitesChecked ? json<NonNullable<FoldSource["sites"]>>(sitesPath) : [],
    sitesChecked,
    status: me?.status ?? "not-fetched",
    uniprot: me?.uniprot ?? null,
    note: me?.note ?? "",
  };
}
