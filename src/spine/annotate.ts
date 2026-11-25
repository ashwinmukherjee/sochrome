// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/** Stage 4: Annotate — determine consequence from transcript model.
 *  Uses CDS offset, codon lookup, and splice rules. */

import type {
  PinnedVariant,
  AnnotatedVariant,
  Consequence,
  ReferenceIndex,
  TranscriptModel,
} from "../contracts/types.ts";
import { EXON_EDGE } from "../contracts/constants.ts";
import { getRefBases } from "./tables.ts";

const CODON_TABLE: Record<string, string> = {
  TTT: "F",
  TTC: "F",
  TTA: "L",
  TTG: "L",
  CTT: "L",
  CTC: "L",
  CTA: "L",
  CTG: "L",
  ATT: "I",
  ATC: "I",
  ATA: "I",
  ATG: "M",
  GTT: "V",
  GTC: "V",
  GTA: "V",
  GTG: "V",
  TCT: "S",
  TCC: "S",
  TCA: "S",
  TCG: "S",
  CCT: "P",
  CCC: "P",
  CCA: "P",
  CCG: "P",
  ACT: "T",
  ACC: "T",
  ACA: "T",
  ACG: "T",
  GCT: "A",
  GCC: "A",
  GCA: "A",
  GCG: "A",
  TAT: "Y",
  TAC: "Y",
  TAA: "*",
  TAG: "*",
  CAT: "H",
  CAC: "H",
  CAA: "Q",
  CAG: "Q",
  AAT: "N",
  AAC: "N",
  AAA: "K",
  AAG: "K",
  GAT: "D",
  GAC: "D",
  GAA: "E",
  GAG: "E",
  TGT: "C",
  TGC: "C",
  TGA: "*",
  TGG: "W",
  CGT: "R",
  CGC: "R",
  CGA: "R",
  CGG: "R",
  AGT: "S",
  AGC: "S",
  AGA: "R",
  AGG: "R",
  GGT: "G",
  GGC: "G",
  GGA: "G",
  GGG: "G",
};

const AA_NAMES: Record<string, string> = {
  A: "Ala",
  R: "Arg",
  N: "Asn",
  D: "Asp",
  C: "Cys",
  E: "Glu",
  Q: "Gln",
  G: "Gly",
  H: "His",
  I: "Ile",
  L: "Leu",
  K: "Lys",
  M: "Met",
  F: "Phe",
  P: "Pro",
  S: "Ser",
  T: "Thr",
  W: "Trp",
  Y: "Tyr",
  V: "Val",
  U: "Sec",
  "*": "Ter",
};

/** Complement a single base. */
function complement(base: string): string {
  switch (base) {
    case "A":
      return "T";
    case "T":
      return "A";
    case "C":
      return "G";
    case "G":
      return "C";
    default:
      return "N";
  }
}

/** Reverse complement a sequence. */
function reverseComplement(seq: string): string {
  let rc = "";
  for (let i = seq.length - 1; i >= 0; i--) {
    rc += complement(seq[i]);
  }
  return rc;
}

/** Get the coding sequence codon and amino acid at a CDS offset.
 *  Returns null if reference not available. */
function getCodonAtOffset(
  cdsOffset: number,
  refBin: ArrayBuffer | null,
  refIndex: ReferenceIndex | null,
  tx: TranscriptModel,
): { codon: string; codonOffset: number; aaPos: number } | null {
  if (!refBin || !refIndex) return null;

  const codonOffset = cdsOffset % 3;
  const codonStartCds = cdsOffset - codonOffset;
  const aaPos = Math.floor(cdsOffset / 3) + 1; // 1-based amino acid position

  // Get the 3 genomic positions for this codon.
  const genomicPositions = cdsToGenomic(codonStartCds, 3, tx);
  if (!genomicPositions || genomicPositions.length !== 3) return null;

  // Read bases from reference.
  let codon = "";
  for (const gpos of genomicPositions) {
    const base = getRefBases(refBin, refIndex, gpos, 1);
    if (!base) return null;
    codon += tx.strand === "-" ? complement(base) : base;
  }

  return { codon, codonOffset, aaPos };
}

/** Map CDS offset + length to genomic positions.
 *  Returns an array of 1-based genomic positions in coding order. */
function cdsToGenomic(cdsStart: number, length: number, tx: TranscriptModel): number[] | null {
  if (tx.cds_start === null || tx.cds_end === null) {
    throw new Error(`cdsToGenomic on non-coding transcript ${tx.transcript}`);
  }
  const positions: number[] = [];
  let cdsPos = 0;

  if (tx.strand === "+") {
    for (const [es, ee] of tx.exons) {
      const exonCdsStart = Math.max(es, tx.cds_start);
      const exonCdsEnd = Math.min(ee, tx.cds_end);
      if (exonCdsStart > exonCdsEnd) continue;

      const exonCdsLen = exonCdsEnd - exonCdsStart + 1;
      for (let i = 0; i < exonCdsLen; i++) {
        if (cdsPos >= cdsStart && cdsPos < cdsStart + length) {
          positions.push(exonCdsStart + i);
        }
        cdsPos++;
        if (positions.length === length) return positions;
      }
    }
  } else {
    // Minus strand: iterate from highest to lowest genomic exon.
    for (let ei = tx.exons.length - 1; ei >= 0; ei--) {
      const [es, ee] = tx.exons[ei];
      const exonCdsStart = Math.max(es, tx.cds_start);
      const exonCdsEnd = Math.min(ee, tx.cds_end);
      if (exonCdsStart > exonCdsEnd) continue;

      const exonCdsLen = exonCdsEnd - exonCdsStart + 1;
      for (let i = 0; i < exonCdsLen; i++) {
        if (cdsPos >= cdsStart && cdsPos < cdsStart + length) {
          positions.push(exonCdsEnd - i);
        }
        cdsPos++;
        if (positions.length === length) return positions;
      }
    }
  }

  return positions.length === length ? positions : null;
}

/** HGVS c. coordinate of one genomic position on a coding transcript:
 *  CDS "N", 5' UTR "-N", 3' UTR "*N", intronic "N+d" / "N-d" from the
 *  nearest exon base (a midpoint tie takes "+"). Beyond the transcript ends
 *  the 5'/3' numbering continues. */
