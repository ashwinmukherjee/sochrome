// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The only place a request is made or a cache is touched: bundle files, fetched once and kept while they stand.

import type { Manifest, ManifestFile } from "../contracts/app";

/** The network and the cache, passed in so a tool or a test can stand in for the browser's. */
export interface Net {
  fetch(url: string, init?: RequestInit): Promise<Response>;
  caches?: CacheStorage;
}

export const browserNet = (): Net => ({
  fetch: (url, init) => fetch(url, init),
  caches: typeof caches === "undefined" ? undefined : caches,
});

const CACHE_PREFIX = "pack-";

const hex = (buf: ArrayBuffer): string => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join(""); // prettier-ignore

/** A fetched file must be the one the manifest lists, byte for byte. */
async function verify(file: ManifestFile, buf: ArrayBuffer): Promise<void> {
  if (buf.byteLength !== file.bytes) throw new Error(`${file.path}: ${buf.byteLength} bytes, the manifest lists ${file.bytes}`); // prettier-ignore
  if (hex(await crypto.subtle.digest("SHA-256", buf)) !== file.sha256) throw new Error(`${file.path}: not the file the manifest lists`); // prettier-ignore
}

export async function getJson<T>(net: Net, url: string, init?: RequestInit): Promise<T> {
  const res = await net.fetch(url, init);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export class Store {
  /** Files held here when there is no cache to keep them in. */
  private readonly memory = new Map<string, ArrayBuffer>();

  private constructor(
    private readonly base: string,
    private readonly net: Net,
    private readonly cache: Cache | null,
  ) {}

  /**
   * Open the cache for this manifest's files and delete every other. It is named by the files' own digests,
   * so a file built anew under the same pack date is fetched again, never read stale from the cache.
   */
  static async open(base: string, manifest: Manifest, net: Net): Promise<Store> {
    let cache: Cache | null = null;
    if (net.caches) {
      const files = new TextEncoder().encode(manifest.files.map((f) => f.sha256).join());
      const name = CACHE_PREFIX + hex(await crypto.subtle.digest("SHA-256", files)).slice(0, 16);
      try {
        for (const k of await net.caches.keys())
          if (k.startsWith(CACHE_PREFIX) && k !== name) await net.caches.delete(k);
        cache = await net.caches.open(name);
      } catch {
        // Storage refused (a private window): the files are held in memory for this visit instead.
      }
    }
    return new Store(base, net, cache);
  }

  /** Make `file` readable. Nothing is requested when the cache already holds it. */
  async land(file: ManifestFile): Promise<void> {
    const url = this.base + file.path;
    if (this.memory.has(file.path) || (await this.cache?.match(url))) return;
    // Revalidated whatever the host says: a file kept past its pack would not be the one the manifest lists.
    const res = await this.net.fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`${file.path}: HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    await verify(file, buf);
    if (this.cache) {
      try {
        await this.cache.put(url, new Response(buf));
        return;
      } catch {
        // Over the storage quota: held in memory for this visit instead.
      }
    }
    this.memory.set(file.path, buf);
  }

  /** A landed file's bytes, as fetched. */
  async read(file: ManifestFile): Promise<ArrayBuffer> {
    const held = this.memory.get(file.path);
    if (held) return held;
    const hit = await this.cache?.match(this.base + file.path);
    if (!hit) throw new Error(`${file.path} was read before it was fetched`);
    return hit.arrayBuffer();
  }
}

export async function inflate(gz: ArrayBuffer): Promise<ArrayBuffer> {
  return new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
}
