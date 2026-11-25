// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/** Stage 2: Normalize — VcfRecord → NormalizedVariant.
 *  1. Trim shared suffix.
 *  2. Trim shared prefix (may empty shorter allele for indels).
 *  3. Left-align indels against the reference window. */

import type { VcfRecord, NormalizedVariant, ReferenceIndex } from "../contracts/types.ts";
import { getRefBases } from "./tables.ts";

/** Extract the indel components from a VCF record.
 *  Returns null for SNVs or MNVs (equal-length substitutions).
 *  For indels, returns the deleted/inserted sequence and the anchor position. */
function extractIndel(
  pos: number,
  ref: string,
  alt: string,
): {
  type: "del" | "ins";
  anchorPos: number;
  indelSeq: string;
} | null {
  // Trim shared prefix (fully — allow shorter allele to become empty).
  let prefixLen = 0;
  while (prefixLen < ref.length && prefixLen < alt.length && ref[prefixLen] === alt[prefixLen]) {
    prefixLen++;
  }
  let r = ref.slice(prefixLen);
  let a = alt.slice(prefixLen);
  const newPos = pos + prefixLen;

  // Trim shared suffix.
  while (r.length > 0 && a.length > 0 && r[r.length - 1] === a[a.length - 1]) {
    r = r.slice(0, -1);
    a = a.slice(0, -1);
  }

  // After trimming: if both non-empty, it's a substitution (SNV/MNV), not an indel.
  if (r.length > 0 && a.length > 0) return null;
  // If both empty, it was an exact match (shouldn't happen in VCF).
  if (r.length === 0 && a.length === 0) return null;

  if (r.length > 0) {
    // Deletion: ref has extra bases.
    return { type: "del", anchorPos: newPos, indelSeq: r };
  } else {
    // Insertion: alt has extra bases.
    return { type: "ins", anchorPos: newPos, indelSeq: a };
  }
}

/** Left-align an indel against the reference.
 *  Takes a pure indel (no anchor) and shifts it left.
 *  Returns the anchored VCF representation, or null when a reference base it
 *  needs is not shipped (the reference covers CDS ± 8 bp plus one anchor base). */
function leftAlignIndel(
  type: "del" | "ins",
  indelPos: number,
  indelSeq: string,
  refBin: ArrayBuffer | null,
  refIndex: ReferenceIndex | null,
): { pos: number; ref: string; alt: string } | null {
  if (!refBin || !refIndex) return null;
  let curPos = indelPos;
  let curSeq = indelSeq;

  // Shift left: while the base before the indel matches the last base
  // of the indel sequence, rotate and shift.
  for (let i = 0; i < 10000; i++) {
    if (curPos <= 1) break;
    const prevBase = getRefBases(refBin, refIndex, curPos - 1, 1);
    if (!prevBase) return null;
    if (prevBase !== curSeq[curSeq.length - 1]) break;

    curSeq = prevBase + curSeq.slice(0, -1);
    curPos--;
  }

  // Anchor is the base just before the indel position (checked above).
  const anchorPos = curPos - 1;
  const anchorBase = getRefBases(refBin, refIndex, anchorPos, 1);
  if (!anchorBase || anchorPos < 1) return null;
  if (type === "del") {
    return { pos: anchorPos, ref: anchorBase + curSeq, alt: anchorBase };
  }
  return { pos: anchorPos, ref: anchorBase, alt: anchorBase + curSeq };
}

/** Normalize a substitution (SNV or MNV) — just trim prefix/suffix. */
function normalizeSubstitution(pos: number, ref: string, alt: string): { pos: number; ref: string; alt: string } {
  // Trim shared prefix (keep at least 1 base in each).
  let prefixLen = 0;
  while (prefixLen < ref.length - 1 && prefixLen < alt.length - 1 && ref[prefixLen] === alt[prefixLen]) {
    prefixLen++;
  }
  let r = ref.slice(prefixLen);
  let a = alt.slice(prefixLen);
  const p = pos + prefixLen;

  // Trim shared suffix (keep at least 1 base in each).
  while (r.length > 1 && a.length > 1 && r[r.length - 1] === a[a.length - 1]) {
    r = r.slice(0, -1);
    a = a.slice(0, -1);
  }

  return { pos: p, ref: r, alt: a };
}

/** Normalize a single VCF record. */
export function normalizeRecord(
  rec: VcfRecord,
  refBin: ArrayBuffer | null,
  refIndex: ReferenceIndex | null,
): NormalizedVariant {
  const original_pos = rec.pos;
  const original_ref = rec.ref;
  const original_alt = rec.alt;

  const indel = extractIndel(rec.pos, rec.ref, rec.alt);

  // Substitutions need no reference. Indels are left-aligned where the
  // reference is shipped; elsewhere the input's own anchored form is kept
  // and marked unnormalized (cut 2 refuses those).
  const aligned = indel ? leftAlignIndel(indel.type, indel.anchorPos, indel.indelSeq, refBin, refIndex) : null;
  const normalized = !indel || aligned !== null;
  const { pos, ref, alt } = aligned ?? normalizeSubstitution(rec.pos, rec.ref, rec.alt);

  return {
    chrom: rec.chrom,
    pos,
    ref,
    alt,
    gt: rec.gt,
    normalized,
    original_pos,
    original_ref,
    original_alt,
  };
}

/** Only plain letters can be read as a change (ClinVar check): an N, an IUPAC code, a
 *  spanning deletion (*) or a symbolic allele (<DEL>) says no letter, and SETX "c.822G>N" was
 *  annotated as a missense change, "p.Met274?", and told as one amino acid swapped. */
export const isPlain = (r: { ref: string; alt: string }) => /^[ACGT]+$/.test(r.ref) && /^[ACGT]+$/.test(r.alt);

/** A record left out, and why: the reader's `throws`. */
export interface Dropped {
  key: string;
  stage: string;
  message: string;
}

const SAME = "REF and ALT are the same letters: no change";

/** Normalize all records; records with a letter other than A, C, G or T are left out, and so are
 *  records whose REF and ALT are the same letters: they change nothing, and are told in `dropped`. */
export function normalize(
  records: VcfRecord[],
  refBin: ArrayBuffer | null,
  refIndex: ReferenceIndex | null,
  dropped?: Dropped[],
): NormalizedVariant[] {
  const out: NormalizedVariant[] = [];
  for (const r of records) {
    if (!isPlain(r)) continue;
    if (r.ref !== r.alt) out.push(normalizeRecord(r, refBin, refIndex));
    else dropped?.push({ key: `${r.chrom}:${r.pos}:${r.ref}:${r.alt}`, stage: "normalize", message: SAME });
  }
  return out;
}
