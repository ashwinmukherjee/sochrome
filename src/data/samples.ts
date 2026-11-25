// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// A sample's precomputed result, and the gene set a result is read beside: fetched when the app asks.

import type { GeneInfo, Manifest, SampleFile, SampleId } from "../contracts/app";
import { GENES, MANIFEST, sampleFile } from "./layout";
import { getJson, inflate, Store, type Net } from "./store";

export const loadSample = (base: string, net: Net, id: SampleId): Promise<SampleFile> =>
  getJson<SampleFile>(net, base + sampleFile(id));

/** The gene set for the page. After a file's read it comes from the cache the read filled, with no request for it. */
export async function loadGenes(base: string, net: Net): Promise<GeneInfo[]> {
  const manifest = await getJson<Manifest>(net, base + MANIFEST, { cache: "no-cache" });
  const file = manifest.files.find((f) => f.path === GENES);
  if (!file) throw new Error(`the manifest lists no ${GENES}`);
  const store = await Store.open(base, manifest, net);
  await store.land(file);
  return JSON.parse(new TextDecoder().decode(await inflate(await store.read(file)))) as GeneInfo[];
}
