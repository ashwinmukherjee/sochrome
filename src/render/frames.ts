// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The frame engine's public surface: geometry as a pure function of (specimen, beat).

/* A frame is the stage at the end of one beat, a pure function of (specimen, beat): no clock, no
   DOM, no randomness. Animation is interpolation between frames: `sample()` finds the two frames
   either side of t and tweens them with the motion tokens. So animation code never computes a
   position, the resting state is exactly `frame(spec, lastBeat)` (reduced motion and a finished
   replay are the same object), and scrubbing backwards is exact.

   Positions, sizes and opacities tween; channels do not (a half-outlined block is a codon we are
   half sure of). A channel flips when its own mark's transition completes.

   The front: a mark's `rank` is its place in reading order, and unit r starts at r * staggerPitch.
   The front advances linearly while each unit's motion is eased: it is a reading rate, and easing
   it would depict a ribosome that hesitates and then hurries. */

export type {
  Channel,
  Reach,
  BlockMark,
  TickMark,
  BeadMark,
  RuleMark,
  SliverMark,
  SeamMark,
  PathMark,
  ModuleMark,
  ClearingMark,
  HairMark,
  LabelMark,
  Mark,
  StageCaption,
  Frame,
} from "./frames/marks";
export { fitLines, o4Line } from "./frames/fold";
export { isBuilt, registerVariant, stageCaption, frame } from "./frames/registry";
export type { VariantRecords } from "./frames/registry";
export { timeline, settledAt, sample } from "./frames/timeline";
export type { Phase } from "./frames/timeline";
