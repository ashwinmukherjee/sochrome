// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/** Core types for the spine pipeline.
 *  Types are the spec — every stage consumes and produces these. */

// ── Stage 1: Parse ──

export interface VcfRecord {
  chrom: string;
  pos: number; // 1-based
  id: string;
  ref: string;
  alt: string; // single allele (multi-allelic split in normalize)
  qual: number;
  filter: string;
  info: string;
  gt: string; // e.g. "0/1", "1/1"
}

// ── Stage 2: Normalize ──

export interface NormalizedVariant {
  chrom: string;
  pos: number; // 1-based, left-aligned
  ref: string;
  alt: string;
  gt: string;
  normalized: boolean; // false: indel outside the shipped reference, input form kept
  original_pos: number;
  original_ref: string;
  original_alt: string;
}

// ── Stage 3: Pin ──

export interface PinnedVariant extends NormalizedVariant {
  gene: string | null;
  transcript: string | null;
  strand: "+" | "-" | null;
  exon_index: number | null; // 0-based in transcript order
  cds_offset: number | null; // 0-based offset from CDS start in coding sequence
  splice_distance: number | null; // distance to nearest exon boundary, null if exonic
  cds_distance: number | null; // bp to nearest CDS segment of the transcript (0 inside), null if non-coding
  region: "cds" | "utr5" | "utr3" | "intronic" | "intergenic";
}

// ── Stage 4: Annotate ──

export type Consequence =
  | "frameshift"
  | "stop_gained"
  | "start_lost"
  | "stop_lost"
  | "splice_donor"
  | "splice_acceptor"
  | "splice_region"
  | "missense"
  | "synonymous"
  | "synonymous_splice_region"
  | "inframe_indel"
  | "intronic"
  | "utr"
  | "intergenic"
  // O5: what the structural-variant reader will produce; nothing emits them yet
  | "gene_deletion"
  | "copy_gain"
  | "inversion"
  | "complex_rearrangement";

export interface AnnotatedVariant extends PinnedVariant {
  consequence: Consequence;
  hgvs_c: string | null;
  hgvs_p: string | null;
  codon_ref: string | null;
  codon_alt: string | null;
  aa_ref: string | null;
  aa_alt: string | null;
  /** CDS variants within EXON_EDGE (3) bases of an internal exon junction: the distance,
   *  1 = the base next to the junction. null elsewhere. A change here can also weaken
   *  the cut (the exon side of the splice signal), whatever it does to the protein. */
  exon_edge: number | null;
}

// ── Stage 5: Join ──

export interface ClinVarHit {
  variation_id: number;
  clnsig: string;
  review_stars: number;
  clnrevstat: string;
  hgvs_c: string;
}

export interface GnomadHit {
  af_grpmax: number | null; // null: not carried (gnomAD gave none)
  af_global: number | null; // INFO/AF; null: not carried by the current slim files
  grpmax_pop: string;
  nhomalt: number;
  filter: string; // "PASS" or flags joined by ";" — provenance, not a gate
}

export interface AlphaMissenseHit {
  score: number;
  am_class: string;
}

export type Absence = {
  absent: true;
  reason: "not_in_table" | "outside_scope" | "not_missense" | "ac0" | "grpmax_missing";
};

export interface JoinedVariant extends AnnotatedVariant {
  clinvar: ClinVarHit | Absence;
  gnomad: GnomadHit | Absence;
  alphamissense: AlphaMissenseHit | Absence;
}

// ── Stage 6: Bundle ──
// The frozen data contract: claim-keyed, hard object-type polymorphism, foreclosure as a value.

/** A foreclosed field: the reason is the value. */
export interface Foreclosed<R extends string> {
  absent: true;
  reason: R;
}

export type ObjectType = "mendelian" | "polygenic" | "pgx" | "negative_screen";

export type SampleSex = "female" | "male" | "unknown";

export interface Identity {
  gene: string;
  transcript: string; // MANE Select
  hgvs_c: string;
  hgvs_p:
    | string
    | Foreclosed<
        "no protein change asserted" | "not computed for inframe indel" | "not computed for multi-nucleotide variant"
      >;
  normalized_key: string; // chrom:pos:ref:alt, left-aligned
  consequence: Consequence;
  splice_distance: number | Foreclosed<"exonic">;
  exon_edge: number | Foreclosed<"not at an exon edge">;
}

export type ZygosityFlag = "sex_unknown";

export type Zygosity =
  | { state: "het" | "hom" | "hemi"; flags: ZygosityFlag[] }
  | { state: "compound_het_unphased"; with: string[]; flags: ZygosityFlag[] }; // with: normalized keys

/** SD: semidominant (one altered copy causes the condition, two a more severe one); dominant
 *  for the carrier split. */
