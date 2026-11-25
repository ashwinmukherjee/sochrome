// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The fold lane's frames: the folded protein and what a change does to it in three dimensions.

import { visual as V } from "../tokens";
import type { StateEntry, BeatName } from "../states";
import { CODON_SPECIMENS, FOLD_SPECIMENS, FOLD_STATEMENTS, CHAIN_SPECIMENS, type FoldSpecimen } from "../specimens";
import { chainCaption, chainRegister } from "./chain";
import { type Frame, type Mark, pastOf, span } from "./marks";
import { frame } from "./registry";

/* ---- Lane 4: portrait ----
   One domain, one frozen projection, the same drawing on every page; every other portrait state
   is this drawing plus one operation. The projection is read from the fixture, never recomputed.
   No datum: x is a projection axis, not chain position. Solid above pLDDT 70, hollow below. */

/** where an insertion's arrived residues sit, for any uniform scale and shift of the points
 *  (foldInsertion's geometry). Shared with foldFit so the stage is fitted to the bulge too. */
function bulgeOuts(spec: FoldSpecimen, at: (i: number) => [number, number], step: number): [number, number][] {
  const m = spec.markIdx;
  const a = at(m),
    b = at(m + 1);
  const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const runA = at(Math.max(0, m - 1));
  const runB = at(Math.min(spec.points.length - 1, m + 2));
  const rd = Math.hypot(runB[0] - runA[0], runB[1] - runA[1]) || 1; // struct — divide-by-zero guard
  let [px, py] = [-(runB[1] - runA[1]) / rd, (runB[0] - runA[0]) / rd];
  const cx = spec.points.reduce((s, _, i) => s + at(i)[0], 0) / spec.points.length;
  const cy = spec.points.reduce((s, _, i) => s + at(i)[1], 0) / spec.points.length;
  if ((mid[0] - cx) * px + (mid[1] - cy) * py < 0) {
    px = -px;
    py = -py;
  }
  const out: [number, number] = [mid[0] + px * step, mid[1] + py * step];
  const n = Math.max(1, spec.added ?? 1);
  const cl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const [ux, uy] = [(b[0] - a[0]) / cl, (b[1] - a[1]) / cl];
  return Array.from({ length: n }, (_, k) => {
    const d = (k - (n - 1) / 2) * step;
    return [out[0] + ux * d, out[1] + uy * d] as [number, number];
  });
}

/** The one projection, fitted to the stage and shared by every portrait cell, so windows of one
 *  protein share one scale; one scale for both axes, since stretching would claim a shape. Left-set:
 *  the leftmost drawn edge (`moduleSize / 2`, not `foldPad`) lands at x = 0, the left edge of the
 *  copy and of the chain lane's line. Centred vertically. `foldPad` is the scale's inset only. */
function foldFit(spec: FoldSpecimen) {
  const xs = spec.points.map((p) => p[0]);
  const ys = spec.points.map((p) => p[1]);
  /* An insertion's bulge points away from the fold, so it is fitted with the points (in their own
     units); otherwise near an edge it would be clipped. */
  if (spec.added != null && spec.markIdx != null && spec.markIdx + 1 < spec.points.length) {
    const raw = (i: number) => spec.points[i] as [number, number];
    const d = spec.points
      .slice(1)
      .map((p, i) => Math.hypot(p[0] - spec.points[i][0], p[1] - spec.points[i][1]))
      .sort((p, q) => p - q);
    for (const [x, y] of bulgeOuts(spec, raw, d[Math.floor(d.length / 2)] ?? 0)) {
      xs.push(x);
      ys.push(y);
    }
  }
  const lo = [Math.min(...xs), Math.min(...ys)];
  const hi = [Math.max(...xs), Math.max(...ys)];
  /* The fit is to the lane box: horizontally the stage less the overrun band and `foldPad` each
     side; vertically `foldInkH` less one module, so the ink is `foldInkH` tall when height binds.
     `k` scales the points only; modules stay `moduleSize`. */
  const k = Math.min(
    (V.stageW - V.stageOverrun - 2 * V.foldPad) / Math.max(1e-6, hi[0] - lo[0]), // struct — divide-by-zero guard
    (V.foldInkH - V.moduleSize) / Math.max(1e-6, hi[1] - lo[1]), // struct — divide-by-zero guard
  );
  const ox = V.moduleSize / 2 - lo[0] * k;
  const oy = (V.portraitStageH - (hi[1] - lo[1]) * k) / 2 - lo[1] * k;
  return (i: number): [number, number] => [spec.points[i][0] * k + ox, spec.points[i][1] * k + oy];
}