function cCoordinate(pos: number, tx: TranscriptModel): string {
  if (tx.cds_start === null || tx.cds_end === null) {
    throw new Error(`cCoordinate on non-coding transcript ${tx.transcript}`);
  }
  // Exons in transcript order, each as [first, last] genomic base in that order.
  const ordered: [number, number][] =
    tx.strand === "+" ? tx.exons.map(([s, e]) => [s, e]) : [...tx.exons].reverse().map(([s, e]) => [e, s]);
  const dir = tx.strand === "+" ? 1 : -1;
  const along = (a: number, b: number) => (b - a) * dir; // bases from a to b, transcript order

  // 0-based cDNA index of an exonic base.
  const cdna = (g: number): number => {
    let n = 0;
    for (const [f, l] of ordered) {
      if (along(f, g) >= 0 && along(g, l) >= 0) return n + along(f, g);
      n += along(f, l) + 1;
    }
    throw new Error(`cdna: ${g} not exonic in ${tx.transcript}`);
  };
  const cdsFirst = cdna(tx.strand === "+" ? tx.cds_start : tx.cds_end);
  const cdsLast = cdna(tx.strand === "+" ? tx.cds_end : tx.cds_start);
  const label = (i: number): string =>
    i < cdsFirst ? `-${cdsFirst - i}` : i > cdsLast ? `*${i - cdsLast}` : `${i - cdsFirst + 1}`;

  const txFirst = ordered[0][0];
  const txLast = ordered[ordered.length - 1][1];
  if (along(pos, txFirst) > 0) return label(-along(pos, txFirst));
  if (along(txLast, pos) > 0) return label(cdna(txLast) + along(txLast, pos));

  for (let k = 0; k < ordered.length; k++) {
    const [f, l] = ordered[k];
    if (along(f, pos) >= 0 && along(pos, l) >= 0) return label(cdna(pos));
    const next = ordered[k + 1];
    if (next && along(l, pos) > 0 && along(pos, next[0]) > 0) {
      const up = along(l, pos);
      const down = along(pos, next[0]);
      return up <= down ? `${label(cdna(l))}+${up}` : `${label(cdna(next[0]))}-${down}`;
    }
  }
  throw new Error(`cCoordinate: ${pos} unplaced in ${tx.transcript}`);
}

/** Segment of a genomic position on tx, in genomic order: exon k, intron k
 *  (between exon k and k+1), or outside the transcript span. */
function segment(g: number, tx: TranscriptModel): string {
  const ex = tx.exons;
  if (g < ex[0][0]) return "up";
  for (let k = 0; k < ex.length; k++) {
    if (g <= ex[k][1]) return g >= ex[k][0] ? `e${k}` : `i${k - 1}`;
  }
  return "down";
}

/** An indel in HGVS terms, genomic coordinates (first <= last).
 *  del/dup: the affected bases [first, last]; ins: between first and last = first + 1.
 *  seq: deleted, duplicated or inserted bases, genomic orientation. */
interface HgvsIndel {
  kind: "del" | "dup" | "ins";
  first: number;
  last: number;
  seq: string;
}

/** Place an anchored indel by its affected bases, shifted 3' on the transcript
 *  strand (HGVS 3' rule), never across an exon/intron border. An insertion
 *  that copies the bases 5' of it is a dup. null when the variant is not a
 *  simple anchored indel or the shipped reference does not reach the shift. */
function placeIndel(
  v: PinnedVariant,
  tx: TranscriptModel,
  refBin: ArrayBuffer | null,
  refIndex: ReferenceIndex | null,
): HgvsIndel | null {
  if (!refBin || !refIndex || !v.normalized) return null;
  if (v.ref[0] !== v.alt[0] || (v.ref.length > 1 && v.alt.length > 1)) return null;
  const base = (g: number) => getRefBases(refBin, refIndex, g, 1);
  const seg = (g: number) => segment(g, tx);
  const plus = tx.strand === "+";

  if (v.alt.length === 1) {
    let s = v.pos + 1;
    let e = v.pos + v.ref.length - 1;
    for (;;) {
      // The base leaving the deleted range and the one entering it.
      const [out, inn, edge] = plus ? [s, e + 1, e] : [e, s - 1, s];
      const a = base(out);
      const b = base(inn);
      if (a === null || b === null) return null;
      if (a !== b || seg(inn) !== seg(edge)) break;
      if (plus) {
        s++;
        e++;
      } else {
        s--;
        e--;
      }
    }
    const seq = getRefBases(refBin, refIndex, s, e - s + 1);
    return seq === null ? null : { kind: "del", first: s, last: e, seq };
  }

  let g = v.pos; // inserted between g and g + 1
  let ins = v.alt.slice(1);
  for (;;) {
    if (plus) {
      const b = base(g + 1);
      if (b === null) return null;
      if (b !== ins[0] || seg(g + 2) !== seg(g + 1)) break;
      ins = ins.slice(1) + ins[0];
      g++;
    } else {
      const b = base(g);
      if (b === null) return null;
      if (b !== ins[ins.length - 1] || seg(g - 1) !== seg(g)) break;
      ins = ins[ins.length - 1] + ins.slice(0, -1);
      g--;
    }
  }
  const n = ins.length;
  const [ds, de] = plus ? [g - n + 1, g] : [g + 1, g + n];
  const prior = getRefBases(refBin, refIndex, ds, n);
  if (prior === null) return null;
  if (prior === ins) return { kind: "dup", first: ds, last: de, seq: ins };
  return { kind: "ins", first: g, last: g + 1, seq: ins };
}

