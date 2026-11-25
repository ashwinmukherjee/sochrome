// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/** Codon-lane facts: the same fields as the renderer's CodonSpecimen, computed from the
 *  gene model and the edit the way the 26 specimens were. */

import { CODON, translate, type GeneModel, type Edit, applyToOrf } from "./model.ts";

export type CodonKind =
  "frameshift" | "in-frame" | "nonsense" | "silent" | "stop-loss" | "missense" | "mnv" | "start-loss";

export interface CodonFacts {
  kind: CodonKind;
  /** the codon the operation lands on (for an arrival, the slot it takes) */
  seam: number;
  /** the codon where reading terminates; null when no stop is read in the
   *  sequence the reference holds (never-stopping, or past what is shipped) */
  terminator: number | null;
  trueEnd: number | null;
  netBaseDelta: number;
  cutCells: number[];
  addCells: number[];
  swapCell: number | null;
  lastCodon: number;
  /** in-frame only: whole codons that leave (<0) or arrive (>0) */
  words: number;
  /** an in-frame edit drawn on its codon-aligned spelling (the stated reduction) */
  aligned: boolean;
  /** the reference ran out before a stop was read (frameshift / stop loss); false when the
   *  whole message was read and simply has no stop */
  stopBeyondReference: boolean;
  /** start-loss only: the start codon before and after (WT1 starts CTG, not ATG) */
  startFrom?: string;
  startTo?: string;
  /** start-loss only: the first ATG past the lost start, where scanning would begin reading
   *  instead (a prediction by the scanning rule, not a measurement). `codon` is its codon in
   *  the original reading when `inStep`; null when no ATG follows in the coding sequence. */
  restart?: { nt: number; inStep: boolean; codon: number | null } | null;
  /** frameshift deletion only: the whole cut, as the coding letters it takes — `start` the
   *  first (1-based c. position, the HGVS spelling's), `n` how many. cutCells
   *  holds only the letters inside the first codon cut, which drew a 38-letter deletion as
   *  2; the renderer draws from this. */
  cut?: { start: number; n: number };
  /** frameshift insertion only: the whole insertion — the new letters go in after coding
   *  letter `after` (HGVS's 3'-most spelling), `n` of them. addCells holds only
   *  those that fit in the rest of one codon, which drew a 58-letter duplication as none. */
  add?: { after: number; n: number };
}

const codonOf = (nt: number): [number, number] => [Math.floor((nt - 1) / 3) + 1, ((nt - 1) % 3) + 1];

function firstDifference(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i + 1;
  return n + 1;
}

const del = (s: string, lo: number, hi: number) => s.slice(0, lo - 1) + s.slice(hi);
const ins = (s: string, after: number, x: string) => s.slice(0, after) + x + s.slice(after);

/* WHERE READING BEGINS INSTEAD. With the start gone, the reading machinery scans on
   to the next ATG (leaky scanning). If that ATG is in step with the original reading, the protein
   is made from there, missing everything before it; if it is out of step, the message is misread
   and no working protein is made. Only the coding sequence is searched, from its second letter:
   an ATG in the 5' UTR sits before the lost start and was already passed over. */
export function restartOf(cds: string): { nt: number; inStep: boolean; codon: number | null } | null {
  const i = cds.indexOf("ATG", 1);
  if (i < 0) return null;
  const inStep = i % 3 === 0;
  return { nt: i + 1, inStep, codon: inStep ? i / 3 + 1 : null };
}

