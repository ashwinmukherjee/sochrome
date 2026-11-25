// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The chain lane's frames: the protein as a line of residues, folded where it holds a shape.

import { visual as V } from "../tokens";
import type { StateEntry, BeatName } from "../states";
import { CHAIN_SPECIMENS, type ChainSpecimen } from "../specimens";
import { type Frame, type Mark, type StageCaption, emptyFrame, pastOf, span } from "./marks";

/* ---- Lane 3: chain ----
   The claim is the whole chain's confidence profile, so the line runs end to end with no bleed:
   the protein genuinely ends. No ruler and no datum; the line is the ground. The address is a
   bead on the line, and no text is drawn on the register (the number is in the caption).
   Two registers, one cut at pLDDT 70. Hold: a filled bar, `barH`. Let-go: a `dashDissolve3`
   hairline on the centreline in the same ink, so weight and continuity carry the distinction.
   At each boundary the let-go dots densify into the bar's end over `taperWindows`: a seam, not a
   third register, drawn in the run's own dasharray. N and C stop clean, with no serif.
   Nothing in this lane moves: `establish` draws both registers, `locate` lands the bead. */

/** one question, one cut: is the structure map holding here */
function holdsAt(plddt: number): boolean {
  return plddt >= V.plddtSolid;
}

/** The chain register as marks. The portrait also draws it for a chain with no placeable fold
 *  (§2.13), so there is one chain renderer. `locate` is passed: beats are the caller's. */
