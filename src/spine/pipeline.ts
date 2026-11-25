// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// A file's kept records through every stage, one chromosome at a time: what the reader calls.

import type {
  ChromData,
  ChromIndex,
  DataBundle,
  Finding,
  GenomeResult,
  Mark,
  P23Facts,
  ReadEvent,
  VariantFacts,
  SexPair,
} from "../contracts/app.ts";
import { CHROM_X, CHROMS, CHROM_Y } from "../contracts/constants.ts";
import type {
  InheritanceMode,
  JoinedVariant,
  MendelianBundle,
  NormalizedVariant,
  TranscriptModel,
  VcfRecord,
} from "../contracts/types.ts";
import { annotateVariant } from "./annotate.ts";
import { assertNoNullish, bundle, normalizedKey, runHets, type BundleContext } from "./bundle.ts";
import { dispatch, type ClinvarInfo } from "./facts/dispatch.ts";
import {
  clinvarMatch,
  cnvFacts,
  extentOf,
  isSymbolicCopyNumber,
  joinedCopyNumber,
  p23CopyNumber,
  parseCopyNumberLine,
  spelledDeletion,
  takesAPiece,
  usualCopies,
  type CnvFacts,
  type CopyNumberData,
  type CopyNumberRecord,
  type Extent,
} from "./cnv.ts";
import { buildModel, type GeneModel, type RefGetter } from "./facts/model.ts";
import { isCarrier } from "./funnel.ts";
import { gate as changesProtein } from "./gates/changes_protein.ts";
import { gate as coding } from "./gates/coding.ts";
import { gate as dosage } from "./gates/dosage.ts";
import { gate as rare } from "./gates/rare.ts";
import { joinVariant } from "./join.ts";
import type { Covered } from "./keep.ts";
import { codingRuler } from "./marks.ts";
import { findingKey, variantName } from "./name.ts";
import { normalize } from "./normalize.ts";
import { p23Facts } from "./p23.ts";
import { parseLines } from "./parse.ts";
import { pin } from "./pin.ts";
import { copiesOfX, sexOf, tallyX } from "./sex.ts";
import { getRefBases, isClinVarRecord } from "./tables.ts";

/** What the reader hands over once the file has been streamed. */
export interface GenomeInput {
  source: GenomeResult["source"];
  displayName: string;
  /** The kept data lines of each chromosome, in ledger order (24 lists), verbatim. Emptied as they are read. */
  lines: string[][];
  /** Every record of each chromosome, kept or not (24 counts). */
  parsed: number[];
  /** True drops the opt-in genes before anything is read. */
  leaveOut: boolean;
  /** A sample's donor's copies of X, where the sample's file has no X: P3's figure reads it. */
  donorX?: 1 | 2;
  /** What the reader's scan added up per chromosome (scanLine's `covered`), when it kept the tally. */
  covered?: readonly Covered[];
}

/** The bundle, with the copy-number data a file's deletion and duplication records are read against. */
export type SpineData = DataBundle & { copyNumber?: CopyNumberData };

type Throw = GenomeResult["throws"][number];

/** A record past the cuts: its level, and where its mark sits when that is not its own position. */
interface Cut {
  v: JoinedVariant;
  level: 1 | 2 | 3;
  at?: number;
}

/** A copy-number record against one gene it takes a piece of. */
interface CopyNumberHit {
  r: CopyNumberRecord;
  t: TranscriptModel;
  x: Extent;
  cnv: CnvFacts;
}

/** A record that passed every cut, with what the stages made of it. */
export interface Read {
  joined: JoinedVariant;
  bundle: MendelianBundle;
  facts: VariantFacts;
  p23: P23Facts;
  carrier: boolean;
  /** The file's own FILTER for the record was not PASS. */
  lowConfidence: boolean;
}

/** A FILTER that flags nothing: PASS, or none applied. */
const passed = (filter: string): boolean => filter === "PASS" || filter === "." || filter === "";
/** A record as the file wrote it, to find its FILTER again after the stages have moved and trimmed it. */
const asWritten = (pos: number, ref: string, alt: string): string => `${pos}:${ref}:${alt}`;