/** The anchor drawing. Every other portrait state is this plus one operation, and calls it
 *  rather than redrawing it. List order is z-order: thread, then modules, then the identifier.
 *  Collisions occlude, never offset: a projection can stack residues (brief 5, rule 7). */
function foldMarks(
  spec: FoldSpecimen,
  o: {
    /** the residue the operation lands on: drawn last, and dark. Passed, not read off
     *  `markIdx`, because not every cell marks its own centre. */
    mark?: number | null;
    /** before `locate`: the residue the reticle will close onto */
    reticle?: number;
    /** whether the drawn-last residue is the identifier yet: default true, false only in the
     *  C trial's naming beat (§8.55). When false it is lifted above the field with its own key
     *  and ink; a key change would crossfade two identical squares and blink. */
    dark?: boolean;
    /** the outer extent of the ground cleared behind the located residue, or 0 for none.
     *  §8.55. */
    clearing?: number;
    /** whether the identifier has grown to `moduleSizeMarked` (C3): it arrives named at its
     *  own size, then grows a beat later, two stages of one mark on one key. */
    grown?: boolean;
    /** modules NOT to draw, and the thread segments that end on them */
    drop?: ReadonlySet<number>;
    /** marks between the thread and the modules. A 0.5px contact hairline over 8px modules
     *  would strike through residues it does not touch; under them it runs from one module
     *  into another, which is what a contact is. */
    under?: readonly Mark[];
    /** marks between the modules and the identifier: an operation's own material, which
     *  outranks the reference field and is outranked by the identifier (rule 7, C2). */
    over?: readonly Mark[];
    /** marks on the clearing: after it, before the identifier (SPEC: the halo). Contacts are
     *  the operation's claim about this residue, so inside its clear ground they stay visible
     *  and meet its edge. Pass only the part inside; the full line stays in `under`. */
    onClearing?: readonly Mark[];
  } = {},
): Mark[] {
  const at = foldFit(spec);
  const marks: Mark[] = [];
  const mark = o.mark ?? null;
  const drop = o.drop ?? new Set<number>();

  /* The thread: straight segments between measured module centres, no curve interpolation,
     since a curve asserts positions nothing measured (brief 5, rule 5). N-1 separate segments,
     not one polyline, so `sealed-removal` and `insertion-bulge` can drop one by key. No N→C
     draw-on: `establish` arrives as one fade. Butt-cap joins are covered by the module on each
     vertex (`moduleSize` is eight times `foldThread`). */
  spec.points.forEach((_, i) => {
    if (i === 0) return;
    if (drop.has(i) || drop.has(i - 1)) return;
    marks.push({
      kind: "path",
      key: `t${spec.start + i}`,
      pts: [at(i - 1), at(i)],
      w: V.foldThread,
    });
  });

  if (o.under) marks.push(...o.under);

  spec.points.forEach((_, i) => {
    /* The marked residue is not drawn twice: two stacked marks fading together leave a ghost
       (§8.34). The identifier below is its own key, so it still arrives rather than flips. */
    if (i === mark || drop.has(i)) return;
    const [x, y] = at(i);
    marks.push({
      kind: "module",
      key: `m${spec.start + i}`,
      x,
      y,
      size: V.moduleSize,
      // the portrait's register is the reliability boundary, the same cut the
      // chain lane draws solid at — one fact, one number, two grammars
      ch: spec.plddt[i] >= V.plddtSolid ? "solid" : "hollow",
    });
  });

  /* The identifier is pushed last, so nothing occludes it (rule 7). It keeps its own register
     (`ch`); `dark` selects `inkTerminal` in `paint.tsx`; grown, it is `moduleSizeMarked`, one
     `markStep` larger than its neighbours, so size finds it as well as value (§2.9). Keyed
     `mark`, not `m{n}`, so it arrives rather than flipping on a beat boundary (§3.6a), and never
     tweens with a module. The operation's own material goes just before it (C2). */
  if (o.over) marks.push(...o.over);

  /* The identifier has two stages on one key (C3). Named: dark at `moduleSize`, inside the full
     clear ground. Grown: a beat later at `moduleSizeMarked`; only the size changes, so it may
     tween (`tweenMark`). The clear ground's outer extent is the final footprint at both stages
     (`paint.tsx` derives the ring from the core), so it is in place a beat before the growth.
     Before `locate` the clear ground waits under the residue at `locateFrom` and zero opacity,
     so `locate` grows it outward from the residue's edge; invisible at rest. */
  if (mark == null && o.reticle != null && !drop.has(o.reticle)) {
    const [x, y] = at(o.reticle);
    // under the residue's own module, so the growing ground never paints over it
    const r = o.reticle;
    const own = marks.findIndex((k) => k.key === `m${spec.start + r}`);
    marks.splice(own < 0 ? marks.length : own, 0, {
      kind: "clearing",
      key: "clearing",
      x,
      y,
      size: (V.moduleSizeMarked + 2 * V.markHalo) * V.locateFrom,
      op: V.locateOp,
    });
  }
  if (mark != null && !drop.has(mark)) {
    const [x, y] = at(mark);
    /* The clearing goes over the field and under the residue (§8.55): it masks the neighbours,
       and the residue is what it clears for. Its rank is not the caller's, so not via `over`. */
    if (o.clearing) {
      marks.push({ kind: "clearing", key: "clearing", x, y, size: o.clearing });
      if (o.onClearing) marks.push(...o.onClearing);
    }
    const dark = o.dark ?? true;
    marks.push({
      kind: "module",
      /* Key by stage: unclaimed, it keeps the field's key, so lifting it tweens nothing;
         claimed, it is `mark`, so the darkening arrives as a crossfade rather than a flip. */
      key: dark ? "mark" : `m${spec.start + mark}`,
      x,
      y,
      size: dark && o.grown ? V.moduleSizeMarked : V.moduleSize,
      ch: spec.plddt[mark] >= V.plddtSolid ? "solid" : "hollow",
      ...(dark ? { dark: true } : {}),
      /* The grey residue holds while the dark one arrives over it, so the residue only darkens;
         fading both at once would let the clearing show through and lighten it first. */
      ...(!dark ? { discrete: true } : {}),
      // the clearing behind it already IS its clear ground — see `halo`
      ...(o.clearing ? { halo: 0 } : {}),
    });
  }
  return marks;
}

