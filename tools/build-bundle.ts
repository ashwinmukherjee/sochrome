// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Builds public/data/ from the packs: one file per chromosome, the gene set, the rulers, and the manifest that orders them.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import type { ChromIndex, GeneInfo, Manifest, ManifestFile } from "../src/contracts/app";
import { CHROMS } from "../src/contracts/constants";
import type { InheritanceMode } from "../src/contracts/types";
import { decodeFold, decodeTable, encodeFold, encodeTable } from "../src/data/columns";
import { pack } from "../src/data/container";
import {
  chromFile,
  COPY_NUMBER,
  fetchOrder,
  foldSection,
  GENES,
  KEEP_WINDOWS,
  MANIFEST,
  PACKED,
  RULERS,
  SECTION,
} from "../src/data/layout";
import rulers from "../src/ledger/rulers.json";
import thirdParty from "../src/third-party.json";
import { keepWindows, nodeBundle } from "./spine/node-bundle";
import { PATHS } from "./spine/paths";

export const OUT = resolve(PATHS.root, "public/data");
const GZIP_LEVEL = 9;

/** Text that must never be in the bundle: AlphaMissense's source header line, and SpliceAI's fields. */
const FORBIDDEN = ["CC BY-NC", "NonCommercial", "SpliceAI", "spliceai", "Pangolin"];

const json = <T>(path: string) => JSON.parse(readFileSync(path, "utf8")) as T;
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));

interface Job {
  job: string;
  source: string;
}
/** A condition's plain name, from src/copy/json/sources/conditions.json: every entry there is accepted. */
interface Condition {
  name: string;
  description: string | null;
}

/** The gene set with each gene's job line and its conditions' names: reviewed where the source record says so. */
export function described(genes: GeneInfo[]): GeneInfo[] {
  const jobs = json<Record<string, Job>>(resolve(PATHS.root, "src/copy/json/sources/gene-lines.json"));
  const conditions = json<{ names: Record<string, Condition> }>(
    resolve(PATHS.root, "src/copy/json/sources/conditions.json"),
  ).names;
  return genes.map((g) => {
    const job = jobs[g.symbol];
    const named = Object.fromEntries(
      Object.entries(g.conditions).map(([mode, c]) => {
        const known = conditions[c.mondo];
        return [mode as InheritanceMode, { ...c, name: known?.name ?? "", about: known?.description ?? "", reviewed: !!known }]; // prettier-ignore
      }),
    );
    return { ...g, conditions: named, job: job?.job || null, jobReviewed: job?.source === "reviewed" };
  });
}

/** A table on the wire, refused unless it decodes to the packed table byte for byte. */
function table(name: string, packed: Uint8Array): Uint8Array {
  // Checked before the columns scatter its text, where a forbidden word could no longer be found.
  assertClean(name, packed);
  const wire = encodeTable(packed);
  if (!Buffer.from(decodeTable(wire)).equals(packed)) throw new Error(`${name} doesn't decode to itself`);
  return wire;
}

/** A fold on the wire, refused unless it decodes to the same JSON. */
function fold(name: string, fold: unknown): Uint8Array {
  const text = JSON.stringify(fold);
  assertClean(name, Buffer.from(text));
  const wire = encodeFold(Buffer.from(text));
  if (JSON.stringify(decodeFold(wire)) !== text) throw new Error(`${name}'s fold doesn't decode to itself`);
  return wire;
}

function assertClean(name: string, bytes: Uint8Array): void {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (const word of FORBIDDEN) if (buf.includes(word)) throw new Error(`${name} carries "${word}"`);
}

async function main(): Promise<void> {
  const source = await nodeBundle();
  const genes = described(source.genes);
  const packFile = (file: string) => readFileSync(resolve(PATHS.packs, file));

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const written = new Map<string, ManifestFile>();
  const write = (path: string, raw: Uint8Array): void => {
    assertClean(path, raw);
    const gz = gzipSync(raw, { level: GZIP_LEVEL });
    writeFileSync(resolve(OUT, path), gz);
    written.set(path, { path, bytes: gz.length, sha256: createHash("sha256").update(gz).digest("hex") });
  };

  write(KEEP_WINDOWS, encode(keepWindows().map((w) => (w ? Array.from(w) : null))));
  write(GENES, encode(genes));
  write(RULERS, encode(rulers));
  write(COPY_NUMBER, packFile("copy-number.json"));

  const chromosome = async (c: ChromIndex): Promise<Uint8Array> => {
    const n = `chr${CHROMS[c]}`;
    const sections: [string, Uint8Array][] = [
      [SECTION.clinvar, table(`${n} ClinVar`, packFile(`clinvar2.${n}.bin`))],
      [SECTION.gnomad, table(`${n} gnomAD`, packFile(`gnomad.${n}.bin`))],
      [SECTION.alphamissense, table(`${n} AlphaMissense`, packFile(`alphamissense.${n}.bin`))],
      [SECTION.reference, packFile(`reference.${n}.bin`)],
      [SECTION.referenceIndex, packFile(`reference.${n}.json`)],
      [SECTION.transcripts, packFile(`transcripts.${n}.json`)],
      [SECTION.windows, packFile(`cds_windows.${n}.bed`)],
    ];
    for (const g of genes)
      if (g.chrom === CHROMS[c]) sections.push([foldSection(g.symbol), fold(g.symbol, await source.fold(g.symbol))]);
    return pack(sections);
  };
  for (const c of PACKED) {
    write(chromFile(c), await chromosome(c));
    process.stdout.write(`${chromFile(c)} ${written.get(chromFile(c))?.bytes}\n`);
  }

  const upstream = json<{ pack_date: string }>(resolve(PATHS.packs, "manifest.json"));
  const manifest: Manifest = {
    pack_date: upstream.pack_date,
    clinvar_date: source.manifest.clinvar_date,
    sources: thirdParty.data
      .filter((s) => s.shipped)
      .map(({ name, version, licence, link }) => ({ name, version, licence, link })),
    files: fetchOrder().map((path) => {
      const f = written.get(path);
      if (!f) throw new Error(`${path} is in the fetch order but was not built`);
      return f;
    }),
  };
  if (written.size !== manifest.files.length) throw new Error("a file was built that the fetch order does not list");
  writeFileSync(resolve(OUT, MANIFEST), `${JSON.stringify(manifest, null, 1)}\n`);
  const total = manifest.files.reduce((n, f) => n + f.bytes, 0);
  process.stdout.write(`${manifest.files.length} files, ${total} bytes, pack ${manifest.pack_date}, ClinVar ${manifest.clinvar_date}\n`); // prettier-ignore
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) await main();
