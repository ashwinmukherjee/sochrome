// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Regression: a bundle for each spike flagship, compared field by field with the first hand-checked records.

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { InheritanceMode, JoinedVariant, MendelianBundle } from "../../src/contracts/types";
import { assertNoNullish, bundle, normalizedKey, runHets, type BundleContext } from "../../src/spine/bundle";
import { parseVcf } from "../../src/spine/parse";
import { isForeclosed, JUNE_ONLY, MAPPINGS } from "./june-map";
import { bundleOnDisk } from "./parity";
import { PATHS } from "./paths";
import { joinRecords } from "./through";

const FLAGSHIPS = [
  "chr17:43124027:ACT:A",
  "chr17:43106487:A:C",
  "chr17:43099774:C:A",
  "chr17:43099773:A:C",
  "chr17:43086839:G:A",
  "chr17:43093941:T:G",
  "chr16:23636299:G:C",
  "chr16:23638093:T:C",
];

export interface RegressReport {
  records: number;
  match: number;
  differs: string[];
  juneOnly: number;
  contractOnly: number;
}

/** Every leaf of a JSON tree by dotted path; `leaf` says where to stop. */
function leaves(x: unknown, leaf: (x: unknown) => boolean, path = "", out = new Map<string, unknown>()) {
  if (leaf(x) || typeof x !== "object" || x === null) out.set(path, x);
  else for (const [k, e] of Object.entries(x)) leaves(e, leaf, path ? `${path}.${k}` : k, out);
  return out;
}

/** A bundle's leaves, its claims keyed by kind; a foreclosure is one leaf. */
function contractLeaves(b: MendelianBundle): Map<string, unknown> {
  const stop = (x: unknown) => isForeclosed(x) || Array.isArray(x);
  const { claims, ...rest } = b;
  const out = leaves(rest, stop);
  for (const { kind, ...c } of claims) leaves(c, stop, `claims.${kind}`, out);
  return out;
}

const show = (x: unknown) => (isForeclosed(x) ? `absent(${x.reason})` : JSON.stringify(x));

/** A bundle for each flagship, with the joined record it was made from. */
export async function flagshipBundles(): Promise<{ joined: JoinedVariant; bundle: MendelianBundle }[]> {
  const data = await bundleOnDisk();
  const [, spikes] = parseVcf(readFileSync(resolve(PATHS.fixtures, "spike_records.vcf"), "utf8"));
  const joined = await joinRecords(spikes);
  const ctx: BundleContext = {
    object_type: "mendelian",
    sex: "unknown",
    inheritance: new Map<string, InheritanceMode[]>(data.genes.map((g) => [g.symbol, g.modes])),
    pack_date: data.manifest.pack_date,
  };
  // Each flagship is its own run of one record: the cuts decide what reaches a list, not what can be bundled.
  return FLAGSHIPS.map((key) => {
    const v = joined.find((j) => normalizedKey(j) === key);
    if (!v) throw new Error(`flagship ${key} is not in the output`);
    return { joined: v, bundle: bundle(v, ctx, runHets([v], [v.chrom])) as MendelianBundle };
  });
}

export async function regress(): Promise<RegressReport> {
  const bundles = (await flagshipBundles()).map((f) => f.bundle);
  assertNoNullish(bundles);

  const dir = resolve(PATHS.fixtures, "june");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort(); // prettier-ignore
  const report: RegressReport = { records: files.length, match: 0, differs: [], juneOnly: 0, contractOnly: 0 };
  for (const file of files) {
    const rec = JSON.parse(readFileSync(resolve(dir, file), "utf8")) as Record<string, unknown>;
    const b = bundles.find((x) => x.claims[0].source.variation_id === Number(rec.variation_id));
    if (!b) throw new Error(`${file}: no flagship bundle joins ClinVar ${String(rec.variation_id)}`);
    const covered = new Set<string>();
    for (const [path, value] of leaves(rec, Array.isArray)) {
      const m = MAPPINGS.find((x) => x.june === path);
      if (!m) {
        if (!(path in JUNE_ONLY)) throw new Error(`${file}: field ${path} is neither mapped nor set aside`);
        report.juneOnly++;
        continue;
      }
      m.contract.forEach((c) => covered.add(c));
      const want = m.fromJune(value);
      const got = m.fromContract(b);
      if (JSON.stringify(want) === JSON.stringify(got)) report.match++;
      else report.differs.push(`${file} ${path}: ${show(want)} against ${show(got)}`);
    }
    for (const path of contractLeaves(b).keys()) if (!covered.has(path)) report.contractOnly++;
  }
  return report;
}