/** The median backbone step, in px. Cells that invent geometry (the insertion, the stop-loss
 *  extension) place it at this step, so invented material matches the real; median because a
 *  turn's step is not typical of its run. */
function foldStep(spec: FoldSpecimen): number {
  const at = foldFit(spec);
  const steps = spec.points
    .map((_, i) => (i ? Math.hypot(at(i)[0] - at(i - 1)[0], at(i)[1] - at(i - 1)[1]) : 0))
    .slice(1)
    .sort((a, b) => a - b);
  return steps[Math.floor(steps.length / 2)] ?? V.moduleSize;
}

/** the unit vector along the segment ending at `i`, which is the chain's own
 *  heading there. Used only where a direction has to be chosen and none is
 *  measured — see `stop-loss-extension`. */
function foldHeading(spec: FoldSpecimen, i: number): [number, number] {
  const at = foldFit(spec);
  const a = at(Math.max(0, i - 1)),
    b = at(i);
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; // struct — divide-by-zero guard
  return [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
}

export function foldAnchorFrame(_beat: BeatName): Frame {
  const fa = FOLD_SPECIMENS["anchor"];
  return {
    w: V.stageW,
    h: V.portraitStageH,
    marks: foldMarks(fa),
    caption: { name: `${fa.gene} PROTEIN`, pos: span("AMINO ACID", "AMINO ACIDS", fa.start, fa.end, fa.length) },
  };
}

/* ---- the five drawn operations, one function each ------------------------ */

/* A run of changed residues (E2). The clear ground is a band along the backbone between them,
   one identifier wide with square ends, or the identifier's square when they nearly coincide; it
   opens on `locate` like the single identifier's. Each residue holds grey, then darkens on
   `substitute`. One contact set, each partner drawn from the nearer changed residue, under the
   field and again on the band. */
function foldRun(beat: BeatName, spec: FoldSpecimen, entry: StateEntry): Mark[] {
  const at = foldFit(spec);
  const past = pastOf(entry, beat);
  const run = spec.marks!;
  const W = V.moduleSizeMarked + 2 * V.markHalo;
  const pts = run.map((i) => at(i));
  const showContacts = past("contacts");
  const from = (k: number) => spec.contactFrom?.[k] ?? 0;
  const line = (j: number, k: number, inner: boolean): Mark => {
    const [mx, my] = pts[from(k)],
      [x, y] = at(j);
    let x2 = x,
      y2 = y;
    if (inner) {
      const dx = x - mx,
        dy = y - my,
        f = Math.min(1, W / 2 / Math.max(Math.abs(dx), Math.abs(dy), 1e-9));
      x2 = mx + dx * f;
      y2 = my + dy * f;
    }
    return {
      kind: "hair",
      key: `c${spec.start + j}${inner ? "-in" : ""}`,
      x1: mx,
      y1: my,
      x2,
      y2,
      w: V.contactStroke,
      delta: true,
    };
  };
  const marks = foldMarks(spec, { under: showContacts ? spec.contacts.map((j, k) => line(j, k, false)) : undefined });
  // the band (or the square, when the residues nearly coincide)
  const far = pts.some((p, k) => k && Math.hypot(p[0] - pts[k - 1][0], p[1] - pts[k - 1][1]) >= V.moduleSize);
  const located = past("locate");
  const w = located ? W : W * V.locateFrom;
  if (far) {
    marks.push({
      kind: "path",
      key: "run-clear",
      pts: pts.map((p) => [p[0], p[1]] as [number, number]),
      w,
      clear: true,
      op: located ? 1 : 0,
    } as Mark);
  } else {
    const xs = pts.map((p) => p[0]),
      ys = pts.map((p) => p[1]);
    marks.push({
      kind: "clearing",
      key: "run-clear",
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
      size:
        (Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) + W) *
        (located ? 1 : V.locateFrom),
      op: located ? 1 : 0,
    } as Mark);
  }
  if (showContacts) spec.contacts.forEach((j, k) => marks.push(line(j, k, true)));
  run.forEach((i, k) => {
    const [x, y] = pts[k];
    const ch = spec.plddt[i] >= V.plddtSolid ? "solid" : "hollow";
    marks.push(
      past("substitute")
        ? ({ kind: "module", key: `run-${k}-dark`, x, y, size: V.moduleSize, ch, dark: true, halo: 0 } as Mark)
        : ({ kind: "module", key: `run-${k}`, x, y, size: V.moduleSize, ch, discrete: true } as Mark),
    );
  });
  return marks;
}

