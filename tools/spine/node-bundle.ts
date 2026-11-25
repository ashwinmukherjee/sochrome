// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The data bundle read straight from the packs on disk: what the spine's harness and checks run against.

import { createReadStream, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createGunzip } from "node:zlib";
import type { ChromData, ChromIndex, FoldSource, GeneCondition, GeneInfo, Rulers } from "../../src/contracts/app";
import { CHROMS } from "../../src/contracts/constants";
import type { InheritanceMode, TranscriptModel } from "../../src/contracts/types";
import rulers from "../../src/ledger/rulers.json";
import type { ChainReason, Fold } from "../../src/spine/facts/fold";
import type { CopyNumberData } from "../../src/spine/cnv";
import { loadInheritanceMap } from "../../src/spine/funnel";
import { parseGnomadWindows } from "../../src/spine/join";
import type { SpineData } from "../../src/spine/pipeline";
import { windowsOf, type KeepWindows } from "../../src/spine/keep";
import { CLINVAR_FORMAT, loadPackedTable, loadReferenceIndex } from "../../src/spine/tables";
import { PATHS } from "./paths";

const text = (path: string) => readFileSync(path, "utf8");
const json = <T>(path: string) => JSON.parse(text(path)) as T;
const bytes = (path: string): ArrayBuffer => {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
/** A tab-separated table's rows, header dropped. */
const rows = (path: string) =>
  text(path)
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((l) => l.split("\t"));

const pack = (file: string) => resolve(PATHS.packs, file);
const chromName = (c: ChromIndex) => `chr${CHROMS[c]}`;
/** The chromosomes the packs cover: 1 to 22 and X. */
export const hasPacks = (c: ChromIndex) => existsSync(pack(`reference.${chromName(c)}.json`));

/** The reference windows of every chromosome: the lines a reader keeps. */
export function keepWindows(): KeepWindows {
  return CHROMS.map((_, c) =>
    hasPacks(c) ? windowsOf(json<{ start: number; end: number }[]>(pack(`reference.${chromName(c)}.json`))) : undefined,
  );
}

/** A chromosome's shipped reference letters, as the reader's stages get them. */
export function referenceOf(c: ChromIndex): ChromData["reference"] {
  const n = chromName(c);
  return { bin: bytes(pack(`reference.${n}.bin`)), index: loadReferenceIndex(text(pack(`reference.${n}.json`))) };
}

const RANK = ["Definitive", "Strong", "Moderate"];
const MODES: readonly string[] = ["AD", "SD", "AR", "XL"];

/** ClinGen's gene-disease validity file: each gene's best-rated condition per pattern, ties by file order. */
function conditionsByGene(): Map<string, Partial<Record<InheritanceMode, GeneCondition>>> {
  const out = new Map<string, Partial<Record<InheritanceMode, GeneCondition>>>();
  const lines = text(resolve(PATHS.raw, "clingen_gene_disease_validity.csv")).split("\n").slice(6);
  const records = lines
    .map((l) => (l.match(/"([^"]*)"/g) ?? []).map((x) => x.slice(1, -1)))
    .filter((r) => r.length >= 7 && RANK.includes(r[6]) && MODES.includes(r[4]));
  records.sort((a, b) => RANK.indexOf(a[6]) - RANK.indexOf(b[6]));
  for (const [gene, , label, mondo, moi, , validity] of records) {
    const per = out.get(gene) ?? {};
    out.set(gene, per);
    const mode = moi as InheritanceMode;
    per[mode] ??= { mondo, label, name: "", about: "", validity, reviewed: false };
  }
  return out;
}

/** ClinGen's haploinsufficiency rating per gene. */
function haploinsufficiency(): Map<string, string> {
  const lines = text(resolve(PATHS.raw, "clingen_dosage_GRCh38.tsv")).split("\n");
  const header = lines.find((l) => l.startsWith("#Gene Symbol"));
  if (!header) throw new Error("the dosage file has no header");
  const column = header.slice(1).split("\t").indexOf("Haploinsufficiency Score");
  return new Map(
    lines
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => l.split("\t"))
      .map((c) => [c[0], c[column]]),
  );
}

function optIns(): Map<string, GeneInfo["optIn"]> {
  const file = json<{ genes: { gene: string; ask: boolean; group: GeneInfo["optIn"] }[] }>(
    resolve(PATHS.bench, "copy/sources/optin-conditions.json"),
  );
  return new Map(file.genes.filter((g) => g.ask).map((g) => [g.gene, g.group]));
}

function genes(): GeneInfo[] {
  const inSet = new Set(rows(resolve(PATHS.data, "validity.tsv")).map((r) => r[0]));
  const modes = loadInheritanceMap(text(resolve(PATHS.data, "inheritance.tsv")));
  const conditions = conditionsByGene();
  const hi = haploinsufficiency();
  const optIn = optIns();
  const cutShort = json<{ format: number; lofKnown: Record<string, number> }>(pack("clinvar2.genes.json"));
  if (cutShort.format !== CLINVAR_FORMAT) throw new Error("the ClinVar gene counts are not the format the spine reads");
  return rows(resolve(PATHS.data, "genes.tsv"))
    .filter(([symbol]) => inSet.has(symbol))
    .map(([symbol, transcript, chrom, start, end]) => ({
      symbol,
      chrom: chrom.replace(/^chr/, ""),
      pos: Math.round((Number(start) + Number(end)) / 2),
      transcript,
      modes: modes.get(symbol) ?? [],
      conditions: conditions.get(symbol) ?? {},
      job: null,
      jobReviewed: false,
      dosage: { hi: hi.get(symbol) ?? null, lofKnown: cutShort.lofKnown[symbol] ?? 0 },
      optIn: optIn.get(symbol) ?? null,
    }));
}

interface FoldEntry {
  gene: string;
  uniprot: string | null;
  status: "matched" | "no-uniprot-match" | "no-alphafold-model";
  note: string;
}

/** A gene's AlphaFold model and UniProt sites, as the facts stage reads them, from the earlier spine's cache. */
function foldReader(): (gene: string) => FoldSource {
  const cache = resolve(PATHS.spine, "cache");
  const byGene = new Map(
    Object.values(json<Record<string, FoldEntry>>(resolve(cache, "fold/map.json"))).map((e) => [e.gene, e]),
  );
  return (gene) => {
    const e = byGene.get(gene);
    if (!e) return { fold: null, why: "AlphaFold not fetched for this gene", reason: "not-fetched", sites: [], sitesChecked: false }; // prettier-ignore
    if (e.status === "matched" && e.uniprot) {
      const sitesPath = resolve(cache, "sites", `${e.uniprot}.json`);
      const sitesChecked = existsSync(sitesPath);
      return {
        fold: json<Fold>(resolve(cache, "fold", `${e.uniprot}.json`)),
        why: "",
        reason: "not-fetched",
        sites: sitesChecked ? json<NonNullable<FoldSource["sites"]>>(sitesPath) : [],
        sitesChecked,
      };
    }
    const other = e.status === "no-uniprot-match";
    const reason: ChainReason = other
      ? "other-isoform"
      : /^AlphaFold model sequence/.test(e.note)
        ? "partial-model"
        : "no-model";
    const why = other ? `the MANE protein is not UniProt's canonical sequence (${e.note})` : e.note;
    return { fold: null, why, reason, sites: [], sitesChecked: false };
  };
}

/** ClinVar's release date, from the file the packs were built from. */
async function clinvarDate(): Promise<string> {
  const stream = createReadStream(resolve(PATHS.raw, "clinvar/clinvar.vcf.gz"), { end: 1 << 16 }).pipe(createGunzip());
  let head = "";
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      head += chunk.toString("utf8");
      if (head.length > 4096) break;
    }
  } catch {
    // The slice ends mid-stream; the header came out before that.
  }
  const date = /^##fileDate=(\d{4}-\d{2}-\d{2})/m.exec(head)?.[1];
  if (!date) throw new Error("ClinVar's file states no date");
  return date;
}

