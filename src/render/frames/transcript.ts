// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The transcript lane's frames: the message's blocks and the cuts that join them.

import { visual as V } from "../tokens";
import type { StateEntry, BeatName } from "../states";
import { BRCA1_EXONS, BRCA1_CDS_LENGTH, TRANSCRIPT_SPECIMENS, type TranscriptSpecimen } from "../specimens";
import { PITCH1, measure1 } from "./codon";
import { type BlockMark, type Channel, type Frame, type Mark, type Reach, type SeamMark, pastOf, span } from "./marks";

/* Lane 2, transcript. Two scales, one register: the establishing frame is the whole message end to end
   (position and scale, no states); the window is a fixed span of nucleotides centred on the join, at true
   proportion, bleeding off both edges. The move between them is continuous, so they read as one object.
   Block width is linear in bp at both scales; the brief's "power-law blocks" would break the establishing
   frame's one job, stating scale.
   Joins are intron positions: blocks abut and a seam stands on each join. A join becomes a length only
   while material is in it (an opened gap, `transcriptPlan`'s `open`).
   The builder dispatches on the specimen's kind, never the state name.
   Two ways to admit material: `retain`'s join fails to close, so material grows in through a seam that
   stays put (fixed left edge, growing width); `pseudo-exon`'s join is made, so the strip opens the intron
   and closes onto the piece it kept (fixed width, moving left edge). Downstream moves by the box's width
   once it settles, and by whatever stands in the gap before that (`growthShift`). */

/** The layout of one opened gap. `inner` is the area content is drawn into; `shift` is what everything
 *  downstream of it moves by. */
interface GapPlan {
  afterC: number;
  intronBp: number;
  /** the intron this gap stands for */
  intron: number;
  innerX: number;
  innerW: number;
  /** what the admitted material will take once it is drawn */
  admittedW: number;
  shift: number;
  /** `deep-intronic` only: the gap stands for the whole intron for one beat before closing onto the piece
   *  that stays, so on that beat it is `admittedW + breakBlockW` wide (the material at true proportion plus
   *  the lane's elision width for the rest of the run). */
  reveals: boolean;
}

interface TranscriptPlan {
  pxpb: number;
  winLo: number;
  /** the window's upper edge in nt (`winLo + span`); the datum's rule anchors to it. */
  winHi: number;
  x: (nt: number) => number;
  blocks: { exon: number; cLo: number; cHi: number; bp: number; x: number; w: number }[];
  ticks: { nt: number; x: number }[];
  height: number;
  gap: GapPlan | null;
  /** displacement for material at a given coding position */
  shiftAt: (c: number) => number;
  /** may the datum's rule bleed past this side of the window: false where this side is the gene's true
   *  edge (nt 0 or `BRCA1_CDS_LENGTH`). Same claim as the codon lane's `bleedLeft`/`bleedRight`. */
  bleedLeft: boolean;
  bleedRight: boolean;
  /** `datumBleed` at this window's pxpb, in px. Exposed so the rule and the tick filter bounded by it
   *  cannot disagree about how far the line runs. */
  bleed: number;
}

/** The ruler drops below the identifier bead just far enough to leave `identifierClear` between the bead's
 *  clear square and the blocks (sizing option F). The codon lane's ruler carries no bead and keeps
 *  `datumGap`. */
const tDatumGap = (): number =>
  V.identifierUnified ? Math.max(V.datumGap, (V.moduleSize + 2 * V.markHalo) / 2 + V.identifierClear) : V.datumGap;

/** Solves px-per-nucleotide once per window. With no gap the span fills the stage; with one open the scale
 *  also leaves room for the admitted material (and, for a revealing gap, `breakBlockW`). Solved off the
 *  window, not the beat, so every windowed beat of a cell shares it and the ruler never moves. */
function transcriptPlan(
  lo: number,
  hi: number,
  /** the gap to open, if any; every gap seats flush. A gap showing a break column instead of material has
   *  no cell and is unsupported here (GLITCHES.md).
   *  `reveals` (deep-intronic): the gap opens wide for a beat before closing onto the chunk, so the reader
   *  sees the run it came out of. On that beat it holds the chunk at true message proportion and the rest
   *  of the intron elided to `breakBlockW`; see `transcriptFrame`'s gap section. */
  open?: {
    afterC: number;
    nt: number;
    intron: number;
    intronBp: number;
    reveals?: boolean;
  },
): TranscriptPlan {
  const total = GENE.cdsLength;
  const span = Math.min(Math.max(1, hi - lo), total);
  const winLo = Math.max(0, Math.min(Math.max(0, total - span), lo));
  const winHi = winLo + span;

  /* Room for the datum's hairline. This lane's pxpb fills exactly what a window asks for, so a bleed needs
     width reserved before the scale is solved. Every lane shares one left edge at x = 0, so the left bleed is
     withdrawn and the frame's own cut is the continuation; the right bleed stays, continuing into the
     overrun band, wherever that side is not the gene's true edge. */
  const bleedLeft = false;
  const bleedRight = winHi < total;
  /* Solved exactly, with the margins in the equation: the bled datum must land on 0 and on
     `stageW − stageOverrun`, so each margin is the bleed at the real scale:

       (nBleed × datumBleed + span + gap.nt) × pxpb + (reveals ? breakBlockW : 0) = stageW − stageOverrun

     `usableW` and the gap branch below re-derive the same pxpb from these margins. */
  const refW = V.stageW - V.stageOverrun;
  const nBleed = (bleedLeft ? 1 : 0) + (bleedRight ? 1 : 0);
  const exactPxpb =
    (refW - (open && open.reveals ? V.breakBlockW : 0)) / (nBleed * V.datumBleed + span + (open ? open.nt : 0));
  const marginL = bleedLeft ? V.datumBleed * exactPxpb : 0;
  const marginR = bleedRight ? V.datumBleed * exactPxpb : 0;
  const usableW = refW - marginL - marginR;

  let pxpb = usableW / span;
  let gap: GapPlan | null = null;
  if (open) {
    /* A revealing gap is solved off its widest beat, which holds the message, the chunk at true message
       proportion and the rest of the intron elided, all at once:

         span * pxpb  +  nt * pxpb  +  breakBlockW  =  usableW

       Any other gap reserves room for the material alone: every admitting kind seats it flush. */
    pxpb = open.reveals ? (usableW - V.breakBlockW) / (span + open.nt) : usableW / (span + open.nt);
  }

  const x = (nt: number) => (nt - winLo) * pxpb + marginL;

  if (open) {
    /* The gap's inner area holds one width on every windowed beat, whatever is in it, so nothing downstream
       moves on a beat where nothing was added to the message. */
    const admittedW = open.nt * pxpb;
    /* The same sum the scale was solved from, written out again so a slip upstream shows as an overrun
       instead of being absorbed by a gap sized off the leftover. */
    const innerW = open.reveals ? admittedW + V.breakBlockW : admittedW;
    /* The gap starts where the block before it ends (blocks abut, gaps seat flush). The seams stand on these
       edges, so the boxes they bound set `openEdge`; see the post-pass at the end of `transcriptFrame`. */
    gap = {
      afterC: open.afterC,
      intron: open.intron,
      intronBp: open.intronBp,
      innerX: x(open.afterC),
      innerW,
      admittedW,
      /* The settled shift: the box's own width. A revealing gap's wider beat is carried per beat by
         `transcriptFrame`'s `growthShift`; the plan is the ruler, and the ruler knows nothing of beats. */
      shift: admittedW,
      reveals: !!open.reveals,
    };
  }
  const shiftAt = (c: number) => (gap && c > gap.afterC ? gap.shift : 0);

  /* Blocks abut at their true edges: each runs `x(cLo - 1)` to `x(cHi)` with no per-block offset, so every
     block start stays exactly on the scale, and a join is said by a seam drawn on it (the seam loop). An
     opened gap displaces everything after it by material really added; the datum stays put so the reader
     sees by how much. The plan stays unclamped: trimming happens at emit time, once displacement is known. */
  const blocks = GENE.exons.map((e) => ({
    exon: e.exon,
    cLo: e.cLo,
    cHi: e.cHi,
    bp: e.bp,
    x: x(e.cLo - 1) + shiftAt(e.cLo),
    w: Math.max(1, e.bp * pxpb),
  }));

  /* The datum is ticked at real block boundaries, not a round interval: one per junction plus the CDS ends,
     n+1 ticks for n exons, as in the codon lane. A tick is keyed by nucleotide, so a tick in two frames
     travels to its own new x. The datum never takes the gap's shift: it measures the reference the shift is
     measured against. A tick is kept only inside the rule's drawn extent (`datumX1`/`datumX2`), since with
     a gap open the bleed can end short of the stage. */
  const bleed = V.datumBleed * pxpb;
  const coreX1 = x(winLo);
  const coreX2 = x(winHi);
  const datumX1 = coreX1 - (bleedLeft ? bleed : 0);
  const datumX2 = coreX2 + (bleedRight ? bleed : 0);

  const boundaryNts = [0, ...GENE.exons.map((e) => e.cHi)];
  const ticks: { nt: number; x: number }[] = [];
  for (const nt of boundaryNts) {
    const px = x(nt);
    if (px >= datumX1 - V.epsPx && px <= datumX2 + V.epsPx) ticks.push({ nt, x: px });
  }

  const height = V.blockH + tDatumGap() + V.tickLen / 2;
  return { pxpb, winLo, winHi, x, blocks, ticks, height, gap, shiftAt, bleedLeft, bleedRight, bleed };
}

