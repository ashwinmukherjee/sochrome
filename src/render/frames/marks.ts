// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The marks a frame is made of, the fill channels they carry, and the frame itself.

import { visual as V } from "../tokens";
import type { StateEntry, BeatName } from "../states";

/* ---- Channels: the fill vocabulary, one table for every lane ---- */

export type Channel =
  /** read as intended · present · made */
  | "solid"
  /** read in the wrong frame: letters real, grouping false. Reserved for that alone; material
   *  never reached stays `solid` and says so on the reach axis. */
  | "hollow"
  /** reading terminates here */
  | "black"
  /** material that arrived and does not belong to the reference: a retained intron, a
   *  pseudo-exon, an inserted module. Transcript and portrait lanes only; an inserted base in
   *  the codon lane is drawn solid and marked by its entrance (decision 5). */
  | "arrived";

/** A second axis, orthogonal to the channel: was it read. "Misread" and "never reached" are
 *  different facts. A mark is `unread` exactly when, in the frame being drawn, reading has not
 *  got to it (see readFront in codonFrame). */
export type Reach = "read" | "unread";

/* ---- Marks ---- */

interface Base {
  /** stable across beats — this is what lets two frames be tweened at all */
  key: string;
  /** moves in the standard time whatever its distance: a cell crossing a mask (a break, the
   *  strip's edge) travels further than its neighbours and must still land with them */
  sync?: boolean;
  /** place in the front, in units. Absent = not in the field, moves at once. */
  rank?: number;
  /** arrival/departure only, never a resting value */
  op?: number;
  /** exempt from the establish beat's fade-in: the instrument the reading is measured against
   *  is present from the first frame. Affects nothing about later tweens. */
  static?: boolean;
  /** arrives or leaves in one frame, never fading, for a mark whose existence is a binary
   *  structural fact (a seam). Read only by `tweenMark`'s arrival/departure branches; unlike
   *  `static`, it governs every transition after the first frame. */
  discrete?: boolean;
  /** the variant's own material (the portrait's seal, an arrived residue and its tethers, the
   *  stop-loss extension), not reference material it acts on. Paint gives it a halo underlay and
   *  `data-delta`, and the host's palette inks it as delta. */
  delta?: boolean;
  /** the identifier's clear ground drawn as a band along a path (E2's run), not a square */
  clear?: boolean;
  /** a `delta` mark painted without the halo underlay: the portrait's tethers */
  bare?: boolean;
}

export interface BlockMark extends Base {
  /** outline weight, when the lane sets one (`transcriptStroke`). Paint insets the outline by
   *  half of it, so the painted footprint is the box exactly. Ignored by filled blocks. */
  sw?: number;
  kind: "block";
  x: number;
  y: number;
  w: number;
  h: number;
  ch: Channel;
  reach?: Reach;
  /** how many parts the block divides into; a codon is three bases */
  parts?: number;
  /** 1-based part that is hollow inside an otherwise solid block: one letter swapped, grouping
   *  intact. Discrete, like every channel. */
  swap?: number;
  /** a `black` block that is the gene's own stop: painted in the neutral `inkTerminalRef`, since
   *  the variant hue says "the variant did this". A stop the variant makes or reaches stays plain. */
  own?: boolean;
  /** draw an extra joint at this mark's own edge(s), for a codon split across marks, where the
   *  boundary between them is still a base boundary. Discrete, like swap. */
  edgeJoint?: readonly ("start" | "end")[];
  /** this side's edge is not stroked at all, because another mark stands there. The halves of a
   *  stop-split exon use it against the sliver between them, so they read as one block with the
   *  sliver inside rather than a box built around it. */
  openEdge?: readonly ("start" | "end")[];
  /** the quieter unread rung, with `reach: "unread"` only: `inkFill` at a hairline, so unread
   *  material sits just above the datum and clear of the misread register. Shared by the codon
   *  and transcript lanes (RULES.md §8.9). */
  faint?: boolean;
  /** this material is in the message because a join failed (`retain`'s intron). Paint does not
   *  read it (§8.48: every admitted box takes `dashGhost`); kept until its push site and its hold
   *  in `tweenMark` can go with it (GLITCHES D7). */
  unjoined?: boolean;
  /** a hard clip in x, [lo, hi]. Strip and break edges are viewports: material crossing one
   *  keeps moving and is cut at the boundary, with no fade. Not held through a tween, since it is
   *  the same in every frame the cell exists. */
  clip?: readonly [number, number];
  /** true when `trim` cut this mark down to fit its bound. For the harness; paint never reads it. */
  trimmed?: boolean;
  /** the dashed outline this mark belongs to: its length, and how far into it this mark begins.
   *  Set by `transcriptFrame`'s post-pass, read only by paint's dashed outline.
   *
   *  `restW` (§8.48): the width at rest. Not tweened, so a moving outline keeps one pattern for
   *  the whole phase instead of re-flowing its dashes every frame.
   *
   *  `restFrom` (§8.49): 0 for a whole box; for the far half of a box the stop cut, its offset
   *  into the whole box's pattern, so both halves read as one outline. Carried rather than
   *  derived from `x`, because `x` tweens and would slide the box out from under its dashes. */
  restW?: number;
  restFrom?: number;
}
export interface TickMark extends Base {
  kind: "tick";
  x: number;
  y: number;
  len: number;
  /* No `dashed` flag (§7.10b): a tick is a plain address. The seam on the same nucleotide
     states any damage, and the datum is the instrument. */
}
/** The address bead: a small filled square sitting on a line. `x`/`y` is its centre (as for
 *  `ModuleMark`), and `size` is carried on the mark because geometry lives in frames. It answers
 *  only "where", so it has one fixed ink and no channel, reach or dash. */
