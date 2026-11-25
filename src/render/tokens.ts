// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Every quantity the renderer draws or times with, named once: geometry and motion, and each ink as a token lookup.
// Unitless numbers are px unless named otherwise (…Nt is nucleotides, dur… is ms); none live elsewhere in render/.

import { CONTACT_MAX_A, CONTACT_MIN_SEP, FOLD_WINDOW, PLDDT_SOLID, PROTEIN_SCALE } from "../contracts/constants";

/* ---- visual ---- */

// Hoisted so the tokens defined in terms of these can say so in code rather than in a comment.
const strokeHairline = 0.5;

/** The size step a terminal mark takes: a mark at `inkTerminal` renders one step larger than the material around
 *  it (RULES.md §2.9). Refused where a mark's size is a measured quantity, e.g. the codon stop block (§7.24). */
const markStep = 2 * strokeHairline;

const barH = 7;

/** How far a bead stands proud of the bar it sits on, per side. Two steps so the overhang is still a whole device
 *  pixel at the 50% render (GLITCHES B4). Not shared with `markHalo`, which is ground around a mark, not its body. */
const beadClear = 2 * markStep;

const moduleSize = 8;

const detailMin = 6;

export const visual = {
  /* ── core vocabulary ── */

  /** One residue's mark on the chain and in the portrait. Fixed rather than derived, so two cells of one gene agree;
   *  8 so the hollow (pLDDT < 70) outline reads as an outline (RULES.md §8.27). */
  moduleSize,

  /** The substituted residue's resting size (§2.9). A search cue must be categorical, not minimal: 1.75× is ~3× the
   *  area and reads without comparing neighbours. Centred on its residue and drawn last (register rule 7); it
   *  arrives at `moduleSize` and grows to this (§8.52). */
  moduleSizeMarked: moduleSize * 1.75,

  /** The clear ground around the identifier, a ground-coloured stroke sized off the module so the ring stays
   *  constant as the glyph grows (§8.54). Its one absolute cue; it may cover a neighbouring residue, as register
   *  rule 7 already allows. */
  markHalo: moduleSize * 0.375,
  /** The close-up's cut-signal bracket. `setBracket(false)` drops it. */
  junctionBracket: true,
  /** How a locate arrives: the located mark's clear ground (portrait) or bead (chain) starts at `locateFrom` × its
   *  resting size and `locateOp` opacity, and tweens to rest over the locate beat. Set at runtime by `setLocate`. */
  locateFrom: 0.35, // inside the residue with its hairline: 0.35 x 27 = 9.5px under 11px
  /* Full strength, no fade: the ground opens out of the residue, hidden at rest, so REFERENCE is unchanged. The
     chain's bead still fades (frames.ts), since a solid bead would show in REFERENCE. */
  locateOp: 1,
  /** the chain's bead locates like the portrait: its dark square keeps its size and only a halo square under it
   *  settles */
  locateBeadHalo: false,
  /** One identifier glyph: the chain's and transcript's bead painted in the portrait identifier's proportions, scaled
   *  with the bead's own size through any tween. Off draws the bead as a CSS ring. Set by `setIdentifier`. */
  identifierUnified: true,
  /** clearance between the identifier's clear square and the message above it (transcript) */
  identifierClear: 2,
  /** the portrait's contact lines */
  contactStroke: 0.75,

  /** The portrait's thread, an eighth of the module so the two scale together (§2.10). The widest step down that
   *  keeps it ~2:1 over the contact hairline. Still `inkFull`: a weight step, not a value one. */
  foldThread: moduleSize * 0.125,

  /** one nucleotide. With blockGap this makes a 60-unit codon slot, so a 768 register holds 12 codons a row. */
  codonCellW: 18,

  /** block height, codon AND transcript. One token so the datum does not jump at the scale hand-off. */
  blockH: 48,

  /** datum rules, ticks, joints, contact hairlines */
  strokeHairline,
  /** The ordinary line. Reserved, no reader: `seamStroke` states itself against it, and a removed token hides from
   *  every gate (GLITCHES F7). */
  strokeStd: 1.2,
  /** outline blocks, the heaviest rule. Solved against blockH (fill ink grows with area, outline with perimeter),
   *  so it moves when blockH does. */
  strokeHeavy: 1.44,
  /** The seam: a join between adjacent blocks, drawn over the fill at every join, with its own weight. Also the
   *  admitted box's outline, so the box and its seam verticals read as one (§8.48); the misread outline stays on
   *  `strokeHeavy`. */
  seamStroke: 1.2,
  /** The held register's height. Hold is a filled bar, an area, because this lane has no datum to lend its marks
   *  authority. 7, not 6 (`detailMin`'s numeral, a different quantity) nor 8 (reads as a small block). */
  barH,

  /** The held bar's narrowest drawn width, 2:1 so it reads as an oblong with extent, never as the square bead
   *  (§7.10b, §8.39). A stated overstatement and a deliberate departure from §8.20: widened symmetrically in
   *  `chainRegister`, with the true extent kept on the mark as `truePts`. */
  barMinW: 2 * barH,

  /** The chain's length as a fraction of the stage, centred, so it reads as an object on the stage rather than as
   *  the stage's width. px-per-residue and the smoothing window derive from it. */
  chainLineSpan: 0.75,

  /** The taper at each hold/let-go boundary, in smoothing windows: the let-go dash ramps to `dashDissolve3` over
   *  this span so the cut reads as a seam. In windows because that is the resolution the grade is decided at. */
  taperWindows: 1,

  /** Reserved, no reader: material joined in that the reference lacks. Admitted boxes take `dashGhost` (§8.48);
   *  kept for the F7 reason. */
  dashArrived: [3, 2] as readonly number[],
  /** The one pattern for "not here as the gene has it": an unreal seam (`SeamMark.real === false`) and every
   *  admitted box's outline, so a box and its seams share one tick vocabulary (§8.48). Gap-dominant on purpose. */
  dashGhost: [2, 3] as readonly number[],

  /* The chain lane has two registers, hold and let-go, cut once at `plddtSolid` with a taper at each boundary.
     pLDDT below 70 is not a middle amount of structure, so a graded ladder would claim a degree the data lacks. */
  /** No chain reader. Its one reader is the portrait's low-confidence module (`paint.tsx`), which is unsure rather
   *  than foreign and so must not take `dashArrived` (RULES.md §7.13). */
  dashDissolve1: [9, 4] as readonly number[],
  /** Reserved, no reader: the rhythm between the two registers, if a third is ever argued for. */
  dashDissolve2: [4, 4] as readonly number[],
  /** The let-go register's pattern: dots at `strokeHairline` in `inkFull`, one part ink in four so the run still
   *  reads as one continuous chain. The name is historical; names are final (RULES.md §8). */
  dashDissolve3: [1, 3] as readonly number[],

  /** The hollow module's dash, a proportion of `moduleSize` so the outline is the same broken square at any size
   *  (four dashes, every corner inside one). Dash equals gap: an outline this small states a break, not a degree. */
  dashModule: [moduleSize * 0.3, moduleSize * 0.3] as readonly number[],

  /* The read/unread register: three opaque value rungs, not alphas, which break the L* ramp and accumulate where
     marks overlap. They resolve by name against the page's tokens, so dark mode is a token swap. Material gets
     quieter as it gets further from "read as intended", never louder. These are stroke values: a filled block
     takes `inkFill`, and never-read material loses its fill and keeps its outline. */
  /** read as intended. The ordinary ink: outlines, seams, the chain, modules. */
  inkFull: "var(--v-observed)",
  /** read, but not as intended: the wrong frame (hollow), or material not in the reference (dashed-hollow). Quiet
   *  but unmistakable, because it happened. */
  inkQuiet: "var(--v-predicted)",
  /** never reached, and anything the transcript ghosts. The same rung as the whole datum, rule and ticks alike. */
  inkFaint: "var(--v-uncertain)",

  /* The rest of the ladder. `tokens:check` fails on any `var(--v-` outside this file. */
  /** every filled block. The lightest ink rung: a fill covers area, so it sits lighter than any stroke to weigh the
   *  same on the page. */
  inkFill: "var(--v-unknown)",
  /** The mark the register is about: where reading terminates, the portrait's substituted residue, and the address
   *  bead. Off the material ladder (`inkFull`…`inkFill`) entirely (RULES.md §7.16). */
  inkTerminal: "var(--v-terminal)",
  /** The gene's own stop: the terminal rung of the neutral ladder. `--v-terminal` says "the variant's"; the stop
   *  every copy of the gene ends on isn't the variant's (SPEC: the gene's own stop). */
  inkTerminalRef: "var(--v-terminal-ref)",
  /** the ground a register is drawn on, and therefore what a subtraction from a mark is made of: a joint cutting a
   *  filled block, the swapped cell inside a solid codon. Not a colour choice; it is the absence of ink. */
  inkGround: "var(--v-ground)",
  /** mono labels: residue numbers, coordinates, an elided run's count. Type is read, not weighed, so it takes the
   *  text rung rather than an ink rung. */
  inkText: "var(--v-text)",
  /** The identifier's clear ground, and the underlay beneath the variant's own material. */
  inkHalo: "var(--v-halo)",
  /** The faint interior of an element outlined in the variant's ink. */
  inkWash: "var(--v-fill)",

  /** datum tick, split evenly across the rule */
  tickLen: 8,

  /** The address bead: a filled square sitting ON a line or bar, for an annotation rather than a boundary. Clears
   *  the bar by a whole pixel at 50% even when it lands fully on one. One size in every lane, the transcript's
   *  hairline datum included (RULES.md §7.12). */
  beadSize: barH + 2 * beadClear,

  /** A stop's length in nucleotides (one codon). The window's support set reaches this far past the stop's address
   *  so the frame never cuts the terminator in half (`support()`, frames.ts). */
  stopSliverW: 3,

  /** The stop's drawn width at block scale, in px: fixed rather than true proportion, so stops making the same
   *  claim look the same across cells (RULES.md §7.9). It eats into the material it ends, never adds length. */
  stopSliverPx: 4,

  /** the stage every cell draws into. 768 keeps a 60-unit codon slot and 12 codons a row; narrower would push the
   *  pitch under `detailMin` and drop the joints. The height holds one register. */
  stageW: 768,
  stageH: 240,
  /** the portrait's own stage, taller so the fold draws at the larger material scale; other lanes keep `stageH` */
  portraitStageH: 320,
  /** the transcript lane's one stroke weight: every outline and seam, whatever it claims */
  transcriptStroke: 2,
  /** the portrait's one-line finding ("No protein made."), relative to labelSize */
  findingScale: 1.25,

  /* ── supporting quantities, named here so no literal appears in frames.ts ── */

  /** the reveal between blocks; without it adjacent blocks share a footprint and the count stops being readable */
  blockGap: 6,
  /** content bottom to datum rule */
  datumGap: 12,
  /** air either side of the support set, as a fraction of its span, so the same rule holds at any scale and the
   *  frame still bleeds off both edges */
  winMargin: 0.12,
  /** Junction composition target, in nt, for a support that is a single boundary (`foreclosed`): whole flanking
   *  exons are added, alternating sides, until the window is at least this wide, so it never cuts mid-exon and
   *  both sides get a real flanking exon. */
  junctionWindowBp: 450,
  /** an inserted base or codon starts blockH + this above its slot, so it reads as arriving from above rather than
   *  as one tall block */
  insertGap: 8,
  /** mono label type size and its offset from the mark it labels, so a lane never authors a font-size */
  labelSize: 9,
  labelGap: 7,
  /** portrait: horizontal padding off the stage edge before the projection is scaled, so an extreme module keeps its
   *  ink. The vertical budget is `foldInkH`. */
  foldPad: 14,
  /** The portrait's ink height, modules included: the lobby lane box (deck.css `--lane-h` = 248 − 33 − 15 = 200),
   *  restated because the bundle can't read deck tokens; the lobby harness asserts they agree. The fit scales
   *  geometry only; modules stay `moduleSize`. */
  foldInkH: 200,
  /** How far a register may paint outside its stage box (transcript bleed, a displaced codon row, the codon datum's
   *  bleed). Must exceed the largest displacement, 2 × codonCellW = 36; anything further is clamped in the plan. */
  stageBleed: 40,
  /** The band at the stage's right edge no REFERENCE frame paints into, reserved for YOU's truncation/extension
   *  outline. Stage-width registers take `stageW − stageOverrun`; the codon datum, chain and portrait frame don't.
   *  The codon register's last block can still end inside it, since `codonWindow` sets that width. */
  stageOverrun: 24,
  /** portrait: a contact is drawn only to a module at least this many residues away in sequence; nearer is backbone */
  contactMinSep: CONTACT_MIN_SEP,
  /** portrait: a contact is a Cα pair at most this far apart, in Å (a distance in the protein, not on the page); 8 is
   *  the conventional Cα–Cα cut. `tools/gen-specimens.py` carries the same constant, as Python can't import it. */
  contactMaxA: CONTACT_MAX_A,
  /** portrait: residues per fold window. A fixed count keeps every portrait comparable; the window is centred on the
   *  variant and shifted, never truncated, near a terminus. Chosen over whole-domain windows, which most sites lack
   *  (RULES.md §7.18, §8.27). */
  foldWindow: FOLD_WINDOW,

  /** Reserved, no reader (its mark is gone, §8.31): a seam tick one module wide plus `detailMin` proud at each end,
   *  sized by what it has to clear. Kept for the F7 reason. */
  foldSeamTick: moduleSize + 2 * detailMin,
  /** the tick's own stroke, lighter than a hairline rule because a tick is an address, not a measure */
  tickW: 0.8,
  /** the narrowest a mark may be drawn and still be ink; floors the stop sliver where a rect stops resolving */
  minInk: 0.75,
  /** Coincidence: how close two rendered x's must be to count as one position; every "same point" test reads it.
   *  In px because it absorbs float dust after `pxpb`, and below the thinnest ink drawn. Distinct from `minInk`. */
  epsPx: 0.5,
  /** below this an arriving or leaving mark emits no node, so an absence stays an absence */
  opVanish: 0.002,
  /** subdivisions per residue when the backbone is smoothed; fixed, because adaptive would make a density claim */
  foldSmooth: 6,
  /** a feature below this size is not drawn at all (never squeezed or faded). Gates the codon joints and sets the
   *  chain's smoothing window. */
  detailMin,
  /** The window rule: fixed-width context around the event (the seam, or the true end for a stop-loss) and, where a
   *  stop lands elsewhere, the same width around the landing. Used only where a stop exists; see targetCodons. */
  flankCodons: 1,
  /** The occupancy rule, in slots: a short window grows one real codon at a time (upstream only, once widen() has
   *  opened both ways) until it is this wide or the gene runs out. Downstream of a stop stays at flankCodons. Kept
   *  under MEASURE1. */
  targetCodons: 11,
  /** a run longer than this many reference codons draws as one break column, keeping every codon cell to one row
   *  without shrinking the pitch (frames.ts codonWindow) */
  breakCodons: 4,
  /** a break column's width in codon slots: wider than one slot and un-round, so it reads as many codons
   *  compressed, never as a count */
  breakCells: 2.75,
  /** clearance between the datum hairline and the break count label beneath it; looser than labelGap, because a
   *  label that must not touch a line is a different claim from one sitting near a mark */
  breakLabelGap: 10,
  /** How far past its outermost tick the datum line runs, in codon intervals, on each end that is not the gene's
   *  true edge. The line only, no extra ticks: a tick claims a reference position. */
  bleedRulerIntervals: 0.5,
  /** `bleedRulerIntervals` at block scale, in nucleotides (converted by the window's `pxpb`). `transcriptPlan`
   *  solves `pxpb` with the margins included, so the datum lands on 0 and on `stageW − stageOverrun` exactly. */
  datumBleed: 20,

  /* ── block scale: quantities that depend on how long an intron is ── */

  /** A break column's width at block scale. Not `breakCells`, whose codon slots this register lacks: wider than the
   *  reveal and a stop sliver, narrower than any real block in a window, and un-round. */
  breakBlockW: 44,

  /** The confidence cut, one number for three jobs: AlphaFold's confident band, the portrait's fill boundary, and the
   *  gate routing a variant to the portrait lane, so render and routing can't disagree. */
  plddtSolid: PLDDT_SOLID,
} as const;