/* ---- the window rule ---- */

/** The gene the lane is drawing. A variant from facts brings its own exons; built cells carry none and get
 *  BRCA1's. `transcriptFrame` sets this at the top of every frame, so a frame only sees its own gene. */
export let GENE: { exons: readonly { exon: number; cLo: number; cHi: number; bp: number }[]; cdsLength: number } = {
  exons: BRCA1_EXONS,
  cdsLength: BRCA1_CDS_LENGTH,
};

const blockAt = (c: number) => GENE.exons.find((e) => e.cLo <= c && c <= e.cHi);
const blockEndingAt = (c: number) => GENE.exons.find((e) => e.cHi === c);
const blockAfter = (c: number) => GENE.exons.find((e) => e.cLo > c);
const blockBefore = (c: number) => [...GENE.exons].reverse().find((e) => e.cHi < c);

/** WHAT THE CELL'S ARGUMENT OCCUPIES, in reference coordinates. Everything the
 *  reader has to be able to see at once, and nothing else. */
function support(spec: TranscriptSpecimen): [number, number] {
  switch (spec.kind) {
    case "skip": {
      const lo = spec.skipLo! - 1;
      const hi = spec.stopNtRef != null ? spec.stopNtRef + V.stopSliverW - 1 : spec.skipHi!;
      return [lo, hi];
    }
    case "retain":
    case "pseudo-exon": {
      const before = blockEndingAt(spec.admitted!.afterC)!;
      const after = blockAfter(spec.admitted!.afterC)!;
      return [before.cLo - 1, after.cHi];
    }
    case "foreclosed": {
      /* The support is the junction alone: the cell's claim is stillness at one cut site, and the flanking
         exons are context. `transcriptWindow` composes them whole. */
      return [spec.junctionC! - 1, spec.junctionC!];
    }
    default: {
      // double-agent: the junction and the block either side of it, whose join is in question.
      const before = blockEndingAt(spec.junctionC!)!;
      const after = blockAfter(spec.junctionC!)!;
      return [before.cLo - 1, after.cHi];
    }
  }
}

/** Composes whole flanking exons around a junction, alternating sides, until the window is at least
 *  `V.junctionWindowBp` wide or the gene runs out. Every edge is a real boundary, so the strip is never cut
 *  mid-block at the frame edge. */
function composeJunctionWindow(junctionC: number): [number, number] {
  let lo = blockEndingAt(junctionC)!.cLo - 1;
  let hi = blockAfter(junctionC)!.cHi;
  while (hi - lo < V.junctionWindowBp) {
    const nextAfter = blockAfter(hi);
    const nextBefore = blockBefore(lo + 1);
    if (!nextAfter && !nextBefore) break;
    if (nextAfter) hi = nextAfter.cHi;
    if (hi - lo < V.junctionWindowBp && nextBefore) lo = nextBefore.cLo - 1;
  }
  return [lo, hi];
}

/** The window rule, computed rather than authored: the support plus one flanking block per side, plus air
 *  as a fraction of its span so the rule holds at any scale. The frame bleeds off both edges by
 *  construction. A flank contributes at most the support's own span and bleeds off beyond that: taken
 *  whole, a long flank (BRCA1's exon 10, 3,426 nt) sets the scale and shrinks the subject to a few pixels.
 *  `foreclosed` composes whole exons instead (`composeJunctionWindow`): padding a single point lands
 *  mid-exon, which reads as the story continuing past the frame. */
function transcriptWindow(spec: TranscriptSpecimen): [number, number] {
  if (spec.kind === "foreclosed") return composeJunctionWindow(spec.junctionC!);
  const [sLo, sHi] = support(spec);
  const reach = Math.max(1, sHi - sLo);
  const before = blockBefore(sLo + 1);
  const after = blockAfter(sHi);
  const lo = before ? Math.max(before.cLo - 1, sLo - Math.min(before.bp, reach)) : 0;
  const hi = after ? Math.min(after.cHi, sHi + Math.min(after.bp, reach)) : sHi;
  const pad = (hi - lo) * V.winMargin;
  return [lo - pad, hi + pad];
}

/* ---- shared emitters ---- */

/** Trimmed to the bounds given, not hidden under a clip. The frame cuts the message (a transcript stopping
 *  at the canvas edge would claim the gene stops there), so a block keeps its state and loses only the
 *  geometry past the bound. Bounds are the window's own edges, not the stage's.
 *  The third value says whether anything was cut (`BlockMark.trimmed`), which cannot be re-derived from
 *  position once `shiftAt` displaces a block. It carries `V.epsPx`: a sub-pixel cut moves no ink and must
 *  not drop a whole block from probe.ts's "blocks at true proportion". */
function trim(x: number, w: number, lo: number, hi: number): [number, number, boolean] {
  const clo = Math.max(lo, x);
  const chi = Math.min(hi, x + w);
  const cut = clo - x > V.epsPx || x + w - chi > V.epsPx;
  return [clo, Math.max(0, chi - clo), cut];
}

