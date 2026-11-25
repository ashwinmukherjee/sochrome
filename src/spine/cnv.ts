// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copy-number records: a deletion or duplication of a whole coding piece or more, read against each gene it touches.

import type { GeneInfo, P23Facts } from "../contracts/app.ts";
import type { ClinVarHit, JoinedVariant, TranscriptModel } from "../contracts/types.ts";
import { governingMode } from "./funnel.ts";
import { clinvarClass, reviewLevel } from "./p23.ts";
import { inPar } from "./sex.ts";
import type { ClinVarRecord } from "./tables.ts";

type Cnv = NonNullable<P23Facts["cnv"]>;
/** The copy model reads the protein-coding genes a change spans beside the set's own. */
export type CnvFacts = Cnv & { codingGenes: number };

/** ClinGen's dosage rating: [hi, ts, hiDisease, tsDisease]. */
type Rating = [hi: string | null, ts: string | null, hiDisease: string | null, tsDisease: string | null];

/** copy-number.json, as the data repo's pack_cnv.py writes it. Chromosomes are bare; coordinates 1-based, inclusive. */
export interface CopyNumberData {
  format: 1;
  clinvar_date: string;
  /** Gene to ClinGen's rating. */
  ratings: Record<string, Rating>;
  /** ClinGen's curated regions: [id, name, chrom, start, end, ...rating]. */
  regions: [id: string, name: string, chrom: string, start: number, end: number, ...rating: Rating][];
  /** ClinVar's copy-number records per chromosome, sorted by start. */
  clinvar: Record<
    string,
    [
      id: string,
      start: number,
      end: number,
      dir: "loss" | "gain",
      clnsig: string,
      revstat: string,
      copies: number | null,
      conf: Record<string, number> | null,
    ][]
  >;
  /** MONDO id to the disease's name, where one is known. */
  labels: Record<string, string>;
  /** Every protein-coding gene per chromosome: [start, end, start, end, …], sorted by start. */
  proteinCoding: Record<string, number[]>;
}

/** One copy-number record of the file: the letters [start, end] are lost or gained. */
export interface CopyNumberRecord {
  /** Bare chromosome name. */
  chrom: string;
  start: number;
  end: number;
  dir: "loss" | "gain";
  /** The copy number the file states (CN), or null. */
  stated: number | null;
  /** Both copies carry the change, by the file's genotype. */
  both: boolean;
  /** REF and ALT as the file gives them. */
  ref: string;
  alt: string;
  filter: string;
  /** A deletion spelled out in letters; false for a symbolic allele. */
  spelled: boolean;
}

const SYMBOLIC = /^<(DEL|DUP|CNV)\b[^>]*>$/;

/** Whether a data line's ALT is a symbolic copy-number allele. */
export const isSymbolicCopyNumber = (alt: string): boolean => alt.split(",").every((a) => SYMBOLIC.test(a));

const infoValue = (info: string, key: string): string | null => {
  const m = new RegExp(`(?:^|;)${key}=([^;]*)`).exec(info);
  return m ? m[1] : null;
};

/**
 * A data line with a symbolic copy-number allele (<DEL>, <DUP>, <CNV>), one record per ALT.
 * POS is the letter before the change and END its last letter, as VCF defines them; a record
 * that gives neither END nor SVLEN, or a <CNV> without a copy number, throws.
 * `expected` is the copies a person has there before any change.
 */
export function parseCopyNumberLine(line: string, expected: (pos: number) => number): CopyNumberRecord[] {
  const cols = line.split("\t");
  if (cols.length < 10) return [];
  const pos = parseInt(cols[1], 10);
  const info = cols[7];
  const format = cols[8].split(":");
  const sample = cols[9].split(":");
  const field = (name: string) => (format.includes(name) ? (sample[format.indexOf(name)] ?? null) : null);
  const gt = field("GT") ?? "./.";
  const alleles = gt.split(/[/|]/);
  const cnRaw = field("CN") ?? infoValue(info, "CN");
  const stated = cnRaw !== null && /^\d+$/.test(cnRaw) ? Number(cnRaw) : null;
  const endRaw = infoValue(info, "END");
  const lenRaw = infoValue(info, "SVLEN");
  const out: CopyNumberRecord[] = [];
  cols[4].split(",").forEach((alt, i) => {
    const kind = SYMBOLIC.exec(alt)?.[1];
    if (!kind) throw new Error(`not a copy-number allele: ${alt}`);
    const len = lenRaw === null ? null : Math.abs(Number(lenRaw.split(",")[i] ?? lenRaw.split(",")[0]));
    const end = endRaw !== null ? Number(endRaw) : len !== null ? pos + len : NaN;
    if (!Number.isFinite(end) || end <= pos) throw new Error(`a copy-number record at ${cols[0]}:${pos} states no end`);
    // A genotype that names another allele of the line, or the reference twice, is not this change.
    const mine = alleles.filter((a) => a === String(i + 1)).length;
    const called = alleles.some((a) => a !== "." && a !== "0");
    if (called && mine === 0) return;
    const usual = expected(pos + 1);
    let dir: "loss" | "gain";
    if (kind === "DEL") dir = "loss";
    else if (kind === "DUP") dir = "gain";
    else if (stated === null) throw new Error(`a <CNV> record at ${cols[0]}:${pos} states no copy number`);
    else if (stated === usual) return;
    else dir = stated < usual ? "loss" : "gain";
    const both = alleles.length === 2 ? mine === 2 : dir === "loss" && stated === 0 && usual === 2;
    out.push({ chrom: cols[0].replace(/^chr/, ""), start: pos + 1, end, dir, stated, both, ref: cols[3], alt, filter: cols[6], spelled: false }); // prettier-ignore
  });
  return out;
}