export function setBracket(on: boolean): void {
  (visual as unknown as { junctionBracket: boolean }).junctionBracket = on;
}

export function setLocate(o: { from?: number; op?: number; beadHalo?: boolean }): void {
  const v = visual as unknown as { locateFrom: number; locateOp: number; locateBeadHalo: boolean };
  if (o.from != null) v.locateFrom = o.from;
  if (o.op != null) v.locateOp = o.op;
  if (o.beadHalo != null) v.locateBeadHalo = o.beadHalo;
}

/* The protein lanes' material scale: what a reader has to see in the portrait and chain (residues, identifier, bar,
   bead, fold height), never a line weight or type. The bead is shared with the transcript, so its identifier stays
   even across lanes. Base values are captured once so repeated calls never compound. */
const SCALE_BASE = (() => {
  const v = visual as unknown as Record<string, number>;
  return {
    moduleSize: v.moduleSize,
    moduleSizeMarked: v.moduleSizeMarked,
    markHalo: v.markHalo,
    barH: v.barH,
    beadSize: v.beadSize,
    foldInkH: v.foldInkH,
    stageH: v.stageH,
  };
})();
export function setScale(o: { protein?: number }): void {
  if (o.protein == null) return;
  const v = visual as unknown as Record<string, number>;
  for (const k of ["moduleSize", "moduleSizeMarked", "markHalo", "barH", "beadSize", "foldInkH"] as const) {
    v[k] = SCALE_BASE[k] * o.protein;
  }
}
export function setStageH(h: number): void {
  (visual as unknown as { stageH: number }).stageH = Math.max(1, Math.round(h || SCALE_BASE.stageH));
}