/** Breaks a line too wide for the stage at the sentence (". ") or clause ("; ", ", ") nearest
 *  its middle. The type is monospace (p1.css), so a character is 0.6 of the size wide. */
export function fitLines(lines: readonly string[], size: number): string[] {
  const max = (V.stageW - 2 * V.foldPad) / (0.6 * size);
  const out: string[] = [];
  for (const line of lines) {
    if (line.length <= max) {
      out.push(line);
      continue;
    }
    let best = -1;
    for (const sep of [". ", "; ", ", ", " "]) {
      for (let i = line.indexOf(sep); i > 0; i = line.indexOf(sep, i + 1)) {
        if (best < 0 || Math.abs(i - line.length / 2) < Math.abs(best - line.length / 2)) best = i;
      }
      if (best > 0) {
        const a = line.slice(0, best + (sep === " " ? 0 : 1)).trim(),
          b = line.slice(best + sep.length).trim();
        out.push(...fitLines([a], size), ...fitLines([b], size));
        break;
      }
    }
    if (best < 0) out.push(line);
  }
  return out;
}

/** O4's sentence. A buried residue gets none: the contacts are the claim. On the surface the
 *  drawing cannot say what the residue touches, so one line does. */
export function o4Line(o4: FoldSpecimen["o4"]): string | null {
  if (!o4 || o4.state === "buried") return null;
  if (o4.state === "surface") return "On the surface. Nothing on record says what it touches.";
  const p = o4.partners ?? [];
  const who = p.length > 1 ? `${p[0]} and ${p[1]} bind` : `${p[0]} binds`;
  return `Sits where ${who}. The shape holds; the binding is what changes.`;
}

/** F1's late branch on the fold. The protein is made up to the residue before `markIdx`.
 *  `locate` opens the clear ground, `identify` darkens the identifier (terminal ink: a stop), and
 *  on `truncate` everything after it turns unread, outlined with a dotted backbone in neutral ink,
 *  sweeping outward from the stop, connector then residue, on the same keys.
 *  Beats: establish, locate, identify, truncate, settle. */
