// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The routing's promises, re-derived from each record's raw positions and the cut signal, never from the drawing's kind.

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { GenomeResult, VariantFacts } from "../../src/contracts/app";
import { SIGNAL } from "../../src/contracts/constants";
import { dispatch } from "../../src/spine/facts/dispatch";
import { findingKey } from "../../src/spine/name";
import { clinvarInfo } from "../../src/spine/pipeline";
import { clinvarSample } from "./clinvar-sample";
import { bundleOnDisk, readSample } from "./parity";
import { PATHS, SAMPLES } from "./paths";
import { flagshipBundles } from "./regress";
import { modelFor, chromData, refGetter } from "./through";

type Side = "donor" | "acceptor";
/** The signal's letters on each side of a join; the acceptor's are all in the intron. */
const WINDOW: Record<Side, { exon: number; intron: number }> = {
  donor: SIGNAL.donor,
  acceptor: { exon: 0, intron: SIGNAL.acceptor.intron },
};
/** An intronic offset inside the signal: donor +1 to +6, acceptor −3 to −1. */
const inSignal = (side: Side, off: number) =>
  side === "donor" ? off >= 1 && off <= WINDOW.donor.intron : off <= -1 && off >= -WINDOW.acceptor.intron;

export interface InvariantReport {
  checked: number;
  problems: string[];
}

export function invariants(facts: readonly VariantFacts[]): InvariantReport {
  const report: InvariantReport = { checked: 0, problems: [] };
  for (const v of facts) {
    const fail = (what: string) => report.problems.push(`${v.gene} ${v.hgvs_c}: ${what}`);
    for (const d of v.drawings) {
      if (d.lane === "codon" && d.kind === "silent") {
        report.checked++;
        if (d.codon?.kind !== "silent") fail("a silent drawing whose codon record is not a silent one");
        // Leading, the silent drawing swaps one letter; letters that leave or arrive are drawn doing so first.
        if (d === v.drawings[0] && !/\d[ACGT]>[ACGT]$/.test(v.hgvs_c))
          fail("a silent drawing leads, but the change is not one swapped letter");
      }
      const t = d.transcript;
      if (d.kind === "double-agent") {
        report.checked++;
        if (!t || t.locusOffset !== 0 || t.locusC == null || t.junctionC == null) {
          fail("double-agent without an exonic locus and a join");
          continue;
        }
        const side: Side = t.locusC <= t.junctionC ? "donor" : "acceptor";
        const letter = side === "donor" ? t.junctionC - t.locusC + 1 : t.locusC - t.junctionC;
        if (letter > WINDOW[side].exon)
          fail(`double-agent at exon letter ${letter} on the ${side} side, outside the signal`);
        if (t.signal && (t.signal.side !== side || t.signal.letter !== letter))
          fail("the record's signal disagrees with its positions");
      }
      const j = t?.junction;
      if (!j) continue;
      report.checked++;
      const w = WINDOW[j.side];
      if (j.window.exon !== w.exon || j.window.intron !== w.intron) fail("the junction's window is not the signal's");
      const essential = j.offsets.some((o) => Math.abs(o) <= 2);
      const inside = j.offsets.some((o) => inSignal(j.side, o));
      if (j.state === "broken" && !essential) fail("broken without touching an essential letter");
      // An indel can shift letters into the signal from outside it, so only a substitution is held to its offset.
      if (j.edit === "sub" && j.state === "weakened" && !inside)
        fail("weakened, but the changed letter is outside the signal");
      if (j.edit === "sub" && j.state === "beside" && inside)
        fail("beside, but the changed letter is inside the signal");
    }
  }
  return report;
}

/** Every facts record the harness can make or find: both genomes, the flagships, 3,000 ClinVar variants, and the shipped fixtures. */
export async function everyFacts(): Promise<{ from: string; facts: VariantFacts[] }[]> {
  const out: { from: string; facts: VariantFacts[] }[] = [];
  for (const sample of SAMPLES) {
    const r = await readSample(sample);
    out.push({ from: sample, facts: [...r.yours, ...r.carriers].map((f) => f.facts) });
  }
  const data = await bundleOnDisk();
  const flagships: VariantFacts[] = [];
  for (const { joined, bundle } of await flagshipBundles()) {
    const model = await modelFor(joined.chrom, bundle.identity.transcript);
    const fold = await data.fold(bundle.identity.gene);
    const ref = refGetter(await chromData(joined.chrom));
    flagships.push(dispatch(bundle.identity, model, clinvarInfo(bundle), fold, findingKey(bundle.identity), ref));
  }
  out.push({ from: "flagships", facts: flagships });
  out.push({ from: "ClinVar selection", facts: (await clinvarSample()).facts });
  for (const file of readdirSync(PATHS.results)
    .filter((f) => f.endsWith(".result.json"))
    .sort()) {
    const r = JSON.parse(readFileSync(resolve(PATHS.results, file), "utf8")) as GenomeResult;
    out.push({ from: file, facts: [...r.yours, ...r.carriers].map((f) => f.facts) });
  }
  return out;
}
