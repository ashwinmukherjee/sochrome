// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { Manifest, ReadEvent } from "../../src/contracts/app";
import { MEMORY_BUDGET_BYTES } from "../../src/contracts/constants";
import { MANIFEST } from "../../src/data/layout";
import { chromeRead } from "../bundle/chrome-read";
import { BUNDLE_DIR } from "../bundle/disk-net";
import { referenceResult } from "../bundle/node-read";
import { sampleVcf } from "../spine/paths";
import type { Check, Result } from "./_check";

const MB = 1024 ** 2;

/** What is out of order in a read's events; empty when they are as the contract lists them. */
export function disorder(events: readonly ReadEvent[]): string[] {
  const out: string[] = [];
  const types = events.map((e) => e.type);
  if (types[0] !== "start") out.push(`the first event is ${types[0]}`);
  if (types.at(-1) !== "done") out.push(`the last event is ${types.at(-1)}`);
  // The sex pair is told once the file's X is read: after the scan's last progress, before the result.
  const sex = types.indexOf("sex");
  if (sex < 0 || sex < types.lastIndexOf("progress"))
    out.push(`the sex pair is told at event ${sex}, before the scan ends`);
  if (types.filter((t) => t === "start" || t === "sex" || t === "done").length !== 3) out.push("start, sex or done more than once"); // prettier-ignore
  let bytes = 0;
  let reference = 0;
  let chrom = -1;
  let fraction = 0;
  let records = 0;
  const closed = new Set<number>();
  let closing = 0;
  for (const e of events) {
    if (e.type === "reference") {
      if (e.fraction < reference) out.push(`the reference went back from ${reference} to ${e.fraction}`);
      reference = e.fraction;
    } else if (e.type === "progress") {
      // The reader's closing progress: every byte read, after the last chromosome is done. Once, and only that.
      const total = events.find((x) => x.type === "start")?.bytesTotal;
      if (closed.has(e.chromIndex) && e.chromIndex === chrom && e.bytesRead === total && e.fraction === 1) {
        if (closing++) out.push("the closing progress came twice");
        bytes = e.bytesRead;
        continue;
      }
      if (e.chromIndex < chrom || closed.has(e.chromIndex)) out.push(`progress on chromosome index ${e.chromIndex} after ${chrom}`); // prettier-ignore
      if (e.chromIndex !== chrom) [chrom, fraction, records] = [e.chromIndex, 0, 0];
      if (e.fraction < fraction || e.fraction > 1) out.push(`chromosome index ${chrom}: fraction ${fraction} then ${e.fraction}`); // prettier-ignore
      if (e.records < records) out.push(`chromosome index ${chrom}: records ${records} then ${e.records}`);
      if (e.bytesRead < bytes) out.push(`bytes read went back from ${bytes} to ${e.bytesRead}`);
      [fraction, records, bytes] = [e.fraction, e.records, e.bytesRead];
    } else if (e.type === "chrom-done") {
      if (closed.has(e.chromIndex)) out.push(`chromosome index ${e.chromIndex} done twice`);
      if (e.chromIndex === chrom && e.records < records) out.push(`chromosome index ${chrom}: done with ${e.records} records after ${records}`); // prettier-ignore
      closed.add(e.chromIndex);
    }
  }
  if (reference !== 1) out.push(`the reference ended at ${reference}`);
  if (closing !== 1) out.push("no closing progress: the page can't tell the file has been read to its end");
  return out.slice(0, 8);
}

async function run(): Promise<Result> {
  const path = sampleVcf("hg002");
  const read = await chromeRead(path);
  const last = read.events.at(-1);
  if (last?.type !== "done") return { ok: false, detail: `the read ended with ${JSON.stringify(last).slice(0, 300)}` };
  const failed = disorder(read.events);
  const node = await referenceResult(path, statSync(path).size);
  if (JSON.stringify(last.result) !== JSON.stringify(node)) failed.push("the result differs from Node's");
  if (read.peakBytes > MEMORY_BUDGET_BYTES) failed.push(`peak memory ${Math.round(read.peakBytes / MB)} MB is over the budget`); // prettier-ignore
  if (read.peakBytes === 0) failed.push("memory was not measured");
  const manifest = JSON.parse(readFileSync(resolve(BUNDLE_DIR, MANIFEST), "utf8")) as Manifest;
  const order = [MANIFEST, ...manifest.files.map((f) => f.path)];
  if (JSON.stringify(read.asked) !== JSON.stringify(order)) failed.push(`data requests were not the manifest in order: ${read.asked.slice(0, 6).join(", ")}… (${read.asked.length})`); // prettier-ignore
  const c = last.result.counts;
  const progress = read.events.filter((e) => e.type === "progress").length;
  const detail =
    `${c.all} → ${c.coding} → ${c.protein} → ${c.rare} (${c.yours} + ${c.carriers}), same as Node; ` +
    `${Math.round(read.ms)} ms; peak ${Math.round(read.peakBytes / MB)} MB of ${Math.round(MEMORY_BUDGET_BYTES / MB)} MB; ` +
    `${progress} progress events in order; ${read.asked.length} data requests in the manifest's order`;
  return { ok: failed.length === 0, detail: failed.length ? `${failed.join("\n")}\n${detail}` : detail };
}

export const check: Check = {
  id: "S4",
  title: "The worker on HG002 in Chrome: same result as Node, under budget, progress monotonic",
  owner: "A-reader",
  run,
};
