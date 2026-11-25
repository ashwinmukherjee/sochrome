// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The 3,000 ClinVar variants of the earlier check, each read as one heterozygous record: their joins and their facts.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { VariantFacts } from "../../src/contracts/app";
import type { InheritanceMode, MendelianBundle, VcfRecord } from "../../src/contracts/types";
import { assertNoNullish, bundle, runHets, type BundleContext } from "../../src/spine/bundle";
import { dispatch } from "../../src/spine/facts/dispatch";
import { gate as coding } from "../../src/spine/gates/coding";
import { findingKey } from "../../src/spine/name";
import { clinvarInfo } from "../../src/spine/pipeline";
import { isClinVarRecord } from "../../src/spine/tables";
import { bundleOnDisk } from "./parity";
import { PATHS } from "./paths";
import { chromData, joinRecords, modelFor, refGetter } from "./through";

export interface ClinVarSample {
  variants: number;
  /** Records found in the packed table, each field equal to the selection's own reading of ClinVar's file. */
  joined: number;
  facts: VariantFacts[];
  problems: string[];
}

let made: Promise<ClinVarSample> | null = null;
export const clinvarSample = () => (made ??= sample());

async function sample(): Promise<ClinVarSample> {
  const rows = readFileSync(resolve(PATHS.bench, "scripts/clinvar-check/variants.tsv"), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split("\t"));
  const header = rows[0];
  const at = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`the ClinVar selection has no ${name} column`);
    return i;
  };
  const col = { id: at("variation_id"), chrom: at("chrom"), pos: at("pos"), ref: at("ref"), alt: at("alt"), clnsig: at("clnsig"), revstat: at("revstat"), conf: at("clnsigconf") }; // prettier-ignore
  const wanted = new Map<string, string[]>();
  const records: VcfRecord[] = rows.slice(1).map((r) => {
    const rec = { chrom: `chr${r[col.chrom]}`, pos: Number(r[col.pos]), id: r[col.id], ref: r[col.ref], alt: r[col.alt], qual: 0, filter: "PASS", info: "", gt: "0/1" }; // prettier-ignore
    wanted.set(r[col.id], r);
    return rec;
  });

  const data = await bundleOnDisk();
  const genes = new Set(data.genes.map((g) => g.symbol));
  const ctx: BundleContext = {
    object_type: "mendelian",
    sex: "unknown",
    inheritance: new Map<string, InheritanceMode[]>(data.genes.map((g) => [g.symbol, g.modes])),
    pack_date: data.manifest.pack_date,
  };
  const out: ClinVarSample = { variants: records.length, joined: 0, facts: [], problems: [] };
  for (const v of await joinRecords(records)) {
    const cv = v.clinvar;
    if (!("absent" in cv) && isClinVarRecord(cv)) {
      const row = wanted.get(String(cv.variation_id));
      if (row) {
        out.joined++;
        const conf = cv.conf ? Object.entries(cv.conf).map(([unit, n]) => `${unit}_(${n})`).join("|") : "."; // prettier-ignore
        const got = [cv.clnsig, cv.clnrevstat, conf];
        // A record with no germline classification: the file leaves both fields out, the pack names the absence.
        const named = (x: string, absence: string) => (x === "." ? absence : x);
        const want = [named(row[col.clnsig], "no_germline_classification"), named(row[col.revstat], "no_germline_review_status"), row[col.conf]]; // prettier-ignore
        if (JSON.stringify(got) !== JSON.stringify(want))
          out.problems.push(`ClinVar ${cv.variation_id}: packed ${JSON.stringify(got)}, ClinVar's file ${JSON.stringify(want)}`); // prettier-ignore
      }
    }
    if (v.gene === null || !genes.has(v.gene) || !coding(v)) continue;
    try {
      const b = bundle(v, ctx, runHets([v], [v.chrom])) as MendelianBundle;
      assertNoNullish(b);
      const model = await modelFor(v.chrom, b.identity.transcript);
      const ref = refGetter(await chromData(v.chrom));
      const fold = await data.fold(b.identity.gene);
      out.facts.push(dispatch(b.identity, model, clinvarInfo(b), fold, findingKey(b.identity), ref));
    } catch (e) {
      out.problems.push(
        `${v.gene} ${v.chrom}:${v.pos}:${v.ref}:${v.alt}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return out;
}