export function codonFacts(m: GeneModel, e: Edit): CodonFacts | null {
  const ed = applyToOrf(m, e);
  if (!ed) return null;
  const L = m.cds.length;
  const refRead = translate(m.orfTail); // ends "*" at L/3
  const altRead = translate(ed.seq);
  const stopped = altRead.endsWith("*");
  const term = stopped ? altRead.length : null;
  const lastCodon = refRead.length; // residues + stop
  const k0 = ed.at + 1; // 1-based first changed nucleotide
  const base = {
    trueEnd: null,
    cutCells: [] as number[],
    addCells: [] as number[],
    swapCell: null as number | null,
    lastCodon,
    words: 0,
    aligned: false,
    stopBeyondReference: !stopped && !m.tailComplete,
  };

  // E7: any change to the first codon is a start loss (the spine's rule: read from sequence,
  // so a gene starting CTG is covered and an indel that leaves the start in place is not)
  /* A START WORD CHANGED INTO ATG STILL STARTS: WT1 starts on CTG, and
     CTG to ATG keeps the start and the protein (a start word always reads as Met), so it is a
     silent change at codon 1, not a start loss. */
  if (k0 <= 3 && ed.delta === 0 && ed.seq.slice(0, 3) === "ATG" && m.cds.slice(0, 3) !== "ATG") {
    return {
      ...base,
      kind: "silent",
      seam: 1,
      terminator: null,
      netBaseDelta: 0,
      swapCell: codonOf(k0)[1],
      startFrom: m.cds.slice(0, 3),
      startTo: "ATG",
      stopBeyondReference: false,
    };
  }
  if (k0 <= 3 && ed.seq.slice(0, 3) !== m.cds.slice(0, 3)) {
    return {
      ...base,
      kind: "start-loss",
      seam: 1,
      terminator: null,
      netBaseDelta: ed.delta,
      swapCell: codonOf(k0)[1],
      startFrom: m.cds.slice(0, 3),
      startTo: ed.seq.slice(0, 3),
      stopBeyondReference: false,
      restart: restartOf(m.cds),
    };
  }
  if (ed.delta === 0) {
    const changed = [...e.ref].length;
    const [cod, cell] = codonOf(k0);
    if (cod === L / 3) {
      // the terminator itself changed
      if (stopped && term === cod)
        return {
          ...base,
          kind: "silent",
          seam: cod,
          terminator: null,
          netBaseDelta: 0,
          swapCell: cell,
          stopBeyondReference: false,
        };
      return {
        ...base,
        kind: "stop-loss",
        seam: cod,
        terminator: term,
        trueEnd: cod,
        netBaseDelta: 0,
        swapCell: cell,
        lastCodon: Math.floor(m.orfTail.length / 3),
      };
    }
    if (changed > 1)
      return { ...base, kind: "mnv", seam: cod, terminator: term, netBaseDelta: 0, stopBeyondReference: false };
    const refC = m.cds.slice((cod - 1) * 3, cod * 3),
      altC = ed.seq.slice((cod - 1) * 3, cod * 3);
    if (CODON[altC] === "*")
      return {
        ...base,
        kind: "nonsense",
        seam: cod,
        terminator: cod,
        netBaseDelta: 0,
        swapCell: cell,
        stopBeyondReference: false,
      };
    if (CODON[altC] === CODON[refC])
      return {
        ...base,
        kind: "silent",
        seam: cod,
        terminator: null,
        netBaseDelta: 0,
        swapCell: cell,
        stopBeyondReference: false,
      };
    return {
      ...base,
      kind: "missense",
      seam: cod,
      terminator: null,
      netBaseDelta: 0,
      swapCell: cell,
      stopBeyondReference: false,
    };
  }

  if (ed.delta % 3 !== 0) {
    /* THE READING IS KEPT: the letters after the edit re-form every codon through the stop (a
       letter cut from the stop codon, the next one closing it into a stop again). Nothing is
       misread, so there is no first misread codon: the seam is the codon the edit lands on, and
       its spelling stays inside the coding sequence. */
    const kept = altRead === refRead;
    const end = kept ? L : m.orfTail.length;
    // a stop read past the protein's own end (in the 3' UTR): the row runs on to it
    if (term != null && term > lastCodon) base.lastCodon = Math.floor(m.orfTail.length / 3);
    if (ed.delta < 0) {
      const n = -ed.delta;
      const cells: number[] = [];
      for (let k = k0; k < k0 + n; k++) {
        const [c, cell] = codonOf(k);
        if (c === codonOf(k0)[0]) cells.push(cell);
      }
      // the cut is drawn on HGVS's spelling, the 3'-most of the equivalent ones (a deletion in a
      // repeat can sit anywhere along it and leave the same sequence; the edit arrives left-aligned)
      let start = k0;
      while (start + n <= end && m.orfTail[start - 1] === m.orfTail[start - 1 + n]) start++;
      const seam = kept ? codonOf(start)[0] : firstDifference(altRead, refRead);
      return {
        ...base,
        kind: "frameshift",
        seam,
        terminator: term,
        netBaseDelta: ed.delta,
        cutCells: cells,
        cut: { start, n },
      };
    }
    // arrival: the new letters take the cells after the one they follow
    const [, cell] = codonOf(k0 - 1);
    const cells: number[] = [];
    for (let k = 0; k < ed.delta && cell + 1 + k <= 3; k++) cells.push(cell + 1 + k);
    // the whole insertion, on HGVS's spelling: an insertion in a repeat can sit anywhere along
    // it (rotating as it goes) and leave the same sequence; the edit arrives left-aligned
    let after = k0 - 1,
      insSeq = ed.seq.slice(after, after + ed.delta);
    while (after < end - (kept ? 1 : 0) && m.orfTail[after] === insSeq[0]) {
      insSeq = insSeq.slice(1) + insSeq[0];
      after++;
    }
    const seam = kept ? codonOf(after + 1)[0] : firstDifference(altRead, refRead);
    return {
      ...base,
      kind: "frameshift",
      seam,
      terminator: term,
      netBaseDelta: ed.delta,
      addCells: cells,
      add: { after, n: ed.delta },
    };
  }

  // in-frame: draw the codon-aligned spelling of the same protein, as the generator does
  const n = Math.abs(ed.delta);
  const want = translate(ed.seq);
  if (ed.delta < 0) {
    const lo = k0,
      hi = k0 + n - 1;
    for (let lo2 = lo - n; lo2 <= lo + n; lo2++) {
      if (lo2 < 1 || (lo2 - 1) % 3 !== 0 || lo2 + n - 1 > L) continue;
      if (translate(del(m.orfTail, lo2, lo2 + n - 1)) === want) {
        const seam = codonOf(lo2)[0];
        const k =
          want.endsWith("*") && want.length < refRead.length - n / 3 ? ("nonsense" as const) : ("in-frame" as const);
        return {
          ...base,
          kind: k,
          seam,
          terminator: k === "nonsense" ? want.length : null,
          netBaseDelta: ed.delta,
          words: -n / 3,
          aligned: lo2 !== lo,
          stopBeyondReference: false,
        };
      }
    }
    void hi;
    // no codon-aligned spelling (the join word is respelled): a stop read at the protein's own
    // end is the normal stop, not an early one, so nothing terminates early
    const early = stopped && term! < refRead.length - n / 3;
    return {
      ...base,
      kind: early ? "nonsense" : "in-frame",
      seam: codonOf(k0)[0],
      terminator: early ? term : null,
      netBaseDelta: ed.delta,
      words: -n / 3,
      stopBeyondReference: !stopped,
    };
  }
  const seq = ed.seq.slice(ed.at, ed.at + n);
  for (let a2 = ed.at - n; a2 <= ed.at + n; a2++) {
    if (a2 < 0 || a2 > L || a2 % 3 !== 0) continue;
    for (let r = 0; r < n; r++) {
      const rot = seq.slice(r) + seq.slice(0, r);
      if (translate(ins(m.orfTail, a2, rot)) === want) {
        const k = want.endsWith("*") && want.length < refRead.length ? ("nonsense" as const) : ("in-frame" as const);
        return {
          ...base,
          kind: k,
          seam: a2 / 3 + 1,
          terminator: k === "nonsense" ? want.length : null,
          netBaseDelta: ed.delta,
          words: n / 3,
          aligned: a2 !== ed.at,
          stopBeyondReference: false,
        };
      }
    }
  }
  const early = stopped && term! < refRead.length + n / 3;
  return {
    ...base,
    kind: early ? "nonsense" : "in-frame",
    seam: codonOf(k0)[0],
    terminator: early ? term : null,
    netBaseDelta: ed.delta,
    words: n / 3,
    stopBeyondReference: !stopped,
  };
}
