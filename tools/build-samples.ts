// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The benchmark genomes read ahead of time, through the built bundle, into public/data/samples/.

import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { SampleFile, SampleId } from "../src/contracts/app";
import { bundleLoader } from "../src/data/bundle";
import { sampleFile } from "../src/data/layout";
import { readGenome } from "../src/spine/pipeline";
import { BASE, BUNDLE_DIR, diskNet } from "./bundle/disk-net";
import { SHIPPED, sampleVcf } from "./spine/paths";
import { readKept } from "./spine/read";

/** Each donor's copies of X: the benchmark files stop at chromosome 22. */
const DONOR_X: Record<SampleId, 1 | 2> = { hg003: 1, hg002: 1, hg001: 2 };

async function main(): Promise<void> {
  const loader = bundleLoader(BASE, diskNet());
  loader.start();
  const [windows, data] = await Promise.all([loader.keepWindows, loader.bundle]);
  // Named samples only, when given (tsx tools/build-samples.ts hg003): the others keep their built files.
  const named = process.argv.slice(2);
  for (const id of SHIPPED.filter((s) => !named.length || named.includes(s))) {
    const path = sampleVcf(id);
    const began = performance.now();
    const kept = await readKept(path, windows);
    const result = await readGenome(
      {
        source: { kind: "sample", id },
        displayName: id.toUpperCase(),
        lines: kept.lines,
        parsed: kept.parsed,
        leaveOut: false,
        donorX: DONOR_X[id],
        covered: kept.covered,
      },
      data,
    );
    const sample: SampleFile = { id, result, readMs: Math.round(performance.now() - began) };
    const out = resolve(BUNDLE_DIR, sampleFile(id));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(sample)}\n`);
    const c = result.counts;
    process.stdout.write(
      `${id}: ${c.all} → ${c.coding} → ${c.protein} → ${c.rare} (${c.yours} + ${c.carriers} carriers), ` +
        `${result.throws.length} throws, ${sample.readMs} ms, ${statSync(out).size} bytes\n`,
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) await main();