/** Build HGVS c. notation for any variant on a coding transcript. */
function buildHgvsC(
  v: PinnedVariant,
  tx: TranscriptModel,
  refBin: ArrayBuffer | null,
  refIndex: ReferenceIndex | null,
): string | null {
  const sense = (seq: string) => (tx.strand === "-" ? reverseComplement(seq) : seq);
  const c = (g: number) => cCoordinate(g, tx);
  const span = (a: number, b: number): string => {
    const [x, y] = tx.strand === "+" ? [a, b] : [b, a];
    return x === y ? c(x) : `${c(x)}_${c(y)}`;
  };
  if (v.ref.length === v.alt.length) {
    if (v.ref.length === 1) return `c.${c(v.pos)}${sense(v.ref)}>${sense(v.alt)}`;
    return `c.${span(v.pos, v.pos + v.ref.length - 1)}delins${sense(v.alt)}`;
  }
  /* A DELINS OF UNEQUAL LENGTHS (ClinVar check): ref and alt share no anchor base,
     or both are longer than one (EGFR c.2235_2246delinsCA, ALPL T>CTAA). placeIndel takes only
     anchored indels, so these had no c. at all and the bundle threw. HGVS names the changed
     bases after trimming what ref and alt share at either end; a delins isn't 3'-shifted. */
  if (v.ref[0] !== v.alt[0] || (v.ref.length > 1 && v.alt.length > 1)) {
    let p = 0,
      s = 0;
    while (p < v.ref.length && p < v.alt.length && v.ref[p] === v.alt[p]) p++;
    while (s < v.ref.length - p && s < v.alt.length - p && v.ref[v.ref.length - 1 - s] === v.alt[v.alt.length - 1 - s])
      s++;
    const del = v.ref.slice(p, v.ref.length - s),
      ins = v.alt.slice(p, v.alt.length - s);
    const lo = v.pos + p;
    if (!del.length) return `c.${span(lo - 1, lo)}ins${sense(ins)}`;
    if (!ins.length) return `c.${span(lo, lo + del.length - 1)}del`;
    return `c.${span(lo, lo + del.length - 1)}delins${sense(ins)}`;
  }
  const d = placeIndel(v, tx, refBin, refIndex);
  if (d === null) return null;
  if (d.kind === "ins") return `c.${span(d.first, d.last)}ins${sense(d.seq)}`;
  return `c.${span(d.first, d.last)}${d.kind}`;
}

/** c. string for a non-CDS variant on its pinned transcript. */
function hgvsCOutsideCds(
  v: PinnedVariant,
  transcripts: TranscriptModel[],
  refBin: ArrayBuffer | null,
  refIndex: ReferenceIndex | null,
): string | null {
  const tx = transcripts.find((t) => t.transcript === v.transcript);
  return tx && tx.cds_start !== null ? buildHgvsC(v, tx, refBin, refIndex) : null;
}

/** Bases within this many of an internal exon junction, on the exon side, are part of the
 *  splice signal (the exon half of the donor/acceptor consensus). */

/** CDS length of a coding transcript. */
function cdsLength(tx: TranscriptModel): number {
  let len = 0;
  for (const [es, ee] of tx.exons) {
    const s = Math.max(es, tx.cds_start ?? Infinity);
    const e = Math.min(ee, tx.cds_end ?? -Infinity);
    if (s <= e) len += e - s + 1;
  }
  return len;
}

/** Sense-strand bases of CDS offsets [from, from + n). Past the CDS end it continues into
 *  the 3' UTR only while the stop codon's exon does; null when the reference or the exon
 *  runs out first. */
function senseRange(
  tx: TranscriptModel,
  from: number,
  n: number,
  refBin: ArrayBuffer,
  refIndex: ReferenceIndex,
): string | null {
  const len = cdsLength(tx);
  const inCds = Math.max(0, Math.min(n, len - from));
  const genomic = inCds > 0 ? cdsToGenomic(from, inCds, tx) : [];
  if (genomic === null) return null;
  if (n > inCds) {
    if (tx.cds_start === null || tx.cds_end === null) return null;
    const end = tx.strand === "+" ? tx.cds_end : tx.cds_start;
    const exon = tx.exons.find(([s, e]) => s <= end && end <= e);
    if (!exon) return null;
    for (let k = 1; k <= n - inCds; k++) {
      const g = tx.strand === "+" ? end + k : end - k;
      if (g < exon[0] || g > exon[1]) return null;
      genomic.push(g);
    }
  }
  let out = "";
  for (const g of genomic) {
    const b = getRefBases(refBin, refIndex, g, 1);
    if (b === null) return null;
    out += tx.strand === "-" ? complement(b) : b;
  }
  return out;
}

/** Codon-by-codon translation, no stop handling. */
function codons(seq: string): string {
  let aa = "";
  for (let i = 0; i + 3 <= seq.length; i += 3) aa += CODON_TABLE[seq.slice(i, i + 3)] ?? "?";
  return aa;
}

/** Selenocysteine: a MANE CDS ends at its one true stop, so an in-frame stop codon INSIDE
 *  the reference CDS is read as Sec (U) — in scope today, SELENON 428. Given a translation
 *  and the 0-based codon indexes that are Sec in the reference, reads those back as U. */
function readSec(aa: string, sec: ReadonlySet<number>): string {
  if (sec.size === 0) return aa;
  return [...aa].map((a, k) => (a === "*" && sec.has(k) ? "U" : a)).join("");
}
function secOf(refCds: string): Set<number> {
  const all = codons(refCds),
    out = new Set<number>();
  for (let k = 0; k < all.length - 1; k++) if (all[k] === "*") out.add(k);
  return out;
}

/** Distance (1-based) from the nearest INTERNAL exon junction, for a CDS variant whose
 *  bases lie within EXON_EDGE of one; null otherwise. */
function exonEdgeOf(v: PinnedVariant, tx: TranscriptModel): number | null {
  if (v.region !== "cds") return null;
  const ex = tx.exons;
  let best = Infinity;
  for (let g = v.pos; g < v.pos + Math.max(1, v.ref.length); g++) {
    const k = ex.findIndex(([s, e]) => s <= g && g <= e);
    if (k < 0) continue;
    if (k > 0) best = Math.min(best, g - ex[k][0] + 1);
    if (k < ex.length - 1) best = Math.min(best, ex[k][1] - g + 1);
  }
  return best <= EXON_EDGE ? best : null;
}

