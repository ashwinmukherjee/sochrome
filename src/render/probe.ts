// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Harness only (?probe=1): writes laid-out boxes and the checks a screenshot can't make into <pre id="__diag">.
// The checks are the load-bearing rules restated as assertions, so breaking one fails a run. Nothing here draws.

import { visual as V } from "./tokens";
import { STATES, cellKey, type StateEntry } from "./states";
import { frame, sample, timeline, isBuilt, type Mark } from "./frames";
import { BRCA1_EXONS, TRANSCRIPT_SPECIMENS, CODON_SPECIMENS, CHAIN_SPECIMENS } from "./specimens";
/* A check about a rendered dash pattern calls the paint layer's own function rather than restating it (§7.10a). */
import { letGoSeq } from "./lanes/paint";

const nums = (m: Mark): number[] =>
  Object.entries(m)
    .filter(([, v]) => typeof v === "number")
    .map(([, v]) => v as number);

/* Datum ticks only: `tick-*` are the metronome that may never move; `locus` is an address and arrives on its own
   beat. The chain lane has no datum, so this collects nothing there; its stillness is checked on the profile. */
function ticksOf(marks: Mark[]): string {
  return marks
    .filter((m) => m.kind === "tick" && m.key.startsWith("tick-"))
    .map((m) => `${(m as any).x.toFixed(3)}@${(m as any).y.toFixed(3)}`)
    .sort()
    .join(",");
}

/** FNV-1a, 32 bit, printed hex. Not cryptography — an identity check a human
 *  can eyeball in a log line. */
function hash(s: string): string {
  let h = 0x811c9dc5; // struct — FNV offset basis
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // struct — FNV prime
  }
  return (h >>> 0).toString(16).padStart(8, "0"); // struct — 8 hex digits
}

