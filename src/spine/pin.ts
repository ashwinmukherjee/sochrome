// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/** Stage 3: Pin — assign each variant to a gene and transcript.
 *  For each variant, find the transcript whose window contains it,
 *  then determine: exon/intron/UTR, CDS offset, splice distance. */

import type { NormalizedVariant, PinnedVariant, TranscriptModel } from "../contracts/types.ts";

/** Build a sorted list of transcript models for efficient lookup. */
export function buildTranscriptIndex(models: TranscriptModel[]): TranscriptModel[] {
  // Non-coding transcripts have no CDS; order them by first exon.
  const key = (t: TranscriptModel) => t.cds_start ?? t.exons[0][0];
  return [...models].sort((a, b) => key(a) - key(b));
}

/** Distance in bp from pos (or the span pos..end) to the nearest CDS segment of tx (exon ∩ CDS);
 *  0 inside one, null when tx has no CDS (non-coding RNA). */
/** THE BASES A VARIANT CHANGES, not its VCF anchor (ClinVar check): a deletion is
 *  written from the base before it, so STK11 c.735-6_735-2del (pos 10 letters into the intron)
 *  and ATM c.1608-13_1626del (which reaches into the exon) measured 10 and 14 letters from the
 *  coding sequence and fell at cut 2. The span is the record's ref, anchor included. */
export const spanEnd = (v: { pos: number; ref: string }) => v.pos + Math.max(1, v.ref.length) - 1;
/** The first changed base: past the anchor of an anchored deletion (CSF1R c.308-11_308-9del,
 *  anchored at -12, must measure 9 letters out, not 8). */
export const spanStart = (v: { pos: number; ref: string; alt: string }) =>
  v.ref.length > v.alt.length && v.ref[0] === v.alt[0] ? v.pos + 1 : v.pos;
export function cdsDistance(pos: number, tx: TranscriptModel, end: number = pos): number | null {
  if (tx.cds_start === null || tx.cds_end === null) return null;
  let best = Infinity;
  for (const [es, ee] of tx.exons) {
    const s = Math.max(es, tx.cds_start);
    const e = Math.min(ee, tx.cds_end);
    if (s > e) continue;
    if (pos <= e && end >= s) return 0;
    best = Math.min(best, end < s ? s - end : pos - e);
  }
  return best === Infinity ? null : best;
}

/** The transcripts a variant is pinned to: one per gene whose CDS ± 8 bp covers it (a
 *  variant in two genes' coding sequence, e.g. the MYH11/NDE1 overlap, gets a row for each),
 *  else the first whose exon span ± 10 kb covers it, else none (intergenic). */
export function pinTargets(v: NormalizedVariant, transcripts: TranscriptModel[]): TranscriptModel[] {
  const coding: TranscriptModel[] = [];
  let first: TranscriptModel | null = null;
  for (const tx of transcripts) {
    if (tx.chrom !== v.chrom) continue;
    // Sorted by CDS start (buildTranscriptIndex): past pos + 8, no later CDS can cover it, and
    // a later window-only match can't beat one already found.
    if (tx.cds_start !== null && tx.cds_start - 8 > spanEnd(v) && (coding.length || first)) break;
    // Gene window: min exon start - 10000 to max exon end + 10000.
    const geneStart = tx.exons[0][0] - 10000;
    const geneEnd = tx.exons[tx.exons.length - 1][1] + 10000;
    if (v.pos < geneStart || v.pos > geneEnd) continue;
    const d = cdsDistance(spanStart(v), tx, spanEnd(v));
    if (d !== null && d <= 8 && !coding.some((c) => c.symbol === tx.symbol)) coding.push(tx);
    if (first === null) first = tx;
  }
  return coding.length ? coding : first ? [first] : [];
}

/** Pin a single variant to its first target transcript. */
export function pinVariant(v: NormalizedVariant, transcripts: TranscriptModel[]): PinnedVariant {
  return pinTo(v, pinTargets(v, transcripts)[0] ?? null);
}