/** The datum: one rule ticked by nucleotide, static, so the scale is never the ambiguous thing on screen.
 *  The rule bleeds past the window's edge on whichever side is not the gene's own start or end.
 *  Every tick is a plain address (§7.10b): a damaged join is stated once, by the seam on it
 *  (`damagedSeamX`); the instrument does not report on its own specimen.
 *  `static` exempts the datum from the first beat's group fade: the instrument is there and the reading
 *  arrives onto it (a hairline fading with the blocks is not visible until nearly home). Seams belong to
 *  the object and arrive with it. */
function transcriptDatum(plan: TranscriptPlan, top: number): Mark[] {
  const y = top + V.blockH + tDatumGap();
  const coreX1 = plan.x(plan.winLo);
  const coreX2 = plan.x(plan.winHi);
  const out: Mark[] = [
    {
      kind: "rule",
      key: "rule",
      x1: coreX1 - (plan.bleedLeft ? plan.bleed : 0),
      x2: coreX2 + (plan.bleedRight ? plan.bleed : 0),
      coreX1,
      coreX2,
      y,
      static: true,
    },
  ];
  plan.ticks.forEach((t) =>
    out.push({
      kind: "tick",
      key: `tick-${t.nt}`,
      x: t.x,
      y,
      len: V.tickLen,
      static: true,
    }),
  );
  return out;
}

/** One break column at block scale, as in the codon lane: a column and its count, in nucleotides. It
 *  stands for a run the message does not contain, so it is an outline, not a filled block. */
function breakColumn(key: string, x: number, w: number, y: number, nt: number): Mark[] {
  return [
    { kind: "block", key, x, y, w, h: V.blockH, ch: "hollow", reach: "unread", faint: true },
    {
      kind: "label",
      key: `${key}-n`,
      x: x + w / 2,
      y: y + V.blockH + tDatumGap() + V.breakLabelGap + V.labelSize,
      text: `${nt.toLocaleString("en-US")} nt`,
      anchor: "middle",
      static: true,
    },
  ];
}

/* ---- the builder ---- */

/** reading order downstream of an event, for the front: one rank per block. */
function rankFrom(exon: number, afterC: number): number {
  const after = GENE.exons.filter((e) => e.cLo > afterC);
  const i = after.findIndex((e) => e.exon === exon);
  return i < 0 ? 0 : i;
}

/* ---- O1: the join at letter scale (holes O1/E9/E10/E12) ----
   One junction close up: the exon's letters in their real codons (grouped by the reading frame at this
   join, a split codon included), the intron's letters single, the codon ruler under the exon only (the
   rule runs on), and the cut signal as a bracket over the facts' `window` (the facts stage's SIGNAL). The
   changed letter takes the codon lane's changed-letter mark. Three states, told apart by the drawing:
     broken    an essential letter (±1, ±2): the join turns dotted (`break`)
     weakened  a letter inside the bracket changes; the join holds
     beside    the changed letter sits outside the bracket; the join holds */