function checks(entry: StateEntry) {
  const out: { name: string; ok: boolean; detail?: string }[] = [];
  const beats = entry.beats;

  // Determinism
  const a = JSON.stringify(frame(entry, beats[0]));
  const b = JSON.stringify(frame(entry, beats[0]));
  out.push({ name: "deterministic", ok: a === b });

  /* The beat grid: the datum's ticks are identical in every beat. A variant cell opens already windowed, so no beat is
     entitled to move the ruler. */
  const sets = beats.map((bt) => ticksOf(frame(entry, bt).marks));
  const same = sets.every((s) => s === sets[0]);
  out.push({
    name: "beat grid holds",
    ok: same,
    detail: !same
      ? "TICKS MOVED"
      : sets[0] === ""
        ? "no datum in this lane"
        : `${sets[0].split(",").length} ticks, identical across ${beats.length} beats`,
  });

  /* ---- Codon lane: the unread rung and the one-beat delay ---- */
  if (entry.lane === "codon") {
    /* Every unread block is faint (`inkFill`, RULES.md §8.9), at every beat, since a block can turn unread
       mid-replay. */
    let strongUnread = 0;
    for (const bt of beats) {
      for (const m of frame(entry, bt).marks as any[]) {
        if (m.kind === "block" && m.reach === "unread" && !m.faint) strongUnread++;
      }
    }
    out.push({
      name: "codon lane: unread blocks are faint",
      ok: strongUnread === 0,
      detail: strongUnread ? `${strongUnread} unread block(s) at the old, stronger rung` : "faint throughout",
    });

    /* The stop's downstream unread flip trails its own black flip by one beat (frameshift and nonsense; stop-loss's
       reference terminator is faint from frame one on purpose). Found by the first beat any block turns black, not
       by beat name. */
    const spec = CODON_SPECIMENS[entry.state];
    if (spec && spec.terminator != null && spec.trueEnd == null) {
      const stopBeatIdx = beats.findIndex((bt) =>
        (frame(entry, bt).marks as any[]).some((m) => m.kind === "block" && m.ch === "black"),
      );
      const sameBeatUnread =
        stopBeatIdx >= 0 &&
        (frame(entry, beats[stopBeatIdx]).marks as any[]).some((m) => m.kind === "block" && m.reach === "unread");
      const everUnread = beats.some((bt) =>
        (frame(entry, bt).marks as any[]).some((m) => m.kind === "block" && m.reach === "unread"),
      );
      out.push({
        name: "codon lane: unread trails the stop's own black flip by a beat",
        ok: stopBeatIdx < 0 || (!sameBeatUnread && everUnread),
        detail:
          stopBeatIdx < 0
            ? "no stop in this cell"
            : `stop turns black at beat ${stopBeatIdx} (${beats[stopBeatIdx]}); unread ${sameBeatUnread ? "WRONGLY present that same beat" : "absent that beat"}, ${everUnread ? "appears later" : "NEVER appears"}`,
      });
    }
  }

  /* ---- Chain lane ---- */
  if (entry.lane === "chain") {
    /* Nothing displaces in this lane (why it has no ruler): every `path` mark is identical in every beat. The address
       may arrive, so the profile is checked rather than the whole frame. */
    const profiles = beats.map((bt) => JSON.stringify(frame(entry, bt).marks.filter((m) => m.kind === "path")));
    const still = profiles.every((p) => p === profiles[0]);
    const runs = JSON.parse(profiles[0]) as any[];
    out.push({
      name: "chain: nothing displaces — the profile is identical in every beat",
      ok: still,
      detail: still ? `${runs.length} runs, identical across ${beats.length} beats` : "THE PROFILE MOVED",
    });

    /* Both registers are present from the first paint: confidence is measured, not an event, so a cell must not
       establish held and then let go. Both must appear, or an all-hold chain would pass trivially. */
    const regsOf = (bt: string) =>
      (frame(entry, bt).marks.filter((m) => m.kind === "path") as any[])
        .map((m) => (m.reg === "hold" ? "H" : "L"))
        .sort()
        .join("");
    const r0 = regsOf(beats[0]);
    const rN = regsOf(beats[beats.length - 1]);
    const nHold = [...r0].filter((c) => c === "H").length;
    out.push({
      name: "chain: both registers present from the first paint",
      ok: r0 === rN && nHold > 0 && nHold < r0.length,
      detail: `hold×${nHold} let-go×${r0.length - nHold}` + (r0 === rN ? "" : " — REGISTERS CHANGED MID-REPLAY"),
    });

    /* Exactly two transverse extents, the two tokens: `m.w` is a trace's weight or a bar's height, and a third extent
       would be a third state. The taper is dash-only for this reason: a seam, not a state. */
    const widths = [...new Set(runs.map((m: any) => Number(m.w.toFixed(4))))].sort((a, b) => a - b);
    const wantW = [V.strokeHairline, V.barH].map((w) => Number(w.toFixed(4))).sort((a, b) => a - b);
    out.push({
      name: "chain: exactly two transverse extents, and they are the two tokens",
      ok: widths.length === 2 && widths.every((w, i) => Math.abs(w - wantW[i]) < 1e-6),
      detail: `${widths.join(" · ")} (want ${wantW.join(" · ")})`,
    });

    /* Every register boundary tapers, on the let-go side: a hard cut at `plddtSolid` without one reads as a butt
       joint. Counted from the run list: adjacent hold/let-go pairs equal taper ends claimed. */
    let boundaries = 0;
    for (let i = 1; i < runs.length; i++) if (runs[i].reg !== runs[i - 1].reg) boundaries++;
    const taperEnds = runs.reduce((n: number, m: any) => n + (m.taper?.length ?? 0), 0);
    const taperOnHold = runs.some((m: any) => m.reg === "hold" && m.taper?.length);
    out.push({
      name: "chain: every register boundary tapers, on the let-go side",
      ok: boundaries === taperEnds && !taperOnHold,
      detail: `${boundaries} boundaries, ${taperEnds} tapered end(s)` + (taperOnHold ? " — A HELD RUN IS TAPERED" : ""),
    });

    /* The profile is at full value from the first instant: it is `static`, the lane's ground, and a ground does not
       arrive. Two marks at one opacity are not equally visible (a 0.5px dotted hairline vanishes in a crossfade a 2px
       bar survives), so every path must read op 1 at eleven samples across `establish`, not only at its end. */
    {
      const est = timeline(entry).phases[0];
      let worst = 1;
      for (let k = 0; k <= 10; k++) {
        for (const m of sample(entry, est.at + (est.dur * k) / 10).marks as any[]) {
          if (m.kind === "path") worst = Math.min(worst, m.op ?? 1);
        }
      }
      out.push({
        name: "chain: the profile does not fade in — it is the ground",
        ok: worst >= 1 - 0.001,
        detail: `worst path opacity across establish: ${worst.toFixed(3)}`,
      });
    }

    /* The held spans match the raw profile: the one check here that reads source data, asking whether the render is
       true rather than consistent. The drawn hold fraction is compared with the raw share of residues at or above
       `plddtSolid`; 2 points of tolerance (worst measured 0.3) catches a region going missing, not an edge moving.
       It reads `truePts` where a run has one, since the `barMinW` floor in `chainRegister` moves drawn extents. */
    {
      const cs = CHAIN_SPECIMENS[entry.state.replace(/-[ab]$/, "")];
      if (cs) {
        const span = (m: any) => {
          const p = m.truePts ?? m.pts;
          return Math.abs(p[1][0] - p[0][0]);
        };
        const total = runs.reduce((s: number, m: any) => s + span(m), 0);
        const heldPx = runs.filter((m: any) => m.reg === "hold").reduce((s: number, m: any) => s + span(m), 0);
        const drawn = total > 0 ? heldPx / total : 0;
        const raw = cs.plddt.filter((p) => p >= V.plddtSolid).length / cs.plddt.length;
        out.push({
          name: "chain: held spans match the raw profile's own",
          ok: Math.abs(drawn - raw) <= 0.02,
          detail:
            `drawn ${(drawn * 100).toFixed(1)}% of the line, raw ≥${V.plddtSolid} ` +
            `${(raw * 100).toFixed(1)}% of residues (Δ ${((drawn - raw) * 100).toFixed(1)}pp)`,
        });
      }
    }

    /* Every let-go run draws at least two dots, or a run between bars reads as a nick joining them (§7.10a). It calls
       the paint layer's own `letGoSeq` and counts the dots it returns, so it stays true when the pattern's rule moves;
       the dash probe can't see a dasharray never emitted (B2). Asserted, not enforced: widening a run would shorten
       the bars (§8.20). It measures the drawn extent (`pts`), which is what the dots are laid along. */
    {
      const [d0, g0] = V.dashDissolve3;
      let worstDots = Infinity,
        worstLen = Infinity,
        worstDot = Infinity;
      for (const m of runs as any[]) {
        if (m.reg !== "let-go") continue;
        const len = Math.abs(m.pts[1][0] - m.pts[0][0]);
        const seq = letGoSeq(len, d0, g0, m.taperLen ?? 0, !!m.taper?.includes("start"), !!m.taper?.includes("end"));
        // a dasharray reads role from POSITION: even indices are ink
        const dots = seq.filter((_, i) => i % 2 === 0);
        if (dots.length < worstDots) {
          worstDots = dots.length;
          worstLen = len;
        }
        worstDot = Math.min(worstDot, ...dots);
      }
      out.push({
        name: "chain: every let-go run draws at least two dots",
        ok: worstDots === Infinity || (worstDots >= 2 && worstDot >= d0),
        detail:
          worstDots === Infinity
            ? "no let-go run in this cell"
            : `fewest ${worstDots} dot(s) on a ${worstLen.toFixed(2)}px run · ` +
              `shortest dot ${worstDot.toFixed(2)}px against a ${d0}px token`,
      });
    }

    /* No text on a chain register at any beat; the residue number is in the caption. The painted counterpart (no
       `<text>` in `#lane-chain`) is in the smoke. */
    const labels = beats.reduce((n, bt) => n + frame(entry, bt).marks.filter((m) => m.kind === "label").length, 0);
    out.push({
      name: "chain: no text on the register",
      ok: labels === 0,
      detail: labels ? `${labels} label mark(s) still drawn` : "silent",
    });

    /* The address arrives on its own beat and on the line: absent at `establish`, exactly one from `locate` on, and
       its y is the profile's own y. An exact number, not a tolerance, so a moved clearance fails at once. */
    const beadsAt = (bt: string) => frame(entry, bt).marks.filter((m) => m.kind === "bead") as any[];
    const lineY = (runs[0]?.pts?.[0]?.[1] ?? null) as number | null;
    const first = beadsAt(beats[0]).length;
    const later = beats.slice(1).map((bt) => beadsAt(bt));
    const onLine = later.every((bs) => bs.every((b) => lineY != null && Math.abs(b.y - lineY) < V.epsPx));
    out.push({
      name: "chain: the address arrives on its own beat, on the line",
      ok: first === 0 && later.every((bs) => bs.length === 1) && onLine,
      detail:
        `establish ${first} bead(s), then ${later.map((bs) => bs.length).join("/")}` +
        (onLine ? ", on the line" : ", OFF THE LINE"),
    });
  }

  /* ---- Block scale ---- */
  if (entry.lane === "transcript" && beats.length > 1) {
    /* the same `-[ab]` strip as frames.ts's `transcriptSpec`, so a pair, if one returns, checks the builder's
       specimen */
    const spec = TRANSCRIPT_SPECIMENS[entry.state.replace(/-[ab]$/, "")];

    /* True proportion, the block-scale counterpart of the beat grid: a block's width is its length. Measured against a
       px-per-nucleotide derived from the datum's own ticks, not the plan, at `beats[0]`, the intact frame. */
    const f = frame(entry, beats[0]);
    const ts = f.marks
      .filter((m) => m.kind === "tick" && m.key.startsWith("tick-"))
      .map((m) => ({ nt: Number(m.key.slice(5)), x: (m as any).x }))
      .sort((a, b) => a.nt - b.nt);
    /* "Whole" means `!trimmed`: a mark's own x/w always satisfies the bound `trim` was given, so the harness reads
       `trim`'s own report rather than re-deriving it (`shiftAt` displacement makes the geometric test wrong). */
    if (ts.length >= 2) {
      const pxpb = (ts[1].x - ts[0].x) / (ts[1].nt - ts[0].nt);
      let worst = 0;
      let n = 0;
      for (const m of f.marks) {
        if (m.kind !== "block" || !/^ex\d+$/.test(m.key) || (m as any).trimmed) continue;
        const b = BRCA1_EXONS.find((e) => `ex${e.exon}` === m.key);
        if (!b) continue;
        worst = Math.max(worst, Math.abs((m as any).w - b.bp * pxpb));
        n++;
      }
      out.push({
        name: "blocks at true proportion",
        ok: worst <= 0.01,
        detail: `${n} whole blocks, worst ${worst.toFixed(4)}px off the datum's own scale`,
      });

      /* Datum bleed equals the strip's own overrun on whichever end bleeds: `datumBleed` at this window's pxpb, or
         zero, never a fixed pixel count (a fixed-px margin puts the hairline on the stage edge). */
      const rule = f.marks.find((m) => m.kind === "rule") as any;
      if (rule) {
        const wantBleed = V.datumBleed * pxpb;
        const gotL = rule.coreX1 - rule.x1;
        const gotR = rule.x2 - rule.coreX2;
        const atEdge = (got: number) => got < 0.01;
        const atBleed = (got: number) => Math.abs(got - wantBleed) < 0.01;
        out.push({
          name: "datum bleed = strip extent's own overrun",
          ok: (atEdge(gotL) || atBleed(gotL)) && (atEdge(gotR) || atBleed(gotR)),
          detail: `left ${gotL.toFixed(2)}px, right ${gotR.toFixed(2)}px, want 0 or ${wantBleed.toFixed(2)}px`,
        });
      }
    }

    /* Frame integrity is carried by fill: downstream of an out-of-frame event goes hollow, downstream of an in-frame
       one must not (skip-frame-kept's whole claim). */
    const last = frame(entry, beats[beats.length - 1]);
    const hollow = last.marks.some((m) => m.kind === "block" && /^ex\d+/.test(m.key) && (m as any).ch === "hollow");
    const breaksFrame = spec
      ? (spec.skipBp != null && spec.skipBp % 3 !== 0) || (spec.admitted != null && !spec.admitted.inFrame)
      : false;
    out.push({
      name: "frame integrity is carried by fill",
      ok: hollow === breaksFrame,
      detail: breaksFrame
        ? `frame broken, downstream ${hollow ? "hollow" : "STILL SOLID"}`
        : `frame intact, downstream ${hollow ? "WRONGLY HOLLOW" : "solid"}`,
    });

    /* The strip's length claim at its right edge: `coreX2` is the datum's fixed edge and the strip may fall short of
       it or run past it. Zero for no length change, an overrun for admitted material, a shortfall for a skip; the
       trim bound moves with each block's own displacement so the claim survives. Read at settle. */
    const stripHi = Math.max(...last.marks.filter((m) => m.kind === "block").map((m) => (m as any).x + (m as any).w));
    const ruleClaim = last.marks.find((m) => m.kind === "rule") as any;
    if (ruleClaim && Number.isFinite(stripHi)) {
      const mismatch = stripHi - ruleClaim.coreX2;
      const wantSign = spec?.admitted != null ? 1 : spec?.skipBp != null ? -1 : 0;
      const ok =
        wantSign === 0 ? Math.abs(mismatch) < 0.5 : Math.sign(mismatch) === wantSign && Math.abs(mismatch) > 0.5;
      out.push({
        name: "strip length claim at the right edge",
        ok,
        detail: `mismatch ${mismatch.toFixed(2)}px, want ${wantSign === 0 ? "≈0 (no length change)" : wantSign > 0 ? "overrun (material admitted)" : "shortfall (material skipped)"}`,
      });
    }

    /* One seam per join between adjacent visible blocks at settle, ordinary or manufactured. Blocks are distinct
       parents (a stop-split `exN`/`exN-post` is one) with a pixel in the viewBox, since `trim` still emits marks
       wholly in the bleed: the same visibility test frames.ts uses to decide which joins earn a seam. */
    // strips `-pre` alongside `-post`, matching frames.ts's own `parentOf`
    const parentOf = (key: string) => key.replace(/-(post|pre)$/, "");
    const blockParents = new Set(
      last.marks
        .filter(
          (m) =>
            m.kind === "block" &&
            /^(ex\d+|admitted)(-post|-pre)?$/.test(m.key) &&
            (m as any).x + (m as any).w > 0 &&
            (m as any).x < V.stageW,
        )
        .map((m) => parentOf(m.key)),
    );
    const seams = last.marks.filter((m) => m.kind === "seam").length;
    const expectedSeams = Math.max(0, blockParents.size - 1);
    out.push({
      name: "seam count = blocks - 1",
      ok: seams === expectedSeams,
      detail: `${blockParents.size} blocks, ${seams} seams (want ${expectedSeams})`,
    });

    /* Strip extent < stage width: `datumBleed` reserves room on every side that isn't a true gene edge, so no
       windowed cell's strip reaches the stage edge. Checked on every cell. */
    const blockXs = last.marks.filter((m) => m.kind === "block") as any[];
    if (blockXs.length) {
      const lo = Math.min(...blockXs.map((m) => m.x));
      const hi = Math.max(...blockXs.map((m) => m.x + m.w));
      out.push({
        name: "strip extent < stage width",
        ok: hi - lo < V.stageW - 0.01,
        detail: `${(hi - lo).toFixed(2)}px of ${V.stageW}`,
      });
    }

    /* Discrete marks never partially fade, sampled mid-transition (a rest frame can't tell a snap from a fade).
       `establish` is excluded: there the strip fades in as one thing (`sample`'s first phase reads `static`, not
       `discrete`), which the veil check below holds (§8.45, §8.46). */
    let worstDiscreteOp = 1;
    timeline(entry)
      .phases.slice(1)
      .forEach((ph) => {
        const s = sample(entry, ph.at + ph.dur / 2);
        for (const m of s.marks as any[]) {
          if (m.discrete) worstDiscreteOp = Math.min(worstDiscreteOp, m.op ?? 1);
        }
      });
    out.push({
      name: "discrete marks never partially fade",
      ok: worstDiscreteOp >= 1 - 0.001,
      detail: `worst mid-transition opacity on a discrete mark: ${worstDiscreteOp.toFixed(3)}`,
    });

    /* The damage is one mark and lands at u=1 (§7.10b): the seam holds `real: true` strictly inside its phase and
       flips at completion, and the datum tick on the same base is identical through the beat. Sampled every 5%,
       since a midpoint look misses a phase of disagreement. */
    if (entry.state === "foreclosed-junction") {
      const ph = timeline(entry).phases.find((p) => p.beat === "damage-seam")!;
      let earlyFlips = 0;
      let tickMoved = 0;
      const tickAt = (t: number) => JSON.stringify(sample(entry, t).marks.find((m) => m.key === "tick-5074") ?? null);
      const tick0 = tickAt(ph.at);
      for (let k = 1; k < 20; k++) {
        const t = ph.at + (ph.dur * k) / 20;
        const seam = sample(entry, t).marks.find((m) => m.key === "seam-ex16-ex17") as any;
        if (seam && seam.real === false) earlyFlips++;
        if (tickAt(t) !== tick0) tickMoved++;
      }
      const settled = sample(entry, ph.at + ph.dur).marks.find((m) => m.key === "seam-ex16-ex17") as any;
      out.push({
        name: "the damaged join flips on one mark, at u=1",
        ok: earlyFlips === 0 && settled?.real === false,
        detail:
          earlyFlips === 0 && settled?.real === false
            ? "seam real through the beat, false at its completion"
            : `flipped early at ${earlyFlips}/19 steps; settled real=${settled?.real}`,
      });
      out.push({
        name: "the datum tick on the damaged join never changes",
        ok: tickMoved === 0,
        detail: tickMoved === 0 ? "identical at every 5% step" : `changed at ${tickMoved}/19 steps`,
      });
    }

    /* The strip arrives as one thing at `establish` (§8.47): no non-static mark carries a fade of its own, the shared
       veil rises monotonically to whole, and it is gone by the beat's end. Per-mark `op` alone would pass under a
       veil whatever happened (B2). `static` marks (the datums, the chain profile, the break column's label) are
       exempt. */
    {
      const estPh = timeline(entry).phases[0];
      let ownFade = 0;
      let lastVeil = -1;
      let monotone = true;
      let veils = 0;
      for (let k = 0; k <= 10; k++) {
        const s = sample(entry, estPh.at + (estPh.dur * k) / 10);
        for (const m of s.marks as any[]) if (!m.static && (m.op ?? 1) < 1) ownFade++;
        /* An absent `fade` reads 0 when only the instrument is on the stage (below the `opVanish` floor) and 1 when
           the object is there unveiled. */
        const veil = s.fade ?? ((s.marks as any[]).some((m) => !m.static) ? 1 : 0);
        if (veil < lastVeil - 0.001) monotone = false;
        if (s.fade != null) veils++;
        lastVeil = veil;
      }
      const settled = sample(entry, estPh.at + estPh.dur).fade == null;
      out.push({
        name: "the strip arrives as one thing at establish",
        ok: ownFade === 0 && monotone && settled,
        detail:
          ownFade || !monotone || !settled
            ? `${ownFade} mark(s) fading on their own · monotone ${monotone} · clear at the boundary ${settled}`
            : `one veil, ${veils}/11 instants under it, rising to whole and gone by the boundary`,
      });
    }

    /* The hairline is exactly the gap at every instant of the unzip: `intron-hair` exists from `establish` at zero
       width, so its right end is the downstream block's left edge throughout. An identity, not a tolerance, and keyed
       on the mark rather than a beat name, so any revealing cell inherits it. */
    {
      const hairPh = timeline(entry).phases.find((p) =>
        (frame(entry, p.beat).marks as any[]).some((m) => m.key === "intron-hair" && m.x2 > m.x1),
      );
      if (hairPh) {
        let worstJoin = 0;
        let sampled = 0;
        for (let k = 0; k <= 10; k++) {
          const s = sample(entry, hairPh.at + (hairPh.dur * k) / 10);
          const hair = (s.marks as any[]).find((m) => m.key === "intron-hair");
          if (!hair) continue;
          const right = (s.marks as any[])
            .filter((m) => m.kind === "block" && m.x + 0.01 >= hair.x1)
            .sort((a, b) => a.x - b.x)[0];
          if (!right) continue;
          sampled++;
          worstJoin = Math.max(worstJoin, Math.abs(right.x - hair.x2));
        }
        out.push({
          name: "the hairline opens with the gap, never ahead of it",
          ok: sampled > 8 && worstJoin <= 0.05,
          detail: `${sampled}/11 instants sampled · worst hair-to-block gap ${worstJoin.toFixed(3)}px`,
        });
      }
    }

    /* Single value step at the sliver: reading stops once and never resumes, so a seam's `faint` is monotonic in x.
       Checked at settle, where every seam is present. */
    {
      const lastF = frame(entry, beats[beats.length - 1]);
      const seams = (lastF.marks.filter((m) => m.kind === "seam") as any[]).sort((a, b) => a.x - b.x);
      let steps = 0;
      for (let k = 1; k < seams.length; k++) {
        if (!!seams[k - 1].faint && !seams[k].faint) steps++;
      }
      out.push({
        name: "single value step at sliver position",
        ok: steps === 0,
        detail: seams.length ? `${seams.map((s) => (s.faint ? "faint" : "full")).join(" → ")}` : "no seams",
      });
    }

    /* The block counterpart: `reach` is monotonic in x, and every unread block carries `faint`, so nothing past a
       sliver paints at the datum's rung. Visible blocks only, at settle. */
    {
      const lastF = frame(entry, beats[beats.length - 1]);
      const blocks = (lastF.marks.filter((m) => m.kind === "block") as any[])
        .filter((m) => m.x + m.w > 0 && m.x < V.stageW)
        .sort((a, b) => a.x - b.x);
      let steps = 0;
      for (let k = 1; k < blocks.length; k++) {
        if (blocks[k - 1].reach === "unread" && blocks[k].reach !== "unread") steps++;
      }
      const strongPastStop = blocks.filter((m) => m.reach === "unread" && !m.faint);
      out.push({
        name: "single value step + hairline past the sliver",
        ok: steps === 0 && strongPastStop.length === 0,
        detail: blocks.length
          ? `${blocks.map((m) => (m.reach === "unread" ? (m.faint ? "faint" : "STRONG-UNREAD") : "read")).join(" → ")}`
          : "no blocks",
      });
    }

    /* Datum extent < stage width: `datumBleed`'s margin leaves the bled rule strictly inside the room reserved for it
       (see the token), on every windowed cell. */
    const rule2 = last.marks.find((m) => m.kind === "rule") as any;
    if (rule2) {
      out.push({
        name: "datum extent < stage width",
        ok: rule2.x2 - rule2.x1 < V.stageW - 0.01,
        detail: `${(rule2.x2 - rule2.x1).toFixed(2)}px of ${V.stageW}`,
      });
    }

    /* A seam event never shares a beat with a block event, or the smaller change is lost inside the larger. A seam
       leaving with its own block is one thing departing and is excluded (skip-frame-broken's bypassed exon). Checked
       over every adjacent beat pair, not named beats. */
    {
      const conflicts: string[] = [];
      for (let i = 0; i < beats.length - 1; i++) {
        const a = frame(entry, beats[i]);
        const b = frame(entry, beats[i + 1]);
        const am = new Map(a.marks.map((m) => [m.key, m]));
        const bm = new Map(b.marks.map((m) => [m.key, m]));
        const keys = new Set([...am.keys(), ...bm.keys()]);
        let seamEvent = false,
          blockEvent = false;
        for (const k of keys) {
          const x = am.get(k) as any,
            y = bm.get(k) as any;
          if ((!x && y?.kind === "seam") || (x?.kind === "seam" && y && x.real !== y.real)) seamEvent = true;
          if (
            (!x && y?.kind === "block") ||
            (x?.kind === "block" && !y) ||
            (x?.kind === "block" && y && x.reach !== y.reach)
          )
            blockEvent = true;
        }
        if (seamEvent && blockEvent) conflicts.push(`${beats[i]}->${beats[i + 1]}`);
      }
      out.push({
        name: "seam events never share a beat with block events",
        ok: conflicts.length === 0,
        detail: conflicts.length ? `overlap at ${conflicts.join(", ")}` : "clear",
      });
    }
  }

  /* Channels (`ch`, `reach`, `real`) hold their FROM value until their transition completes, sheet-wide since
     `tweenMark` is shared: read as intended or not, never half. Only unfronted phases (`span === 0`), where every mark
     shares one progress; on a staggered phase a fast unit legitimately finishes first. */
  {
    let channelMismatch = 0;
    timeline(entry)
      .phases.slice(1)
      .forEach((ph, i) => {
        if (ph.span > 0) return;
        const fromF = frame(entry, beats[i]);
        const midF = sample(entry, ph.at + ph.dur * 0.5);
        const fromM = new Map(fromF.marks.map((m: any) => [m.key, m]));
        for (const m of midF.marks as any[]) {
          const f = fromM.get(m.key);
          if (!f || f.kind !== m.kind) continue;
          if ("ch" in f && m.ch !== f.ch) channelMismatch++;
          if (("reach" in f || "reach" in m) && (f.reach ?? null) !== (m.reach ?? null)) channelMismatch++;
          if ("real" in f && f.real != null && m.real !== f.real) channelMismatch++;
        }
      });
    out.push({
      name: "channels hold until their own transition completes",
      ok: channelMismatch === 0,
      detail: channelMismatch ? `${channelMismatch} flipped before u=1 on an unfronted phase` : "held",
    });
  }

  /* No duplicate `m.key` within a frame, at any beat: `tweenMark`'s lookup and React's keys both keep only the last
     mark under a repeated key, so the other never tweens or paints. */
  {
    let dupes = 0;
    const dupeDetail: string[] = [];
    for (const bt of beats) {
      const seen = new Map<string, number>();
      for (const m of frame(entry, bt).marks) seen.set(m.key, (seen.get(m.key) ?? 0) + 1);
      seen.forEach((n, k) => {
        if (n > 1) {
          dupes++;
          dupeDetail.push(`${bt}:${k}x${n}`);
        }
      });
    }
    out.push({
      name: "no duplicate mark keys within a frame",
      ok: dupes === 0,
      detail: dupes ? dupeDetail.join(", ") : "unique",
    });
  }

  /* The address bead is one size everywhere, across lanes and beats: checked against `V.beadSize` itself, so a push
     site that hardcodes a size fails here. Cells with no bead pass. */
  {
    let beadMismatch = 0;
    let beadCount = 0;
    for (const bt of beats) {
      for (const m of frame(entry, bt).marks) {
        if (m.kind !== "bead") continue;
        beadCount++;
        if ((m as any).size !== V.beadSize) beadMismatch++;
      }
    }
    out.push({
      name: "address bead is the shared size, everywhere it is drawn",
      ok: beadMismatch === 0,
      detail: beadCount ? `${beadCount} bead mark(s), ${beadMismatch} off V.beadSize` : "no bead in this cell",
    });
  }

  /* The terminal size step on the mark list (RULES.md §2.9): every unmarked module is `moduleSize` at every beat, and
     the marked one is named at `moduleSize` for at most one beat, then grown to `moduleSizeMarked`, never shrinking.
     Paint check (ix) holds the other half: nothing else on the register ended up the same size. */
  {
    let sizeMismatch = 0;
    let modCount = 0;
    let markedCount = 0;
    const markedSizes: number[] = [];
    for (const bt of beats) {
      let markedHere: number | null = null;
      for (const m of frame(entry, bt).marks as any[]) {
        if (m.kind !== "module") continue;
        modCount++;
        if (m.dark) {
          markedCount++;
          markedHere = m.size;
        } else if (m.size !== V.moduleSize) sizeMismatch++;
      }
      if (markedHere != null) markedSizes.push(markedHere);
    }
    /* A cell that clears ground for its identifier (§8.55) separates it by the clearing, not a size step, so there
       the identifier must never change size. Read off the marks: any `clearing` means this grammar. */
    const clears = beats.some((bt) => frame(entry, bt).marks.some((m) => m.kind === "clearing"));

    const faults: string[] = [];
    if (sizeMismatch) faults.push(`${sizeMismatch} unmarked module(s) off moduleSize`);
    if (clears) {
      const off = markedSizes.filter((s) => s !== V.moduleSize).length;
      if (off) faults.push(`${off} beat(s) with the identifier off moduleSize in a cleared cell`);
    } else if (markedSizes.length) {
      const named = markedSizes.filter((s) => s === V.moduleSize).length;
      const grown = markedSizes.filter((s) => s === V.moduleSizeMarked).length;
      if (named + grown !== markedSizes.length) {
        faults.push(`the identifier takes a size that is neither token (${markedSizes.join("/")})`);
      }
      if (named > 1) faults.push(`the identifier is named for ${named} beats, not one`);
      for (let i = 1; i < markedSizes.length; i++) {
        if (markedSizes[i] < markedSizes[i - 1]) faults.push("the identifier shrinks");
      }
      if (markedSizes[markedSizes.length - 1] !== V.moduleSizeMarked) {
        faults.push("the identifier never grows");
      }
    }
    out.push({
      name: clears
        ? "the identifier holds its own size; the clearing is what separates it"
        : "the identifier is named at its own size, then grows one increment",
      ok: faults.length === 0,
      detail: faults.length
        ? faults.join("; ")
        : modCount
          ? `${modCount} module mark(s), ${markedCount} marked` +
            (markedSizes.length ? ` at ${markedSizes.join(" -> ")}` : "")
          : "no module in this cell",
    });
  }

  /* ---- Stage text: one register per stage, and it does not narrate (RULES.md §2.12) ----
     A coordinate (`12 codons`) is apparatus; a finding (one line) or a foreclosure (at most two) is the cell
     speaking. The line count comes from the text (more than two words is prose, and undeclared prose fails), since
     `LabelMark.copy` is set by an author who may not know the rule; the flag says which register. Every beat. */
  {
    const labels = (bt: string) => frame(entry, bt).marks.filter((m) => m.kind === "label") as any[];
    const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

    const faults: string[] = [];
    let lines = 0;
    const registers = new Set<string>();
    for (const bt of beats) {
      const prose = labels(bt).filter((m) => words(m.text) > 2 || m.copy);
      const undeclared = prose.filter((m) => !m.copy);
      if (undeclared.length) {
        faults.push(`${bt}: ${undeclared.length} line(s) of prose declaring no register — "${undeclared[0].text}"`);
      }
      const here = new Set(prose.map((m) => m.copy).filter(Boolean));
      here.forEach((r) => registers.add(r as string));
      if (here.size > 1) faults.push(`${bt}: two registers on one stage (${[...here].join(" + ")})`);
      /* the ceiling is read off the declared register: a flat 2 would let a finding grow a second line */
      const ceiling = here.has("finding") && here.size === 1 ? 1 : 2;
      if (prose.length > ceiling) {
        faults.push(`${bt}: ${prose.length} lines of stage copy, ceiling ${ceiling}`);
      }
      lines = Math.max(lines, prose.length);
    }
    out.push({
      name: "stage text is one register, sized to it",
      ok: faults.length === 0,
      detail: faults.length
        ? faults.join("; ")
        : lines
          ? `${lines} line(s), ${[...registers].join("/")}`
          : "no copy on this stage",
    });
  }

  /* Nothing on a stage narrates: "this tool" or "this stage" makes the instrument the subject, and "because" is a
     caption climbing onto the picture. Every label, not just declared copy. `gen-specimens.py` gates the same
     strings at the source; this catches one composed in frames.ts. */
  {
    const FORBIDDEN = ["this tool", "this stage", "because"];
    const hits: string[] = [];
    for (const bt of beats) {
      for (const m of frame(entry, bt).marks as any[]) {
        if (m.kind !== "label") continue;
        for (const bad of FORBIDDEN) {
          if (m.text.toLowerCase().includes(bad)) hits.push(`${bt}: "${m.text}" (${bad})`);
        }
      }
    }
    out.push({
      name: "no narration on a stage",
      ok: hits.length === 0,
      detail: hits.length ? hits.join("; ") : `clear of ${FORBIDDEN.length} forbidden strings`,
    });
  }

  /* A damaged seam rests one full beat before anything else moves (§8.14): its flip lands as its phase ends, the
     instant the next begins, so the beat after a `real` true-to-false flip must be identical to it. Generic, not by
     beat name; cells with no seam pass. */
  {
    const restViolations: string[] = [];
    for (let i = 0; i + 2 < beats.length; i++) {
      const from = frame(entry, beats[i]);
      const to = frame(entry, beats[i + 1]);
      const fromM = new Map(from.marks.map((m) => [m.key, m]));
      const damaged = to.marks.some((m) => {
        if (m.kind !== "seam") return false;
        const f = fromM.get(m.key) as any;
        return f?.kind === "seam" && f.real === true && (m as any).real === false;
      });
      if (!damaged) continue;
      const after = frame(entry, beats[i + 2]);
      if (JSON.stringify(to) !== JSON.stringify(after)) {
        restViolations.push(`${beats[i + 1]} -> ${beats[i + 2]}`);
      }
    }
    out.push({
      name: "a damaged seam rests one full beat before anything else changes",
      ok: restViolations.length === 0,
      detail: restViolations.length ? `changed immediately after damage: ${restViolations.join(", ")}` : "clear",
    });
  }

  // Rest
  const last = JSON.stringify(frame(entry, beats[beats.length - 1]));
  const rest = JSON.stringify(sample(entry, timeline(entry).total + 5000));
  out.push({ name: "rests at the last beat", ok: last === rest });

  // Bounds
  let bad = 0;
  let worst = 0;
  for (const bt of beats) {
    for (const m of frame(entry, bt).marks) {
      for (const n of nums(m)) if (!isFinite(n)) bad++;
      const x = (m as any).x;
      const w = (m as any).w ?? 0;
      if (typeof x === "number") worst = Math.max(worst, -Math.min(0, x), Math.max(0, x + w - V.stageW));
    }
  }
  out.push({ name: "no non-finite geometry", ok: bad === 0, detail: `${bad} bad` });
  out.push({
    name: "paints within the bleed",
    ok: worst <= V.stageBleed + 0.01,
    detail: `worst overhang ${worst.toFixed(2)} of ${V.stageBleed}`,
  });

  return out;
}