export type InheritanceMode = "AD" | "SD" | "AR" | "XL" | "other";

/** EVERY PATTERN A GENE HAS. `modes`: every pattern the gene has a curated
 *  condition for (ClinGen, Moderate or better), from the pack's inheritance table. `mode`: the one
 *  that governs this record given its copies (governingMode in funnel.ts): with one altered copy a
 *  dominant pattern wins (one harmful copy of BRCA1 is a cancer risk, not carrier status); with
 *  two copies (hom, or two changes in the gene) the recessive one does. */
export interface Inheritance {
  mode: InheritanceMode | Foreclosed<"no mode recorded">;
  modes: InheritanceMode[];
}

/** What would update a claim; empty when settled. */
export type WhatWouldUpdate = string[] | Foreclosed<"derived for pathogenicity only">;

export interface PathogenicityClaim {
  kind: "pathogenicity";
  /** clnsig: the first "|"-part of ClinVar CLNSIG, verbatim — the classification.
   *  qualifiers: the remaining "|"-parts, verbatim and in ClinVar's order. */
  value: { clnsig: string; qualifiers: string[]; review_stars: number } | Foreclosed<"not_in_table">;
  uncertainty: "epistemic";
  source: { table: "clinvar"; pack_date: string; variation_id: number | Foreclosed<"not_in_table"> };
  what_would_update: string[];
}

export interface FrequencyClaim {
  kind: "frequency";
  value:
    | { af: number; basis: "af_grpmax"; pop: string }
    | { af: number; basis: "af_global" }
    | Foreclosed<"not_in_table" | "outside_scope" | "ac0" | "grpmax_missing">;
  uncertainty: "measured";
  source: {
    table: "gnomad";
    pack_date: string;
    filter: string | Foreclosed<"no gnomad record">;
    af_global: number | Foreclosed<"no gnomad record">; // INFO/AF: provenance, whatever the basis
  };
  what_would_update: WhatWouldUpdate;
}

/** Calibration query-key coordinates (contract: modality · distance-to-target ·
 *  raw-effect-vs-floor · cell-track-match · de-circ channel). The render queries
 *  the surface with these; the shape ships before the surface exists. */
export interface CalibrationKey {
  modality: Foreclosed<"calibration surface not built">;
  distance_to_target: Foreclosed<"calibration surface not built">;
  raw_effect_vs_floor: Foreclosed<"calibration surface not built">;
  cell_track_match: Foreclosed<"calibration surface not built">;
  decirc_channel: Foreclosed<"calibration surface not built">;
}

export interface ComputationalClaim {
  kind: "computational";
  value: { score: number; am_class: string } | Foreclosed<"not_missense" | "not_in_table">;
  uncertainty: "predicted";
  source: { table: "alphamissense"; pack_date: string };
  calibration_key: CalibrationKey;
  what_would_update: WhatWouldUpdate;
}

export type PenetranceForeclosure =
  "upstream unresolved" | "no estimate for gene" | "recessive carrier: question malformed";

export interface PenetranceClaim {
  kind: "penetrance";
  value: Foreclosed<PenetranceForeclosure>;
  uncertainty: "aleatoric";
  source: Foreclosed<"penetrance table not built">;
  what_would_update: WhatWouldUpdate;
}

export type Claim = PathogenicityClaim | FrequencyClaim | ComputationalClaim | PenetranceClaim;

export interface MendelianBundle {
  object_type: "mendelian";
  identity: Identity;
  zygosity: Zygosity;
  inheritance: Inheritance;
  claims: [PathogenicityClaim, FrequencyClaim, ComputationalClaim, PenetranceClaim];
}

/** Reserved object types: present in the contract, constructing one throws. */
export interface ReservedBundle {
  object_type: "polygenic" | "pgx" | "negative_screen";
}

export type Bundle = MendelianBundle | ReservedBundle;

// ── Table index types ──

export interface TranscriptModel {
  symbol: string;
  transcript: string;
  chrom: string;
  strand: "+" | "-";
  cds_start: number | null; // genomic, always lower; null for non-coding RNA
  cds_end: number | null; // genomic, always higher; null for non-coding RNA
  exons: [number, number][]; // [start, end] genomic, sorted ascending
}

export interface ReferenceWindow {
  start: number; // 1-based genomic start
  end: number; // 1-based genomic end (inclusive)
  symbol: string;
  offset: number; // byte offset from file start
  bytes: number; // total chunk bytes (8-byte header + packed data)
}

/** Reference index: flat array of windows from the JSON sidecar. */
export type ReferenceIndex = ReferenceWindow[];

// ── Binary table codec ──

export interface PackedTable {
  count: number;
  positions: Uint32Array;
  offsets: Uint32Array;
  payload: DataView;
}

// ── Pipeline config ──