/** CDS offset (0-based, coding order) of a genomic base; null outside the CDS. */
function cdsOffsetOf(g: number, tx: TranscriptModel): number | null {
  if (tx.cds_start === null || tx.cds_end === null || g < tx.cds_start || g > tx.cds_end) return null;
  const order = tx.strand === "+" ? tx.exons : [...tx.exons].reverse();
  let off = 0;
  for (const [es, ee] of order) {
    const s = Math.max(es, tx.cds_start),
      e = Math.min(ee, tx.cds_end);
    if (s > e) continue;
    if (g >= s && g <= e) return off + (tx.strand === "+" ? g - s : e - g);
    off += e - s + 1;
  }
  return null;
}

/** The bases a variant CHANGES, not its VCF anchor: after the shared prefix p, either the
 *  replaced/deleted genomic bases, or (a pure insertion) the gap between two bases. */
function changedBases(v: PinnedVariant): { p: number; bases: number[] } | { p: number; gap: [number, number] } {
  let p = 0;
  while (p < v.ref.length && p < v.alt.length && v.ref[p] === v.alt[p]) p++;
  if (p === v.ref.length) return { p, gap: [v.pos + p - 1, v.pos + p] };
  return { p, bases: Array.from({ length: v.ref.length - p }, (_, i) => v.pos + p + i) };
}

/** Where one genomic base sits on tx: CDS, UTR, intron (with its distance to the nearer
 *  exon edge), or outside the transcript. */
function baseKind(g: number, tx: TranscriptModel): { k: "cds" | "utr" | "intron" | "outside"; d: number } {
  const ex = tx.exons;
  for (let i = 0; i < ex.length; i++) {
    const [s, e] = ex[i];
    if (g >= s && g <= e)
      return {
        k: tx.cds_start !== null && tx.cds_end !== null && g >= tx.cds_start && g <= tx.cds_end ? "cds" : "utr",
        d: 0,
      };
    if (i + 1 < ex.length && g > e && g < ex[i + 1][0]) return { k: "intron", d: Math.min(g - e, ex[i + 1][0] - g) };
  }
  return { k: "outside", d: Infinity };
}

type ChangedLocation =
  | { kind: "splice_site"; g: number }
  | { kind: "splice_region" | "intronic" | "utr" | "coding" | "start_lost" | "stop_lost" };

/** Where a multi-base variant's changed bases fall. A deletion that crosses an exon/intron
 *  border removes a junction, so it is a splice-site change; an insertion only disrupts a
 *  splice site when it lands inside the ±1/±2 dinucleotide. null: outside the transcript. */
function changedLocation(v: PinnedVariant, tx: TranscriptModel): ChangedLocation | null {
  const c = changedBases(v);
  const near = (d: number) => (d <= 8 ? "splice_region" : "intronic") as "splice_region" | "intronic";
  if ("gap" in c) {
    const [A, B] = c.gap.map((g) => baseKind(g, tx));
    if (A.k === "outside" || B.k === "outside") return null;
    if (A.k === "intron" && B.k === "intron")
      return A.d <= 2 && B.d <= 2 ? { kind: "splice_site", g: c.gap[0] } : { kind: near(Math.min(A.d, B.d)) };
    if (A.k === "cds" || B.k === "cds") return { kind: A.k === "utr" || B.k === "utr" ? "utr" : "coding" };
    if (A.k === "utr" && B.k === "utr") return { kind: "utr" };
    return { kind: near(Math.min(A.k === "intron" ? A.d : Infinity, B.k === "intron" ? B.d : Infinity)) };
  }
  const ks = c.bases.map((g) => ({ g, ...baseKind(g, tx) }));
  if (ks.some((x) => x.k === "outside")) return null;
  const intron = ks.filter((x) => x.k === "intron");
  if (intron.length) {
    const nearest = intron.reduce((m, x) => (x.d < m.d ? x : m));
    if (intron.length < ks.length || nearest.d <= 2) return { kind: "splice_site", g: nearest.g };
    return { kind: near(nearest.d) };
  }
  const cds = ks.filter((x) => x.k === "cds").length;
  if (cds === ks.length) return { kind: "coding" };
  if (cds === 0) return { kind: "utr" };
  const fivePrime = ks.some(
    (x) => x.k === "utr" && (tx.strand === "+" ? x.g < (tx.cds_start ?? 0) : x.g > (tx.cds_end ?? 0)),
  );
  return { kind: fivePrime ? "start_lost" : "stop_lost" };
}

/** The CDS offsets a pure deletion removes [lo, hi], or the gap a pure insertion opens
 *  (between lo and hi = lo + 1), read from the changed bases. null for anything else, or
 *  when the change leaves the CDS. */
function indelOffsets(
  v: PinnedVariant,
  tx: TranscriptModel,
): { kind: "del" | "ins"; lo: number; hi: number; ins: string } | null {
  const c = changedBases(v);
  const len = cdsLength(tx);
  if ("gap" in c) {
    const [f1, f2] = tx.strand === "+" ? c.gap : [c.gap[1], c.gap[0]];
    const o1 = cdsOffsetOf(f1, tx),
      o2 = cdsOffsetOf(f2, tx);
    const lo = o1 ?? (o2 !== null ? o2 - 1 : null);
    if (lo === null || lo < 0 || lo + 1 >= len) return null;
    const ins = v.alt.slice(c.p);
    return { kind: "ins", lo, hi: lo + 1, ins: tx.strand === "-" ? reverseComplement(ins) : ins };
  }
  const offs = c.bases.map((g) => cdsOffsetOf(g, tx));
  if (offs.some((o) => o === null)) return null;
  const lo = Math.min(...(offs as number[])),
    hi = Math.max(...(offs as number[]));
  if (hi - lo + 1 !== offs.length) return null;
  const ins = v.alt.slice(c.p); // empty for a pure deletion, else a delins
  return { kind: "del", lo, hi, ins: tx.strand === "-" ? reverseComplement(ins) : ins };
}

/** What a coding indel or delins does, read from sequence: the edit is applied to the CDS
 *  (plus the 3' UTR the stop codon's exon carries) and the result translated, so a start
 *  that survives as the next ATG, a stop that is kept, or a stop that arrives at once are all
 *  seen as what they are. Returns null when the reference can't be read; the caller then
 *  falls back to the frame arithmetic. hgvs_p null means "use the simple-indel notation". */