function foldTruncated(beat: BeatName, spec: FoldSpecimen, entry: StateEntry): Mark[] {
  const past = pastOf(entry, beat);
  const m = spec.markIdx;
  const marks = foldMarks(spec, {
    mark: past("locate") ? m : null,
    reticle: m,
    dark: past("identify") || (!entry.beats.includes("identify") && past("truncate")),
    clearing: past("locate") ? V.moduleSizeMarked + 2 * V.markHalo : 0,
  });
  if (!past("truncate")) return marks;
  return marks.map((k): Mark => {
    const i = /^[mt]\d+$/.test(k.key) ? +k.key.slice(1) - spec.start : -1;
    if (i <= m) return k;
    // grey and outlined means never made: the neutral ink, as the codon lane's ghost, not the variant's
    if (k.kind === "module") return { ...k, ch: "hollow", rank: 2 * (i - m) };
    if (k.kind === "path") return { ...k, unread: true, rank: 2 * (i - m) - 1 };
    return k;
  });
}

/** Substitution (BRCA1 C61G). The changed residue goes dark, then hairlines run to every residue
 *  it touches across the fold; nothing moves. Contacts are read from the specimen (computed and
 *  gated in the generator), never derived here. O4's sentence is the narrative's (`o4Line`); no
 *  sentence is drawn on the stage. */
function foldSubstitution(beat: BeatName, spec: FoldSpecimen, entry: StateEntry): Mark[] {
  return foldSubstitutionDrawing(beat, spec, entry);
}
function foldSubstitutionDrawing(beat: BeatName, spec: FoldSpecimen, entry: StateEntry): Mark[] {
  if (spec.marks && spec.marks.length > 1) return foldRun(beat, spec, entry);
  const at = foldFit(spec);
  const m = spec.markIdx;
  const [mx, my] = at(m);
  /* The C trial (§8.55). `locate` opens the clear ground around the residue without touching
     it; `substitute` darkens it in place: make room, then name. It never grows, a stated
     departure from §2.9; ink plus 5px of clear ground set it apart, in the shipped identifier's
     footprint (`moduleSizeMarked + 2 × markHalo`). Beats are asked with `pastOf`, never by name. */
  const past = pastOf(entry, beat);
  const showContacts = past("contacts");
  const clearing = past("locate") ? V.moduleSizeMarked + 2 * V.markHalo : 0;
  /* Contacts cross the clearing (SPEC: the halo). The full hairline stays under the field; the
     piece inside the clearing is drawn again on it, so the line meets the residue's edge. That
     piece runs from the centre to where the ray leaves the square: scale by half the clearing
     over the larger component, capped at 1. */
  const half = clearing / 2;
  const inner = (j: number): Mark => {
    const [x, y] = at(j);
    const dx = x - mx,
      dy = y - my;
    const k = Math.min(1, half / Math.max(Math.abs(dx), Math.abs(dy), 1e-9));
    return {
      kind: "hair",
      key: `c${spec.start + j}-in`,
      x1: mx,
      y1: my,
      x2: mx + dx * k,
      y2: my + dy * k,
      w: V.contactStroke,
      delta: true,
    };
  };
  return foldMarks(spec, {
    mark: past("locate") ? m : null,
    reticle: m,
    dark: past("substitute"),
    clearing,
    under: showContacts
      ? spec.contacts.map((j): Mark => {
          const [x, y] = at(j);
          // the variant's own: `delta` takes the delta ink by flag
          return {
            kind: "hair",
            key: `c${spec.start + j}`,
            x1: mx,
            y1: my,
            x2: x,
            y2: y,
            w: V.contactStroke,
            delta: true,
          };
        })
      : undefined,
    onClearing: showContacts && clearing ? spec.contacts.map(inner) : undefined,
  });
}

/** Sealed removal (CFTR F508del). One module leaves and a straight segment joins its neighbours;
 *  that segment is the operation's whole mark. Nothing else moves: the variant protein has no
 *  structure, so the rest is the reference and claims nothing about the mutant. No tick on the
 *  join (§8.31): on a projection it lands on stacked residues of its own ink and cannot be seen. */
