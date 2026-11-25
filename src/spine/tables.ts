// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/** Binary table reader for packed annotation files.
 *  Format: uint32 count, uint32[count] positions, uint32[count] offsets, payload bytes.
 *  Lookup: binary search on positions, then ref/alt string match in payload. */

import type { ClinVarHit, GnomadHit, PackedTable, ReferenceIndex } from "../contracts/types.ts";

/** Parse a packed binary table from an ArrayBuffer. */
export function loadPackedTable(buf: ArrayBuffer): PackedTable {
  const dv = new DataView(buf);
  const count = dv.getUint32(0, true);
  const posStart = 4;
  const offStart = posStart + count * 4;
  const payStart = offStart + count * 4;

  const positions = new Uint32Array(buf, posStart, count);
  const offsets = new Uint32Array(buf, offStart, count);
  const payload = new DataView(buf, payStart);

  return { count, positions, offsets, payload };
}

/** Binary search for the first index where positions[i] >= target. */
function lowerBound(positions: Uint32Array, target: number): number {
  let lo = 0;
  let hi = positions.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (positions[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Read a length-prefixed ASCII string from a DataView.
 *  Returns [string, bytes_consumed]. Length prefix is uint16. */
function readString16(dv: DataView, offset: number): [string, number] {
  const len = dv.getUint16(offset, true);
  const bytes = new Uint8Array(dv.buffer, dv.byteOffset + offset + 2, len);
  return [new TextDecoder().decode(bytes), 2 + len];
}

/** Look up all records at a given position. Returns payload offsets
 *  (relative to payload start) for records matching pos + ref + alt. */
export function lookupExact(table: PackedTable, pos: number, ref: string, alt: string): number | null {
  let idx = lowerBound(table.positions, pos);
  while (idx < table.count && table.positions[idx] === pos) {
    const off = table.offsets[idx];
    const [recRef, refConsumed] = readString16(table.payload, off);
    const [recAlt] = readString16(table.payload, off + refConsumed);
    if (recRef === ref && recAlt === alt) {
      return off + refConsumed + 2 + recAlt.length;
    }
    idx++;
  }
  return null;
}

// ── ClinVar payload, format 2 (the data repo's pack_clinvar2.py): uint32 variation_id,
//    uint8 n + n x uint8 clnsig units, uint8 review_stars, uint8 clnrevstat,
//    uint16 hgvs_c_len, hgvs_c bytes, uint8 k + k x (uint8 clnsig unit, uint16 labs),
//    uint8 m + m x uint32 MONDO numbers. The table's first record sits at position 0
//    with ref "clinvar" and alt "2": it names the format and is no variant. ──

// Mirrors CLNSIG_CODES in the data repo's pack.py; codes start at 1. A record's
// CLNSIG is its units joined by "|", in ClinVar's order and spelling.
const CLNSIG_NAMES: Record<number, string> = {
  1: "Benign",
  2: "Likely_benign",
  3: "Uncertain_significance",
  4: "Likely_pathogenic",
  5: "Pathogenic",
  6: "Pathogenic/Likely_pathogenic",
  7: "Benign/Likely_benign",
  8: "Conflicting_classifications_of_pathogenicity",
  9: "not_provided",
  10: "drug_response",
  11: "risk_factor",
  12: "association",
  13: "protective",
  14: "Affects",
  15: "other",
  16: "no_germline_classification",
  17: "no_classification_for_the_single_variant",
  18: "no_classifications_from_unflagged_records",
  19: "confers_sensitivity",
  20: "association_not_found",
  21: "Pathogenic,_low_penetrance",
  22: "Likely_pathogenic,_low_penetrance",
  23: "Pathogenic/Pathogenic,_low_penetrance",
  24: "Likely_pathogenic/Pathogenic,_low_penetrance",
  25: "Likely_pathogenic/Likely_pathogenic,_low_penetrance",
  26: "Pathogenic/Likely_pathogenic,_low_penetrance",
  27: "Pathogenic/Likely_pathogenic/Pathogenic,_low_penetrance",
  28: "Pathogenic/Likely_pathogenic/Likely_pathogenic,_low_penetrance",
  29: "Established_risk_allele",
  30: "Likely_risk_allele",
  31: "Uncertain_risk_allele",
  32: "Uncertain_significance/Uncertain_risk_allele",
  33: "Pathogenic/Likely_risk_allele",
  34: "Likely_pathogenic/Likely_risk_allele",
  35: "Pathogenic/Likely_pathogenic/Likely_risk_allele",
  36: "Pathogenic/Likely_pathogenic/Established_risk_allele",
  37: "Pathogenic/Likely_pathogenic/Pathogenic,_low_penetrance/Established_risk_allele",
  38: "VUS-high",
  39: "VUS-mid",
  40: "VUS-low",
  41: "Uncertain_significance/VUS-high",
  42: "Uncertain_significance/VUS-mid",
  43: "Uncertain_significance/VUS-low",
};

function clnsigUnit(code: number): string {
  const name = CLNSIG_NAMES[code];
  if (name === undefined) throw new Error(`unknown ClinVar CLNSIG code ${code}`);
  return name;
}

// Mirrors REVSTAT_CODES in the data repo's pack.py; codes start at 1.
const REVSTAT_NAMES: Record<number, string> = {
  1: "practice_guideline",
  2: "reviewed_by_expert_panel",
  3: "criteria_provided,_multiple_submitters,_no_conflicts",
  4: "criteria_provided,_conflicting_classifications",
  5: "criteria_provided,_single_submitter",
  6: "no_assertion_criteria_provided",
  7: "no_classification_provided",
  8: "no_classification_for_the_single_variant",
  9: "no_classifications_from_unflagged_records",
  10: "no_germline_review_status",
};

function revstatName(code: number): string {
  const name = REVSTAT_NAMES[code];
  if (name === undefined) throw new Error(`unknown ClinVar review-status code ${code}`);
  return name;
}

/** A ClinVar record as format 2 carries it. */
export interface ClinVarRecord extends ClinVarHit {
  /** How the labs split on a conflicting variant: CLNSIG unit to its number of labs. null: no conflict recorded. */
  conf: Record<string, number> | null;
  /** The variant's own conditions, as MONDO ids ("MONDO:0011450"), in ClinVar's order. */
  mondo: string[];
}

/** Whether a hit carries format 2's fields: the contract's ClinVarHit does not name them. */
export function isClinVarRecord(cv: ClinVarHit): cv is ClinVarRecord {
  return "conf" in cv && "mondo" in cv;
}

export const CLINVAR_FORMAT = 2;

const checkedTables = new WeakSet<PackedTable>();

/** Refuse a ClinVar table that is not format 2: an earlier table would be misread, not rejected, by its bytes alone. */
function assertClinVarFormat(table: PackedTable): void {
  if (checkedTables.has(table)) return;
  const marked = table.count > 0 && table.positions[0] === 0 && lookupExact(table, 0, "clinvar", String(CLINVAR_FORMAT)) !== null; // prettier-ignore
  if (!marked) throw new Error(`the ClinVar table is not format ${CLINVAR_FORMAT}`);
  checkedTables.add(table);
}

/** The ClinVar record for an exact pos, ref and alt, or null. */
export function lookupClinVar(table: PackedTable, pos: number, ref: string, alt: string): ClinVarRecord | null {
  assertClinVarFormat(table);
  const off = lookupExact(table, pos, ref, alt);
  return off === null ? null : readClinVarPayload(table.payload, off);
}

function readClinVarPayload(dv: DataView, payloadFieldOffset: number): ClinVarRecord {
  let off = payloadFieldOffset;
  const variation_id = dv.getUint32(off, true);
  off += 4;
  const units = dv.getUint8(off);
  off += 1;
  if (units === 0) throw new Error(`ClinVar record ${variation_id} has no CLNSIG unit`);
  const clnsig: string[] = [];
  for (let i = 0; i < units; i++) clnsig.push(clnsigUnit(dv.getUint8(off + i)));
  off += units;
  const review_stars = dv.getUint8(off);
  off += 1;
  const clnrevstatCode = dv.getUint8(off);
  off += 1;
  const [hgvs_c, hgvsBytes] = readString16(dv, off);
  off += hgvsBytes;
  const splits = dv.getUint8(off);
  off += 1;
  const conf: Record<string, number> = {};
  for (let i = 0; i < splits; i++, off += 3) conf[clnsigUnit(dv.getUint8(off))] = dv.getUint16(off + 1, true);
  const conditions = dv.getUint8(off);
  off += 1;
  const mondo: string[] = [];
  for (let i = 0; i < conditions; i++, off += 4)
    mondo.push(`MONDO:${String(dv.getUint32(off, true)).padStart(7, "0")}`);

  return {
    variation_id,
    clnsig: clnsig.join("|"),
    review_stars,
    clnrevstat: revstatName(clnrevstatCode),
    hgvs_c,
    conf: splits ? conf : null,
    mondo,
  };
}

// ── gnomAD payload: float32 af_grpmax, uint8 grpmax_pop, uint16 nhomalt, uint8 filter, float32 af_global ──
// af_grpmax and af_global are NaN when not carried; read as null.

const POP_NAMES: Record<number, string> = {
  1: "afr",
  2: "ami",
  3: "amr",
  4: "asj",
  5: "eas",
  6: "fin",
  7: "mid",
  8: "nfe",
  9: "sas",
  10: "remaining",
};

// FILTER bitmask; 0 = PASS. Mirrors FILTER_BITS in the data repo's pack.py.
const FILTER_BITS: [number, string][] = [
  [1, "AC0"],
  [2, "AS_VQSR"],
  [4, "InbreedingCoeff"],
];

export function decodeGnomadFilter(code: number): string {
  if (code === 0) return "PASS";
  const names = FILTER_BITS.filter(([bit]) => code & bit).map(([, n]) => n);
  if (names.length === 0 || code & ~7) throw new Error(`unknown gnomAD filter code ${code}`);
  return names.join(";");
}

export function readGnomadPayload(dv: DataView, payloadFieldOffset: number): GnomadHit {
  let off = payloadFieldOffset;
  const grpmax = dv.getFloat32(off, true);
  off += 4;
  const popCode = dv.getUint8(off);
  off += 1;
  const nhomalt = dv.getUint16(off, true);
  off += 2;
  const filter = decodeGnomadFilter(dv.getUint8(off));
  off += 1;
  const global = dv.getFloat32(off, true);

  return {
    af_grpmax: Number.isNaN(grpmax) ? null : grpmax,
    af_global: Number.isNaN(global) ? null : global,
    grpmax_pop: POP_NAMES[popCode] ?? `unknown(${popCode})`,
    nhomalt,
    filter,
  };
}

// ── AlphaMissense payload: uint8 score (0-255 → 0.0-1.0) ──
// Class is derived from score using AlphaMissense published cutoffs:
//   score < 0.34 → likely_benign
//   score < 0.564 → ambiguous
//   else → likely_pathogenic

export function readAlphaMissensePayload(
  dv: DataView,
  payloadFieldOffset: number,
): { score: number; am_class: string } {
  const raw = dv.getUint8(payloadFieldOffset);
  const score = raw / 255;
  const am_class = score < 0.34 ? "likely_benign" : score < 0.564 ? "ambiguous" : "likely_pathogenic";
  return { score, am_class };
}

// ── Reference sequence (2-bit packed) ──

const BASES = ["A", "C", "G", "T"] as const;

export function loadReferenceIndex(json: string): ReferenceIndex {
  return JSON.parse(json) as ReferenceIndex;
}

/** Get a reference sequence substring.
 *  refBin: the full reference binary buffer.
 *  index: parsed reference index JSON (flat array of windows).
 *  pos: 1-based genomic position.
 *  length: number of bases to fetch.
 *
 *  Binary format per window at offset:
 *    uint32 start_pos, uint32 length_bp, then ceil(length_bp/4) bytes of 2-bit data.
 *  Encoding: A=0, C=1, G=2, T=3, MSB-first, 4 bases per byte. */
export function getRefBases(refBin: ArrayBuffer, index: ReferenceIndex, pos: number, length: number): string | null {
  const dv = new DataView(refBin);

  for (const w of index) {
    if (pos >= w.start && pos + length - 1 <= w.end) {
      // Data starts after the 8-byte header (uint32 start + uint32 len).
      const dataOffset = w.offset + 8;
      const relStart = pos - w.start;
      let result = "";
      for (let i = 0; i < length; i++) {
        const baseIdx = relStart + i;
        const byteIdx = Math.floor(baseIdx / 4);
        const bitShift = 6 - (baseIdx % 4) * 2;
        const byte = dv.getUint8(dataOffset + byteIdx);
        const code = (byte >> bitShift) & 0x03;
        result += BASES[code];
      }
      return result;
    }
  }
  return null;
}
