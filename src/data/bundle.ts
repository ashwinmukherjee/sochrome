// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The data bundle in the browser: every file in the manifest's order, the same requests for everyone.

import type { ChromData, ChromIndex, DataBundle, GeneInfo, Manifest, Rulers } from "../contracts/app";
import { CHROMS } from "../contracts/constants";
import type { TranscriptModel } from "../contracts/types";
import type { CopyNumberData } from "../spine/cnv";
import { parseGnomadWindows } from "../spine/join";
import type { KeepWindows } from "../spine/keep";
import { loadPackedTable, loadReferenceIndex } from "../spine/tables";
import { decodeFold, decodeTable } from "./columns";
import { unpack } from "./container";
import { chromFile, COPY_NUMBER, foldSection, GENES, KEEP_WINDOWS, MANIFEST, RULERS, SECTION } from "./layout";
import { getJson, inflate, Store, type Net } from "./store";

export interface BundleLoader {
  /** Begin fetching: the manifest, then every file it lists, in its order. Nothing is requested before this. */
  start(): void;
  /** The lines a reader keeps: the first file to land, so a read can begin while the rest arrives. */
  readonly keepWindows: Promise<KeepWindows>;
  readonly bundle: Promise<DataBundle>;
  /** Every file the manifest lists has arrived. */
  readonly landed: Promise<void>;
}

interface Opened {
  manifest: Manifest;
  /** A bundle file's inflated bytes, once it has landed. */
  file(path: string): Promise<ArrayBuffer>;
  /** The last file has landed. */
  all: Promise<void>;
}

/** One chromosome's tables, and its genes' folds as they were packed. */
interface Held {
  data: ChromData;
  folds: Map<string, Uint8Array>;
}

const text = (bytes: ArrayBuffer | Uint8Array): string => new TextDecoder().decode(bytes);
const json = <T>(bytes: ArrayBuffer | Uint8Array): T => JSON.parse(text(bytes)) as T;

function section(sections: Map<string, Uint8Array>, name: string, file: string): Uint8Array {
  const s = sections.get(name);
  if (!s) throw new Error(`${file} has no ${name} section`);
  return s;
}

function chromData(buf: ArrayBuffer, file: string): Held {
  const sections = unpack(buf);
  const get = (name: string) => section(sections, name, file);
  const folds = new Map<string, Uint8Array>();
  const prefix = foldSection("");
  for (const [name, bytes] of sections)
    if (name.startsWith(prefix)) folds.set(name.slice(prefix.length), bytes.slice());
  return {
    data: {
      clinvar: loadPackedTable(decodeTable(get(SECTION.clinvar))),
      gnomad: loadPackedTable(decodeTable(get(SECTION.gnomad))),
      alphamissense: loadPackedTable(decodeTable(get(SECTION.alphamissense))),
      // A buffer of its own, read from offset zero, so the file's bytes can be let go.
      reference: {
        bin: get(SECTION.reference).slice().buffer,
        index: loadReferenceIndex(text(get(SECTION.referenceIndex))),
      },
      transcripts: json<TranscriptModel[]>(get(SECTION.transcripts)),
      windows: parseGnomadWindows(text(get(SECTION.windows))),
    },
    folds,
  };
}

/** Fetch the manifest, then its files one after another, in its order. */
async function open(base: string, net: Net, onProgress?: (fraction: number) => void): Promise<Opened> {
  const manifest = await getJson<Manifest>(net, base + MANIFEST, { cache: "no-cache" });
  const store = await Store.open(base, manifest, net);
  const total = manifest.files.reduce((n, f) => n + f.bytes, 0);
  const byPath = new Map(manifest.files.map((f) => [f.path, f]));
  const landed = new Map<string, Promise<void>>();
  let got = 0;
  let before: Promise<void> = Promise.resolve();
  for (const f of manifest.files) {
    before = before.then(async () => {
      await store.land(f);
      got += f.bytes;
      onProgress?.(total ? got / total : 1);
    });
    landed.set(f.path, before);
    // A failed fetch is reported by whoever reads the file; the chain itself has no other listener.
    before.catch(() => undefined);
  }
  return {
    manifest,
    all: before,
    async file(path) {
      const f = byPath.get(path);
      if (!f) throw new Error(`the manifest lists no ${path}`);
      await landed.get(path);
      return inflate(await store.read(f));
    },
  };
}

export function bundleLoader(base: string, net: Net, onProgress?: (fraction: number) => void): BundleLoader {
  let begin: () => void = () => undefined;
  const begun = new Promise<void>((resolve) => (begin = resolve));
  const opened = begun.then(() => open(base, net, onProgress));

  const keepWindows = opened.then(async (o) =>
    json<(number[] | null)[]>(await o.file(KEEP_WINDOWS)).map((w) => (w ? Int32Array.from(w) : undefined)),
  );

  const bundle = opened.then(async (o): Promise<DataBundle> => {
    const [genes, rulers, copyNumber] = await Promise.all([
      o.file(GENES).then((b) => json<GeneInfo[]>(b)),
      o.file(RULERS).then((b) => json<Rulers>(b)),
      o.file(COPY_NUMBER).then((b) => json<CopyNumberData>(b)),
    ]);
    const chromOf = new Map(genes.map((g) => [g.symbol, (CHROMS as readonly string[]).indexOf(g.chrom)]));
    // One chromosome's tables are held at a time.
    let held: { c: ChromIndex; loading: Promise<Held> } | null = null;
    const hold = (c: ChromIndex): Promise<Held> => {
      if (held?.c !== c) {
        const file = chromFile(c);
        held = { c, loading: o.file(file).then((buf) => chromData(buf, file)) };
      }
      return held.loading;
    };
    return {
      manifest: o.manifest,
      genes,
      rulers,
      copyNumber,
      chrom: async (c) => (await hold(c)).data,
      async fold(gene) {
        const c = chromOf.get(gene);
        if (c === undefined || c < 0) throw new Error(`${gene} is not in the gene set`);
        const packed = (await hold(c)).folds.get(gene);
        if (!packed) throw new Error(`${chromFile(c)} has no fold entry for ${gene}`);
        return decodeFold(packed);
      },
    };
  });

  // Nothing listens until a reader does; a failure then reaches it through its own await.
  keepWindows.catch(() => undefined);
  bundle.catch(() => undefined);
  const landed = opened.then((o) => o.all);
  landed.catch(() => undefined);
  return { start: () => begin(), keepWindows, bundle, landed };
}