/** What a change over [s, e] does to one gene's coding sequence. Exons are numbered in transcript order. */
export interface Extent {
  whole: boolean;
  startIn: boolean;
  stopIn: boolean;
  exons: { first: number; last: number; of: number };
  fullExons: number;
  share: number;
  inFrame: boolean;
  plen: number;
  onlyLast: boolean;
  /** The lowest coding position the change takes. */
  first: number;
}

/** Null when the change touches none of the gene's coding sequence. */
export function extentOf(t: TranscriptModel, s: number, e: number): Extent | null {
  if (t.cds_start === null || t.cds_end === null) return null;
  const cs = t.cds_start;
  const ce = t.cds_end;
  let cdsLen = 0;
  let hit = 0;
  let first = Infinity;
  const coding: { n: number; full: boolean; touched: boolean }[] = [];
  t.exons.forEach(([x0, x1], i) => {
    const lo = Math.max(x0, cs);
    const hi = Math.min(x1, ce);
    if (lo > hi) return;
    cdsLen += hi - lo + 1;
    const a = Math.max(lo, s);
    const b = Math.min(hi, e);
    if (a <= b) {
      hit += b - a + 1;
      first = Math.min(first, a);
    }
    coding.push({ n: t.strand === "+" ? i + 1 : t.exons.length - i, full: s <= lo && e >= hi, touched: a <= b });
  });
  coding.sort((a, b) => a.n - b.n);
  const touched = coding.filter((c) => c.touched);
  if (!touched.length) return null;
  return {
    whole: s <= cs && e >= ce,
    startIn: t.strand === "+" ? s <= cs : e >= ce,
    stopIn: t.strand === "+" ? e >= ce : s <= cs,
    exons: { first: touched[0].n, last: touched[touched.length - 1].n, of: t.exons.length },
    fullExons: coding.filter((c) => c.full).length,
    share: hit / cdsLen,
    inFrame: hit % 3 === 0,
    plen: Math.round(cdsLen / 3) - 1,
    onlyLast: touched.length === 1 && touched[0].n === coding[coding.length - 1].n,
    first,
  };
}

/** A copy-number change takes the whole coding sequence or at least one whole coding piece; less is a small change. */
export const takesAPiece = (x: Extent): boolean => x.whole || x.fullExons >= 1;

/** A spelled-out deletion that takes a whole coding piece of some gene: read as a copy-number change, not by its letters. */
export function spelledDeletion(
  r: { chrom: string; pos: number; ref: string; alt: string; gt: string; filter: string },
  transcripts: readonly TranscriptModel[],
): CopyNumberRecord | null {
  if (r.alt.length !== 1 || r.ref.length < 2 || r.ref[0] !== r.alt) return null;
  const start = r.pos + 1;
  const end = r.pos + r.ref.length - 1;
  const takes = transcripts.some((t) => {
    const x = extentOf(t, start, end);
    return x !== null && takesAPiece(x);
  });
  if (!takes) return null;
  const alleles = r.gt.split(/[/|]/);
  const both = alleles.length === 2 && alleles.every((a) => a !== "0" && a !== ".");
  return { chrom: r.chrom.replace(/^chr/, ""), start, end, dir: "loss", stated: null, both, ref: r.ref, alt: r.alt, filter: r.filter, spelled: true }; // prettier-ignore
}