function codingIndelEffect(
  v: PinnedVariant,
  tx: TranscriptModel,
  refBin: ArrayBuffer | null,
  refIndex: ReferenceIndex | null,
): { consequence: Consequence; hgvs_p: string | null } | null {
  if (!refBin || !refIndex) return null;
  const o = indelOffsets(v, tx);
  if (!o) return null;
  const len = cdsLength(tx);
  let ref: string | null = null;
  for (const extra of [300, 150, 60, 0]) {
    ref = senseRange(tx, 0, len + extra, refBin, refIndex);
    if (ref !== null) break;
  }
  if (ref === null) return null;
  const alt =
    o.kind === "ins" ? ref.slice(0, o.hi) + o.ins + ref.slice(o.hi) : ref.slice(0, o.lo) + o.ins + ref.slice(o.hi + 1);
  const delta = alt.length - ref.length;
  if (o.lo <= 2 && alt.slice(0, 3) !== ref.slice(0, 3)) return { consequence: "start_lost", hgvs_p: "p.Met1?" };
  const sec = secOf(ref.slice(0, len));
  const upTo = (a: string) => {
    const k = a.indexOf("*");
    return k === -1 ? a : a.slice(0, k + 1);
  };
  // Sec positions keep their index upstream of the edit, and shift by whole codons
  // downstream of an in-frame one; downstream of a frameshift the old frame is gone.
  const edit = Math.floor(o.lo / 3);
  const altSec = new Set<number>([...sec].flatMap((k) => (k < edit ? [k] : delta % 3 === 0 ? [k + delta / 3] : [])));
  const R = upTo(readSec(codons(ref.slice(0, len)), sec)),
    A = upTo(readSec(codons(alt), altSec));
  // The protein reads the same, stop included: the edit sits in the stop codon (or runs into it)
  // and the letters that follow re-form the stop where it was. Named as the stop kept.
  if (A === R) return { consequence: "synonymous", hgvs_p: R.endsWith("*") ? `p.Ter${R.length}=` : "p.=" };
  let i = 0;
  while (i < R.length && i < A.length && R[i] === A[i]) i++;
  const res = (k: number) => `${aaName(R[k])}${k + 1}`;
  const stopsAt = A.endsWith("*") ? A.length - 1 : -1;
  if (i === R.length - 1) {
    // the first change is at the stop codon
    return {
      consequence: "stop_lost",
      hgvs_p: `p.Ter${i + 1}${aaName(A[i])}ext*${stopsAt === -1 ? "?" : stopsAt - i}`,
    };
  }
  if (delta % 3 !== 0) {
    if (stopsAt === i) return { consequence: "frameshift", hgvs_p: `p.${res(i)}Ter` };
    return { consequence: "frameshift", hgvs_p: `p.${res(i)}fs` };
  }
  if (stopsAt !== -1 && stopsAt < R.length - 1 + delta / 3) {
    return {
      consequence: "stop_gained",
      hgvs_p:
        stopsAt === i
          ? `p.${res(i)}Ter`
          : `p.${res(i)}_${res(Math.min(stopsAt, R.length - 2))}delins${[...A.slice(i, stopsAt)].map(aaName).join("")}Ter`,
    };
  }
  // In frame, and the stop now arrives later than the reading frame says it should (or never):
  // the old stop codon was destroyed, so the protein runs on. A stop loss, written from the
  // first changed residue through the old stop.
  const expected = R.length - 1 + delta / 3;
  if (stopsAt === -1 || stopsAt > expected) {
    const tail = [...A.slice(i, stopsAt === -1 ? undefined : stopsAt)].map(aaName).join("");
    return {
      consequence: "stop_lost",
      hgvs_p: `p.${res(i)}_Ter${R.length}delins${tail}${stopsAt === -1 ? "ext*?" : "Ter"}`,
    };
  }
  // In frame: trim the shared tail, name what was removed, added or replaced.
  let t = 0;
  while (t < R.length - i && t < A.length - i && R[R.length - 1 - t] === A[A.length - 1 - t]) t++;
  const j = R.length - 1 - t,
    ai = A.slice(i, A.length - t);
  const span = (a: number, b: number) => (a === b ? res(a) : `${res(a)}_${res(b)}`);
  if (j < i)
    return { consequence: "inframe_indel", hgvs_p: `p.${res(i - 1)}_${res(i)}ins${[...ai].map(aaName).join("")}` };
  if (ai === "") return { consequence: "inframe_indel", hgvs_p: `p.${span(i, j)}del` };
  return { consequence: "inframe_indel", hgvs_p: `p.${span(i, j)}delins${[...ai].map(aaName).join("")}` };
}

/** A multi-nucleotide substitution in the CDS, codon by codon. null when it leaves the CDS. */
function annotateMnv(
  v: PinnedVariant,
  tx: TranscriptModel,
  refBin: ArrayBuffer | null,
  refIndex: ReferenceIndex | null,
  splice: boolean,
): Pick<AnnotatedVariant, "consequence" | "hgvs_p" | "codon_ref" | "codon_alt" | "aa_ref" | "aa_alt"> | null {
  if (!refBin || !refIndex || v.cds_offset === null) return null;
  const n = v.ref.length,
    plus = tx.strand === "+";
  const lo = plus ? v.cds_offset : v.cds_offset - (n - 1);
  const g = cdsToGenomic(lo, n, tx);
  const want = Array.from({ length: n }, (_, i) => (plus ? v.pos + i : v.pos + n - 1 - i));
  if (!g || g.some((x, i) => x !== want[i])) return null;
  const c0 = lo - (lo % 3),
    c1 = Math.ceil((lo + n) / 3) * 3;
  const ref = senseRange(tx, c0, c1 - c0, refBin, refIndex);
  if (ref === null) return null;
  const alt = ref.slice(0, lo - c0) + (plus ? v.alt : reverseComplement(v.alt)) + ref.slice(lo - c0 + n);
  const last = cdsLength(tx) / 3 - 1,
    k0 = c0 / 3;
  const sec = new Set([...codons(ref)].flatMap((a, k) => (a === "*" && k0 + k !== last ? [k] : [])));
  const R = readSec(codons(ref), sec),
    A = readSec(codons(alt), sec),
    p0 = c0 / 3 + 1;
  const res = (i: number) => `${aaName(R[i])}${p0 + i}`;
  const base = { codon_ref: ref, codon_alt: alt, aa_ref: R, aa_alt: A };
  if (c0 === 0 && alt.slice(0, 3) !== ref.slice(0, 3)) return { ...base, consequence: "start_lost", hgvs_p: "p.Met1?" };
  const s = R.indexOf("*");
  if (s !== -1 && A[s] !== "*")
    return { ...base, consequence: "stop_lost", hgvs_p: `p.Ter${p0 + s}${aaName(A[s])}ext*?` };
  if (R === A)
    return {
      ...base,
      consequence: splice ? "synonymous_splice_region" : "synonymous",
      hgvs_p: R.length === 1 ? `p.${res(0)}=` : "p.=",
    };
  const changed = [...R].map((r, i) => (r !== A[i] ? i : -1)).filter((i) => i >= 0);
  const f = changed[0],
    stopAt = A.indexOf("*");
  const l = stopAt !== -1 ? stopAt : changed[changed.length - 1];
  const consequence = stopAt !== -1 ? "stop_gained" : "missense";
  const hgvs_p =
    f === l
      ? `p.${res(f)}${aaName(A[f])}`
      : `p.${res(f)}_${res(l)}delins${[...A.slice(f, l + 1)].map(aaName).join("")}`;
  return { ...base, consequence, hgvs_p };
}

