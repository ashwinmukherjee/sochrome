// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The flagship check: a spiked chromosome through the stages for its counts, and each flagship's consequence and joins.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import type { ChromData } from "../../src/contracts/app";
import { annotate } from "../../src/spine/annotate";
import { checkRefLetters, referenceVerdict, type RefTally } from "../../src/spine/build";
import { normalize } from "../../src/spine/normalize";
import { parseVcf } from "../../src/spine/parse";
import { pin } from "../../src/spine/pin";
import { PATHS } from "./paths";
import { chromData, joinRecords } from "./through";

/** What the spiked chr17 gives. One record fewer than when the stages were ported: the spike's dummy second allele, which the genotype does not carry, is no record. */
const COUNTS = { lines: 101_725, records: 102_935, inWindow: 8_711, coding: 151 };

export interface FlagshipReport {
  passed: number;
  total: number;
  problems: string[];
}

/** The REF-letter check on the benchmark chromosome as written, and with every position moved as another build would. */
function referenceProblems(text: string, d: ChromData): string[] {
  const lines = text.split("\n").filter((l) => l && l[0] !== "#");
  const moved = lines.map((l) => {
    const cols = l.split("\t");
    cols[1] = String(Number(cols[1]) + 37);
    return cols.join("\t");
  });
  const asWritten = checkRefLetters(lines, d.reference);
  const elsewhere = checkRefLetters(moved, d.reference);
  const share = (t: RefTally) => `${t.matched} of ${t.checked}`;
  return [
    referenceVerdict(asWritten) === "matches"
      ? ""
      : `the benchmark's REF letters should match the reference: ${share(asWritten)}`,
    referenceVerdict(elsewhere) === "differs"
      ? ""
      : `REF letters read at the wrong positions should differ: ${share(elsewhere)}`,
    referenceVerdict(checkRefLetters(lines.slice(0, 20), d.reference)) === "undecided"
      ? ""
      : "twenty records should decide nothing",
  ].filter(Boolean);
}

/** The spiked benchmark chromosome: stage counts, the multi-allelic split, and left-alignment. */
async function stageProblems(): Promise<string[]> {
  const text = gunzipSync(readFileSync(resolve(PATHS.spine, "fixtures/chr17.spike.vcf.gz"))).toString("utf8");
  const lines = text.split("\n").filter((l) => l && l[0] !== "#" && l !== "\r").length;
  const [, records] = parseVcf(text);
  const d = await chromData("chr17");
  const refProblems = referenceProblems(text, d);
  const normalized = normalize(records, d.reference.bin, d.reference.index);
  const annotated = annotate(pin(normalized, d.transcripts), d.transcripts, d.reference.bin, d.reference.index);
  const now = {
    lines,
    records: records.length,
    inWindow: annotated.filter((v) => v.gene !== null).length,
    coding: annotated.filter((v) => v.region === "cds").length,
  };
  const problems: string[] = [...refProblems];
  if (JSON.stringify(now) !== JSON.stringify(COUNTS))
    problems.push(`stage counts ${JSON.stringify(now)} were ${JSON.stringify(COUNTS)}`);
  const split = records.filter((r) => r.pos === 43086839 && r.info === "SPIKE");
  if (split.length !== 1 || split[0].alt !== "A" || split[0].gt !== "0/1")
    problems.push(`the two-allele spike at 43086839 (G to A,T, genotype 0/1) should give the one allele carried, gave ${split.map((r) => `${r.alt} ${r.gt}`).join(", ")}`); // prettier-ignore
  const delAG = normalized.find((v) => v.original_pos === 43124029 && v.original_ref === "TCT");
  if (!delAG || delAG.pos !== 43124027 || delAG.ref !== "ACT" || delAG.alt !== "A")
    problems.push("the right-shifted c.68_69del was not left-aligned to 43124027 ACT>A");
  return problems;
}

/** Each row of flagships.tsv against the spike records' own join. */
export async function flagships(): Promise<FlagshipReport> {
  const problems = await stageProblems();
  const [header, ...rows] = readFileSync(resolve(PATHS.fixtures, "flagships.tsv"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("\t"));
  const [, spikes] = parseVcf(readFileSync(resolve(PATHS.fixtures, "spike_records.vcf"), "utf8"));
  const joined = await joinRecords(spikes);
  let passed = 0;
  for (const cells of rows) {
    const row = Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
    const label = `${row.gene} ${row.hgvs_c}`;
    const v = joined.find(
      (j) =>
        j.chrom === row.chrom &&
        j.pos === Number(row.pos_normalized) &&
        j.ref === row.ref_normalized &&
        j.alt === row.alt_normalized,
    );
    if (!v) {
      problems.push(`${label}: not in the output`);
      continue;
    }
    const cv = "absent" in v.clinvar ? null : v.clinvar;
    const got = [v.consequence, v.hgvs_c, v.hgvs_p, cv?.variation_id, cv?.clnsig, cv?.review_stars];
    const want = [row.consequence, row.hgvs_c, row.hgvs_p || null, Number(row.clinvar_varid), row.clinvar_clnsig, Number(row.clinvar_stars)]; // prettier-ignore
    if (JSON.stringify(got) === JSON.stringify(want)) passed++;
    else problems.push(`${label}: ${JSON.stringify(got)} expected ${JSON.stringify(want)}`);
  }
  return { passed, total: rows.length, problems };
}