export function chainRegister(
  spec: ChainSpecimen,
  locate: boolean,
  stageH: number = V.stageH,
  ended: boolean = locate,
  pushed = false,
): Mark[] {
  /* The line is `chainLineSpan` of the stage, left-set at x = 0, the left edge of the copy above
     it, as in the other lanes. Its clear ground lies past the C-terminus, where "does this
     continue?" could be asked, and there is no frame, so a clean stop cannot read as cropped. */
  const span = V.chainLineSpan * V.stageW;
  const x0 = 0;
  const x1 = x0 + span;
  const y = stageH / 2;
  const lastR = spec.lastResidue ?? spec.length;
  const tailN = spec.length - lastR;
  /* A chain that ends early: REFERENCE runs the full extent, and once `ended` the line draws back
     to where the chain really ends. On `push-in` the window narrows to the protein's end, three
     times the missing length before it, and the rest runs off the left edge: a continuous push-in,
     never a cut, per the render spec's rule for two scales. */
  const zLo = tailN > 0 ? Math.max(1, lastR - 3 * tailN) : 1;
  const zoom = pushed && zLo > 1;
  /* scaled to the protein's own length; a run-on is drawn off-scale (see `ext` below) */
  const total = spec.length;
  const at = (res: number) =>
    !zoom ? x0 + ((res - 1) / (total - 1)) * (x1 - x0) : x0 + ((res - zLo) / (spec.length - zLo)) * (x1 - x0);

  /* The reference length sets the scale; the chain's own end sets where the ink stops, once
     `ended` (the beat after `locate`). What was never made is an empty gap, not a ghost: every
     chain starts at the same x, so where the ink stops is the one quantity that varies. Rows with
     no `lastResidue` end at `length`. */
  const last = ended ? lastR : spec.length;

  /* The register is decided per neighbourhood: however many residues fall inside one
     `detailMin` of line. Per residue it only manufactures speckle below what can be drawn; the
     window moves with the scale. */
  const pxPerRes = zoom ? (x1 - x0) / (spec.length - zLo) : (x1 - x0) / (spec.length - 1);
  let win = Math.max(1, Math.ceil(V.detailMin / pxPerRes));
  if (win % 2 === 0) win += 1;
  const half = (win - 1) / 2;
  const smooth = spec.plddt.map((_, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(spec.plddt.length, i + half + 1);
    let s = 0;
    for (let k = lo; k < hi; k++) s += spec.plddt[k];
    return s / (hi - lo);
  });

  /* The taper spans the smoothing window in px: the description may be ambiguous exactly where it
     was never precise. Resolved here because it depends on the specimen against the stage. */
  const taperLen = V.taperWindows * win * pxPerRes;

  const marks: Mark[] = [];

  /* Runs of one register, a segment per run. Boundary residues are shared (`runStart = i - 1`),
     so runs abut exactly and the taper reads as a seam. */
  type Run = { start: number; end: number; hold: boolean };
  const runs: Run[] = [];
  /* An unmapped chain is one let-go run: there is no structure map to derive runs from (BRCA2 has
     no AlphaFold model; its experimental coverage is short peptides inside other proteins). The
     lane's both-registers invariant is scoped to `lane === "chain"`; this is a portrait cell. */
  if (spec.unmapped) {
    runs.push({ start: 1, end: last, hold: false });
  } else {
    let runStart = 1;
    let runHold = holdsAt(smooth[0]);
    for (let i = 2; i <= last; i++) {
      const h = holdsAt(smooth[i - 1]);
      if (h !== runHold) {
        runs.push({ start: runStart, end: i - 1, hold: runHold });
        runStart = i - 1;
        runHold = h;
      }
    }
    runs.push({ start: runStart, end: last, hold: runHold });
  }

  /* A let-go run too short for two dots (`2 × d0`, measured in px, since the smoothing is in
     residues) merges into its neighbour, always a hold. The cost is a stated overstatement of the
     held extent, at most 2px (0.62px on `solid-ground`), a departure from §8.20: the alternative
     is not a truer picture but an absent one. */
  {
    const minLetGo = 2 * V.dashDissolve3[0];
    const px = (r: Run) => Math.abs(at(r.end) - at(r.start));
    for (let i = 0; i < runs.length;) {
      if (runs[i].hold || px(runs[i]) >= minLetGo || runs.length === 1) {
        i++;
        continue;
      }
      if (i > 0 && i + 1 < runs.length) {
        runs[i - 1].end = runs[i + 1].end;
        runs.splice(i, 2);
      } else if (i > 0) {
        runs[i - 1].end = runs[i].end;
        runs.splice(i, 1);
      } else {
        runs[i + 1].start = runs[i].start;
        runs.splice(i, 1);
      }
    }
  }

  /* The `barMinW` floor is applied here, not at paint (C1): widening a bar moves material
     boundaries, so the abutting let-go runs give up the pixels it takes and their tapers meet its
     drawn edge. Symmetric about the run's midpoint. The true extent rides on the mark as `truePts`,
     only where drawn and true differ, so the raw-profile check still measures the data. */
  const ext = runs.map((r) => {
    const a = at(r.start),
      b = at(r.end);
    return { x0: a, x1: b, t0: a, t1: b };
  });
  /* A neighbour gives at most its length less `2 × dashDissolve3[0]` (the merge threshold above),
     or the bar would cross it and draw it backwards; a guard, not a case. One `give`, both sides,
     so the bar never moves: one that cannot reach the floor stays short and centred, and the
     smoke's 2:1 shape check fails on it. The chain's own two ends are not clamped. */
  const roomFor = (i: number) =>
    i < 0 || i >= runs.length ? Infinity : Math.max(0, ext[i].x1 - ext[i].x0 - 2 * V.dashDissolve3[0]);
  runs.forEach((r, i) => {
    const len = ext[i].x1 - ext[i].x0;
    if (!r.hold || len >= V.barMinW) return;
    const give = Math.min((V.barMinW - len) / 2, roomFor(i - 1), roomFor(i + 1));
    if (give <= 0) return;
    ext[i].x0 -= give;
    ext[i].x1 += give;
    /* not past the chain's own start: the overrun moves to the right side */
    if (ext[i].x0 < x0) {
      ext[i].x1 += x0 - ext[i].x0;
      ext[i].x0 = x0;
    }
    if (i > 0) ext[i - 1].x1 = ext[i].x0;
    if (i + 1 < runs.length) ext[i + 1].x0 = ext[i].x1;
  });

  /* A let-go run tapers at whichever end meets a hold run; the chain's own two ends do not. Hold
     runs never taper: softening them would make the held claim the thing that fades. */
  runs.forEach((r, i) => {
    const taper: ("start" | "end")[] = [];
    if (!r.hold) {
      if (i > 0 && runs[i - 1].hold) taper.push("start");
      if (i < runs.length - 1 && runs[i + 1].hold) taper.push("end");
    }
    const e = ext[i];
    marks.push({
      kind: "path",
      key: `seg-${r.start}`,
      pts: [
        [e.x0, y],
        [e.x1, y],
      ],
      w: r.hold ? V.barH : V.strokeHairline,
      reg: r.hold ? "hold" : "let-go",
      ...(e.x0 !== e.t0 || e.x1 !== e.t1
        ? {
            truePts: [
              [e.t0, y],
              [e.t1, y],
            ] as [number, number][],
          }
        : {}),
      ...(taper.length ? { taper, taperLen } : {}),
      /* Static, exempt from the establish fade: with no datum the profile is the instrument, and
         confidence is measured, not an event. (A 0.5px let-go trace at a partial fade also sinks
         under the paper.) The bead is not static: its arrival is the lane's only event. */
      static: true,
    });
  });

  /* The address lands on `locate` and stays: it is the lane's only event. The bead is alone, since
     no text is drawn on a chain register (the harness asserts it); its number is a fact about the
     specimen and goes in the caption. No end tick on any chain: where the line stops, or turns to
     dashes, is the boundary. */
  if (spec.extension && ended) {
    /* The run-on is drawn as the portrait draws it (`foldStopLoss`): from the last residue, its
       residues and threads in the fold's marks and ink, as many as fit in the clear ground, then a
       dotted line to the stage's edge. Not to scale: it says a chain runs on, and long; the copy
       says how long. */
    const nExt = spec.extension;
    const ox = at(spec.length),
      pad = V.moduleSize / 2 + V.markHalo;
    const room = V.stageW - pad - ox,
      full = V.moduleSize * 2.5;
    const fits = Math.floor(room / full);
    const dotted = nExt > fits && fits >= 1;
    const drawn = dotted ? fits - 1 : nExt;
    const step = dotted ? full : Math.max(0, Math.min(full, room / Math.max(1, nExt)));
    const threads: Mark[] = [],
      residues: Mark[] = [];
    if (dotted)
      threads.push({
        kind: "path",
        key: "ext-run",
        pts: [
          [ox + step * drawn, y],
          [ox + room, y],
        ],
        w: V.foldThread,
        ch: "arrived",
        rank: 2 * drawn + 1,
        delta: true,
        bare: true,
        unread: true,
      } as Mark);
    let prev = ox;
    for (let k = 1; k <= drawn; k++) {
      const x = ox + step * k;
      threads.push({
        kind: "path",
        key: `ext-t${k}`,
        pts: [
          [prev, y],
          [x, y],
        ],
        w: V.foldThread,
        ch: "arrived",
        rank: 2 * k - 1,
        delta: true,
        bare: true,
      } as Mark);
      residues.push({
        kind: "module",
        key: `ext-r${k}`,
        x,
        y,
        size: V.moduleSize,
        ch: "arrived",
        rank: 2 * k,
        delta: true,
        bare: true,
      } as Mark);
      prev = x;
    }
    marks.push(...threads, ...residues);
  }

  /* On a push-in, what runs off the left edge is cut there: the line starts at the stage edge,
     which says it continues. */
  if (zoom) {
    for (let k = marks.length - 1; k >= 0; k--) {
      const m = marks[k];
      if (m.kind !== "path") continue;
      const xa = m.pts[0][0],
        xb = m.pts[m.pts.length - 1][0];
      if (xb <= x0) {
        marks.splice(k, 1);
        continue;
      }
      if (xa < x0) {
        const { truePts: _t, taper: _p, ...rest } = m;
        marks[k] = {
          ...rest,
          pts: [
            [x0, y],
            [xb, y],
          ],
        };
      }
    }
  }
  if (locate) {
    /* On the line, not below it: below, the bead is tied to the register only by x. The glyph
       sits on a line rather than crossing it (as the transcript lane's, §8.8), and `beadSize`
       (`barH + 2 × strokeHairline`) keeps it visible there. */

    if (V.locateBeadHalo) {
      // the halo as its own square under the bead, sized as the CSS ring draws it at rest
      marks.push({ kind: "clearing", key: "bead-halo", x: at(spec.site), y, size: V.moduleSize + 2 * V.markHalo });
    }
    marks.push({ kind: "bead", key: "site", x: at(spec.site), y, size: V.beadSize });
  } else if (V.locateBeadHalo) {
    marks.push({
      kind: "clearing",
      key: "bead-halo",
      x: at(spec.site),
      y,
      size: (V.beadSize + 5) * V.locateFrom,
      op: 0,
    });
    marks.push({ kind: "bead", key: "site", x: at(spec.site), y, size: V.beadSize, op: 0 });
  } else {
    // as in the portrait: waits small and unseen, grows into place on `locate`
    marks.push({ kind: "bead", key: "site", x: at(spec.site), y, size: V.beadSize * V.locateFrom, op: 0 }); // always fades: a solid dot would show in REFERENCE
  }

  return marks;
}

