// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The spine's behaviours proven on made-up records: each proof reads a few lines as a file and says what is wrong.

import type { Finding, GenomeResult } from "../../src/contracts/app";
import { CHROM_X, CHROMS, CNV_MANY_GENES } from "../../src/contracts/constants";
import type { CnvFacts } from "../../src/spine/cnv";
import { isKept, recordsIn, scanLine, type Covered } from "../../src/spine/keep";
import { parseLine } from "../../src/spine/parse";
import { readGenome } from "../../src/spine/pipeline";
import { context } from "../../src/copy/p23/model";
import { p23Copy } from "../../src/copy/p23/room";
import { copiesOfX, inPar, tallyX } from "../../src/spine/sex";
import { keepWindows, referenceOf } from "./node-bundle";
import { getRefBases } from "../../src/spine/tables";
import { bundleOnDisk } from "./parity";

/** A made-up record: chromosome, position, REF, ALT, genotype; then FILTER, INFO and a stated copy number where it has them. */
export type Row = [
  chrom: string,
  pos: number,
  ref: string,
  alt: string,
  gt: string,
  filter?: string,
  info?: string,
  cn?: number,
];

const line = ([chrom, pos, ref, alt, gt, filter, info, cn]: Row) =>
  `chr${chrom}\t${pos}\t.\t${ref}\t${alt}\t.\t${filter ?? "PASS"}\t${info ?? "."}\t${cn === undefined ? "GT" : "GT:CN"}\t${cn === undefined ? gt : `${gt}:${cn}`}`;

/** Made-up records read as one person's file, scanned and kept as the reader does. */
export async function readRows(rows: readonly Row[], leaveOut = false): Promise<GenomeResult> {
  const lines: string[][] = CHROMS.map(() => []);
  const parsed = CHROMS.map(() => 0);
  const covered: Covered[] = CHROMS.map(() => ({ bases: 0, blocks: 0 }));
  const windows = keepWindows();
  for (const row of rows) {
    const c = (CHROMS as readonly string[]).indexOf(row[0]);
    const text = line(row);
    const b = Buffer.from(text);
    const verdict = scanLine(b, 0, b.length, windows[c], covered[c]);
    parsed[c] += recordsIn(verdict);
    if (isKept(verdict)) lines[c].push(text);
  }
  return readGenome(
    {
      source: { kind: "file", name: "made-up.vcf", bytes: 0 },
      displayName: "made-up",
      parsed,
      lines,
      leaveOut,
      covered,
    },
    await bundleOnDisk(),
  );
}

type Say = (ok: boolean, what: string) => void;
interface Proof {
  name: string;
  run: (say: Say) => Promise<void> | void;
}

const all = (r: GenomeResult): Finding[] => [...r.yours, ...r.carriers];
const inGene = (list: Finding[], gene: string) => list.filter((f) => f.bundle.identity.gene === gene);

/** The three X-linked variants of the x-one fixture. */
const X_ONE: [number, string, string, string][] = [
  [31180394, "A", "T", "DMD"],
  [22190447, "G", "A", "PHEX"],
  [153725495, "T", "TGGCTCCTGC", "ABCD1"],
];
/**
 * X records the reader keeps and no cut passes, outside the pseudoautosomal regions: they only say how X
 * was called. Each sits ten letters into a reference window, well short of its coding sequence, and names
 * the reference's own letter there as REF, as a real file's records do (the reader leaves out one that doesn't).
 */
export function xFill(n: number, gt: string, skip = 0): Row[] {
  const w = keepWindows()[CHROM_X];
  if (!w) throw new Error("no windows for X");
  const { bin, index } = referenceOf(CHROM_X);
  const starts: number[] = [];
  for (let i = 0; i < w.length; i += 2) if (!inPar(w[i]) && w[i + 1] - w[i] > 150) starts.push(w[i] + 10);
  if (starts.length < skip + n) throw new Error("too few X windows for the made-up records");
  return starts.slice(skip, skip + n).map((pos): Row => {
    const ref = getRefBases(bin, index, pos, 1);
    if (!ref) throw new Error(`no reference letter at X:${pos}`);
    return ["X", pos, ref, ref === "G" ? "A" : "G", gt];
  });
}

