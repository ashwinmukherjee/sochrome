// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/** The gene model the facts are computed over: one MANE transcript, its coding
 *  sequence and as much 3' sequence after it as the shipped reference holds.
 *
 *  Browser-portable: no Node imports. The caller hands in a base getter, so the
 *  same code reads the packed reference in Node today and in the browser later. */

import type { TranscriptModel } from "../../contracts/types.ts";

/** (pos, length) -> bases on the + strand, or null where the reference has none. */
export type RefGetter = (pos: number, length: number) => string | null;

const COMP: Record<string, string> = { A: "T", C: "G", G: "C", T: "A", N: "N" };
export const revcomp = (s: string): string => {
  let out = "";
  for (let i = s.length - 1; i >= 0; i--) out += COMP[s[i]] ?? "N";
  return out;
};

const BASES = "TCAG";
const AAS = "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG";
export const CODON: Record<string, string> = {};
for (let i = 0; i < 64; i++) CODON[BASES[i >> 4] + BASES[(i >> 2) & 3] + BASES[i & 3]] = AAS[i];

/** Translate codon by codon to the first stop, which is included as "*". No stop
 *  read: the string simply ends (that is a fact the caller must see, not a "?"). */
export function translate(seq: string): string {
  let aa = "";
  for (let i = 0; i + 3 <= seq.length; i += 3) {
    const a = CODON[seq.slice(i, i + 3)] ?? "X";
    aa += a;
    if (a === "*") break;
  }
  return aa;
}

/** One coding piece: an exon's coding part, in transcript order. */
export interface Piece {
  /** 1-based, in transcript order, counting every exon (UTR-only ones too) */
  exon: number;
  /** coding coordinates, inclusive */
  cLo: number;
  cHi: number;
  bp: number;
}

/** The gap after a coding piece, in transcript order. */
export interface Gap {
  /** 1-based intron number in transcript order */
  intron: number;
  /** the last coding base before it; null where the piece before carries none */
  afterC: number | null;
  bp: number;
  gLo: number;
  gHi: number;
}

export interface GeneModel {
  symbol: string;
  transcript: string;
  chrom: string;
  strand: "+" | "-";
  /** the coding sequence, sense strand, start codon to stop codon inclusive */
  cds: string;
  /** cds + the 3' UTR as far as the reference reaches without a break */
  orfTail: string;
  /** the tail reaches the end of the message (the data stage ships the whole 3' UTR); false when
   *  the reference ran out first */
  tailComplete: boolean;
  /** genomic position of every base of orfTail, in sense order */
  gpos: number[];
  pieces: Piece[];
  gaps: Gap[];
  /** the reference protein, residues only (no "*") */
  protein: string;
  /** number of exons in the transcript, UTR-only ones included */
  exonCount: number;
  /** the last exon-exon join, in coding coordinates (past cds.length when it
   *  lies in the 3' UTR); null for a one-exon transcript. F1's 50-letter rule
   *  is measured from here. */
  lastJunctionC: number | null;
}

/** Exons in transcript (sense) order. */
const senseExons = (tx: TranscriptModel): [number, number][] =>
  tx.strand === "+" ? tx.exons.slice() : tx.exons.slice().reverse();

