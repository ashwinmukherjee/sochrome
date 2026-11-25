// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { SHELL_JS_BUDGET_BYTES } from "../../src/contracts/constants";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { MEMORY_BUDGET_BYTES } from "../../src/contracts/constants";
import { REFERENCE_MB } from "../../src/app/landing/words";
import { chromeRead } from "../bundle/chrome-read";
import { sampleVcf } from "../spine/paths";
import type { Check, Result } from "./_check";
import { builtFiles, DIST } from "./lib/built";

/** The scripts the page loads before anything is chosen, gzipped (REBUILD §7.1b). */
const KB = 1024;
const MB = 1024 ** 2;

/** The entry script and the chunks the built page preloads with it. */
function shellScripts(html: string): string[] {
  const tags = html.match(/<(script|link)\b[^>]*>/g) ?? [];
  return tags.flatMap((tag) => {
    const entry = /^<script\b/.test(tag) && /type="module"/.test(tag) ? /src="([^"]+)"/.exec(tag)?.[1] : undefined;
    const preload =
      /^<link\b/.test(tag) && /rel="modulepreload"/.test(tag) ? /href="([^"]+)"/.exec(tag)?.[1] : undefined;
    return [entry ?? preload ?? []].flat();
  });
}

async function run(): Promise<Result> {
  const failed: string[] = [];

  const html = builtFiles().find((f) => f.path === "index.html")?.text;
  if (!html) return { ok: false, detail: "the build has no index.html" };
  const scripts = shellScripts(html);
  if (!scripts.length) failed.push("the built page loads no script to measure");
  const shell = scripts.reduce((n, src) => n + gzipSync(readFileSync(resolve(DIST, src.replace(/^\//, "")))).length, 0);
  if (shell > SHELL_JS_BUDGET_BYTES) failed.push(`the shell's scripts are ${Math.round(shell / KB)} KB gzipped`);

  // The landing says what LOAD YOUR GENOME downloads: the number has to be the data's own.
  const manifest = JSON.parse(readFileSync(resolve(DIST, "data/manifest.json"), "utf8")) as { files: { bytes: number }[] }; // prettier-ignore
  const data = manifest.files.reduce((n, f) => n + f.bytes, 0);
  if (Math.round(data / 1e7) * 10 !== REFERENCE_MB)
    failed.push(`the landing says ${REFERENCE_MB} MB of reference data; the manifest's files are ${(data / 1e6).toFixed(1)} MB`); // prettier-ignore

  // The read is measured on the worker's dev page: the worker and its messages, without the app's own drawing.
  const read = await chromeRead(sampleVcf("hg002"));
  if (read.events.at(-1)?.type !== "done") failed.push("the read did not finish");
  const longest = Math.max(0, ...read.longTasks);
  if (read.longTasks.length) failed.push(`${read.longTasks.length} long tasks on the main thread, the longest ${Math.round(longest)} ms`); // prettier-ignore
  if (read.peakBytes === 0) failed.push("memory was not measured");
  if (read.peakBytes > MEMORY_BUDGET_BYTES) failed.push(`peak memory ${Math.round(read.peakBytes / MB)} MB is over the budget`); // prettier-ignore

  const detail =
    `reference data ${(data / 1e6).toFixed(1)} MB, said as ${REFERENCE_MB}; ` +
    `shell scripts ${Math.round(shell / KB)} KB gzipped of ${SHELL_JS_BUDGET_BYTES / KB} KB (${scripts.length} files); ` +
    `${read.longTasks.length} long tasks during the read on the worker's dev page; ` +
    `peak ${Math.round(read.peakBytes / MB)} MB of ${Math.round(MEMORY_BUDGET_BYTES / MB)} MB`;
  return { ok: failed.length === 0, detail: failed.length ? `${failed.join("\n")}\n${detail}` : detail };
}

export const check: Check = {
  id: "Q3",
  title: "Budgets: shell size, long tasks during a read, the worker's peak memory, the download the landing names",
  owner: "A-reader, G",
  run,
};