/** Everything the stages work out, before it is shaped for the app. */
export interface Reading {
  /** The person's copies of X, from the file's own X records; null when it has none. */
  copiesX: 1 | 2 | null;
  /** Genes read, and genes the person chose to leave out. */
  checked: { genes: number; leftOut: number };
  counts: { coding: number; protein: number; rare: number };
  marks: Mark[];
  reads: Read[];
  throws: Throw[];
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The cuts a record passes: 1 coding, 2 changes protein, 3 rare and in the gene set. */
function level(v: JoinedVariant, genes: ReadonlySet<string>): 1 | 2 | 3 {
  if (!changesProtein(v)) return 1;
  return rare(v) && v.gene !== null && genes.has(v.gene) ? 3 : 2;
}

/**
 * The first record of each change, by its normalized position and letters: a file that writes a row
 * twice would otherwise show every finding twice. The rest are noted in `throws`.
 */
function once(variants: readonly NormalizedVariant[], throws: Throw[]): NormalizedVariant[] {
  const seen = new Set<string>();
  return variants.filter((v) => {
    const key = `${v.chrom}:${v.pos}:${v.ref}:${v.alt}`;
    if (!seen.has(key)) {
      seen.add(key);
      return true;
    }
    throws.push({ key, stage: "normalize", message: "the same change as an earlier record: read once" });
    return false;
  });
}

/**
 * The records whose REF is the reference's own letters, where the shipped reference can say: a row that names
 * another letter is a damaged or mis-converted row, and reading it would invent a change. The rest are noted in
 * `throws`. A REF outside the shipped windows, or spelled with other letters (N), is kept unchecked.
 */
function onReference(
  records: readonly VcfRecord[],
  reference: ChromData["reference"],
  chrom: string,
  throws: Throw[],
): VcfRecord[] {
  return records.filter((r) => {
    if (!/^[ACGT]+$/.test(r.ref)) return true;
    const letters = getRefBases(reference.bin, reference.index, r.pos, r.ref.length);
    if (letters === null || letters === r.ref) return true;
    throws.push({ key: `${chrom}:${r.pos}:${r.ref}:${r.alt}`, stage: "normalize", message: `REF ${r.ref} where the reference reads ${letters}: left out` }); // prettier-ignore
    return false;
  });
}

/** One chromosome: its kept lines to joined records, each with the cuts it passes. Only records in `genes` are read. */
function stages(
  c: ChromIndex,
  records: readonly VcfRecord[],
  d: ChromData,
  genes: ReadonlySet<string>,
  leftOut: ReadonlySet<string>,
  throws: Throw[],
): Cut[] {
  const chrom = `chr${CHROMS[c]}`;
  const { bin, index } = d.reference;
  const pinned = pin(once(normalize(onReference(records, d.reference, chrom, throws), bin, index, throws), throws), d.transcripts).filter((v) => v.gene !== null && !leftOut.has(v.gene)); // prettier-ignore
  const out: Cut[] = [];
  for (const p of pinned) {
    let stage = "annotate";
    try {
      const a = annotateVariant(p, d.transcripts, bin, index);
      stage = "join";
      const v = joinVariant(a, d.clinvar, d.gnomad, d.alphamissense, d.windows);
      stage = "cuts";
      if (coding(v)) out.push({ v, level: level(v, genes) });
    } catch (e) {
      throws.push({ key: `${chrom}:${p.pos}:${p.ref}:${p.alt}:${p.gene}`, stage, message: message(e) });
    }
  }
  return out;
}

/**
 * A chromosome's lines as the small changes the stages read and the copy-number records beside them:
 * symbolic deletions and duplications, and spelled-out deletions that take a whole coding piece.
 */
function split(
  chrom: string,
  lines: readonly string[],
  transcripts: readonly TranscriptModel[],
  copiesX: 1 | 2 | null,
  throws: Throw[],
): { small: VcfRecord[]; copyNumber: CopyNumberRecord[] } {
  const small: VcfRecord[] = [];
  const copyNumber: CopyNumberRecord[] = [];
  for (const line of lines) {
    const alt = line.split("\t", 5)[4] ?? "";
    if (alt.startsWith("<") && isSymbolicCopyNumber(alt)) {
      try {
        copyNumber.push(...parseCopyNumberLine(line, (pos) => usualCopies(chrom, pos, copiesX)));
      } catch (e) {
        throws.push({ key: `${chrom}:${line.split("\t", 2)[1]}:${alt}`, stage: "copy-number", message: message(e) });
      }
      continue;
    }
    for (const r of parseLines([line])) {
      const cn = spelledDeletion({ ...r, chrom }, transcripts);
      if (cn) copyNumber.push(cn);
      else small.push({ ...r, chrom });
    }
  }
  return { small, copyNumber };
}

/** Each copy-number record against each gene being read whose coding sequence it touches. */
function copyNumberHits(
  chrom: string,
  records: readonly CopyNumberRecord[],
  transcripts: readonly TranscriptModel[],
  throws: Throw[],
): Omit<CopyNumberHit, "cnv">[] {
  const out: Omit<CopyNumberHit, "cnv">[] = [];
  for (const r of records)
    for (const t of transcripts) {
      const x = extentOf(t, r.start, r.end);
      if (!x) continue;
      if (takesAPiece(x)) out.push({ r, t, x });
      else throws.push({ key: `${chrom}:${r.start - 1}:${r.ref}:${r.alt}:${t.symbol}`, stage: "copy-number", message: "a deletion or duplication record that takes less than one coding piece is not read" }); // prettier-ignore
    }
  return out;
}

/** ClinVar's record as the drawings label it. */
export function clinvarInfo(b: MendelianBundle): ClinvarInfo {
  const [claim] = b.claims;
  const value = claim.value;
  return {
    variation_id: claim.source.variation_id as number | null,
    stars: "absent" in value ? null : value.review_stars,
    clnsig: "absent" in value ? null : value.clnsig,
  };
}

/** Run the stages over every chromosome the bundle covers. */
export async function read(input: GenomeInput, data: SpineData): Promise<Reading> {
  // The opt-in genes are dropped before a record in them is annotated, joined, counted or marked.
  const leftOut = new Set(input.leaveOut ? data.genes.filter((g) => g.optIn !== null).map((g) => g.symbol) : []);
  const genes = new Set(data.genes.map((g) => g.symbol).filter((g) => !leftOut.has(g)));
  const geneOf = new Map(data.genes.map((g) => [g.symbol, g]));
  const copiesX = copiesOfX(tallyX(parseLines(input.lines[CHROM_X] ?? [])));
  const inheritance = new Map<string, InheritanceMode[]>(data.genes.map((g) => [g.symbol, g.modes]));
  const ctx: BundleContext = {
    object_type: "mendelian",
    sex: sexOf(copiesX),
    inheritance,
    pack_date: data.manifest.pack_date,
  };
  const checked = { genes: genes.size, leftOut: leftOut.size };
  const out: Reading = {
    copiesX,
    checked,
    counts: { coding: 0, protein: 0, rare: 0 },
    marks: [],
    reads: [],
    throws: [],
  };

  for (let c = 0; c < CHROMS.length; c++) {
    const lines = input.lines[c] ?? [];
    if (!lines.length || !data.genes.some((g) => g.chrom === CHROMS[c])) continue;
    const d = await data.chrom(c);
    const chrom = `chr${CHROMS[c]}`;
    const read = d.transcripts.filter((t) => genes.has(t.symbol));
    const { small, copyNumber } = split(chrom, lines, read, copiesX, out.throws);
    lines.length = 0;
    const flagged = new Set(small.filter((r) => !passed(r.filter)).map((r) => asWritten(r.pos, r.ref, r.alt)));
    const cut = stages(c, small, d, genes, leftOut, out.throws);
    const hits = new Map<JoinedVariant, CopyNumberHit>();
    for (const { r, t, x } of copyNumberHits(chrom, copyNumber, read, out.throws)) {
      const usual = usualCopies(chrom, r.start, copiesX);
      if (!data.copyNumber) {
        const v = joinedCopyNumber(r, t, null, usual);
        out.throws.push({ key: `${normalizedKey(v)}:${v.gene}`, stage: "facts", message: "the bundle carries no copy-number data to read this record against" }); // prettier-ignore
        cut.push({ v, level: 2, at: x.first });
        continue;
      }
      const cv = clinvarMatch(r, data.copyNumber);
      const v = joinedCopyNumber(r, t, cv, usual);
      const cnv = cnvFacts(r, t, x, { data: data.copyNumber, transcripts: read, usual }, cv?.variation_id ?? null);
      // It changes the protein; the dosage cut stands where Rare does for a small change.
      const level = dosage(cnv, geneOf.get(t.symbol)?.dosage.lofKnown ?? 0, cv?.clnsig ?? null) ? 3 : 2;
      if (level === 3) hits.set(v, { r, t, x, cnv });
      // The mark sits on the lowest coding letter the change takes.
      cut.push({ v, level, at: x.first });
    }

    const ref: RefGetter = (pos, n) => getRefBases(d.reference.bin, d.reference.index, pos, n);
    const models = new Map<string, GeneModel>();
    const modelOf = (tx: TranscriptModel): GeneModel => {
      const m = models.get(tx.transcript) ?? buildModel(tx, ref);
      models.set(tx.transcript, m);
      return m;
    };
    const last = cut.filter((x) => x.level === 3).map((x) => x.v);
    const hets = runHets(last, [chrom]);
    const found = new Map<JoinedVariant, Read>();
    for (const v of last) {
      const key = `${normalizedKey(v)}:${v.gene}`;
      let stage = "bundle";
      try {
        const b = bundle(v, ctx, hets) as MendelianBundle;
        assertNoNullish(b);
        stage = "facts";
        const tx = d.transcripts.find((t) => t.transcript === b.identity.transcript);
        if (!tx) throw new Error(`no transcript ${b.identity.transcript}`);
        const model = modelOf(tx);
        const fold = await data.fold(b.identity.gene);
        const gene = geneOf.get(b.identity.gene);
        const hit = hits.get(v);
        let facts: VariantFacts;
        let p23: P23Facts;
        if (hit) {
          const { cnv } = hit;
          const usual = usualCopies(chrom, hit.r.start, copiesX);
          const cv = "absent" in v.clinvar ? null : v.clinvar;
          facts = dispatch(b.identity, model, clinvarInfo(b), fold, findingKey(b.identity), ref, { copies: cnv.copies, from: usual, whole: cnv.whole }); // prettier-ignore
          stage = "p23";
          p23 = p23CopyNumber(v, hit.t.symbol, b.zygosity.state, cv && isClinVarRecord(cv) ? cv : null, cnv, gene, copiesX ?? input.donorX ?? null); // prettier-ignore
        } else {
          facts = dispatch(b.identity, model, clinvarInfo(b), fold, findingKey(b.identity), ref);
          stage = "p23";
          p23 = p23Facts(v, b, facts, model, gene, copiesX ?? input.donorX ?? null);
        }
        const lowConfidence = hit ? !passed(hit.r.filter) : flagged.has(asWritten(v.original_pos, v.original_ref, v.original_alt)); // prettier-ignore
        found.set(v, {
          joined: v,
          bundle: b,
          facts,
          p23,
          // One copy only: two changes in one gene stay in YOUR VARIANTS (SPEC: carriers). The bundle's
          // pattern says when one lost copy of a cross gene is read as recessive.
          carrier:
            !!gene &&
            b.zygosity.state === "het" &&
            (isCarrier(gene.modes, v.gt, copiesX !== 1) || b.inheritance.mode === "AR"),
          lowConfidence,
        });
      } catch (e) {
        out.throws.push({ key, stage, message: message(e) });
      }
    }

    const offset = codingRuler(d.windows);
    for (const { v, level, at } of cut) {
      const r = found.get(v);
      // A record that threw is in `throws`, not in a list: its mark stays at the cut before.
      const shown = level === 3 && !r ? 2 : level;
      out.counts.coding++;
      if (shown >= 2) out.counts.protein++;
      if (r) {
        out.counts.rare++;
        out.reads.push(r);
      }
      const pos = at ?? v.pos;
      out.marks.push([c, pos, offset(pos), shown, r?.carrier ? 1 : 0, r ? r.bundle.identity.gene : ""]);
    }
  }
  out.marks.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return out;
}

const finding = (r: Read): Finding => ({
  key: findingKey(r.bundle.identity),
  name: variantName(r.bundle.identity),
  bundle: r.bundle,
  facts: r.facts,
  p23: r.p23,
  lowConfidence: r.lowConfidence,
});

/** The pair the ledger names: two copies of X is XX; one is XY where the file holds Y, else X. A sample's file has
 *  no X, so its donor's published copies stand in. A person's file with no X names none. */
export function sexPairOf(copiesX: 1 | 2 | null, yRecords: number, donorX?: 1 | 2): SexPair | null {
  if (copiesX === 2) return "XX";
  if (copiesX === 1) return yRecords > 0 ? "XY" : "X";
  if (donorX === 2) return "XX";
  if (donorX === 1) return "XY";
  return null;
}

/**
 * The reader's one call: a streamed file's kept records to the result the app shows. The worker tells the sex
 * pair itself, as soon as the scan has read X (sexPairOf, from the same lines); the caller posts `done` with this.
 */
export async function readGenome(input: GenomeInput, data: SpineData): Promise<GenomeResult> {
  const parsed = CHROMS.map((_, c) => input.parsed[c] ?? 0);
  const r = await read(input, data);
  // Coverage is "gvcf" only when the scan read reference blocks: a plain VCF says nothing about the places it leaves out.
  const blocks = input.covered?.some((c) => c.blocks > 0 && c.bases > 0) ?? false;
  const yours = r.reads.filter((x) => !x.carrier).map(finding);
  const carriers = r.reads.filter((x) => x.carrier).map(finding);
  return {
    source: input.source,
    displayName: input.displayName,
    copiesX: r.copiesX,
    sexPair: sexPairOf(r.copiesX, parsed[CHROM_Y] ?? 0, input.donorX),
    parsed,
    counts: {
      all: parsed.reduce((a, b) => a + b, 0),
      coding: r.counts.coding,
      protein: r.counts.protein,
      rare: r.counts.rare,
      yours: yours.length,
      carriers: carriers.length,
    },
    marks: r.marks,
    yours,
    carriers,
    checked: { ...r.checked, coverage: blocks ? "gvcf" : "vcf" },
    dataDate: data.manifest.clinvar_date,
    throws: r.throws,
  };
}
