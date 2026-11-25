// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The copy-number test set: each ClinVar case written as a file's record, read, and held to the case's own facts.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { P23Facts } from "../../src/contracts/app";
import type { CnvFacts } from "../../src/spine/cnv";
import { gate as dosage } from "../../src/spine/gates/dosage";
import { differs } from "./parity";
import { PATHS } from "./paths";
import { readRows, xFill, type Row } from "./proofs";

type Cnv = NonNullable<P23Facts["cnv"]>;
type Case = P23Facts & { cnv: Cnv; scenario?: boolean };

export interface CnvCasesReport {
  cases: number;
  /** Cases read as a copy-number finding in their gene. */
  found: number;
  /** Cases the dosage cut holds back, by their own facts: counted as changing the protein, not listed. */
  held: number;
  /** Fields compared and equal. */
  equal: number;
  problems: string[];
}

/** What the case's ClinVar record is in ClinVar's words, not in a file's: the reader names these itself. */
const NAMED_BY_CLINVAR = ["type", "name"];

/**
 * The one difference from the test set, made on purpose. The set's one-X scenario reuses a
 * two-X record, "x1"; read from a file, a deletion on a person's only X leaves no copy.
 */
const ONE_X = { at: "cnv.copies", was: 1, now: 0 };

export async function cnvCases(): Promise<CnvCasesReport> {
  const file = JSON.parse(readFileSync(resolve(PATHS.bench, "copy/sources/cnv-cases.json"), "utf8")) as { cases: Case[] }; // prettier-ignore
  const report: CnvCasesReport = { cases: file.cases.length, found: 0, held: 0, equal: 0, problems: [] };
  for (const c of file.cases) {
    const x = c.cnv;
    const oneX = x.chrom === "X" && c.copiesX === 1;
    const gt = oneX ? "1" : c.zygosity === "hom" ? "1/1" : "0/1";
    const info = `END=${x.end};SVTYPE=${x.dir === "loss" ? "DEL" : "DUP"}`;
    const line: Row = [x.chrom, x.start - 1, "N", x.dir === "loss" ? "<DEL>" : "<DUP>", gt, "PASS", info, x.copiesStated ? x.copies : undefined]; // prettier-ignore
    const fill = x.chrom === "X" ? xFill(30, oneX ? "1" : "0/1") : [];
    const r = await readRows([line, ...fill]);
    const f = [...r.yours, ...r.carriers].find((y) => y.bundle.identity.gene === c.gene && y.p23.cnv);
    const say = (what: string) => report.problems.push(`${c.key}: ${what}`);
    if (!dosage({ ...x, codingGenes: 0 } as CnvFacts, c.dosage.lofKnown, c.clinvar?.clnsig ?? null)) {
      if (f) say("listed, though its gene's dosage in this direction is no known cause and no lab calls it harmful");
      else if (r.throws.length || !r.marks.some((m) => m[3] === 2))
        say("held back by the dosage cut, but not counted as changing the protein"); // prettier-ignore
      else report.held++;
      continue;
    }
    if (!f?.p23.cnv) {
      say(`not read as a copy-number finding (${r.throws.map((t) => t.message).join("; ") || "no finding"})`);
      continue;
    }
    report.found++;
    const want = {
      cnv: { ...x },
      clinvar: c.clinvar,
      zygosity: c.zygosity,
      consequence: c.consequence,
      hi: c.dosage.hi,
    };
    const got = { cnv: { ...f.p23.cnv }, clinvar: f.p23.clinvar, zygosity: f.p23.zygosity, consequence: f.p23.consequence, hi: f.p23.dosage.hi }; // prettier-ignore
    const gone = differs(want, JSON.parse(JSON.stringify(got))).filter(
      (d) =>
        !(d.at.startsWith("cnv.") && NAMED_BY_CLINVAR.includes(d.at.slice(4))) &&
        d.at !== "cnv.codingGenes" &&
        !(oneX && x.dir === "loss" && JSON.stringify(d) === JSON.stringify(ONE_X)),
    );
    report.equal += Object.keys(x).length - NAMED_BY_CLINVAR.length + 4 - gone.length;
    for (const d of gone) say(`${d.at}: ${JSON.stringify(d.now)}, the case has ${JSON.stringify(d.was)}`);
    const drawn = f.facts.drawings.some((d) => d.kind === "copies");
    if (drawn !== x.whole) say(x.whole ? "a whole-gene change should draw the copies" : "a partial change should not draw whole copies"); // prettier-ignore
    if (!(f.p23.cnv as Cnv & { codingGenes?: number }).codingGenes) say("no protein-coding gene count");
  }
  return report;
}
