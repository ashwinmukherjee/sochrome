// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Parity: the two benchmark genomes through the pipeline, against the earlier spine's outputs.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Finding, GenomeResult, P23Facts } from "../../src/contracts/app";
import type { MendelianBundle } from "../../src/contracts/types";
import { readGenome, type GenomeInput, type SpineData } from "../../src/spine/pipeline";
import { keepWindows, nodeBundle } from "./node-bundle";
import { PATHS, sampleVcf, type Sample } from "./paths";
import { readKept } from "./read";

const json = <T>(path: string) => JSON.parse(readFileSync(path, "utf8")) as T;

/** One difference between the baseline and what the pipeline makes now. */
export interface Differ {
  sample: Sample;
  /** bundles, facts or p23, then the record's key, then the path inside it. */
  at: string;
  was: unknown;
  now: unknown;
}

/** Every leaf where two JSON values differ. */
export function differs(was: unknown, now: unknown, at = ""): { at: string; was: unknown; now: unknown }[] {
  if (Object.is(was, now)) return [];
  const both = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;
  if (!both(was) || !both(now) || Array.isArray(was) !== Array.isArray(now)) return [{ at, was, now }];
  const keys = new Set([...Object.keys(was), ...Object.keys(now)]);
  return [...keys].flatMap((k) => differs(was[k], now[k], at ? `${at}.${k}` : k));
}

let shared: Promise<SpineData> | null = null;
export const bundleOnDisk = () => (shared ??= nodeBundle());

/** The donors' copies of X are public; the benchmark files hold no X. */
const DONOR_X: Record<Sample, 1 | 2> = { hg002: 1, hg001: 2 };

const results = new Map<string, Promise<GenomeResult>>();
/** A sample's file through the pipeline. Run once per process, however many checks ask. */
export function readSample(sample: Sample, leaveOut = false): Promise<GenomeResult> {
  const key = `${sample}:${leaveOut}`;
  const made =
    results.get(key) ??
    (async () => {
      const kept = await readKept(sampleVcf(sample), keepWindows());
      const input: GenomeInput = {
        source: { kind: "sample", id: sample },
        displayName: sample.toUpperCase(),
        lines: kept.lines,
        parsed: kept.parsed,
        leaveOut,
        donorX: DONOR_X[sample],
        covered: kept.covered,
      };
      return readGenome(input, await bundleOnDisk());
    })();
  results.set(key, made);
  return made;
}

interface BaselineBundles {
  survivors: MendelianBundle[];
  carriers: MendelianBundle[];
  throws: { normalized_key: string; error: string }[];
}
type BaselineFacts = Record<string, unknown> & { id: string };
interface Baseline {
  bundles: BaselineBundles;
  facts: BaselineFacts[];
  p23: Record<string, P23Facts>;
}

/** The earlier spine's outputs for a sample, and the P2/P3 facts the first fixtures were made with. */
function baseline(sample: Sample): Baseline {
  const out = (kind: string) => resolve(PATHS.spine, "out", `${kind}${sample === "hg001" ? "" : `.${sample}`}.json`);
  return {
    bundles: json<BaselineBundles>(out("bundles")),
    facts: json<BaselineFacts[]>(out("facts")),
    p23: json<Record<string, P23Facts>>(resolve(PATHS.root, "tools/spine/baseline", `p23.${sample}.json`)),
  };
}

/** The record ids the earlier facts stage wrote: the sample, then the finding's key. */
function withSampleIds(x: unknown, sample: Sample, key: string): unknown {
  if (x === key) return `${sample}:${key}`;
  if (Array.isArray(x)) return x.map((e) => withSampleIds(e, sample, key));
  if (typeof x === "object" && x !== null)
    return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, withSampleIds(v, sample, key)]));
  return x;
}

/** The pipeline's result in the baseline's shapes. */
export function asBaseline(sample: Sample, r: GenomeResult): Baseline {
  const facts = (list: Finding[], group: string) =>
    list.map((f) => ({
      ...(withSampleIds(f.facts, sample, f.facts.id) as BaselineFacts),
      sample,
      group,
      zygosity: f.bundle.zygosity.state,
    }));
  return {
    bundles: {
      survivors: r.yours.map((f) => f.bundle),
      carriers: r.carriers.map((f) => f.bundle),
      throws: r.throws.map((t) => ({ normalized_key: t.key, error: t.message })),
    },
    facts: [...facts(r.yours, "survivors"), ...facts(r.carriers, "carriers")],
    p23: Object.fromEntries([...r.yours, ...r.carriers].map((f) => [f.key, f.p23])),
  };
}

/** Each record under its key, so a difference names the record and not a position in a list. */
const keyed = <T>(list: T[], key: (x: T) => string) => Object.fromEntries(list.map((x) => [key(x), x]));

/** Every difference between a sample's baseline and the pipeline's reading of the same file. */
export async function sampleDiffers(sample: Sample): Promise<Differ[]> {
  const bundleKey = (b: MendelianBundle) => `${b.identity.normalized_key}:${b.identity.gene}`;
  const shape = (x: Baseline) => ({
    bundles: {
      survivors: keyed(x.bundles.survivors, bundleKey),
      carriers: keyed(x.bundles.carriers, bundleKey),
      order: [...x.bundles.survivors, ...x.bundles.carriers].map(bundleKey),
      throws: x.bundles.throws,
    },
    facts: keyed(x.facts, (f) => f.id.replace(`${sample}:`, "")),
    p23: x.p23,
  });
  // JSON round trip: the baseline is JSON, and undefined keys are not differences.
  const now = JSON.parse(JSON.stringify(shape(asBaseline(sample, await readSample(sample))))) as unknown;
  return differs(shape(baseline(sample)), now).map((d) => ({ sample, ...d }));
}