function foldSealedRemoval(beat: BeatName, spec: FoldSpecimen, entry: StateEntry): Mark[] {
  const at = foldFit(spec);
  const m = spec.markIdx;
  /* `establish` is the anchor, unmarked; the identifier arrives on `locate`. */
  const past = pastOf(entry, beat);
  /* One identifier in every portrait cell (SPEC: one identifier): `locate` opens the clear
     ground, `identify` darkens it in place, and it never grows. */
  const clear = V.moduleSizeMarked + 2 * V.markHalo;
  if (!past("remove")) {
    return foldMarks(spec, {
      mark: past("locate") ? m : null,
      reticle: m,
      dark: past("identify"),
      clearing: past("locate") ? clear : 0,
    });
  }

  /* N residues: the run markIdx .. markIdx+N-1 drops and the seal joins the survivors either
     side of it. */
  const n = Math.max(1, spec.removed ?? 1);
  const marks = foldMarks(spec, { drop: new Set(Array.from({ length: n }, (_, k) => m + k)) });
  if (!past("seal")) return marks;
  if (m + n >= spec.points.length || m - 1 < 0) return marks; // a survivor is off the window: no join to draw

  /* The seam: the only ink joining the halves, since the removed module's segments went on
     `remove`. Keyed `seal`, the operation's own, so it never tweens with a backbone segment. */
  const a = at(m - 1),
    b = at(m + n);
  /* The seal is the variant's mark: delta ink at twice the thread, on a halo, spliced under the
     modules so the survivors sit on its ends. */
  const firstModule = marks.findIndex((k) => k.kind === "module");
  marks.splice(firstModule < 0 ? marks.length : firstModule, 0, {
    kind: "path",
    key: "seal",
    pts: [a, b],
    w: 2 * V.foldThread,
    delta: true,
  });
  return marks;
}

/** Insertion (CFTR c.413_415dup, p.Leu138dup). The arrived residue has no coordinates, so it
 *  detours out of the backbone and returns. Dashed-hollow is the lane's mark for variant-only
 *  material, and the tethers claim adjacency, not position. The offset is a convention: one
 *  median step, perpendicular to the local run, so it cannot read as the chain continuing. */
function foldInsertion(beat: BeatName, spec: FoldSpecimen, entry: StateEntry): Mark[] {
  const at = foldFit(spec);
  const m = spec.markIdx;
  const a = at(m),
    b = at(m + 1);
  const step = foldStep(spec);
  const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

  /* Perpendicular to the run over m-1..m+2 (on an edge-on helix one zigzag step points along the
     chain), signed away from the window's centroid, so the bulge is always outside the fold. N
     arrived residues sit in a row parallel to the join, one step apart. See `bulgeOuts`. */
  void mid;
  const n = Math.max(1, spec.added ?? 1);
  const outs = bulgeOuts(spec, at, step); // the geometry, shared with foldFit

  /* One event per beat: `arrive` (the residue exists, unjoined; 138-139 still adjacent), `unjoin`
     (that segment goes), `detour` (138 → X), `return` (X → 139). `arrive` precedes `unjoin` so no
     beat shows a bare gap, which would read as a deletion. Tethers run N→C, not by x, which on a
     window that doubles back would draw the chain backwards. None is `discrete`, which would
     hold each at zero until its beat ended. Each beat asks `past` (order from the registry).
     No identifier here: the subject is the arrived residue, which has its own mark (§2.11 allows
     zero). `markIdx` is only where the insertion goes. */
  const past = pastOf(entry, beat);
  const marks = foldMarks(spec).filter((k) => !past("unjoin") || k.key !== `t${spec.start + m + 1}`);

  /* Tethers are spliced before the first module, so they run behind residues like the backbone;
     the arrived residue stays last. */
  const firstModule = () => {
    const k = marks.findIndex((x) => x.kind === "module");
    return k < 0 ? marks.length : k;
  };
  if (past("detour")) {
    /* One connector per gap, in sequence: the join out to the first arrived residue, then each
       residue to the next; `return` closes the last gap. */
    const pts: [number, number][] = [a, ...outs];
    marks.splice(
      firstModule(),
      0,
      ...pts.slice(1).map(
        (p, k): Mark =>
          ({
            kind: "path",
            key: k ? `detour-out${k}` : "detour-out",
            pts: [pts[k], p],
            w: V.foldThread,
            ch: "arrived",
            delta: true,
            bare: true,
            ...(n > 1 ? { rank: k } : {}),
          }) as Mark,
      ),
    );
  }
  /* With several arrived residues the closing connector runs in the same paced sequence on
     `detour` rather than waiting for `return`. */
  if (past("return") || (n > 1 && past("detour"))) {
    marks.splice(firstModule(), 0, {
      kind: "path",
      key: "detour-back",
      pts: [outs[n - 1], b],
      w: V.foldThread,
      ...(n > 1 ? { rank: n } : {}),
      ch: "arrived",
      delta: true,
      bare: true,
    } as Mark);
  }

  /* The arrived residue is last on every beat (rule 7): a module on a vertex covers the thread
     ending there, so both tethers disappear into it. */
  if (past("arrive")) {
    outs.forEach(([x, y], k) =>
      marks.push({
        kind: "module",
        key: k ? `ins${k}` : "ins",
        x,
        y,
        size: V.moduleSize,
        ch: "arrived",
        delta: true,
      }),
    );
  }
  return marks;
}

