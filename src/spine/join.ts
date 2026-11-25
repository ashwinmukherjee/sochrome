// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/** Stage 5: Join — look up each annotated variant in ClinVar, gnomAD,
 *  and AlphaMissense packed tables. Absence is a value.
 *
 *  gnomAD scope tracking: variants outside CDS ± 8 bp windows get
 *  reason "outside_scope" (they were never in the gnomAD table).
 *  Variants inside a window but not found get "not_in_table". */

import type {
  AnnotatedVariant,
  JoinedVariant,
  ClinVarHit,
  GnomadHit,
  AlphaMissenseHit,
  Absence,
  PackedTable,
} from "../contracts/types.ts";
import { lookupExact, lookupClinVar as clinvarRecord, readGnomadPayload, readAlphaMissensePayload } from "./tables.ts";

/** A BED-style window: [start, end) where start is 0-based. */
export interface GnomadWindow {
  start: number; // 0-based
  end: number; // exclusive
}

/** Check if a 1-based position falls in any window.
 *  Windows must be sorted by start. */
function inAnyWindow(pos: number, windows: GnomadWindow[]): boolean {
  // Binary search for the window.
  let lo = 0;
  let hi = windows.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (windows[mid].end < pos) lo = mid + 1;
    else hi = mid;
  }
  if (lo >= windows.length) return false;
  // pos is 1-based; BED start is 0-based, end is exclusive.
  // A 1-based position p is in [start, end) when p > start && p <= end
  // (since BED start 0-based → genomic start+1 is first covered position).
  return pos > windows[lo].start && pos <= windows[lo].end;
}

/** Parse a BED file string into GnomadWindow[]. */
export function parseGnomadWindows(bedText: string): GnomadWindow[] {
  const windows: GnomadWindow[] = [];
  for (const line of bedText.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    windows.push({
      start: parseInt(parts[1], 10),
      end: parseInt(parts[2], 10),
    });
  }
  windows.sort((a, b) => a.start - b.start);
  return windows;
}

/** Look up a variant in ClinVar. */
function lookupClinVar(v: AnnotatedVariant, table: PackedTable | null): ClinVarHit | Absence {
  if (!table) return { absent: true, reason: "not_in_table" };

  return clinvarRecord(table, v.pos, v.ref, v.alt) ?? { absent: true, reason: "not_in_table" };
}

/** Look up a variant in gnomAD with scope tracking. */
function lookupGnomad(
  v: AnnotatedVariant,
  table: PackedTable | null,
  gnomadWindows: GnomadWindow[] | null,
): GnomadHit | Absence {
  if (!table) return { absent: true, reason: "not_in_table" };

  // Check if position is in any gnomAD window.
  if (gnomadWindows && !inAnyWindow(v.pos, gnomadWindows)) {
    return { absent: true, reason: "outside_scope" };
  }

  const off = lookupExact(table, v.pos, v.ref, v.alt);
  if (off === null) return { absent: true, reason: "not_in_table" };

  const hit = readGnomadPayload(table.payload, off);
  // AC0: the allele failed QC entirely — unobserved, not a frequency.
  if (hit.filter.split(";").includes("AC0")) return { absent: true, reason: "ac0" };
  // No grpmax and no global AF carried (pending re-slice with INFO/AF).
  if (hit.af_grpmax === null && hit.af_global === null) {
    return { absent: true, reason: "grpmax_missing" };
  }
  return hit;
}

/** Look up a variant in AlphaMissense.
 *  Only missense variants have AM scores. */
function lookupAlphaMissense(v: AnnotatedVariant, table: PackedTable | null): AlphaMissenseHit | Absence {
  if (v.consequence !== "missense") {
    return { absent: true, reason: "not_missense" };
  }
  if (!table) return { absent: true, reason: "not_in_table" };

  const off = lookupExact(table, v.pos, v.ref, v.alt);
  if (off === null) return { absent: true, reason: "not_in_table" };

  return readAlphaMissensePayload(table.payload, off);
}

/** Join a single variant against all tables. */
export function joinVariant(
  v: AnnotatedVariant,
  clinvarTable: PackedTable | null,
  gnomadTable: PackedTable | null,
  amTable: PackedTable | null,
  gnomadWindows: GnomadWindow[] | null = null,
): JoinedVariant {
  return {
    ...v,
    clinvar: lookupClinVar(v, clinvarTable),
    gnomad: lookupGnomad(v, gnomadTable, gnomadWindows),
    alphamissense: lookupAlphaMissense(v, amTable),
  };
}

/** Join all variants. */
export function join(
  variants: AnnotatedVariant[],
  clinvarTable: PackedTable | null,
  gnomadTable: PackedTable | null,
  amTable: PackedTable | null,
  gnomadWindows: GnomadWindow[] | null = null,
): JoinedVariant[] {
  return variants.map((v) => joinVariant(v, clinvarTable, gnomadTable, amTable, gnomadWindows));
}