export interface BeadMark extends Base {
  kind: "bead";
  x: number;
  y: number;
  size: number;
}
export interface RuleMark extends Base {
  kind: "rule";
  x1: number;
  x2: number;
  y: number;
  /** the window's own edge, before the hairline's bleed is added to x1/x2. For the harness,
   *  which needs the window's bound to tell a whole block from one cut by it. Transcript only. */
  coreX1?: number;
  coreX2?: number;
  /* No `elided` flag: the scale across an elided run is not itself elided, so the rule is
     continuous (see codonDatum). */
}
export interface SliverMark extends Base {
  kind: "sliver";
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface SeamMark extends Base {
  kind: "seam";
  x: number;
  y: number;
  h: number;
  /** stroke weight, when the lane sets one (`transcriptStroke`) */
  sw?: number;
  /** a join that does not exist in the gene renders dashed */
  real?: boolean;
  /** past the stop, at `inkFaint`: the claim `reach: "unread"` makes for a block, carried onto
   *  the join beside it. */
  faint?: boolean;
  /** A seam the variant affects (the skip's forged junction, the admitted chunk's flanks, any
   *  seam beside hollow or arrived material): paint stamps it `data-delta-seam` and render.css
   *  gives it the variant's ink. */
  lds?: boolean;
}
export interface PathMark extends Base {
  kind: "path";
  pts: readonly (readonly [number, number])[];
  w: number;
  /** chain lane only: which register this run is in, a binary cut at `plddtSolid`. Absent on the
   *  portrait's backbone, which is a trace, neither held nor let go. */
  reg?: "hold" | "let-go";
  /** a join the reference does not have, drawn at `inkQuiet`: the portrait's sealed-removal seal */
  quiet?: boolean;
  /** a let-go run's own dash and gap, in place of `dashDissolve3` (the chain's run-on: short
   *  dashes, so it reads beside the bars at hairline weight) */
  dash?: readonly [number, number];
  /** portrait only: backbone nothing holds (F1's never-made part; a long run-on past the room),
   *  dotted like the chain's let-go. F1's backbone is neutral; the run-on is the variant's own. */
  unread?: boolean;
  /** chain let-go runs only: which ends abut a hold run and taper into it. The taper belongs to
   *  the boundary, so it is recorded per end. */
  taper?: ("start" | "end")[];
  /** the taper's span in px: `taperWindows` resolved at this cell's scale, which paint cannot see. */
  taperLen?: number;
  /** chain runs only, where the `barMinW` floor moved the drawn extent: the endpoints the data
   *  says, so the raw-profile check measures the profile, not the floor (C1). Absent otherwise. */
  truePts?: readonly (readonly [number, number])[];
  /** portrait only, and only `"arrived"`: a tether, thread that is not measured backbone (an
   *  insertion's detour, the stop-loss extension). It takes its module's channel, so the two
   *  cannot drift. Absent on ordinary measured material. */
  ch?: Channel;
}
export interface ModuleMark extends Base {
  kind: "module";
  x: number;
  y: number;
  size: number;
  ch: Channel;
  /** the substituted residue, at `inkTerminal`, off the material ladder. It also takes the
   *  terminal size step, `moduleSizeMarked` (RULES.md §2.9), set at the push site. */
  dark?: boolean;
  /** overrides the module's halo (§8.55); set to 0 where a `clearing` already stands behind the
   *  residue, so check (ix), which measures the painted box, is not satisfied by an unseen ring. */
  halo?: number;
}
/** The ground cleared around a located residue, as its own mark (§8.55), so it can open a beat
 *  before the residue is claimed. In `inkGround`, it says "nothing is drawn here", so it is its
 *  own kind, not a module. One per register, above the field and below the residue it clears. */
export interface ClearingMark extends Base {
  kind: "clearing";
  x: number;
  y: number;
  /** side of the square: the identifier's footprint, `moduleSizeMarked + 2 × markHalo` */
  size: number;
}
export interface HairMark extends Base {
  kind: "hair";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** stroke width; absent = `strokeHairline`. The portrait's contacts set it (`contactStroke`),
   *  so the residue's web reads as one figure. */
  w?: number;
  /** the transcript lane's `faint` (`inkFill`): the foreshortened intron `deep-intronic` draws
   *  across its gap, material the message does not contain. Portrait contacts omit it. */
  faint?: boolean;
  /** the ruler's rung: the close-up's cut-signal bracket annotates the sequence like the ticks
   *  do, so it takes their neutral ink. */
  axis?: boolean;
}
export interface LabelMark extends Base {
  /** type size in px; absent = `labelSize`. The portrait's one-line finding sets it. */
  size?: number;
  kind: "label";
  x: number;
  y: number;
  text: string;
  anchor?: "start" | "middle" | "end";
  /** which kind of copy this is, so a probe can hold the stage to it (RULES.md §2.12): at most
   *  one per stage, a finding one line, a foreclosure two (see `checks()` in probe.ts). Omitted on
   *  coordinate labels, which annotate the datum rather than speak. */
  copy?: "finding" | "foreclosure";
}

export type Mark =
  | BlockMark
  | TickMark
  | RuleMark
  | SliverMark
  | SeamMark
  | PathMark
  | ModuleMark
  | HairMark
  | LabelMark
  | BeadMark
  | ClearingMark;

/** What the stage shows, in words, set above it by the host. Each builder computes it from the
 *  window it lays out, so it is true at every stage width. */
export interface StageCaption {
  name: string;
  pos: string;
}
export const nf = (n: number) => n.toLocaleString("en-US");
export const span = (unit: string, units: string, a: number, b: number, total?: number) =>
  `${a === b ? `${unit} ${nf(a)}` : `${units} ${nf(a)}–${nf(b)}`}${total ? ` OF ${nf(total)}` : ""}`;

export interface Frame {
  w: number;
  h: number;
  marks: Mark[];
  caption?: StageCaption;
  /** the whole picture's veil, 0..1 (RULES.md §8.47), present only while an establishing beat
   *  fades in. One number for the object: fading marks separately lets overlapping ink run ahead
   *  of the fade and unwind as it lands. The mount puts it on one group (`fadeGroups` in
   *  lanes/stage.tsx); `static` marks stay outside it at full ink (§8.42). */
  fade?: number;
}

/* A function: the stage width is set per mount (tokens.ts setStageW), so it is read when made. */
export const emptyFrame = (): Frame => ({ w: V.stageW, h: V.stageH, marks: [] });

/** Is this frame at or past that beat, read off the registry: `past("regroup")` is false in a
 *  state with no such beat, so one builder serves states whose beat lists differ. */
export function pastOf(entry: StateEntry, beat: BeatName): (b: BeatName) => boolean {
  const now = entry.beats.indexOf(beat);
  return (b: BeatName) => {
    const i = entry.beats.indexOf(b);
    return i >= 0 && now >= i;
  };
}