const PROOFS: Proof[] = [
  {
    name: "a row whose REF isn't the reference's is left out",
    run: async (say) => {
      const [pos, ref, alt, gene] = X_ONE[0];
      const fill = [...xFill(20, "0/1"), ...xFill(20, "1/1", 20)];
      const right = await readRows([["X", pos, ref, alt, "0/1"], ...fill]);
      say(inGene(all(right), gene).length === 1, `${gene} with the reference's REF should be one finding`);
      const other = ref === "C" ? "G" : "C";
      const wrong = await readRows([["X", pos, other, alt, "0/1"], ...fill]);
      say(inGene(all(wrong), gene).length === 0, `${gene} with REF ${other} should not be read`);
      say(
        wrong.throws.some((t) => t.message.startsWith(`REF ${other} where the reference reads ${ref}`)),
        "the row left out should be noted",
      );
    },
  },
  {
    name: "sex from X: the tally's rule",
    run: (say) => {
      const of = (single: number, het: number, hom: number) => copiesOfX({ single, het, hom });
      say(of(0, 0, 0) === null, "no X records should read as null");
      say(of(3, 0, 0) === 1, "one-allele calls should read as one copy");
      say(of(0, 2, 38) === 1, "5% heterozygous should read as one copy");
      say(of(0, 20, 20) === 2, "50% heterozygous should read as two copies");
      say(of(0, 10, 30) === null, "25% heterozygous should not be decided");
      say(of(0, 0, 19) === null, "19 two-allele records should not be decided");
      const par = tallyX([{ pos: 1_000_000, gt: "0/1" }, { pos: 155_800_000, gt: "0/1" }, { pos: 5_000_000, gt: "./." }, { pos: 5_000_000, gt: "0/0" }]); // prettier-ignore
      say(
        par.het + par.hom + par.single === 0,
        "pseudoautosomal, uncalled and reference records should not be counted",
      );
    },
  },
  {
    name: "sex from X: the x-one fixture's variants, called with one allele",
    run: async (say) => {
      const r = await readRows([...X_ONE.map(([pos, ref, alt]): Row => ["X", pos, ref, alt, "1"]), ...xFill(30, "1")]);
      say(r.copiesX === 1, `copiesX ${r.copiesX}, expected 1`);
      say(r.parsed[CHROM_X] === 33, "X's record count is wrong");
      for (const [, , , gene] of X_ONE) {
        const [f, ...more] = inGene(r.yours, gene);
        say(!!f && !more.length, `${gene} should be one finding in the first list`);
        say(f?.bundle.zygosity.state === "hemi", `${gene} should be read as the only copy`);
        say(f?.p23.copiesX === 1, `${gene}'s P3 facts should carry one copy of X`);
      }
      say(r.throws.length === 0, `threw: ${r.throws.map((t) => t.message).join("; ")}`);
    },
  },
  {
    name: "sex from X: one copy called with two alleles",
    run: async (say) => {
      const r = await readRows([...X_ONE.map(([pos, ref, alt]): Row => ["X", pos, ref, alt, "1/1"]), ...xFill(40, "1/1"), ...xFill(2, "0/1", 40)]); // prettier-ignore
      say(r.copiesX === 1, `copiesX ${r.copiesX}, expected 1`);
      say(all(r).length === 3 && all(r).every((f) => f.bundle.zygosity.state === "hemi"), "the three should be read as the only copy"); // prettier-ignore
    },
  },
  {
    name: "sex from X: two copies",
    run: async (say) => {
      const r = await readRows([["X", 31180394, "A", "T", "0/1"], ...xFill(20, "0/1"), ...xFill(20, "1/1", 20)]);
      say(r.copiesX === 2, `copiesX ${r.copiesX}, expected 2`);
      const [f] = inGene(all(r), "DMD");
      say(f?.bundle.zygosity.state === "het" && f.bundle.zygosity.flags.length === 0, "DMD should be one of two copies, unflagged"); // prettier-ignore
      say(
        inGene(r.carriers, "DMD").length === 1,
        "one changed copy of an X-linked gene, with two X, should be a carrier",
      );
    },
  },
  {
    name: "sex from X: a file with no X, and an X that does not say",
    run: async (say) => {
      const none = await readRows([["17", 43106487, "A", "C", "0/1"]]);
      say(none.copiesX === null, `no X: copiesX ${none.copiesX}, expected null`);
      const few = await readRows([["X", 31180394, "A", "T", "1/1"]]);
      say(few.copiesX === null, `one X record: copiesX ${few.copiesX}, expected null`);
      const [f] = inGene(all(few), "DMD");
      say(!!f?.bundle.zygosity.flags.includes("sex_unknown"), "an X finding read without knowing X should be flagged");
    },
  },
  {
    name: "sex from X: a male file recorded as two matching copies, too few to decide, is never told two",
    run: async (say) => {
      // Callers often write one X as 1/1. With too few X records to decide, P3 must not assume two copies.
      const r = await readRows(X_ONE.map(([pos, ref, alt]): Row => ["X", pos, ref, alt, "1/1"]));
      say(r.copiesX === null, `copiesX ${r.copiesX}, expected null`);
      for (const [, , , gene] of X_ONE) {
        const [f] = inGene(all(r), gene);
        say(f?.p23.copiesX === null, `${gene}'s P3 facts should leave X undecided`);
        if (!f) continue;
        const kind = context(f.p23).p3;
        say(!["one-x", "two-x", "two-copies"].includes(kind), `${gene} reads as ${kind}, which assumes a number of X`);
        const lines = p23Copy(f, undefined).p3.lines.join(" ");
        say(!/two copies of X|Both of your copies/.test(lines), `${gene}'s P3 says a number of X: ${lines}`);
      }
    },
  },
  {
    name: "the leave-out: the opt-in genes are dropped before anything is read",
    run: async (say) => {
      // BRCA1 C61G is in an opt-in gene; CFTR c.413_415dup is not.
      const rows: Row[] = [["17", 43106487, "A", "C", "0/1"], ["7", 117531036, "C", "CCTA", "0/1"]]; // prettier-ignore
      const data = await bundleOnDisk();
      const optIn = data.genes.filter((g) => g.optIn !== null).length;
      say(optIn === 145, `${optIn} opt-in genes, expected 145`);
      const read = await readRows(rows);
      say(read.checked.genes === data.genes.length && read.checked.leftOut === 0, "without the leave-out every gene should be read"); // prettier-ignore
      say(inGene(all(read), "BRCA1").length === 1 && inGene(all(read), "CFTR").length === 1, "both should be findings");
      const left = await readRows(rows, true);
      say(left.checked.genes === data.genes.length - 145 && left.checked.leftOut === 145, `checked ${JSON.stringify(left.checked)}`); // prettier-ignore
      say(inGene(all(left), "BRCA1").length === 0 && inGene(all(left), "CFTR").length === 1, "only CFTR should be a finding"); // prettier-ignore
      say(left.counts.coding === read.counts.coding - 1 && left.counts.rare === read.counts.rare - 1, "the left-out record should not be counted"); // prettier-ignore
      say(!left.marks.some((m) => m[5] === "BRCA1") && left.marks.length === left.counts.coding, "the left-out record should leave no mark"); // prettier-ignore
      say(left.counts.all === read.counts.all, "the file's record count should not change");
    },
  },
  {
    name: "copy-number: a symbolic record is kept by its whole span",
    run: async (say) => {
      const w = keepWindows()[16];
      const verdict = (text: string) => {
        const b = Buffer.from(text);
        return isKept(scanLine(b, 0, b.length, w));
      };
      // BRCA1 sits at chr17:43.04-43.13 Mb; these records start 1 Mb before it.
      const head = "chr17\t42000000\t.\tN\t";
      say(
        verdict(`${head}<DEL>\t.\tPASS\tSVTYPE=DEL;END=44000000\tGT\t0/1`),
        "a deletion reaching over the gene should be kept by END",
      );
      say(
        verdict(`${head}<DUP>\t.\tPASS\tSVLEN=2000000\tGT\t0/1`),
        "a duplication reaching over the gene should be kept by SVLEN",
      );
      say(
        verdict(`${head}<DEL>\t.\tPASS\tSVLEN=-2000000;SVTYPE=DEL\tGT\t0/1`),
        "a negative SVLEN should be read by its size",
      );
      say(
        !verdict(`${head}<DEL>\t.\tPASS\tEND=42000500\tGT\t0/1`),
        "a deletion that ends before the gene should not be kept",
      );
      say(!verdict(`${head}<INV>\t.\tPASS\tEND=44000000\tGT\t0/1`), "an inversion is not a copy-number record");
      say(!verdict(`${head}G\t.\tPASS\tEND=44000000\tGT\t0/1`), "a small change is kept by its own letters only");
    },
  },
  {
    name: "copy-number: routed by what it takes of the gene, not by how the file spells it",
    run: async (say) => {
      const data = await bundleOnDisk();
      const brca1 = (await data.chrom(16)).transcripts.find((t) => t.symbol === "BRCA1");
      if (!brca1) throw new Error("no BRCA1");
      // An inner coding exon of BRCA1, deleted with ten letters either side, spelled out.
      const [x0, x1] = brca1.exons[5];
      const spelled: Row = ["17", x0 - 11, `A${"C".repeat(x1 - x0 + 21)}`, "A", "0/1"];
      const whole = await readRows([spelled]);
      const [f] = inGene(all(whole), "BRCA1");
      say(!!f?.p23.cnv && f.bundle.identity.consequence === "gene_deletion", "a spelled-out deletion of a whole coding piece should be a copy-number finding"); // prettier-ignore
      say(f?.p23.cnv?.where === "inside" && f.p23.cnv.fullExons === 1 && f.p23.cnv.type === "Deletion", `read as ${JSON.stringify(f?.p23.cnv?.exons)}`); // prettier-ignore
      say(
        f?.facts.drawings.length === 0 && f.facts.notes.some((n) => n.includes("not drawn")),
        "part of a gene should not draw whole copies",
      );
      say(whole.counts.rare === 1 && whole.marks.length === 1 && whole.marks[0][1] === x0 && whole.marks[0][3] === 3, "its mark should sit on the first coding letter it takes"); // prettier-ignore

      // The same letters given as a symbolic record inside one coding piece: nothing to read it by.
      const inside = await readRows([["17", x0 + 5, "N", "<DEL>", "0/1", "PASS", `END=${x0 + 20}`]]);
      say(all(inside).length === 0 && inside.throws.some((t) => t.stage === "copy-number"), "a symbolic record inside one piece should be declined, visibly"); // prettier-ignore

      const cnv = (cn: number) => readRows([["17", 42_000_000, "N", "<CNV>", "./.", "PASS", "END=44000000", cn]]);
      say(all(await cnv(2)).length === 0, "two copies is no change");
      const lost = inGene(all(await cnv(1)), "BRCA1")[0]?.p23.cnv as CnvFacts | undefined;
      say(
        lost?.dir === "loss" && lost.copies === 1 && lost.copiesStated && lost.whole,
        "<CNV> with one copy should be a whole-gene loss",
      );
      // An extra BRCA1 is no known cause: counted as changing the protein, held back from the list.
      const extra = await cnv(3);
      say(inGene(all(extra), "BRCA1").length === 0 && extra.counts.protein > extra.counts.rare, "a gain of a gene not rated for extra copies should be held back by the dosage cut"); // prettier-ignore
      // LMNB1 is: an extra copy of it causes disease (ClinGen 3), so its gain is read.
      const lmnb1 = (await data.chrom(4)).transcripts.find((t) => t.symbol === "LMNB1");
      if (!lmnb1) throw new Error("no LMNB1");
      const lo = Math.min(...lmnb1.exons.flat()) - 1_000;
      const hi = Math.max(...lmnb1.exons.flat()) + 1_000;
      const gained = inGene(all(await readRows([["5", lo, "N", "<CNV>", "./.", "PASS", `END=${hi}`, 3]])), "LMNB1")[0];
      say(
        gained?.p23.cnv?.dir === "gain" && gained.bundle.identity.consequence === "copy_gain",
        "<CNV> with three copies should be a gain",
      );
      const drawing = gained?.facts.drawings.find((d) => d.kind === "copies")?.transcript;
      say(drawing?.copies === 3 && drawing.copiesFrom === 2, "a whole gain should draw three copies from two");
      say((lost?.codingGenes ?? 0) > CNV_MANY_GENES && (lost?.codingGenes ?? 0) > (lost?.genes ?? 0), `a 2 Mb change should span many protein-coding genes, counted ${lost?.codingGenes}`); // prettier-ignore
    },
  },
  {
    name: "copy-number: with a small change in the same gene, and under the leave-out",
    run: async (say) => {
      // CFTR lost from one copy, and a harmful small change in CFTR: two changes in one recessive gene.
      const rows: Row[] = [["7", 117_400_000, "N", "<DEL>", "0/1", "PASS", "END=117700000"], ["7", 117531036, "C", "CCTA", "0/1"]]; // prettier-ignore
      const r = await readRows(rows);
      const cftr = inGene(all(r), "CFTR");
      say(cftr.length === 2 && cftr.every((f) => f.bundle.zygosity.state === "compound_het_unphased"), "the two should be read as possibly both copies"); // prettier-ignore
      const alone = await readRows([rows[0]]);
      say(inGene(alone.carriers, "CFTR").length === 1, "one lost copy of a recessive gene alone is carrier status");

      const brca1: Row = ["17", 42_000_000, "N", "<DEL>", "0/1", "PASS", "END=44000000"];
      const read = await readRows([brca1]);
      const left = await readRows([brca1], true);
      say(inGene(all(read), "BRCA1").length === 1 && inGene(all(left), "BRCA1").length === 0, "the leave-out should drop the gene from a copy-number record too"); // prettier-ignore
      say(
        all(left).every((f) => !f.p23.cnv?.others.includes("BRCA1")),
        "a left-out gene should not be named among the others",
      );
    },
  },
  {
    name: "one truncating copy in a cross gene is a carrier",
    run: async (say) => {
      const data = await bundleOnDisk();
      const kcnj11 = data.genes.find((g) => g.symbol === "KCNJ11");
      say(
        !!kcnj11?.modes.includes("AD") && kcnj11.modes.includes("AR"),
        "KCNJ11 should have a dominant and a recessive pattern",
      );
      // KCNJ11: a frameshift, a missense; NOTCH3: a stop; WFS1: a broken cut point. All on one copy.
      const r = await readRows([["11", 17387759, "GAC", "G", "0/1"], ["11", 17386998, "C", "T", "0/1"], ["19", 15192410, "G", "A", "0/1"], ["4", 6291369, "T", "G", "0/1"]]); // prettier-ignore
      for (const gene of ["NOTCH3", "WFS1"]) {
        const [f] = inGene(r.carriers, gene);
        say(!!f && inGene(r.yours, gene).length === 0, `${gene}: one truncating copy should be in the carriers`);
        say(
          f?.bundle.inheritance.mode === "AR" && f.p23.mode === "AR",
          `${gene}: should be read under the recessive pattern`,
        );
        say(
          !!f && Object.keys(f.p23.patterns).join() === "AR",
          `${gene}: P3 should be given the recessive condition alone`,
        );
      }
      // Two changes in KCNJ11: neither is one copy alone, so the rule leaves both where they were.
      say(inGene(r.carriers, "KCNJ11").length === 0 && inGene(r.yours, "KCNJ11").length === 2, "two changes in one cross gene are not carrier status"); // prettier-ignore
      const missense = await readRows([["11", 17386998, "C", "T", "0/1"]]);
      const [m] = inGene(all(missense), "KCNJ11");
      say(inGene(missense.yours, "KCNJ11").length === 1 && m?.bundle.inheritance.mode === "AD", "a missense in a cross gene stays under the dominant pattern"); // prettier-ignore
      const frameshift = await readRows([["11", 17387759, "GAC", "G", "0/1"]]);
      say(inGene(frameshift.carriers, "KCNJ11").length === 1, "KCNJ11's frameshift alone should be a carrier");
      const two = await readRows([["11", 17387759, "GAC", "G", "1/1"]]);
      say(inGene(two.yours, "KCNJ11").length === 1, "both copies lost is not carrier status");
    },
  },
  {
    name: "the condition follows the variant, then the mechanism, then the default",
    run: async (say) => {
      const label = async (row: Row, gene: string, pattern: string) =>
        inGene(all(await readRows([row])), gene)[0]?.p23.patterns[pattern]?.label;
      // TTN: a frameshift takes the loss condition; a missense has no reviewed pick, so the reviewed default.
      const frameshift = await label(["2", 178532545, "AC", "A", "0/1"], "TTN", "AD");
      const missense = await label(["2", 178527191, "C", "G", "0/1"], "TTN", "AD");
      say(frameshift === "dilated cardiomyopathy 1G", `TTN's frameshift names ${frameshift}`);
      say(missense === "dilated cardiomyopathy 1G", `TTN's missense names ${missense}`);
      // LMNA: a harmful missense ClinVar files under one of the gene's conditions keeps its own.
      const data = await bundleOnDisk();
      const lmna = data.genes.find((g) => g.symbol === "LMNA")?.conditions.AD?.label;
      const own = await label(["1", 156134853, "G", "A", "0/1"], "LMNA", "AD");
      say(!!own && own !== lmna, `LMNA's own-condition variant names ${own}, the gene's first-listed is ${lmna}`);
      // A gene with one condition per pattern is untouched.
      const brca1 = await label(["17", 43106487, "A", "C", "0/1"], "BRCA1", "AD");
      say(
        brca1 === data.genes.find((g) => g.symbol === "BRCA1")?.conditions.AD?.label,
        "BRCA1 should keep its one condition",
      );
    },
  },
  {
    name: "low-penetrance and risk-allele classes read as harmful, flagged",
    run: async (say) => {
      // CFH: "Pathogenic,_low_penetrance". KCNJ11: "Pathogenic/Likely_pathogenic/Likely_risk_allele". BRCA1 C61G: plain "Pathogenic".
      const r = await readRows([["1", 196747163, "G", "C", "0/1"], ["11", 17387407, "C", "T", "0/1"], ["17", 43106487, "A", "C", "0/1"]]); // prettier-ignore
      const flag = (gene: string) => (inGene(all(r), gene)[0]?.p23.clinvar as { lowPenetrance?: boolean } | null | undefined)?.lowPenetrance; // prettier-ignore
      const cls = (gene: string) => inGene(all(r), gene)[0]?.p23.clinvar?.class;
      const settled = (gene: string) => inGene(all(r), gene)[0]?.bundle.claims[0].what_would_update.length === 0;
      say(
        cls("CFH") === "pathogenic" && flag("CFH") === true && settled("CFH"),
        `CFH read as ${cls("CFH")}, flag ${flag("CFH")}`,
      );
      say(cls("KCNJ11") === "pathogenic-likely" && flag("KCNJ11") === true && settled("KCNJ11"), `KCNJ11 read as ${cls("KCNJ11")}, flag ${flag("KCNJ11")}`); // prettier-ignore
      say(
        cls("BRCA1") === "pathogenic" && flag("BRCA1") === undefined,
        "an unqualified harmful call should carry no flag",
      );
      const claim = inGene(all(r), "CFH")[0]?.bundle.claims[0].value;
      say(
        !!claim && !("absent" in claim) && claim.clnsig === "Pathogenic,_low_penetrance",
        "the bundle should keep ClinVar's own spelling",
      );
    },
  },
  {
    name: "a record whose FILTER is not PASS is kept, flagged",
    run: async (say) => {
      const brca1 = (filter?: string): Row => ["17", 43106487, "A", "C", "0/1", filter];
      const flag = async (rows: Row[], gene: string) => inGene(all(await readRows(rows)), gene)[0]?.lowConfidence;
      say((await flag([brca1()], "BRCA1")) === false, "PASS should not be flagged");
      say((await flag([brca1(".")], "BRCA1")) === false, "no FILTER applied should not be flagged");
      say((await flag([brca1("LowQual")], "BRCA1")) === true, "LowQual should be kept and flagged");
      say((await flag([brca1("q10;s50")], "BRCA1")) === true, "two filters should be kept and flagged");
      // The right-shifted c.68_69del: the stages move it two letters left; its flag follows it.
      say(
        (await flag([["17", 43124029, "TCT", "T", "0/1", "LowQual"]], "BRCA1")) === true,
        "a record the stages left-align should keep its flag",
      );
      say((await flag([["17", 42_000_000, "N", "<DEL>", "0/1", "LowQual", "END=44000000"]], "BRCA1")) === true, "a flagged copy-number record should be kept and flagged"); // prettier-ignore
    },
  },
  {
    name: "gVCF: <NON_REF> is no record, a reference block is coverage, an uncarried allele is not the person's",
    run: async (say) => {
      const data = await bundleOnDisk();
      const brca1 = (await data.chrom(16)).transcripts.find((t) => t.symbol === "BRCA1");
      if (!brca1?.cds_start) throw new Error("no BRCA1");
      // BRCA1 C61G as a gVCF writes it, between two reference blocks; the second block was not called.
      const rows: Row[] = [
        ["17", brca1.cds_start, "N", "<NON_REF>", "0/0", ".", `END=${43106486}`],
        ["17", 43106487, "A", "C,<NON_REF>", "0/1"],
        ["17", 43106488, "N", "<*>", "./.", ".", `END=${43106488 + 5000}`],
      ];
      const r = await readRows(rows);
      say(r.counts.all === 1 && r.parsed[16] === 1, `a block is not a record: counted ${r.counts.all}`);
      say(inGene(all(r), "BRCA1").length === 1 && r.counts.coding === 1 && r.throws.length === 0, "the variant line should be the one finding, nothing thrown"); // prettier-ignore
      say(inGene(all(r), "BRCA1")[0]?.bundle.zygosity.state === "het", "its genotype should read as one copy");
      say(r.checked.coverage === "gvcf", "coverage read from reference blocks should say gvcf");
      const plain = await readRows([["17", 43106487, "A", "C", "0/1"]]);
      say(plain.checked.coverage === "vcf", "a file with no reference blocks should say vcf");
      const uncalled = await readRows([rows[2]]);
      say(uncalled.checked.coverage === "vcf" && uncalled.counts.all === 0, "an uncalled block covers nothing");

      // Coverage, counted: a called block over one reference window covers exactly the window's part of it.
      const w = keepWindows()[16];
      if (!w) throw new Error("no windows for chr17");
      const covered: Covered = { bases: 0, blocks: 0 };
      const block = Buffer.from(`chr17\t${w[0] - 10}\t.\tN\t<NON_REF>\t.\t.\tEND=${w[0] + 99}\tGT:DP\t0/0:30`);
      const verdict = scanLine(block, 0, block.length, w, covered);
      say(recordsIn(verdict) === 0 && !isKept(verdict), "a block is neither counted nor kept");
      say(
        covered.blocks === 1 && covered.bases === 100,
        `a block reaching 100 letters into a window covered ${covered.bases}`,
      );

      // An allele the genotype does not carry is no record of the person's; two carried alleles are two.
      const none = await readRows([["17", 43106487, "A", "C", "0/0"], ["17", 43106487, "A", "C,G", "0/2"]]); // prettier-ignore
      say(inGene(all(none), "BRCA1").every((f) => !f.key.includes(":A:C:")) && none.throws.length === 0, "an uncarried allele should be no finding and no throw"); // prettier-ignore
      const both = parseLine("chr17\t43106487\t.\tA\tC,G\t.\tPASS\t.\tGT\t1|2");
      say(
        both.length === 2 && both[0].gt === "1|0" && both[1].gt === "0|1",
        "a line with two carried alleles should split into two records",
      );
    },
  },
];

export interface ProofReport {
  passed: number;
  total: number;
  problems: string[];
}

export async function proofs(): Promise<ProofReport> {
  const report: ProofReport = { passed: 0, total: PROOFS.length, problems: [] };
  for (const p of PROOFS) {
    const before = report.problems.length;
    try {
      await p.run((ok, what) => {
        if (!ok) report.problems.push(`${p.name}: ${what}`);
      });
    } catch (e) {
      report.problems.push(`${p.name}: threw ${e instanceof Error ? e.message : String(e)}`);
    }
    if (report.problems.length === before) report.passed++;
  }
  return report;
}