/** Stop-loss extension (PALB2 c.3559T>C, p.Ter1187GlnextTer5). The terminator stops terminating
 *  and the chain runs on in dashed modules past its true end (residue 1186; a stop never renders).
 *  The count comes from the codon lane's specimen. The direction is the last heading, so no turn is
 *  invented. Hollow here means material the reference lacks, not low confidence. */
function foldStopLoss(beat: BeatName, spec: FoldSpecimen, entry: StateEntry): Mark[] {
  const at = foldFit(spec);
  const last = spec.points.length - 1;
  // `establish` is the anchor, unmarked; `locate` opens the clear ground and `identify` darkens
  // in place, no growth (the C trial, as `foldSealedRemoval`)
  const past = pastOf(entry, beat);
  const clear = V.moduleSizeMarked + 2 * V.markHalo;
  if (!past("extend")) {
    return foldMarks(spec, {
      mark: past("locate") ? last : null,
      dark: past("identify"),
      clearing: past("locate") ? clear : 0,
    });
  }

  const [hx, hy] = foldHeading(spec, last);
  const [ox, oy] = at(last);
  /* The extension stays on the stage. Its geometry is claimed, not measured, so where the
     backbone step would carry it off the stage the step shortens; direction is kept. */
  const nExt = spec.extension ?? FOLD_EXT;
  const room = (() => {
    const pad = V.moduleSize / 2 + V.markHalo;
    const lim = (o: number, h: number, lo: number, hi: number) =>
      h > 1e-6 ? (hi - pad - o) / h : h < -1e-6 ? (lo + pad - o) / h : Infinity;
    return Math.min(lim(ox, hx, 0, V.stageW), lim(oy, hy, 0, V.portraitStageH));
  })();
  const full = foldStep(spec);
  const fits = Math.floor(room / full);
  /* A run-on longer than the room: the residues that fit at the fold's own spacing, then a
     dotted line to the room's edge. It says long, not how long; the caption gives the number. */
  const dotted = nExt > fits && fits >= 1;
  const drawn = dotted ? fits - 1 : nExt;
  const step = dotted ? full : Math.max(0, Math.min(full, room / Math.max(1, nExt)));
  /* The extension is the variant's own material (`delta`). Tethers first, residues after, so
     each tether's halo lies under the residues. */
  const tethers: Mark[] = [],
    residues: Mark[] = [];
  let prev: [number, number] = [ox, oy];
  if (dotted) {
    const end: [number, number] = [ox + hx * room, oy + hy * room];
    tethers.push({
      kind: "path",
      key: "x-run",
      pts: [[ox + hx * step * drawn, oy + hy * step * drawn], end],
      w: V.foldThread,
      ch: "arrived",
      rank: 2 * drawn + 1,
      delta: true,
      bare: true,
      unread: true,
    } as Mark);
  }
  for (let k = 1; k <= drawn; k++) {
    const p: [number, number] = [ox + hx * step * k, oy + hy * step * k];
    /* Line, then residue, then line: each tether ranks just before its residue. */
    tethers.push({
      kind: "path",
      key: `x-t${k}`,
      pts: [prev, p],
      w: V.foldThread,
      ch: "arrived",
      rank: 2 * k - 1,
      delta: true,
      bare: true,
    } as Mark);
    residues.push({
      kind: "module",
      key: `x${k}`,
      x: p[0],
      y: p[1],
      size: V.moduleSize,
      ch: "arrived",
      rank: 2 * k,
      delta: true,
      bare: true, // no halo
    });
    prev = p;
  }
  const ext: Mark[] = [...tethers, ...residues];
  /* On the clearing: the extension starts at the identifier's centre, and under the clearing its
     first pixels would be masked. `extend` is past `identify`, so the identifier is already dark. */
  return foldMarks(spec, { mark: last, dark: true, clearing: clear, onClearing: ext });
}

/** how many residues the stop-loss extension runs for: a fact about this variant (terminator
 *  1187 -> 1192), read from the codon lane's specimen so the two lanes cannot disagree. */
const FOLD_EXT = (CODON_SPECIMENS["stop-loss"].terminator ?? 0) - (CODON_SPECIMENS["stop-loss"].trueEnd ?? 0);

/* ---- the two cells that speak instead of drawing ------------------------- */

/** A framed stage with type in it, nothing else; it takes its copy (`FOLD_STATEMENTS`). Its
 *  register (finding or foreclosure, §2.12) is declared on the marks, so a probe can check the
 *  copy's shape. The frame is four faint hairlines: an instrument, not a block, which would read
 *  as material. Every mark is `static`: an empty stage that fades up reads as failing to load. */