function junctionFrame(beat: BeatName, entry: StateEntry, J: NonNullable<TranscriptSpecimen["junction"]>): Frame {
  const past = pastOf(entry, beat);
  const marks: Mark[] = [];
  const maxOff = Math.max(...J.offsets.map(Math.abs));
  /* As long as a codon row, flush left like one. Natural size first (12-20 intron letters, four exon codons);
     the row's leftover goes to more exon codons, and any remainder under a codon to intron letters. */
  const cw0 = V.codonCellW,
    gap0 = V.blockGap,
    ig0 = 2;
  const rowW = Math.min(V.targetCodons, measure1()) * PITCH1 - V.blockGap;
  let N = Math.min(20, Math.max(12, maxOff + 2)); // intron letters shown
  const base0 = (J.phase > 0 ? J.phase : 3) + 9;
  const natural = (g: number, n: number) => (base0 + 3 * g) * cw0 + (g + 3) * gap0 + gap0 + n * cw0 + (n - 1) * ig0;
  let extra = 0;
  /* A contiguous run too long for the row elides, keeping both ends: letters up to six past the signal (or
     the run's start), one break column labelled with its count, then the run's last three letters and three
     unchanged after it. */
  const absOffs = J.offsets.map(Math.abs).sort((p, q) => p - q);
  const isRun = absOffs.length > 1 && absOffs.every((o, j) => j === 0 || o === absOffs[j - 1] + 1);
  const headEnd = Math.max(J.window.intron, absOffs[0]) + 6;
  const breakW0 = V.breakCells * (3 * cw0 + gap0);
  const elide = isRun && natural(0, maxOff + 3) > rowW && maxOff - 3 - headEnd >= 4;
  if (elide) {
    N = headEnd + 6;
    while (natural(extra + 1, N) + breakW0 + ig0 <= rowW) extra++;
  } else {
    while (natural(extra + 1, N) <= rowW) extra++;
    while (natural(extra, N + 1) <= rowW && N < 40) N++;
  }
  const groups = [J.phase > 0 ? J.phase : 3, 3, 3, 3, ...Array(extra).fill(3)]; // exon groups, from the join outward
  const exonLetters = groups.reduce((a, b) => a + b, 0);
  const exonW0 = exonLetters * cw0 + (groups.length - 1) * gap0;
  const intronW0 = N * cw0 + (N - 1) * ig0 + (elide ? breakW0 + ig0 : 0);
  /* The join's gap: a whole codon at the join keeps the codon gap; a split codon's letters take the intron's
     letter spacing so they don't read as isolated. A broken join keeps the codon gap for its dotted join. */
  const joinGap0 = J.phase > 0 && J.state !== "broken" ? ig0 : gap0;
  const total0 = exonW0 + joinGap0 + intronW0;
  const k = Math.min(1, (V.stageW - 2 * V.foldPad) / total0);
  const cw = cw0 * k,
    gap = gap0 * k,
    ig = ig0 * k,
    jg = joinGap0 * k,
    h = V.blockH;
  const total = total0 * k;
  const x0 = 0;
  void total;
  const y = (V.stageH - h) / 2 - 12;
  const donor = J.side === "donor";
  const exonW = exonW0 * k,
    intronW = intronW0 * k;
  const exonX0 = donor ? x0 : x0 + intronW + jg;
  const intronX0 = donor ? x0 + exonW + jg : x0;
  const seamX = donor ? x0 + exonW + jg / 2 : x0 + intronW + jg / 2;
  // exon groups laid out left to right; `groups` is from the join outward
  const order = donor ? [...groups].reverse() : groups;
  const exonCellX: number[] = [];
  const codonEdges: number[] = []; // ticks: true codon boundaries only
  let x = exonX0;
  order.forEach((n, gi) => {
    marks.push({ kind: "block", key: `jx-e${gi}`, x, y, w: n * cw, h, ch: "solid", parts: n } as Mark);
    for (let c = 0; c < n; c++) exonCellX.push(x + c * cw);
    const partialAtJoin = J.phase > 0 && ((donor && gi === order.length - 1) || (!donor && gi === 0));
    const leftIsCodonEdge = !(partialAtJoin && !donor);
    const rightIsCodonEdge = !(partialAtJoin && donor);
    const atJoinLeft = !donor && gi === 0,
      atJoinRight = donor && gi === order.length - 1;
    if (leftIsCodonEdge) codonEdges.push(x - (atJoinLeft ? jg : gap) / 2);
    if (rightIsCodonEdge) codonEdges.push(x + n * cw + (atJoinRight ? jg : gap) / 2);
    x += n * cw + gap;
  });
  // intron letters: donor +1..+N left to right; acceptor -N..-1; an elided run's break between
  type Slot = { off: number } | { brk: number; first: number; last: number };
  const slots: Slot[] = [];
  if (elide) {
    const head = Array.from({ length: headEnd }, (_, j) => j + 1);
    const tail = Array.from({ length: 6 }, (_, j) => maxOff - 2 + j);
    const brk = { brk: maxOff - 3 - headEnd, first: headEnd + 1, last: maxOff - 3 };
    if (donor) slots.push(...head.map((o) => ({ off: o })), brk, ...tail.map((o) => ({ off: o })));
    else slots.push(...tail.reverse().map((o) => ({ off: -o })), brk, ...head.reverse().map((o) => ({ off: -o })));
  } else for (let i = 0; i < N; i++) slots.push({ off: donor ? i + 1 : i - N });
  const slotX: number[] = [];
  {
    let cx = intronX0;
    for (const sl of slots) {
      slotX.push(cx);
      cx += ("brk" in sl ? breakW0 * k : cw) + ig;
    }
  }
  const xOf = (off: number) => slotX[slots.findIndex((sl) => "off" in sl && sl.off === off)];
  const changed = new Set(J.offsets);
  /* The bracket arrives on `locate`, whose sentence is about the signal; the changed letters mark on the beat
     after, whose sentence names the variant (`break` where the cut point itself goes, else `hold`). */
  const located = past(entry.beats.includes("break") ? "break" : "hold");

  // several changed letters take their mark left to right
  let nth = 0;
  const brkLabels: Mark[] = [];
  slots.forEach((sl, i) => {
    if ("brk" in sl) {
      // the run's middle: one step of the front, and its count beneath the datum (breakLabel)
      if (located) nth++;
      brkLabels.push({
        kind: "label",
        key: `jx-brk`,
        x: slotX[i] + (breakW0 * k) / 2,
        anchor: "middle",
        y: y + h + V.datumGap + V.breakLabelGap + V.labelSize,
        text: `${sl.brk} letters`,
        static: true,
      } as Mark);
      return;
    }
    const off = sl.off;
    const isChanged = located && changed.has(off);
    marks.push(
      isChanged
        ? ({
            kind: "block",
            key: `jx-i${off}`,
            x: slotX[i],
            y,
            w: cw,
            h,
            ch: "solid",
            parts: 1,
            swap: 1,
            ...(changed.size > 1 ? { rank: nth++ } : {}),
          } as Mark)
        : ({
            kind: "block",
            key: `jx-i${off}`,
            x: slotX[i],
            y,
            w: cw,
            h,
            ch: "hollow",
            reach: "unread",
            faint: true,
          } as Mark),
    );
  });
  // the ruler: ticks at the exon's codon boundaries; the rule runs on under the intron
  const ry = y + h + V.datumGap;
  const ruleX0 = Math.min(exonX0, intronX0) - 10,
    ruleX1 = Math.max(exonX0 + exonW, intronX0 + intronW) + 10;
  marks.push({ kind: "rule", key: "jx-rule", x1: ruleX0, x2: ruleX1, y: ry, static: true } as Mark, ...brkLabels);
  [...new Set(codonEdges.map((e) => Math.round(e * 100) / 100))].forEach((e, i) =>
    marks.push({ kind: "tick", key: `jx-t${i}`, x: e, y: ry, len: V.tickLen, static: true } as Mark),
  );
  // the cut signal: a bracket above, over the facts' window (the facts stage's SIGNAL)
  const W = J.window;
  let a: number, z: number;
  if (donor) {
    a = W.exon > 0 ? exonCellX[exonCellX.length - W.exon] : xOf(1);
    z = xOf(W.intron) + cw;
  } else {
    a = xOf(-W.intron);
    z = W.exon > 0 ? exonCellX[W.exon - 1] + cw : xOf(-1) + cw;
  }
  const by = y - 10,
    bt = 3;
  // neutral, the ruler's ink
  if (V.junctionBracket && past("locate"))
    marks.push(
      { kind: "hair", key: "jx-sig", x1: a, y1: by, x2: z, y2: by, axis: true } as Mark,
      { kind: "hair", key: "jx-sig-a", x1: a, y1: by - bt, x2: a, y2: by + bt, axis: true } as Mark,
      { kind: "hair", key: "jx-sig-z", x1: z, y1: by - bt, x2: z, y2: by + bt, axis: true } as Mark,
    );
  // the join: dotted only when the cut is broken
  if (J.state === "broken" && past("break")) {
    marks.push({
      kind: "seam",
      key: "jx-join",
      x: seamX,
      y,
      h,
      real: false,
      lds: true,
      discrete: true,
      sw: V.transcriptStroke,
    } as Mark);
  }
  /* No words on the stage: the narrative above the drawing says what the close-up means. */
  const tsj = transcriptSpec(entry.state);
  const exs = tsj.exons ?? GENE.exons;
  const jc = tsj.junctionC ?? -1;
  const exN = J.side === "donor" ? exs.find((e) => e.cHi === jc)?.exon : exs.find((e) => e.cLo === jc + 1)?.exon;
  const caption =
    exN != null
      ? { name: `${tsj.gene} GENE`, pos: J.side === "donor" ? `WHERE EXON ${exN} ENDS` : `WHERE EXON ${exN} BEGINS` }
      : undefined;
  return { w: V.stageW, h: V.stageH, marks, caption };
}

/** A/B pairs share a specimen, so the lookup drops the suffix. No pair is on the sheet now; kept so the
 *  registry can still show two treatments of one specimen (unexercised, RULES.md). */
export const transcriptSpec = (state: string): TranscriptSpecimen => TRANSCRIPT_SPECIMENS[state.replace(/-[ab]$/, "")];