/** The bundle over the packs on disk. One chromosome's tables are held at a time. */
export async function nodeBundle(): Promise<SpineData> {
  const manifest = json<{ pack_date: string }>(pack("manifest.json"));
  const fold = foldReader();
  let held: { c: ChromIndex; data: ChromData } | null = null;
  return {
    manifest: { pack_date: manifest.pack_date, clinvar_date: await clinvarDate(), sources: [], files: [] },
    genes: genes(),
    rulers: rulers as Rulers,
    chrom(c) {
      if (held?.c !== c) {
        const n = chromName(c);
        const data: ChromData = {
          clinvar: loadPackedTable(bytes(pack(`clinvar2.${n}.bin`))),
          gnomad: loadPackedTable(bytes(pack(`gnomad.${n}.bin`))),
          alphamissense: loadPackedTable(bytes(pack(`alphamissense.${n}.bin`))),
          reference: {
            bin: bytes(pack(`reference.${n}.bin`)),
            index: loadReferenceIndex(text(pack(`reference.${n}.json`))),
          },
          transcripts: json<TranscriptModel[]>(pack(`transcripts.${n}.json`)),
          windows: parseGnomadWindows(text(pack(`cds_windows.${n}.bed`))),
        };
        held = { c, data };
      }
      return Promise.resolve(held.data);
    },
    fold: (gene) => Promise.resolve(fold(gene)),
    copyNumber: json<CopyNumberData>(pack("copy-number.json")),
  };
}