/** Translate a coding sequence up to (not including) the first stop. */
function translate(cds: string): string {
  let aa = "";
  for (let i = 0; i + 3 <= cds.length; i += 3) {
    const a = CODON_TABLE[cds.slice(i, i + 3)] ?? "?";
    if (a === "*") break;
    aa += a;
  }
  return aa;
}

const aaName = (a: string) => AA_NAMES[a] ?? a;

/** HGVS p. for a CDS indel, from the reference and variant translations:
 *  frameshift at the first changed residue; in-frame del / dup / ins placed
 *  3'-most. null when the indel reaches outside the CDS or the change is not
 *  one of these (e.g. an in-frame change that creates a stop). */
function indelHgvsP(d: HgvsIndel, tx: TranscriptModel, refBin: ArrayBuffer, refIndex: ReferenceIndex): string | null {
  if (tx.cds_start === null || tx.cds_end === null) return null;
  let len = 0;
  for (const [es, ee] of tx.exons) {
    const s = Math.max(es, tx.cds_start);
    const e = Math.min(ee, tx.cds_end);
    if (s <= e) len += e - s + 1;
  }
  const genomic = cdsToGenomic(0, len, tx);
  if (!genomic) return null;
  let cds = "";
  for (const g of genomic) {
    const b = getRefBases(refBin, refIndex, g, 1);
    if (b === null) return null;
    cds += tx.strand === "-" ? complement(b) : b;
  }
  const index = new Map(genomic.map((g, i) => [g, i]));
  const ia = index.get(d.first);
  const ib = index.get(d.last);
  if (ia === undefined || ib === undefined) return null;
  const [lo, hi] = ia < ib ? [ia, ib] : [ib, ia];
  const senseSeq = tx.strand === "-" ? reverseComplement(d.seq) : d.seq;

  let alt: string;
  if (d.kind === "del") {
    if (hi - lo + 1 !== d.seq.length) return null;
    alt = cds.slice(0, lo) + cds.slice(hi + 1);
  } else if (d.kind === "dup") {
    if (hi - lo + 1 !== d.seq.length) return null;
    alt = cds.slice(0, hi + 1) + cds.slice(lo, hi + 1) + cds.slice(hi + 1);
  } else {
    if (hi !== lo + 1) return null;
    alt = cds.slice(0, hi) + senseSeq + cds.slice(hi);
  }

  const R = translate(cds);
  const A = translate(alt);
  if ((alt.length - cds.length) % 3 !== 0) {
    let i = 0;
    while (i < R.length && i < A.length && R[i] === A[i]) i++;
    if (i >= R.length) return null;
    // The first changed residue is itself a stop: HGVS writes it as a nonsense change.
    if (i === A.length && CODON_TABLE[alt.slice(3 * i, 3 * i + 3)] === "*") return `p.${aaName(R[i])}${i + 1}Ter`;
    return `p.${aaName(R[i])}${i + 1}fs`;
  }
  const res = (i: number) => `${aaName(R[i])}${i + 1}`;
  // In frame, but a stop arrives early: a nonsense change (or a delins ending in Ter).
  if (A.length < R.length + (alt.length - cds.length) / 3) {
    let i = 0;
    while (i < A.length && R[i] === A[i]) i++;
    if (i === A.length) return `p.${res(i)}Ter`;
    return `p.${res(i)}_${res(A.length)}delins${[...A.slice(i)].map(aaName).join("")}Ter`;
  }
  const k = Math.abs(R.length - A.length);
  if (k === 0 || k !== Math.abs(alt.length - cds.length) / 3) return null;
  if (A.length < R.length) {
    for (let i = R.length - k; i >= 0; i--) {
      if (R.slice(0, i) + R.slice(i + k) === A) {
        return k === 1 ? `p.${res(i)}del` : `p.${res(i)}_${res(i + k - 1)}del`;
      }
    }
    return null;
  }
  for (let i = R.length; i >= 0; i--) {
    const ins = A.slice(i, i + k);
    if (R.slice(0, i) + ins + R.slice(i) !== A) continue;
    if (i >= k && R.slice(i - k, i) === ins) {
      return k === 1 ? `p.${res(i - 1)}dup` : `p.${res(i - k)}_${res(i - 1)}dup`;
    }
    if (i === 0 || i === R.length) return null;
    return `p.${res(i - 1)}_${res(i)}ins${[...ins].map(aaName).join("")}`;
  }
  return null;
}