export function transcriptFrame(beat: BeatName, entry: StateEntry): Frame {
  const spec = transcriptSpec(entry.state);
  GENE = { exons: spec.exons ?? BRCA1_EXONS, cdsLength: spec.cdsLength ?? BRCA1_CDS_LENGTH };
  if (spec.junction) return junctionFrame(beat, entry, spec.junction);
  /* O5, a whole-gene deletion: the message end to end, as the establishing view draws it; on `remove` every
     block and seam leaves by the departure fade and the ruler stays where the gene was. The gene, not the
     protein: a protein drawn and erased would say it had been made. */
  /* Copy number: one row per copy, the gene end to end, stacked over the one ruler. On `change` rows past
     the new count leave by the departure fade, or new rows arrive in the arrived style, as any material
     arriving in the message does. The caption counts the copies. */
  if (spec.kind === "copies" && beat !== "establish-full") {
    const f = transcriptFrame("establish-full", entry);
    const from = spec.copiesFrom ?? 2,
      to = spec.copies ?? from,
      n = Math.max(from, to, 1);
    const changed = pastOf(entry, beat)("change");
    const row = f.marks.filter((m) => !m.static && (m.kind === "block" || m.kind === "seam"));
    const bottom = Math.max(...row.map((m: any) => m.y + m.h)),
      gap = 8;
    const rowH = Math.min(V.blockH, (bottom - 12 - gap * (n - 1)) / n);
    const marks: Mark[] = f.marks.filter((m) => m.static);
    for (let r = 0; r < n; r++) {
      const here = changed ? r < to : r < from;
      if (!here) continue;
      const arriving = r >= from;
      const yr = bottom - rowH * (r + 1) - gap * r;
      for (const m of row) {
        const c: any = { ...m, key: `${m.key}@${r}`, y: yr, h: rowH, discrete: undefined };
        if (arriving && m.kind === "block") c.ch = "arrived";
        marks.push(c as Mark);
      }
    }
    const count = changed ? to : from;
    const caption = f.caption
      ? { ...f.caption, pos: count === 0 ? "NO COPIES" : `${count} ${count === 1 ? "COPY" : "COPIES"}` }
      : undefined;
    return { ...f, caption, marks };
  }
  if (spec.kind === "whole-gene" && beat !== "establish-full") {
    const f = transcriptFrame("establish-full", entry);
    // the whole gene shows its name alone (the caption rule, c3d8e67)
    const caption = f.caption ? { ...f.caption, pos: "" } : undefined;
    // the seams go with their blocks; a discrete seam would leave a beat after its block had faded
    const marks = f.marks.map((m) =>
      m.kind === "seam" && (m as any).discrete ? ({ ...m, discrete: undefined } as Mark) : m,
    );
    return { ...f, caption, marks: pastOf(entry, beat)("remove") ? marks.filter((m) => m.static) : marks };
  }

  const past = pastOf(entry, beat);
  const full = beat === "establish-full";

  const admitted = spec.admitted;
  /* The window is computed only if a beat uses one: `establishing` is single-beat and has no lesion to
     window onto. */
  const plan = full
    ? transcriptPlan(0, GENE.cdsLength)
    : (() => {
        const win = transcriptWindow(spec);
        return transcriptPlan(
          win[0],
          win[1],
          admitted
            ? {
                afterC: admitted.afterC,
                nt: admitted.nt,
                intron: admitted.intron,
                intronBp: admitted.intronBp,
                reveals: spec.kind === "pseudo-exon",
              }
            : undefined,
        );
      })();

  const top = Math.max(0, (V.stageH - plan.height) / 2);
  const y = top;
  /* The damaged join, from the beat that reveals the damage: `foreclosed`'s `damage-seam` and `skip`'s
     `break-seam`, one beat name meaning the donor just failed. Stated once, on the seam; see
     `transcriptDatum` for why the tick beneath does not repeat it. */
  const damagedNt =
    !full && ((spec.kind === "foreclosed" && past("damage-seam")) || (spec.kind === "skip" && past("break-seam")))
      ? spec.junctionC!
      : undefined;
  /* The seam's x, off the same `plan.x` every tick uses, so the damage can never drift from its boundary.
     The seam loop breaks that one seam into dashes in place. */
  const damagedSeamX = damagedNt != null ? plan.x(damagedNt) : undefined;
  const marks: Mark[] = [...transcriptDatum(plan, top)];

  /* ---- what this beat has done, read off the registry ---- */
  /* The bypassed exon has two moments: `faded`, when it and its two edge seams leave by the departure fade,
     and `closed`, when everything downstream slides into the room left. Between them the strip shows the
     gap: the section is missing before the rest closes around it. */
  const faded = past("skip-fade");
  const closed = past("skip-close");
  const misread = past("regroup");
  const isAdmitted = past("admit-intron") || past("splice-in");
  /* The bypassed exon's key, so the seam loop fades its two edge seams with it. `null` for every kind but
     `skip`. */
  const bypassedParent = spec.kind === "skip" && spec.skipLo != null ? `ex${blockAt(spec.skipLo)?.exon}` : null;
  /* Reading order for the regroup cascade: counted after `skipHi` for `skip`, after the admitted material's
     `afterC` for `retain`. Only read under `misread`. */
  const regroupAfterC = spec.skipHi ?? admitted?.afterC ?? 0;
  /* The beat the stop sliver appears on: `reveal-stop` where the cell has one, else `settle`. */
  const stopBeat = entry.beats.includes("reveal-stop") ? "reveal-stop" : "settle";
  const stopped = spec.stopCodon != null && past(stopBeat);
  /* Downstream goes faint on the cell's last beat, one step after the sliver appears: "the stop appears" and
     "nothing past it was read" are two facts, and read as one event when they share a beat. Where the last
     beat is the stop beat the two agree. */
  const reachBeat = entry.beats[entry.beats.length - 1];
  const reachStopped = spec.stopCodon != null && past(reachBeat);

  const closeBy = closed ? spec.skipBp! * plan.pxpb : 0;
  const openBy = isAdmitted && admitted ? admitted.nt * plan.pxpb : 0;
  /* `plan.blocks` bake in the settled shift on every beat (the ruler never moves). `retain` grows in, so its
     downstream is displaced by the box's current width (`openBy`); a revealing gap displaces it by 0, then
     the whole open gap, then the chunk's width alone. `curGapW` is what stands in the gap this beat, and
     downstream is offset by its difference from the settled shift. */
  const growing = spec.kind === "retain";
  /* `reveals` is the test, not the kind: a gap ever drawn as an intron is exactly one with a wide beat to
     correct for. */
  const revealing = plan.gap?.reveals === true;
  const shifting = growing || revealing;
  /** the gap stands for the whole intron: after `reveal`, before `splice-in` */
  const opened = revealing && past("reveal") && !past("splice-in");
  const curGapW = !plan.gap
    ? 0
    : growing
      ? openBy
      : !revealing
        ? plan.gap.shift
        : !past("reveal")
          ? 0
          : opened
            ? plan.gap.innerW
            : plan.gap.admittedW;
  const growthShift = shifting && plan.gap ? curGapW - plan.gap.shift : 0;

  /* Where the stop lands on screen. A stop with a reference address is drawn there plus this beat's
     displacement; a stop inside admitted material has no reference address, so it is placed within the gap. */
  let stopX: number | null = null;
  /* One flat width for every stop in the lane (`stopSliverPx`), so one claim has one weight in every cell;
     a departure from true proportion, RULES.md §7.9. The halves either side are computed from it, so the
     strip's length is unchanged. */
  let stopW = V.stopSliverPx;
  if (spec.stopNtRef != null) {
    stopX = plan.x(spec.stopNtRef - 1) - closeBy + (openBy && spec.stopNtRef > admitted!.afterC ? openBy : 0);
  } else if (admitted?.stopWithinNt != null && isAdmitted) {
    stopX = plan.gap!.innerX + (admitted.stopWithinNt - 1) * plan.pxpb;
  }
  /* A seam past the stop is as faint as the material it joins. Reading stops at one x and never resumes, so
     one comparison against `stopX` is the rule. Gated on `reachStopped`, as the blocks' `reach` is, and
     used at every seam push site. */
  const faintAt = (x: number) => reachStopped && stopX != null && x > stopX;

  /* ---- the blocks ---- */
  const winLoX = plan.x(plan.winLo);
  const winHiX = plan.x(plan.winHi);
  for (const b of plan.blocks) {
    // the bypassed block leaves at `skip-fade` by the ordinary departure fade, as a codon lane deletion does;
    // the gap it leaves stays open until `skip-close`
    if (faded && spec.skipLo != null && b.cLo === spec.skipLo) continue;

    const downstream = spec.skipHi != null ? b.cLo > spec.skipHi : admitted != null && b.cLo > admitted.afterC;
    const dx = (spec.skipHi != null && downstream ? -closeBy : 0) + (shifting && downstream ? growthShift : 0);

    /* The trim bound moves with the block it trims. A block carries displacements the datum does not
       (`shiftAt`, `dx`); trimmed against the unshifted bound, a block would lose exactly its shift and hide the
       variant's length claim at the strip's edge. Shifting the bound makes clipping depend only on the
       block's own reference width. */
    const shift = plan.shiftAt(b.cLo) + dx;

    /* Whether this is the block the stop lands in: positional, true on every beat, so the block about to be
       cut can be told apart before the cut. */
    const atStopBlock = stopX != null && downstream && b.x + dx <= stopX && b.x + dx + b.w > stopX;

    /* Hollow is wrong-frame and nothing else: a regrouped skip, or admitted material not a whole number of
       codons, leaves downstream read in another frame; an in-frame event (skip-frame-kept, the 114 nt false
       block) keeps it solid. `retain` flips on its own `regroup` beat, after the unzip and before the stop,
       not on `isAdmitted`. */
    const wrongFrame = misread || (spec.kind !== "retain" && isAdmitted && admitted != null && !admitted.inFrame);

    /* The stop lands inside a block, so the block is cut at it: before the stop was read in the wrong frame,
       after it was never reached. The sliver gates on `stopped`, the post-part's reach on `reachStopped`.
       The cut is discrete, not a shrinking block: the pre-half takes its own key (`-pre`), so the uncut mark
       departs and both halves pop in at their cut geometry; only the sliver fades. `parentOf` (here and in
       probe.ts) strips `-pre`/`-post`, so the halves earn no seam between them. */
    if (stopped && atStopBlock) {
      const [hx, hw] = trim(b.x + dx, Math.max(V.minInk, stopX! - (b.x + dx)), winLoX + shift, winHiX + shift);
      const [px, pw] = trim(
        stopX! + stopW,
        Math.max(V.minInk, b.x + dx + b.w - stopX! - stopW),
        winLoX + shift,
        winHiX + shift,
      );
      marks.push({
        // always a partial exon, cut at the stop, whatever `trim` did
        kind: "block",
        key: `ex${b.exon}-pre`,
        x: hx,
        y,
        w: hw,
        h: V.blockH,
        ch: wrongFrame ? "hollow" : "solid",
        reach: "read",
        trimmed: true,
        openEdge: ["end"],
        discrete: true,
        // no rank: the cascade belongs to `regroup`, and a rank would stagger this discrete arrival. No dash
        // either: this reading is mis-grouped, not foreign, and hollow says that, as for `skip`.
      });
      marks.push({ kind: "sliver", key: "stop", x: stopX!, y, w: stopW, h: V.blockH });
      marks.push({
        kind: "block",
        key: `ex${b.exon}-post`,
        x: px,
        y,
        w: pw,
        h: V.blockH,
        ch: wrongFrame ? "hollow" : "solid",
        reach: reachStopped ? "unread" : "read",
        trimmed: true,
        faint: reachStopped,
        openEdge: ["start"],
        discrete: true,
      });
      continue;
    }

    /* Hollow is wrong-frame, downstream only (`wrongFrame`, above). */
    const ch: Channel = wrongFrame && downstream ? "hollow" : "solid";
    const reach: Reach = reachStopped && downstream && stopX != null && b.x + dx > stopX ? "unread" : "read";
    const [bx, bw, trimmed] = trim(b.x + dx, b.w, winLoX + shift, winHiX + shift);
    if (bw <= 0) continue;
    marks.push({
      kind: "block",
      key: `ex${b.exon}`,
      x: bx,
      y,
      w: bw,
      h: V.blockH,
      ch,
      reach,
      trimmed,
      faint: reach === "unread",
      /* Rank only on `regroup`, the beat the cascade is about; `misread` stays true afterwards and would
         stagger every later transition. */
      rank: beat === "regroup" && downstream ? rankFrom(b.exon, regroupAfterC) : undefined,
      /* `discrete` matters only on the transition where this mark departs into the stop split, so it holds
         full width and vanishes instead of shrinking. */
      discrete: atStopBlock,
    });
  }

  /* ---- what is in the gap ---- */
  if (plan.gap && admitted) {
    const g = plan.gap;
    /* The seam fails a beat before anything rides in through it, so the break isn't lost in the material's
       arrival; `ax` is plan geometry, so the seams can stand at their final left address early. For a
       revealing gap `ax` is per-beat instead (the chunk sits in the intron, then slides into its seat):
       retain's box has a fixed edge and a moving width, this one a fixed width and a moving edge.
       Where the chunk sits inside the open intron is derived from the fixture's offsets. The rest of the
       intron, 5' and 3' of the chunk, is elided to `breakBlockW` split in true proportion, so the ratio of the
       two hairline segments flanking the chunk carries its address (drawn to the intron's scale, 114 nt of
       8,368 would be two pixels). No address mark: the chunk's own offsets place both its edges. */
    const elided = g.intronBp - admitted.nt;
    const foreLo = admitted.fromOffset - 1;
    const ax = !g.reveals
      ? g.innerX + (g.innerW - g.admittedW) / 2
      : isAdmitted
        ? g.innerX
        : g.innerX + foreLo * (V.breakBlockW / elided);
    const seamsOpen = isAdmitted || past("seam-fails");
    /* The box's current width: `openBy` for `growing`, so the box, `growthShift` and the stop read one clock. */
    const curAdmittedW = growing ? openBy : g.admittedW;
    if (growing) {
      /* Grows in from the seam, left edge fixed, no break column. Pushed from `establish` at the width `openBy`
         gives (zero until `admit-intron`), so growth is the ordinary width tween and a zero-width mark paints
         nothing. Existing from frame one also keeps a block arrival off the beat `seam-lo` fails on (probe:
         seam events never share a beat with block events). `unjoined` states the event; `blockStyle` does not
         read it (§8.48, GLITCHES D7). */
      /* A stop inside material that grew in (a duplicated piece): split as the admitted box below is, placed
         from the block's own left edge, since a grown box isn't centred in a gap. */
      if (stopped && admitted.stopWithinNt != null) {
        const sx = ax + (admitted.stopWithinNt - 1) * plan.pxpb;
        const hw = Math.max(V.minInk, sx - ax),
          pw = Math.max(V.minInk, ax + curAdmittedW - sx - stopW);
        marks.push({
          kind: "block",
          key: "admitted-pre",
          x: ax,
          y,
          w: hw,
          h: V.blockH,
          ch: "arrived",
          reach: "read",
          openEdge: ["end"],
          discrete: true,
          restW: curAdmittedW,
          restFrom: 0,
        });
        marks.push({ kind: "sliver", key: "stop", x: sx, y, w: stopW, h: V.blockH });
        marks.push({
          kind: "block",
          key: "admitted-post",
          x: sx + stopW,
          y,
          w: pw,
          h: V.blockH,
          ch: "arrived",
          reach: reachStopped ? "unread" : "read",
          faint: reachStopped,
          openEdge: ["start"],
          discrete: true,
          restW: curAdmittedW,
          restFrom: sx + stopW - ax,
        });
      } else
        marks.push({
          kind: "block",
          key: "admitted",
          x: ax,
          y,
          w: curAdmittedW,
          h: V.blockH,
          ch: "arrived",
          reach: "read",
          unjoined: true,
        });
    } else if (revealing && !past("reveal")) {
      /* Nothing at `establish`: the variant is inside an intron, and the intron isn't on the strip until a beat
         opens it. One mark is pushed anyway and draws nothing: the hairline at zero width, so on `reveal` it
         opens as the ordinary numeric tween in step with the blocks' slide. Pushed as an arrival instead, it
         would draw at its final width from the first frame, over blocks that haven't moved. Same idiom as
         retain's box. */
      marks.push({
        kind: "hair",
        key: "intron-hair",
        x1: g.innerX,
        y1: y + V.blockH / 2,
        x2: g.innerX,
        y2: y + V.blockH / 2,
        faint: true,
      });
    } else if (revealing && opened) {
      /* The intron, then a piece of it: two beats, two marks, no text.
         `reveal`: a bare hairline the width of the gap at the row's mid-height, on the lane's quietest rung
         (`faint`): material the message does not contain, a line because the run is not a block. It is
         foreshortened (elision, not a second scale), so it carries no count and no ticks.
         `mark-chunk`: the chunk, dashed outline, at true message proportion, the width it takes in its seat on
         the next beat, so it is the same mark sliding in. Two scales in one gap is the picture.
         No address mark in this gap (decision 4, §8.7): the chunk's 3' edge already draws it; the variant's
         coordinate lives in the cell's id line. */
      marks.push({
        kind: "hair",
        key: "intron-hair",
        x1: g.innerX,
        y1: y + V.blockH / 2,
        x2: g.innerX + g.innerW,
        y2: y + V.blockH / 2,
        faint: true,
      });
      if (past("mark-chunk")) {
        marks.push({
          kind: "block",
          key: "admitted",
          x: ax,
          y,
          w: g.admittedW,
          h: V.blockH,
          ch: "arrived",
          reach: "read",
        });
      }
    } else if (!isAdmitted) {
      /* Before anything arrives the gap is the whole intron, elided. Unexercised: both admitting kinds open
         their gap on a beat of their own. Kept as the render for an admitting cell with no beat to spare for
         the run (listed in RULES.md). */
      marks.push(...breakColumn("gap-break", g.innerX, g.innerW, y, g.intronBp));
    } else {
      /* Material that arrived and is not in the reference, drawn at true proportion however long it is: it is
         in the message. Only the run that did not arrive is elided. Its edge seams draw `dashGhost` (§8.48). */
      const stopInside = stopped && admitted.stopWithinNt != null && stopX != null;
      if (stopInside) {
        const hw = Math.max(V.minInk, stopX! - ax);
        const pw = Math.max(V.minInk, ax + g.admittedW - stopX! - stopW);
        /* The cut is a discrete arrival, not a resize, as in the exon split: the whole box departs and two
           `discrete` halves arrive at their final geometry. The post-half's reach is `reachStopped`: the sliver
           lands on `reveal-stop`, the drop to unread on `settle`.
           Both halves keep the whole box's tick pattern (§8.49): a cut interrupts a dashed thing, it does not
           re-flow it. `restW` is the whole box and the far half carries `restFrom`, so the box's real corners
           stay anchored and the ends at the opaque sliver fall where the pattern puts them (the smoke's check (i)
           exempts the stop). */
        marks.push({
          kind: "block",
          key: "admitted-pre",
          x: ax,
          y,
          w: hw,
          h: V.blockH,
          ch: "arrived",
          reach: "read",
          openEdge: ["end"],
          discrete: true,
          restW: g.admittedW,
          restFrom: 0,
        });
        marks.push({ kind: "sliver", key: "stop", x: stopX!, y, w: stopW, h: V.blockH });
        marks.push({
          kind: "block",
          key: "admitted-post",
          x: stopX! + stopW,
          y,
          w: pw,
          h: V.blockH,
          ch: "arrived",
          reach: reachStopped ? "unread" : "read",
          faint: reachStopped,
          openEdge: ["start"],
          discrete: true,
          restW: g.admittedW,
          restFrom: stopX! + stopW - ax,
        });
      } else {
        marks.push({
          kind: "block",
          key: "admitted",
          x: ax,
          y,
          w: g.admittedW,
          h: V.blockH,
          ch: "arrived",
          reach: "read",
          /* The whole box leaves the way its halves arrive: `discrete` on a departure is read off the frame
             it leaves from, so without it the box would fade out while the halves are still absent. Gated on
             `isAdmitted`, so the box's arrival out of the intron still fades in. */
          discrete: isAdmitted && admitted.stopWithinNt != null,
        });
      }
    }

    /* The joins it came in through. Both edges get a seam here, both dashed, since they bound one admitted
       run. The box seats flush, so the seam loop cannot find its hi side; it is drawn here at the one correct
       position. Other kinds gate on `seamsOpen`, so `seam-lo` stands a beat before the material.
       `growing` pushes `seam-lo` from `establish` as an ordinary join and flips its `real` in place at
       `seam-fails` (as `foreclosed-junction` does), so no seam arrives on the beat `admitted` first exists.
       Its `seam-hi` waits for `isAdmitted`: before growth it would sit on `seam-lo` and paint over its dash. */
    /* A revealed chunk's edges are its seams from `mark-chunk` on, travelling with it, so nothing swaps or
       jumps when the chunk fuses; the touching-seam rule opens the chunk's own edges. */
    const travelling = !!g.reveals && past("mark-chunk");
    if (growing ? true : seamsOpen || travelling) {
      marks.push({
        /* `lds` waits for the failure on `growing`: until `seam-fails` this is an ordinary join. */
        kind: "seam",
        key: "seam-lo",
        x: ax,
        y,
        h: V.blockH,
        lds: growing ? past("seam-fails") : true,
        real: growing ? !past("seam-fails") : false,
        discrete: !travelling,
        faint: faintAt(ax),
      });
    }
    if (growing ? isAdmitted : seamsOpen || travelling) {
      const hx = ax + (travelling ? g.admittedW : curAdmittedW);
      marks.push({
        kind: "seam",
        key: "seam-hi",
        lds: true,
        x: hx,
        y,
        h: V.blockH,
        real: false,
        discrete: !travelling,
        faint: faintAt(hx),
      });
    }
  }

  /* ---- addresses and events ---- */

  /* The variant's address: at full scale the only mark besides the message. Not on `establishing`, which has
     no variant. */
  if (full && spec.locusC != null && spec.kind !== "establishing") {
    marks.push({
      kind: "tick",
      key: "locus",
      x: plan.x(spec.locusC),
      y: y - V.tickLen,
      len: V.tickLen * 2,
    });
  }

  if (!full) {
    /* No junction circle: every cut site already has a seam saying it. Junction damage is a dashed seam alone;
       a skip's closure is a solid one (`seam-join`). The variant's depth in the intron has no mark (decision
       4, §8.7; see states.ts). */
    if (spec.kind === "skip" && closed) {
      /* The join itself, `real: true` so it draws solid: skipping removes a segment and inserts nothing, so two
         genuine exons meet here. Before `skip-close` there is no join to draw. */
      marks.push({
        kind: "seam",
        key: "seam-join",
        lds: true,
        x: plan.x(spec.skipHi!) - closeBy,
        y,
        h: V.blockH,
        real: true,
        discrete: true,
        faint: faintAt(plan.x(spec.skipHi!) - closeBy),
      });
    }
    if (spec.kind === "double-agent" && past("mark-both")) {
      /* One mark, a bead on the datum's rule at the address; the strip stays clean. No seam or dash: nothing
         splices or closes in this specimen (§8.4). */
      marks.push({
        kind: "bead",
        key: "mark-address",
        x: plan.x(spec.locusC!),
        y: top + V.blockH + tDatumGap(),
        size: V.beadSize,
      });
    }
  }

  /* ---- seams: one per join between adjacent blocks ---- */

  /* Every join in the strip as rendered gets a seam, at `full` too: blocks abut, so an undrawn join would
     read as one block. Always `discrete`, so a seam doesn't seem to lose confidence while content changes
     beside it (`Base.discrete`, `tweenMark`); `faint` past the stop, like the material it joins.
     Runs last, after every manufactured seam (`seam-lo`/`seam-hi`, `seam-join`), so it never doubles one.
     Pairs touching "admitted" are skipped, since the gap section draws those edges; "admitted" stays in the
     sorted order so its flanking blocks never look adjacent.
     The one seam that breaks in place reads `damagedSeamX`; every other is `real`.
     Parent ids, not keys: a stop split is a termination, not a join. A break column earns no seam.
     Only visible blocks with width count: a zero-width "admitted" (`growing`, before it grows) would sort
     between a join's real neighbours and drop that seam. */
  {
    /* The one join this cell opens (§8.49): only a revealing gap has one, at its `innerX`. */
    const openingX = revealing && plan.gap ? plan.gap.innerX : undefined;
    const seamBlocks = marks
      .filter(
        (m): m is BlockMark =>
          m.kind === "block" &&
          /^(ex\d+|admitted)(-post|-pre)?$/.test(m.key) &&
          m.w > 0 &&
          m.x + m.w > 0 &&
          m.x < V.stageW,
      )
      .sort((a, b) => a.x - b.x);
    /* Strips `-pre` and `-post`, so a cut exon's halves read as one parent and get no seam between them. */
    const parentOf = (key: string) => key.replace(/-(post|pre)$/, "");
    /* A second dedup: a skip's `seam-join` lands exactly on its flanking blocks' join. Matching by position is
       safe here, since nothing else manufactures a seam near an ordinary join without being that join. */
    const seamXs = marks.filter((m): m is SeamMark => m.kind === "seam").map((m) => m.x);
    for (let i = 1; i < seamBlocks.length; i++) {
      const prev = seamBlocks[i - 1];
      const cur = seamBlocks[i];
      const prevParent = parentOf(prev.key);
      const curParent = parentOf(cur.key);
      if (prevParent === curParent) continue;
      if (prevParent === "admitted" || curParent === "admitted") continue;
      const jx = prev.x + prev.w;
      /* No seam across a real gap: between `skip-fade` and `skip-close` the bypassed exon's neighbours sort
         adjacent with daylight between them. */
      if (cur.x - jx > V.epsPx) continue;
      if (seamXs.some((x) => Math.abs(x - jx) < V.epsPx)) continue;
      /* The join about to be opened fades as the gap opens (§8.49/§8.49a). Not `discrete`, so it takes the
         ordinary existence fade at the start of `reveal` while the blocks slide: the join releasing and the
         material coming apart are one event. It fades rather than dotting, since nothing has failed (`dashGhost`
         would claim a damaged join). Positional and beat-independent: `discrete` is read off whichever frame
         exists, so it has to be right on every beat. */
      const opening = openingX != null && Math.abs(jx - openingX) < V.epsPx;
      /* The fading exon's two edge seams fade with it rather than dropping a beat later. */
      const fading =
        (bypassedParent != null && (prevParent === bypassedParent || curParent === bypassedParent)) || opening;
      marks.push({
        kind: "seam",
        /* LAB: a seam beside a hollow/arrived block is an affected seam (see SeamMark.lds) */
        lds:
          prev.ch === "hollow" || cur.ch === "hollow" || prev.ch === "arrived" || cur.ch === "arrived"
            ? true
            : undefined,
        key: `seam-${prevParent}-${curParent}`,
        x: jx,
        y,
        h: V.blockH,
        /* In the cascade: a seam takes the rank of the block it follows, so on `regroup` the joins flip left to
           right with the blocks. */
        rank: prev.rank ?? cur.rank,
        real: damagedSeamX == null || Math.abs(jx - damagedSeamX) > V.epsPx,
        discrete: !fading,
        faint: faintAt(jx),
      });
    }
  }

  /* Every touching seam opens both flanking blocks' own edge there, so a join between outlined blocks draws
     one stroke, not three. Done in one post-pass over the finished list, so a future push site cannot forget
     it. */
  {
    const allSeamXs = marks.filter((m): m is SeamMark => m.kind === "seam").map((m) => m.x);
    for (const m of marks) if (m.kind === "seam") m.sw = V.transcriptStroke;
    for (const m of marks) {
      if (m.kind !== "block") continue;
      const open = new Set(m.openEdge ?? []);
      if (allSeamXs.some((sx) => Math.abs(sx - m.x) < V.epsPx)) open.add("start");
      if (allSeamXs.some((sx) => Math.abs(sx - (m.x + m.w)) < V.epsPx)) open.add("end");
      if (open.size) m.openEdge = [...open];
      /* Every block carries its resting width (§8.48, B2): `w` interpolates in a tween and `restW` does not, so
         a dashed outline keeps one tick pattern while its width moves. Fills in rather than assigns, since the
         stop-cut halves carry the whole box's pattern (§8.49). */
      if (m.restW == null) {
        m.restW = m.w;
        m.restFrom = 0;
      }
      /* One weight for every outline in the lane, `transcriptStroke`, inset by half its own weight. */
      m.sw = V.transcriptStroke;
    }
  }

  const shown = GENE.exons.filter((e) => e.cHi > plan.winLo && e.cLo <= plan.winHi).map((e) => e.exon);
  const exTotal = spec.exonCount ?? Math.max(...GENE.exons.map((e) => e.exon));
  const whole = shown.length && Math.min(...shown) === 1 && Math.max(...shown) === exTotal; // a range only for a part
  const caption = shown.length
    ? {
        name: `${spec.gene} GENE`,
        pos: whole ? "" : span("EXON", "EXONS", Math.min(...shown), Math.max(...shown), exTotal),
      }
    : undefined;
  return { w: V.stageW, h: V.stageH, marks, caption };
}