export function buildModel(tx: TranscriptModel, ref: RefGetter): GeneModel {
  if (tx.cds_start == null || tx.cds_end == null) throw new Error(`${tx.symbol}: no CDS`);
  const cs = tx.cds_start,
    ce = tx.cds_end;
  const exons = senseExons(tx);
  const pieces: Piece[] = [];
  const gaps: Gap[] = [];
  let cds = "";
  const gpos: number[] = [];
  let c = 0;
  exons.forEach(([s, e], k) => {
    const lo = Math.max(s, cs),
      hi = Math.min(e, ce);
    const coding = lo <= hi;
    if (coding) {
      const bases = ref(lo, hi - lo + 1);
      if (bases == null) throw new Error(`${tx.symbol}: reference missing at ${tx.chrom}:${lo}-${hi}`);
      const sense = tx.strand === "+" ? bases : revcomp(bases);
      cds += sense;
      for (let i = 0; i < hi - lo + 1; i++) gpos.push(tx.strand === "+" ? lo + i : hi - i);
      pieces.push({ exon: k + 1, cLo: c + 1, cHi: c + (hi - lo + 1), bp: hi - lo + 1 });
      c += hi - lo + 1;
    }
    if (k < exons.length - 1) {
      const next = exons[k + 1];
      const gLo = tx.strand === "+" ? e + 1 : next[1] + 1;
      const gHi = tx.strand === "+" ? next[0] - 1 : s - 1;
      // afterC: the last coding base before the gap; null where the piece before has none
      gaps.push({ intron: k + 1, afterC: coding ? c : null, bp: gHi - gLo + 1, gLo, gHi });
    }
  });

  // 3' tail: walk the exons after the CDS end, base by base, until the reference stops.
  let tail = "";
  const tailPos: number[] = [];
  let tailComplete = true;
  outer: for (const [s, e] of exons) {
    const span: number[] = [];
    if (tx.strand === "+") {
      for (let g = Math.max(s, ce + 1); g <= e; g++) span.push(g);
    } else {
      for (let g = Math.min(e, cs - 1); g >= s; g--) span.push(g);
    }
    for (const g of span) {
      const b = ref(g, 1);
      if (b == null) {
        tailComplete = false;
        break outer;
      }
      tail += tx.strand === "+" ? b : COMP[b];
      tailPos.push(g);
    }
  }

  // the last join: mRNA length up to the end of the second-to-last exon, less the 5' UTR
  let utr5 = 0,
    upto = 0;
  exons.forEach(([s, e], k) => {
    const len = e - s + 1;
    if (k < exons.length - 1) upto += len;
    utr5 += tx.strand === "+" ? Math.max(0, Math.min(e, cs - 1) - s + 1) : Math.max(0, e - Math.max(s, ce + 1) + 1);
  });
  const lastJunctionC = exons.length > 1 ? upto - utr5 : null;

  /* A selenoprotein: an in-frame TGA inside the MANE coding sequence is read as selenocysteine
     (U), not a stop, as annotate.ts's secOf does; SELENON's codon 428 would otherwise end the
     protein at 427 of 556. Only the reference protein reads through it: codon.ts and dispatch
     still translate an edited message to its first TGA. */
  let prot = "";
  for (let i = 0; i + 3 <= cds.length; i += 3) {
    const a = CODON[cds.slice(i, i + 3)] ?? "X";
    prot += a === "*" && i + 3 < cds.length ? "U" : a;
  }
  if (!prot.endsWith("*")) throw new Error(`${tx.symbol}: CDS does not end in a stop`);
  return {
    symbol: tx.symbol,
    transcript: tx.transcript,
    chrom: tx.chrom,
    strand: tx.strand,
    cds,
    orfTail: cds + tail,
    gpos: [...gpos, ...tailPos],
    pieces,
    gaps,
    protein: prot.slice(0, -1),
    exonCount: exons.length,
    lastJunctionC,
    tailComplete,
  };
}

/** A VCF-style edit, trimmed of shared bases. */
export interface Edit {
  pos: number;
  ref: string;
  alt: string;
}

export function trim(chromPos: number, ref: string, alt: string): Edit {
  let p = chromPos,
    r = ref,
    a = alt;
  while (r.length && a.length && r[r.length - 1] === a[a.length - 1]) {
    r = r.slice(0, -1);
    a = a.slice(0, -1);
  }
  while (r.length && a.length && r[0] === a[0]) {
    r = r.slice(1);
    a = a.slice(1);
    p++;
  }
  return { pos: p, ref: r, alt: a };
}

/** The edited orfTail, if every changed base (and, for an insertion, both flanks)
 *  lies inside it and inside one exon. Else null: the edit is not a coding edit. */
export function applyToOrf(m: GeneModel, e: Edit): { seq: string; at: number; delta: number } | null {
  const idx = new Map<number, number>();
  m.gpos.forEach((g, i) => idx.set(g, i));
  if (e.ref.length === 0) {
    // insertion between e.pos-1 and e.pos (genomic)
    const a = idx.get(e.pos - 1),
      b = idx.get(e.pos);
    if (a == null || b == null || Math.abs(a - b) !== 1) return null;
    const after = Math.min(a, b); // sense index the insertion follows
    const ins = m.strand === "+" ? e.alt : revcomp(e.alt);
    return { seq: m.orfTail.slice(0, after + 1) + ins + m.orfTail.slice(after + 1), at: after + 1, delta: ins.length };
  }
  const first = idx.get(e.pos),
    last = idx.get(e.pos + e.ref.length - 1);
  if (first == null || last == null || Math.abs(last - first) !== e.ref.length - 1) return null;
  const lo = Math.min(first, last),
    hi = Math.max(first, last);
  const alt = m.strand === "+" ? e.alt : revcomp(e.alt);
  return { seq: m.orfTail.slice(0, lo) + alt + m.orfTail.slice(hi + 1), at: lo, delta: alt.length - (hi - lo + 1) };
}