/** Build HGVS p. notation. */
function buildHgvsP(aaPos: number, aaRef: string, aaAlt: string, consequence: Consequence): string | null {
  const refName = AA_NAMES[aaRef] ?? aaRef;
  const altName = AA_NAMES[aaAlt] ?? aaAlt;

  if (consequence === "synonymous" || consequence === "synonymous_splice_region") {
    return `p.${refName}${aaPos}=`;
  }
  if (consequence === "missense") {
    return `p.${refName}${aaPos}${altName}`;
  }
  if (consequence === "stop_gained") {
    return `p.${refName}${aaPos}${altName}`;
  }
  if (consequence === "start_lost") {
    return `p.Met1?`;
  }
  return null;
}

/** Annotate a single pinned variant. */
export function annotateVariant(
  v: PinnedVariant,
  transcripts: TranscriptModel[],
  refBin: ArrayBuffer | null,
  refIndex: ReferenceIndex | null,
): AnnotatedVariant {
  const tx = transcripts.find((t) => t.transcript === v.transcript);
  const exon_edge = tx && tx.cds_start !== null ? exonEdgeOf(v, tx) : null;
  return { ...annotateCore(v, transcripts, refBin, refIndex, exon_edge), exon_edge };
}

function annotateCore(
  v: PinnedVariant,
  transcripts: TranscriptModel[],
  refBin: ArrayBuffer | null,
  refIndex: ReferenceIndex | null,
  exonEdge: number | null,
): Omit<AnnotatedVariant, "exon_edge"> {
  // Non-genic variants.
  if (v.region === "intergenic") {
    return {
      ...v,
      consequence: "intergenic",
      hgvs_c: null,
      hgvs_p: null,
      codon_ref: null,
      codon_alt: null,
      aa_ref: null,
      aa_alt: null,
    };
  }
  // Multi-base variants are placed by the bases they change, not by their VCF anchor: a
  // deletion of a donor's GT anchored in the exon is a splice change, a deletion of an
  // exon's first bases anchored in the intron is a coding change, a deletion of the start
  // codon anchored in the 5' UTR is a start loss.
  const txm = transcripts.find((t) => t.transcript === v.transcript);
  let codingByChange = false;
  if (txm && txm.cds_start !== null && txm.cds_end !== null && (v.ref.length !== 1 || v.alt.length !== 1)) {
    const loc = changedLocation(v, txm);
    if (loc && loc.kind === "coding") codingByChange = true;
    else if (loc) {
      const hgvs_c = buildHgvsC(v, txm, refBin, refIndex);
      const none = { hgvs_c, hgvs_p: null, codon_ref: null, codon_alt: null, aa_ref: null, aa_alt: null };
      switch (loc.kind) {
        case "splice_site":
          return { ...v, ...none, consequence: classifySpliceSite({ ...v, pos: loc.g }, transcripts) };
        case "splice_region":
        case "intronic":
        case "utr":
          return { ...v, ...none, consequence: loc.kind };
        case "start_lost":
          return { ...v, ...none, consequence: "start_lost", hgvs_p: "p.Met1?" };
        case "stop_lost":
          return { ...v, ...none, consequence: "stop_lost", hgvs_p: `p.Ter${cdsLength(txm) / 3}ext*?` };
      }
    }
  }

  if (!codingByChange && (v.region === "utr5" || v.region === "utr3")) {
    return {
      ...v,
      consequence: "utr",
      hgvs_c: hgvsCOutsideCds(v, transcripts, refBin, refIndex),
      hgvs_p: null,
      codon_ref: null,
      codon_alt: null,
      aa_ref: null,
      aa_alt: null,
    };
  }

  // Intronic: check splice distance.
  if (!codingByChange && v.region === "intronic") {
    const hgvs_c = hgvsCOutsideCds(v, transcripts, refBin, refIndex);
    if (v.splice_distance !== null && v.splice_distance <= 2) {
      // Determine donor vs acceptor based on position relative to exon.
      const consequence = classifySpliceSite(v, transcripts);
      return { ...v, consequence, hgvs_c, hgvs_p: null, codon_ref: null, codon_alt: null, aa_ref: null, aa_alt: null };
    }
    if (v.splice_distance !== null && v.splice_distance <= 8) {
      return {
        ...v,
        consequence: "splice_region",
        hgvs_c,
        hgvs_p: null,
        codon_ref: null,
        codon_alt: null,
        aa_ref: null,
        aa_alt: null,
      };
    }
    return {
      ...v,
      consequence: "intronic",
      hgvs_c,
      hgvs_p: null,
      codon_ref: null,
      codon_alt: null,
      aa_ref: null,
      aa_alt: null,
    };
  }

  // CDS variant — determine consequence.
  const tx = transcripts.find((t) => t.transcript === v.transcript);
  if (!tx || (v.cds_offset === null && !codingByChange)) {
    return {
      ...v,
      consequence: "intronic",
      hgvs_c: null,
      hgvs_p: null,
      codon_ref: null,
      codon_alt: null,
      aa_ref: null,
      aa_alt: null,
    };
  }

  // Exonic bases within EXON_EDGE of a junction are the exon half of the splice signal.
  // (pin leaves splice_distance null for exonic variants, so it can't be read here.)
  const splice_consequence: Consequence | null = exonEdge !== null ? "splice_region" : null;

  const senseRef = tx.strand === "-" ? reverseComplement(v.ref) : v.ref;
  const senseAlt = tx.strand === "-" ? reverseComplement(v.alt) : v.alt;

  // Indel check.
  const isIndel = senseRef.length !== senseAlt.length;
  const hgvs_c = buildHgvsC(v, tx, refBin, refIndex);

  if (isIndel) {
    const netChange = senseAlt.length - senseRef.length;
    const consequence: Consequence = netChange % 3 === 0 ? "inframe_indel" : "frameshift";
    const placed = placeIndel(v, tx, refBin, refIndex);
    const simple = placed && refBin && refIndex ? indelHgvsP(placed, tx, refBin, refIndex) : null;
    const eff = codingIndelEffect(v, tx, refBin, refIndex);
    if (eff) {
      // Read from sequence; the simple-indel notation (del / dup / ins / fs) where it applies.
      // The simple-indel notation (del / dup / ins / fs, 3'-placed) where it exists for a
      // plain frameshift or in-frame change; the sequence-read p. everywhere else.
      const plain =
        eff.consequence === "frameshift" ? !eff.hgvs_p?.endsWith("Ter") : eff.consequence === "inframe_indel";
      const hgvs_p = (plain ? simple : null) ?? eff.hgvs_p;
      const c: Consequence =
        eff.consequence === "synonymous" && splice_consequence ? "synonymous_splice_region" : eff.consequence;
      return { ...v, consequence: c, hgvs_c, hgvs_p, codon_ref: null, codon_alt: null, aa_ref: null, aa_alt: null };
    }
    const c: Consequence = consequence === "inframe_indel" && simple?.endsWith("Ter") ? "stop_gained" : consequence;
    return {
      ...v,
      consequence: c,
      hgvs_c,
      hgvs_p: simple,
      codon_ref: null,
      codon_alt: null,
      aa_ref: null,
      aa_alt: null,
    };
  }

  // SNV in CDS — get codon context.
  if (senseRef.length === 1 && senseAlt.length === 1) {
    // A single-base change is anchored on itself, so the guard above left cds_offset set.
    if (v.cds_offset === null) throw new Error(`SNV without a CDS offset: ${v.chrom}:${v.pos}`);
    const codonInfo = getCodonAtOffset(v.cds_offset, refBin, refIndex, tx);
    if (!codonInfo) {
      return {
        ...v,
        consequence: "missense",
        hgvs_c,
        hgvs_p: null,
        codon_ref: null,
        codon_alt: null,
        aa_ref: null,
        aa_alt: null,
      };
    }

    const { codon, codonOffset, aaPos } = codonInfo;
    const codonChars = codon.split("");
    codonChars[codonOffset] = senseAlt;
    const altCodon = codonChars.join("");
    // An in-frame stop inside the CDS is selenocysteine (see readSec).
    const isSec = CODON_TABLE[codon] === "*" && aaPos !== cdsLength(tx) / 3;
    const aaRef = isSec ? "U" : (CODON_TABLE[codon] ?? "?");
    const aaAlt = isSec && altCodon === codon ? "U" : (CODON_TABLE[altCodon] ?? "?");

    // Start codon: any change to the first codon, whatever it reads (WT1 starts CTG,
    // WDR26 ACG — the initiator is Met either way).
    if (aaPos === 1) {
      const hgvs_p = buildHgvsP(1, "M", aaAlt, "start_lost");
      return {
        ...v,
        consequence: "start_lost",
        hgvs_c,
        hgvs_p,
        codon_ref: codon,
        codon_alt: altCodon,
        aa_ref: aaRef,
        aa_alt: aaAlt,
      };
    }

    if (aaRef === aaAlt) {
      // Synonymous — but check splice region.
      const consequence: Consequence =
        splice_consequence === "splice_region" ? "synonymous_splice_region" : "synonymous";
      const hgvs_p = buildHgvsP(aaPos, aaRef, aaAlt, consequence);
      return { ...v, consequence, hgvs_c, hgvs_p, codon_ref: codon, codon_alt: altCodon, aa_ref: aaRef, aa_alt: aaAlt };
    }

    if (aaRef === "*") {
      const hgvs_p = `p.Ter${aaPos}${AA_NAMES[aaAlt] ?? aaAlt}ext*?`;
      return {
        ...v,
        consequence: "stop_lost",
        hgvs_c,
        hgvs_p,
        codon_ref: codon,
        codon_alt: altCodon,
        aa_ref: aaRef,
        aa_alt: aaAlt,
      };
    }

    if (aaAlt === "*") {
      const hgvs_p = buildHgvsP(aaPos, aaRef, aaAlt, "stop_gained");
      return {
        ...v,
        consequence: "stop_gained",
        hgvs_c,
        hgvs_p,
        codon_ref: codon,
        codon_alt: altCodon,
        aa_ref: aaRef,
        aa_alt: aaAlt,
      };
    }

    // Missense.
    const hgvs_p = buildHgvsP(aaPos, aaRef, aaAlt, "missense");
    return {
      ...v,
      consequence: "missense",
      hgvs_c,
      hgvs_p,
      codon_ref: codon,
      codon_alt: altCodon,
      aa_ref: aaRef,
      aa_alt: aaAlt,
    };
  }

  // MNV (multi-nucleotide variant): codon by codon. When it leaves the CDS, missense with
  // no p. (the bundle forecloses it as "not computed for multi-nucleotide variant").
  const mnv = annotateMnv(v, tx, refBin, refIndex, splice_consequence !== null);
  if (mnv) return { ...v, hgvs_c, ...mnv };
  return {
    ...v,
    consequence: "missense",
    hgvs_c,
    hgvs_p: null,
    codon_ref: null,
    codon_alt: null,
    aa_ref: null,
    aa_alt: null,
  };
}