/** The chain lane's own cells: what the register looks like is `chainRegister`; when is here. */
export function chainFrame(beat: BeatName, entry: StateEntry): Frame {
  /* `-[ab]` is stripped as in the transcript lane's lookup: a pair is one specimen drawn two
     ways (D3). */
  const spec = CHAIN_SPECIMENS[entry.state.replace(/-[ab]$/, "")];
  if (!spec) return emptyFrame();
  return {
    w: V.stageW,
    h: V.stageH,
    marks: chainRegister(spec, pastOf(entry, beat)("locate")),
    caption: chainCaption(spec, false),
  };
}
/** the chain's caption: the whole protein, or, pushed in on a shortened one, the stretch the
 *  push-in shows (the same zLo `chainRegister` zooms to) */
export function chainCaption(spec: ChainSpecimen, pushed: boolean): StageCaption {
  const lastR = spec.lastResidue ?? spec.length,
    tailN = spec.length - lastR;
  const zLo = tailN > 0 ? Math.max(1, lastR - 3 * tailN) : 1;
  /* A range only for a part: on the whole protein a count beside its name only restates the
     drawing. */
  return {
    name: `${spec.gene} PROTEIN`,
    pos: pushed && zLo > 1 ? span("AMINO ACID", "AMINO ACIDS", zLo, spec.length, spec.length) : "",
  };
}