const STARS: Record<string, number> = { guideline: 4, expert: 3, multiple: 2, conflicting: 1, single: 1, none: 0 };
const group = (clnsig: string): "harmful" | "harmless" | "uncertain" | "other" => {
  const cls = clinvarClass(clnsig);
  return /pathogenic/.test(cls)
    ? "harmful"
    : /benign/.test(cls)
      ? "harmless"
      : cls === "uncertain"
        ? "uncertain"
        : "other";
};

/** The set genes of a chromosome whose coding sequence [s, e] touches. */
const genesUnder = (transcripts: readonly TranscriptModel[], s: number, e: number): string[] =>
  transcripts.filter((t) => extentOf(t, s, e) !== null).map((t) => t.symbol);

/** ClinVar's record of this very change: the same span and direction. The best-reviewed one, then the lowest id. */
export function clinvarMatch(r: CopyNumberRecord, data: CopyNumberData): ClinVarRecord | null {
  const same = (data.clinvar[r.chrom] ?? []).filter((o) => o[1] === r.start && o[2] === r.end && o[3] === r.dir);
  if (!same.length) return null;
  const stars = (o: (typeof same)[number]) => STARS[reviewLevel(o[5].replace(/_/g, " "))];
  const [id, , , , clnsig, revstat, , conf] = same.sort(
    (a, b) => stars(b) - stars(a) || Number(a[0]) - Number(b[0]),
  )[0];
  return {
    variation_id: Number(id),
    clnsig,
    review_stars: stars(same[0]),
    clnrevstat: revstat,
    hgvs_c: "",
    conf,
    mondo: [],
  };
}

/** How many protein-coding genes [s, e] overlaps. */
function codingGenes(spans: readonly number[] | undefined, s: number, e: number): number {
  let n = 0;
  if (spans) for (let i = 0; i < spans.length && spans[i] <= e; i += 2) if (spans[i + 1] >= s) n++;
  return n;
}

export interface CopyNumberContext {
  data: CopyNumberData;
  /** The chromosome's transcripts of the genes being read. */
  transcripts: readonly TranscriptModel[];
  /** The person's copies of the chromosome at a position, before any change. */
  usual: number;
}

/** The copy model's facts for one copy-number record against one gene it takes a piece of. */
export function cnvFacts(
  r: CopyNumberRecord,
  t: TranscriptModel,
  x: Extent,
  cx: CopyNumberContext,
  clinvarId: number | null,
): CnvFacts {
  const { data, transcripts } = cx;
  const [hi, ts, hiDisease, tsDisease] = data.ratings[t.symbol] ?? [null, null, null, null];
  const under = genesUnder(transcripts, r.start, r.end);

  // A ClinGen region scored 3 for this direction that the change wholly contains, holding this gene.
  const held = data.regions.find(
    ([, , chrom, s, e, rhi, rts]) =>
      chrom === r.chrom && r.start <= s && r.end >= e && s <= (t.cds_end ?? 0) && e >= (t.cds_start ?? 0) && (r.dir === "loss" ? rhi : rts) === "3", // prettier-ignore
  );
  const region = held
    ? { id: held[0], name: held[1], score: "3", disease: r.dir === "loss" ? held[7] : held[8] }
    : null;

  // Other reviewed, focal ClinVar changes in the same direction over the same part of this gene.
  const overlaps = { harmful: 0, uncertain: 0, harmless: 0 };
  for (const [id, s, e, dir, clnsig, revstat] of data.clinvar[r.chrom] ?? []) {
    if (s > (t.cds_end ?? 0)) break;
    if (dir !== r.dir || Number(id) === clinvarId || (s === r.start && e === r.end)) continue;
    const y = extentOf(t, s, e);
    if (!y || ["none", "conflicting"].includes(reviewLevel(revstat.replace(/_/g, " ")))) continue;
    if (genesUnder(transcripts, s, e).length > 3) continue;
    const samePart = x.whole ? y.whole : !(y.exons.last < x.exons.first || y.exons.first > x.exons.last);
    const g = group(clnsig);
    if (samePart && g !== "other") overlaps[g]++;
  }

  const disease = r.dir === "gain" ? (region?.disease ?? tsDisease) : (region?.disease ?? null);
  const label = disease ? data.labels[disease] : undefined;
  const lost = r.dir === "loss";
  const copies =
    r.stated ?? (lost ? (r.both || cx.usual === 1 ? 0 : cx.usual - 1) : r.both ? cx.usual + 2 : cx.usual + 1);
  return {
    dir: r.dir,
    type: r.spelled ? "Deletion" : lost ? "copy number loss" : "copy number gain",
    name: `chr${r.chrom}:${r.start}-${r.end}x${copies}`,
    chrom: r.chrom,
    start: r.start,
    end: r.end,
    size: r.end - r.start + 1,
    copies,
    copiesStated: r.stated !== null,
    transcript: t.transcript,
    where: x.whole ? "whole" : x.startIn ? "start" : x.stopIn ? (x.onlyLast ? "last-exon" : "end") : "inside",
    whole: x.whole,
    exons: x.whole ? null : x.exons,
    fullExons: x.fullExons,
    share: +x.share.toFixed(4),
    inFrame: x.whole ? null : x.inFrame,
    plen: x.plen,
    genes: under.length,
    others: under.filter((g) => g !== t.symbol),
    codingGenes: codingGenes(data.proteinCoding[r.chrom], r.start, r.end),
    rating: { hi, ts, hiDisease, tsDisease },
    region,
    overlaps,
    rarity: { measured: false, source: "gnomAD-SV v4 (not in the bundle yet)" },
    condition: disease && label ? { id: disease, label } : null,
  };
}