/** Classify splice site as donor or acceptor.
 *  Donor: 3' end of exon (downstream of exon in transcript direction).
 *  Acceptor: 5' end of exon (upstream in transcript direction).
 *  For + strand: donor at high end of exon, acceptor at low end.
 *  For - strand: donor at low end of exon, acceptor at high end. */
function classifySpliceSite(v: PinnedVariant, transcripts: TranscriptModel[]): Consequence {
  const tx = transcripts.find((t) => t.transcript === v.transcript);
  if (!tx) return "splice_region";

  for (let i = 0; i < tx.exons.length; i++) {
    const [es, ee] = tx.exons[i];
    const distToStart = Math.abs(v.pos - es);
    const distToEnd = Math.abs(v.pos - ee);

    if (distToStart <= 2 && v.pos < es) {
      // Just before exon start (low end).
      return tx.strand === "+" ? "splice_acceptor" : "splice_donor";
    }
    if (distToEnd <= 2 && v.pos > ee) {
      // Just after exon end (high end).
      return tx.strand === "+" ? "splice_donor" : "splice_acceptor";
    }
  }

  return "splice_region";
}

/** Annotate all variants. */
export function annotate(
  variants: PinnedVariant[],
  transcripts: TranscriptModel[],
  refBin: ArrayBuffer | null,
  refIndex: ReferenceIndex | null,
): AnnotatedVariant[] {
  return variants.map((v) => annotateVariant(v, transcripts, refBin, refIndex));
}
