// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { describe, expect, it } from "vitest";
import type { Manifest, ManifestFile } from "../contracts/app";
import { bundleLoader } from "./bundle";
import { pack, unpack } from "./container";
import { COPY_NUMBER, fetchOrder, GENES, KEEP_WINDOWS, MANIFEST, RULERS } from "./layout";
import type { Net } from "./store";

const BASE = "/data/";
const bytes = (s: string) => new TextEncoder().encode(s);

async function gzip(raw: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer> {
  return new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
}

async function listed(path: string, body: ArrayBuffer): Promise<ManifestFile> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", body));
  return { path, bytes: body.byteLength, sha256: Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("") };
}

/** A made-up bundle behind a network that writes down every address asked for. */
async function fake(): Promise<{ net: Net; asked: string[]; manifest: Manifest; bodies: Map<string, ArrayBuffer> }> {
  const contents: Record<string, string> = {
    [KEEP_WINDOWS]: JSON.stringify([[10, 20, 40, 50], null]),
    [GENES]: "[]",
    [RULERS]: JSON.stringify({ chroms: [], genomic: [], coding: [] }),
    [COPY_NUMBER]: "{}",
  };
  const bodies = new Map<string, ArrayBuffer>();
  const files: ManifestFile[] = [];
  for (const path of fetchOrder()) {
    const body = await gzip(bytes(contents[path] ?? path));
    bodies.set(path, body);
    files.push(await listed(path, body));
  }
  const manifest: Manifest = { pack_date: "2000-01-01", clinvar_date: "2000-01-01", sources: [], files };
  const asked: string[] = [];
  const net: Net = {
    fetch(url) {
      asked.push(url);
      const path = url.slice(BASE.length);
      if (path === MANIFEST) return Promise.resolve(new Response(JSON.stringify(manifest)));
      const body = bodies.get(path);
      return Promise.resolve(body ? new Response(body.slice(0)) : new Response(null, { status: 404 }));
    },
  };
  return { net, asked, manifest, bodies };
}

describe("the bundle loader", () => {
  it("asks for nothing until start()", async () => {
    const { net, asked } = await fake();
    bundleLoader(BASE, net);
    await new Promise((r) => setTimeout(r, 10));
    expect(asked).toEqual([]);
  });

  it("asks for the manifest, then every file it lists, in its order", async () => {
    const { net, asked, manifest } = await fake();
    const fractions: number[] = [];
    const loader = bundleLoader(BASE, net, (f) => fractions.push(f));
    loader.start();
    const data = await loader.bundle;
    await loader.landed;
    expect(data.manifest).toEqual(manifest);
    expect(asked).toEqual([MANIFEST, ...manifest.files.map((f) => f.path)].map((p) => BASE + p));
    expect(manifest.files.map((f) => f.path)).toEqual(fetchOrder());
    expect(asked[1]).toBe(BASE + KEEP_WINDOWS);
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
    expect(fractions.at(-1)).toBe(1);
    const windows = await loader.keepWindows;
    expect(Array.from(windows[0] ?? [])).toEqual([10, 20, 40, 50]);
    expect(windows[1]).toBeUndefined();
  });

  it("refuses a file that is not the one the manifest lists", async () => {
    const { net, bodies } = await fake();
    bodies.set(GENES, await gzip(bytes("[1]")));
    const loader = bundleLoader(BASE, net);
    loader.start();
    await expect(loader.bundle).rejects.toThrow(GENES);
  });
});

describe("the container", () => {
  it("gives back the sections it was packed with", () => {
    const packed = pack([
      ["a", Uint8Array.of(1, 2, 3)],
      ["fold/B", new Uint8Array(0)],
      ["c", Uint8Array.of(9)],
    ]);
    const sections = unpack(packed.buffer as ArrayBuffer);
    expect([...sections.keys()]).toEqual(["a", "fold/B", "c"]);
    expect(Array.from(sections.get("a") ?? [])).toEqual([1, 2, 3]);
    expect(Array.from(sections.get("c") ?? [])).toEqual([9]);
  });
});