/** The record as the bundle and the drawings take it: one joined variant per gene, no letters to annotate. */
export function joinedCopyNumber(
  r: CopyNumberRecord,
  t: TranscriptModel,
  cv: ClinVarHit | null,
  usual: number,
): JoinedVariant {
  const chrom = `chr${r.chrom}`;
  const pos = r.start - 1;
  const tag = r.dir === "loss" ? "DEL" : "DUP";
  // The end is part of the allele, so two changes that start together stay two findings.
  const alt = `<${tag}>${r.end}`;
  return {
    chrom,
    pos,
    ref: r.spelled ? r.ref[0] : r.ref,
    alt,
    gt: usual === 1 ? "1" : r.both ? "1/1" : "0/1",
    normalized: true,
    original_pos: pos,
    original_ref: r.ref,
    original_alt: r.alt,
    gene: t.symbol,
    transcript: t.transcript,
    strand: t.strand,
    exon_index: null,
    cds_offset: null,
    splice_distance: null,
    cds_distance: 0,
    region: "cds",
    consequence: r.dir === "loss" ? "gene_deletion" : "copy_gain",
    hgvs_c: `g.${r.start}_${r.end}${r.dir === "loss" ? "del" : "dup"}`,
    hgvs_p: null,
    codon_ref: null,
    codon_alt: null,
    aa_ref: null,
    aa_alt: null,
    exon_edge: null,
    clinvar: cv ?? { absent: true, reason: "not_in_table" },
    gnomad: { absent: true, reason: "outside_scope" },
    alphamissense: { absent: true, reason: "not_missense" },
  };
}

/** P2's and P3's facts for a copy-number finding. */
export function p23CopyNumber(
  v: JoinedVariant,
  symbol: string,
  zygosity: string,
  cv: ClinVarRecord | null,
  cnv: CnvFacts,
  gene: GeneInfo | undefined,
  copiesX: 1 | 2 | null,
): P23Facts {
  const modes = gene?.modes ?? [];
  const revstat = cv?.clnrevstat.replace(/_/g, " ").replace(/ ,/g, ",") ?? "";
  return {
    key: `${v.chrom}:${v.pos}:${v.ref}:${v.alt}`.replace(/^chr/, ""),
    gene: symbol,
    chrom: cnv.chrom,
    hgvs_c: null,
    consequence: cnv.dir === "loss" ? "copy_number_loss" : "copy_number_gain",
    clinvar: cv && { id: String(cv.variation_id), clnsig: cv.clnsig, class: clinvarClass(cv.clnsig), review: reviewLevel(revstat), revstat, stars: cv.review_stars, conf: cv.conf }, // prettier-ignore
    gnomad: null,
    am: null,
    mode: modes.length ? governingMode(modes, zygosity === "hom" || zygosity === "compound_het_unphased") : null,
    patterns: Object.fromEntries(Object.entries(gene?.conditions ?? {}).map(([mode, c]) => [mode, { label: c.label, validity: c.validity }])), // prettier-ignore
    set: "yours",
    zygosity,
    copiesX,
    p1: null,
    dosage: { hi: gene?.dosage.hi ?? null, lofKnown: gene?.dosage.lofKnown ?? 0 },
    cnv,
  };
}

/** The copies of a chromosome a person has at a position before any change: one on X outside the shared ends, with one X. */
export const usualCopies = (chrom: string, pos: number, copiesX: 1 | 2 | null): number =>
  chrom.replace(/^chr/, "") === "X" && copiesX === 1 && !inPar(pos) ? 1 : 2;