/** Pin a variant to one transcript (null: intergenic). */
function pinTo(v: NormalizedVariant, chosen: TranscriptModel | null): PinnedVariant {
  if (chosen !== null) {
    const tx = chosen;
    // Found a transcript. Determine region.
    const exons = tx.exons; // [start, end] sorted ascending genomically
    const strand = tx.strand;

    // Check if position is in an exon.
    let inExonGenomic: number | null = null;
    let exonStart = 0;
    let exonEnd = 0;
    for (let i = 0; i < exons.length; i++) {
      if (v.pos >= exons[i][0] && v.pos <= exons[i][1]) {
        inExonGenomic = i;
        exonStart = exons[i][0];
        exonEnd = exons[i][1];
        break;
      }
    }

    // Convert genomic exon index to transcript-order exon index.
    const exonIndexTranscript =
      inExonGenomic !== null ? (strand === "-" ? exons.length - 1 - inExonGenomic : inExonGenomic) : null;

    // Splice distance: distance to nearest exon boundary (for intronic variants).
    let splice_distance: number | null = null;
    if (inExonGenomic === null) {
      // Find the nearest exon boundary.
      let minDist = Infinity;
      for (const [es, ee] of exons) {
        const distToStart = Math.abs(v.pos - es);
        const distToEnd = Math.abs(v.pos - ee);
        minDist = Math.min(minDist, distToStart, distToEnd);
      }
      if (minDist < Infinity) splice_distance = minDist;
    }

    // Determine region (CDS, UTR, intronic).
    let region: PinnedVariant["region"];
    let cds_offset: number | null = null;

    if (inExonGenomic !== null && tx.cds_start !== null && tx.cds_end !== null) {
      // In an exon — is it CDS or UTR?
      if (v.pos >= tx.cds_start && v.pos <= tx.cds_end) {
        region = "cds";
        // Compute CDS offset (0-based from CDS start in coding sequence).
        cds_offset = computeCdsOffset(v.pos, tx);
      } else if (strand === "+") {
        region = v.pos < tx.cds_start ? "utr5" : "utr3";
      } else {
        region = v.pos > tx.cds_end ? "utr5" : "utr3";
      }
    } else {
      // Between exons of this gene → intronic.
      const firstExonStart = exons[0][0];
      const lastExonEnd = exons[exons.length - 1][1];
      if (v.pos >= firstExonStart && v.pos <= lastExonEnd) {
        region = "intronic";
      } else {
        // Outside the gene's exon span but within window → still intronic
        // (in the padded region).
        region = "intronic";
      }
    }

    return {
      ...v,
      gene: tx.symbol,
      transcript: tx.transcript,
      strand: tx.strand,
      exon_index: exonIndexTranscript,
      cds_offset,
      splice_distance,
      cds_distance: cdsDistance(spanStart(v), tx, spanEnd(v)),
      region,
    };
  }

  // No transcript found — intergenic.
  return {
    ...v,
    gene: null,
    transcript: null,
    strand: null,
    exon_index: null,
    cds_offset: null,
    splice_distance: null,
    cds_distance: null,
    region: "intergenic",
  };
}

/** Compute 0-based CDS offset from the coding start.
 *  For + strand: count bases from cds_start through exons in ascending order.
 *  For - strand: count bases from cds_end through exons in descending order. */
function computeCdsOffset(pos: number, tx: TranscriptModel): number {
  if (tx.cds_start === null || tx.cds_end === null) {
    throw new Error(`computeCdsOffset on non-coding transcript ${tx.transcript}`);
  }
  const exons = tx.exons;
  let offset = 0;

  if (tx.strand === "+") {
    for (const [es, ee] of exons) {
      const cdsStart = Math.max(es, tx.cds_start);
      const cdsEnd = Math.min(ee, tx.cds_end);
      if (cdsStart > cdsEnd) continue; // Exon entirely outside CDS.
      if (pos >= cdsStart && pos <= cdsEnd) {
        return offset + (pos - cdsStart);
      }
      if (cdsEnd < pos) {
        offset += cdsEnd - cdsStart + 1;
      }
    }
  } else {
    // Minus strand: iterate exons from highest to lowest genomic position.
    for (let i = exons.length - 1; i >= 0; i--) {
      const [es, ee] = exons[i];
      const cdsStart = Math.max(es, tx.cds_start);
      const cdsEnd = Math.min(ee, tx.cds_end);
      if (cdsStart > cdsEnd) continue;
      if (pos >= cdsStart && pos <= cdsEnd) {
        return offset + (cdsEnd - pos);
      }
      if (cdsStart > pos) {
        offset += cdsEnd - cdsStart + 1;
      }
    }
  }

  return offset;
}

/** Pin all variants: one row per target transcript (see pinTargets). */
export function pin(variants: NormalizedVariant[], transcripts: TranscriptModel[]): PinnedVariant[] {
  const sorted = buildTranscriptIndex(transcripts);
  return variants.flatMap((v) => {
    const ts = pinTargets(v, sorted);
    return ts.length ? ts.map((t) => pinTo(v, t)) : [pinTo(v, null)];
  });
}