export function probe() {
  const cells = [...document.querySelectorAll<HTMLElement>(".cell")].map((el) => {
    const svg = el.querySelector("svg.mk-svg");
    const r = el.getBoundingClientRect();
    /* left and width too, so the capture script can cut one cell out of a two-column grid without a hand crop */
    return {
      cell: el.dataset.cell,
      built: el.dataset.built === "1",
      top: Math.round(r.top + window.scrollY),
      left: Math.round(r.left + window.scrollX),
      width: Math.round(r.width),
      height: Math.round(r.height),
      beat: svg?.getAttribute("data-beat") ?? null,
      marks: svg ? Number(svg.getAttribute("data-marks")) : 0,
    };
  });

  /* Where each lane sits on the page, so the capture script crops to boxes that follow a rewrap. */
  const lanes = [...document.querySelectorAll<HTMLElement>(".lane")].map((el) => {
    const r = el.getBoundingClientRect();
    return {
      lane: el.id.replace("lane-", ""),
      top: Math.round(r.top + window.scrollY),
      left: Math.round(r.left + window.scrollX),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  });

  const invariants = STATES.filter(isBuilt).map((e) => ({
    cell: cellKey(e),
    total: Math.round(timeline(e).total),
    /* A fingerprint per beat: a change to shared plan code is checked against the reference cells by hash, same
       string before and after. The frames themselves are one `?t=` away. */
    sig: e.beats.map((b) => `${b}:${hash(JSON.stringify(frame(e, b)))}`),
    checks: checks(e),
  }));

  const pre = document.createElement("pre");
  pre.id = "__diag";
  pre.style.display = "none";
  pre.textContent = JSON.stringify({
    pageHeight: document.documentElement.scrollHeight,
    pageWidth: document.documentElement.scrollWidth,
    stage: { w: V.stageW, h: V.stageH, bleed: V.stageBleed },
    lanes,
    cells,
    invariants,
  });
  document.body.appendChild(pre);
}
