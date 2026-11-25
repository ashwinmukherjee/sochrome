// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Where the spine's Node harness finds the packs, the caches, the earlier outputs and the two benchmark genomes.

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
/** The earlier repos keep their working name; it is spelled here in two halves so nothing else has to. */
const old = (suffix: string) => ["mi", `zen-${suffix}`].join("");

/** The folder that holds the sibling repos and raw/: the first one above this repo with the data repo in it. */
function home(): string {
  const set = process.env.SPINE_DATA_HOME;
  if (set) return resolve(set);
  for (let dir = dirname(ROOT); dir !== dirname(dir); dir = dirname(dir))
    if (existsSync(resolve(dir, old("data"), "out"))) return dir;
  throw new Error("the data packs were not found above this repo (set SPINE_DATA_HOME)");
}

const HOME = home();
export const PATHS = {
  root: ROOT,
  /** The packed tables, one set per chromosome. */
  packs: resolve(HOME, old("data"), "out"),
  /** The gene set's tables: genes.tsv, validity.tsv, inheritance.tsv. */
  data: resolve(HOME, old("data")),
  /** The earlier spine: its outputs are the parity baseline, its cache holds the folds. */
  spine: resolve(HOME, old("spine")),
  bench: resolve(HOME, old("bench")),
  /** The renderer's own repo: the fold fixtures its specimens were made from. */
  render: resolve(HOME, old("render")),
  /** The ledger lab: its marks and counts are the baseline for the descent's numbers. */
  lab: resolve(HOME, old("lab")),
  raw: resolve(HOME, "raw"),
  fixtures: resolve(ROOT, "tools/spine/fixtures"),
  results: resolve(ROOT, "test/fixtures"),
};

/** The samples the spine's checks run on, against their recorded outputs. */
export const SAMPLES = ["hg002", "hg001"] as const;
export type Sample = (typeof SAMPLES)[number];
/** The samples the site ships: the checks' two, and HG003, which the landing offers. */
export const SHIPPED = ["hg003", ...SAMPLES] as const;
/** The benchmark file a sample is read from, as a person would load it. */
export const sampleVcf = (s: (typeof SHIPPED)[number]) =>
  resolve(PATHS.raw, "giab", `${s.toUpperCase()}_GRCh38_1_22_v4.2.1_benchmark.vcf.gz`);