export function setIdentifier(o: { unified?: boolean }): void {
  const v = visual as unknown as { identifierUnified: boolean };
  if (o.unified != null) v.identifierUnified = o.unified;
}

/** The host sets the stage width (`mount()`); registers re-solve their geometry against it and nothing is scaled, so
 *  a narrower stage holds fewer codons a row, not smaller ones. Whole px, since the viewBox is 1:1 on layout px. */
export function setStageW(w: number): void {
  (visual as unknown as { stageW: number }).stageW = Math.max(1, Math.round(w));
}

/* ---- motion ---- */

/* Easings are functions, not cubic-bezier() strings: this engine applies them to values it computes, and a CSS copy
   would be a second definition of the same curve. */

export type Ease = (t: number) => number;

/** the establishing beat: everything arrives and is read as a whole while the reader finds the instrument. The
 *  ratios between beats are load-bearing; rescale them together. */
const durEstablish = 1350;
/** the ordinary beat: one operator applies */
const durBeat = 1050;
/** the last beat: the picture resolves in place and stops. A release, shorter than a beat, longer than a micro. */
const durSettle = 780;
/** the smallest legible change: one unit flips channel in place and nothing travels. Its members are named in
 *  beatDur. */
const durMicro = 240;

export const motion = {
  durEstablish,
  durBeat,
  durSettle,
  durMicro,

  /** The beat vocabulary by name, so timings live here rather than as an if-chain in frames.ts. A beat not listed
   *  takes durBeat, or durSettle if last in its state; each phase adds its front (staggerPitch) and stretches for
   *  long moves (durMove). */
  beatDur: {
    establish: durEstablish,
    "establish-full": durEstablish,
    /** stillness still has to be read */
    hold: durEstablish,
    settle: durSettle,
    "flip-stop": durMicro,
    "swap-cell": durMicro,
    locate: durMicro,
    "reveal-stop": durMicro,
    "dissolve-stop": durMicro,
    /** A qualified name, `<beat>/<qualifier>`, looked up before the bare name (`baseDur`). Here the stop lands in
     *  just-arrived material and cuts it, which needs a full beat. frames.ts dispatches on the specimen
     *  (`admitted != null`), never on state names. */
    "reveal-stop/cuts-admitted": durBeat,
    /** A clearing opening around a residue is a change the reader watches, too slow for durMicro (§8.55).
     *  frames.ts dispatches on the marks (a `clearing` present), never on cell names. */
    "locate/clearing": durBeat,
  } as Readonly<Record<string, number>>,

  /** geometry, and any transition an unopposed unit makes alone (span 0). Cubic ease-out: pushed, comes to rest. */
  easeStandard: ((t: number) => 1 - Math.pow(1 - t, 3)) as Ease,

  /** the settle, crossfades, and every staggered front (span > 0), where a repeated ease-out reads as a ratchet.
   *  Cubic in-out: it starts from rest as well as ending there. */
  easeSettle: ((t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)) as Ease,

  /** Per unit, not a total: the delay between one unit of a front and the next, so a wave lasts as long as the
   *  material it crosses. The front advances linearly, because it is a reading rate. */
  staggerPitch: 68,

  /** The cascade's speed, quoted as the time the phase's median-distance unit takes to move; every other unit moves
   *  its own distance at the same px/ms, so outliers arrive late rather than fast. Kept apart from durBeat, which is
   *  a phase's reading budget. */
  durMove: 390,
} as const;

/* ---- one export, so callers needn't know which half a quantity lives in ---- */

export const T = { ...visual, ...motion } as const;
export type Tokens = typeof T;
export default T;

/* the default protein scale, applied once at load from the captured base values */
setScale({ protein: PROTEIN_SCALE });