function foldStatement(state: string): Mark[] {
  const p = V.foldPad;
  const [x1, y1, x2, y2] = [p, p, V.stageW - p, V.portraitStageH - p];
  const corner = ([a, b, c, d]: number[], key: string): Mark => ({
    kind: "hair",
    key,
    x1: a,
    y1: b,
    x2: c,
    y2: d,
    faint: true,
    static: true,
  });
  const marks: Mark[] = [
    corner([x1, y1, x2, y1], "frame-t"),
    corner([x2, y1, x2, y2], "frame-r"),
    corner([x2, y2, x1, y2], "frame-b"),
    corner([x1, y2, x1, y1], "frame-l"),
  ];
  /* `copy: "finding"` on every line. `LabelMark.copy` keeps `foreclosure` too, though no cell
     uses it, so a probe can still catch either register. */
  const lines = fitLines(FOLD_STATEMENTS[state] ?? [], V.labelSize * V.findingScale);
  const lead = V.labelSize * V.findingScale + V.labelGap;
  const top = (V.portraitStageH - (lines.length - 1) * lead) / 2;
  lines.forEach((text, i) => {
    if (!text) return; // a blank line is spacing, not an empty <text> node
    marks.push({
      kind: "label",
      key: `s${i}`,
      text,
      static: true,
      copy: "finding",
      size: V.labelSize * V.findingScale,
      // centred line by line: the finding is the stage's subject
      x: V.stageW / 2,
      y: top + i * lead,
      anchor: "middle",
    });
  });
  return marks;
}

/* ---- dispatch, one entry per state --------------------------------------- */

/** The portrait dispatches on what can be placed (§2.13):
 *    1. a placeable fold: the projection, the anchor-diff grammar;
 *    2. a chain with no placeable fold (`truncated`, BRCA2): the chain register, by calling
 *       `chainRegister`, not a second renderer;
 *    3. neither (`absent`): the framed statement, since no protein was made.
 *  A rule, not a route: a future state lands in its branch without edits here. */
export function foldFrame(beat: BeatName, entry: StateEntry): Frame {
  const state = entry.state;
  /* Branch 2, asked before the names below: the two tables decide, never the cell name. It is
     the chain grammar whole, so no text on the register; its numbers go in the caption (§8.18). */
  if (!FOLD_SPECIMENS[state] && CHAIN_SPECIMENS[state]) {
    return {
      w: V.stageW,
      h: V.portraitStageH,
      marks: chainRegister(
        CHAIN_SPECIMENS[state],
        pastOf(entry, beat)("locate"),
        V.portraitStageH,
        pastOf(entry, beat)("settle") || pastOf(entry, beat)("extend"),
        pastOf(entry, beat)("push-in"),
      ),
      caption: chainCaption(CHAIN_SPECIMENS[state], pastOf(entry, beat)("push-in")),
    };
  }
  /* The drawing is the kind; the record is the state. On built cells they are one name; a
     variant from facts names its drawing in `entry.kind`. */
  const kind = entry.kind ?? state;
  const marks: Mark[] =
    kind === "absent"
      ? foldStatement(kind)
      : kind === "substitution-contacts"
        ? foldSubstitution(beat, FOLD_SPECIMENS[state], entry)
        : kind === "sealed-removal"
          ? foldSealedRemoval(beat, FOLD_SPECIMENS[state], entry)
          : kind === "insertion-bulge"
            ? foldInsertion(beat, FOLD_SPECIMENS[state], entry)
            : kind === "stop-loss-extension"
              ? foldStopLoss(beat, FOLD_SPECIMENS[state], entry)
              : kind === "truncated-fold"
                ? foldTruncated(beat, FOLD_SPECIMENS[state], entry)
                : /* `registers`: one beat, no operation, no marked residue. A window
                 chosen to come out exactly 20 modules held and 20 let go (BRCA1 1629-1668). */
                  foldMarks(FOLD_SPECIMENS["registers"]);
  /* The stage caption names what is shown and where. */
  const fs = FOLD_SPECIMENS[state];
  const caption =
    fs && kind !== "absent"
      ? { name: `${fs.gene} PROTEIN`, pos: span("AMINO ACID", "AMINO ACIDS", fs.start, fs.end, fs.length) }
      : undefined;
  return { w: V.stageW, h: V.portraitStageH, marks, caption };
}
