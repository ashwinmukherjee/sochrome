// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The registry: every cell of the four lanes in sheet order. The sheet iterates it, the lanes dispatch on it, and
// nothing else holds a list of states. Names and notes ship verbatim from reference/p1-system-attachment.md.

export type LaneId = "codon" | "transcript" | "chain" | "portrait";

/** A beat is a named phase of the specimen's argument; frames.ts gives it geometry and motion tokens its timing.
 *  Anchors are single-beat. A variant cell opens windowed on `establish` and ends on `settle`, or on `hold` where
 *  nothing may resolve (foreclosure is stillness, never invented geometry). A rest beat (`hold`, `dwell`) draws the
 *  frame before it, so two events never land back to back (§8.14). */
export type BeatName = string;

/** What the cell is a specimen OF. `id` is null where the brief says the
 *  variant is still to be picked; `unresolved` marks that visibly on the
 *  sheet rather than letting a placeholder read as a decision. */
export interface Specimen {
  /** stable slug used as a frame key and a DOM id; null while unpicked */
  id: string | null;
  /** what prints in the cell's mono id line */
  label: string;
  gene?: string;
  /** HGVS or locus as the attachment gives it */
  variant?: string;
  /** true = the attachment says "[NEW — pick …]"; no molecular numbers exist yet */
  unresolved?: boolean;
}

export interface StateEntry {
  lane: LaneId;
  /** the state name, verbatim */
  state: string;
  specimen: Specimen;
  /** the state note, verbatim from the attachment */
  notes: string;
  /** named phase sequence; the cell rests at the last, click replays from the first */
  beats: BeatName[];
  /** built this pass as its lane's reference implementation */
  reference?: boolean;
  /** documentation-only cell: it exists to show the routing, not to ship */
  docOnly?: boolean;
  /** one of the attachment's open decisions, rendered as an a/b pair */
  openDecision?: string;
  /** Which drawing, when it is not the state name. A variant registered from facts (lib.ts `mountVariant`) has a
   *  state of its own, `v:<id>`, and names the built cell whose drawing and beats it takes. Absent on built cells. */
  kind?: string;
}

/* ---- Lane 1, codon: 8 cells ---- */

const CODON: StateEntry[] = [
  {
    lane: "codon",
    state: "anchor",
    specimen: { id: "codon-anchor", label: "BRCA1 CDS", gene: "BRCA1" },
    notes: "The code reading normally, every three-letter group solid and on the beat.",
    beats: ["establish"],
  },
  {
    lane: "codon",
    state: "frameshift-del",
    specimen: {
      id: "brca1-185delag",
      label: "BRCA1 185delAG",
      gene: "BRCA1",
      variant: "c.68_69delAG",
    },
    notes:
      "Two letters vanish; everything after regroups wrong and lands off-beat; a stop that was always hiding in the shifted reading appears early.",
    /* Move, then colour: every frameshift moves all its groups on `regroup`, then turns them hollow left to right,
       whole codons, on `misread`, so a codon's letters never turn at different times. */
    beats: ["establish", "delete", "regroup", "misread", "reveal-stop", "settle"],
    reference: true,
  },
  {
    lane: "codon",
    state: "frameshift-ins",
    specimen: {
      id: "brca1-5266dupc",
      label: "BRCA1 c.5266dupC",
      gene: "BRCA1",
      variant: "c.5266dupC",
    },
    notes: "One letter arrives; same wrong regrouping; hidden stop revealed.",
    beats: ["establish", "intrude", "regroup", "misread", "reveal-stop", "settle"], // misread: colour after the slide
  },
  {
    lane: "codon",
    state: "nonsense",
    specimen: {
      id: "brca2-k3326x",
      label: "BRCA2 K3326X",
      gene: "BRCA2",
      variant: "c.9976A>T",
    },
    notes: "One group flips directly to stop; nothing moves, nothing regroups; reading simply ends.",
    // no `regroup`: the absence of regrouping is the mechanism, so a beat
    // between the flip and the settle would stage a cause with no effect.
    /* `swap-cell` before `flip-stop`: the letter changes, then the codon it sits in reads as a stop. Same beat and
       mark as `silent`'s. */
    beats: ["establish", "swap-cell", "flip-stop", "settle"],
  },
  {
    lane: "codon",
    state: "in-frame-del",
    specimen: {
      id: "cftr-f508del",
      label: "CFTR F508del",
      gene: "CFTR",
      variant: "c.1521_1523delCTT",
    },
    notes:
      "A whole group leaves; neighbors close; downstream slides but re-lands on the beat, still solid: shorter, not scrambled.",
    beats: ["establish", "delete", "reflow", "settle"],
  },
  {
    lane: "codon",
    state: "in-frame-ins",
    specimen: {
      id: "cftr-l138dup",
      label: "CFTR c.413_415dup",
      gene: "CFTR",
      variant: "c.413_415dup",
    },
    notes: "A whole group arrives; downstream slides out but stays on beat: longer, not scrambled.",
    beats: ["establish", "admit", "reflow", "settle"],
  },
  {
    lane: "codon",
    state: "silent",
    specimen: {
      id: "brca1-s1436",
      label: "BRCA1 S1436=",
      gene: "BRCA1",
      variant: "c.4308T>C",
    },
    notes: "One letter changes inside a group that still spells the same thing; nothing else reacts.",
    beats: ["establish", "swap-cell", "settle"],
  },
  {
    lane: "codon",
    state: "stop-loss",
    specimen: {
      id: "palb2-ter1187gln",
      label: "PALB2 c.3559T>C",
      gene: "PALB2",
      variant: "c.3559T>C",
    },
    notes:
      "The final stop dissolves; reading runs past the true end into material never meant to be read, until a chance stop.",
    beats: ["establish", "dissolve-stop", "read-past", "reveal-stop", "settle"],
  },
];

/* ---- Lane 2, transcript: 7 cells ---- */

const TRANSCRIPT: StateEntry[] = [
  {
    lane: "transcript",
    state: "establishing",
    specimen: { id: "brca1-transcript", label: "BRCA1 MANE", gene: "BRCA1" },
    notes: "The whole gene end to end, one tick where the variant lives; position and scale, nothing else.",
    // single-beat: it is the establishing frame, and the only cell drawn at full scale (`establish-full`).
    beats: ["establish-full"],
  },
  {
    lane: "transcript",
    state: "foreclosed-junction",
    specimen: {
      id: "brca1-5074p3",
      label: "BRCA1 c.5074+3A>C",
      gene: "BRCA1",
      variant: "c.5074+3A>C",
    },
    notes:
      "A cut-site is damaged; every block intact; which repair the cell attempts is unmeasured, and the stillness is the honest render.",
    beats: ["establish", "locate", "hold"], // O1 close-up: weakened, so no break beat
  },
  {
    lane: "transcript",
    state: "skip-frame-broken",
    specimen: {
      id: "brca1-547p1",
      label: "BRCA1 c.547+1G>T",
      gene: "BRCA1",
      variant: "c.547+1G>T",
    },
    notes: "A block bypassed, seam closed; downstream seams land between ticks, regrouped hollow, stop sliver lands.",
    /* Two rest beats (§8.14). `hold` after `break-seam`: the seam's flip lands at its own phase's end, so without it
       the bypassed exon's fade would start with no beat showing the damage at rest. `dwell` after `skip-close`: copy
       lands a breath before its beat, so the line about the reading thrown off needs the strip rejoined and still
       first. A name appears once per list (`pastOf` is an `indexOf`), hence two names; `hold` takes `durEstablish`,
       `dwell` `durBeat`. */
    beats: ["establish", "break-seam", "hold", "skip-fade", "skip-close", "dwell", "regroup", "reveal-stop", "settle"],
    reference: true,
  },
  {
    lane: "transcript",
    state: "skip-frame-kept",
    specimen: {
      id: "brca1-5152p1",
      label: "BRCA1 c.5152+1G>T",
      gene: "BRCA1",
      variant: "c.5152+1G>T",
    },
    notes: "Same bypass, but the length divides evenly; downstream re-lands on ticks, stays solid.",
    // no reveal-stop: nothing terminates, which is the whole contrast with the cell above it.
    // `hold` after `break-seam`: the rest beat, as on `skip-frame-broken`.
    beats: ["establish", "break-seam", "hold", "skip-fade", "skip-close", "settle"],
  },
  /* The only candidate in the four genes whose retention is stated as a number (59 nt, ENIGMA 3*); the argument is in
     tools/fetch-variants.py. Its note's "a stop waits inside them" is false of it (the stop is 44 nt past, in exon 7)
     and ships verbatim; `deep-intronic` is the cell that stops inside admitted material.
     Open decision 3, answered: the stop is drawn at block scale and the intrusion splits at it, the admission's dash
     before the sliver and the unread rung after (paint.tsx `blockStyle`). */
  {
    lane: "transcript",
    state: "retain",
    specimen: {
      id: "brca1-442m22",
      label: "BRCA1 c.442-22_442-13del",
      gene: "BRCA1",
      variant: "c.442-22_442-13del",
    },
    notes:
      "The seam never closes; intervening letters ride in (foreshortened); a stop waits inside them; added length overhangs the last tick.",
    /* Three effects, three beats: downstream turns hollow (`regroup`, as `skip`'s misread does), then the stop fades
       in (`reveal-stop`), then the segment past it dims to unread (`settle`, where `reachBeat` lands). `hold` after
       `seam-fails` is the rest beat, so the seam's failure rests before material rides in. */
    beats: ["establish", "seam-fails", "hold", "admit-intron", "regroup", "reveal-stop", "settle"],
  },
  /* Decision 4, answered: no point mark. `reveal` opens the gap onto the intron as a foreshortened hairline,
     `mark-chunk` picks the captured run out at its own address, and `splice-in` cuts the rest away, so the intron
     either side shows where the material came from; the variant's point is already drawn twice (the chunk's 3' edge,
     the dashed seam it seats through). The motion is retain's, except this join is made, so the gap opens first and
     closes onto the chunk, with dashed seams at both its edges (RULES.md §3.6). */
  {
    lane: "transcript",
    state: "deep-intronic",
    specimen: {
      id: "brca1-4185p4105",
      label: "BRCA1 c.4185+4105C>T",
      gene: "BRCA1",
      variant: "c.4185+4105C>T",
    },
    notes:
      "Far from any seam, the variant manufactures a new cut-site; a false block splices in through joins that never existed in the gene.",
    /* no `regroup`: 114 nt is a whole number of codons, so nothing downstream is misread; its absence is the in-frame
       claim, as on `skip-frame-kept`.
       `reveal` opens the gap and nothing else; `mark-chunk` then picks the run out, nothing moving, so the chunk is
       seen still at its own address before it is carried anywhere. The seam lets go inside `reveal` (§8.49a): absent
       there, its existence fade spends `durMove` at the phase's start while the blocks slide (`opening` in
       `transcriptFrame`). `hold` between them is the rest beat, so the next line of copy lands on a still gap. */
    beats: ["establish", "reveal", "hold", "mark-chunk", "splice-in", "reveal-stop", "settle"],
  },
  {
    lane: "transcript",
    state: "double-agent",
    specimen: {
      id: "brca1-4185ga",
      label: "BRCA1 c.4185G>A",
      gene: "BRCA1",
      variant: "c.4185G>A",
    },
    notes: "One letter that both spells and signs; harmless by spelling, suspect by address; both marks, no verdict.",
    // ends on hold, not settle: no outcome is claimed, so nothing may resolve.
    beats: ["establish", "mark-both", "hold"],
  },
  /* Dosage is refused, not deferred: the product declines copy-number change in a sentence rather than drawing it,
     so the sheet shows no treatment for it (see OUT_OF_SCOPE). */
];

/* ---- Lane 3, chain: 3 cells ---- */
/* Nothing displaces here, so the only event is the address arriving. `establish` draws the profile with both
   registers and every taper already present (confidence is measured, not an event), `locate` lands the bead, `dwell`
   rests, `settle` is stillness. The notes say "tick" where the render draws a bead; notes ship verbatim, so the fix
   belongs upstream (RULES.md §7.11). */
const CHAIN: StateEntry[] = [
  {
    lane: "chain",
    state: "local-failure",
    specimen: {
      id: "palb2-h83d",
      label: "PALB2 H83D",
      gene: "PALB2",
      variant: "c.247C>G",
    },
    notes: "Map solid at both ends, dissolved in the middle, tick standing on the dissolved stretch.",
    /* `dwell` after `locate`, the lane's rest beat: `establish` draws nothing new, so without it the reader waits on a
       still picture and the closing line hands off as the bead arrives. It draws the `locate` frame. */
    beats: ["establish", "locate", "dwell", "settle"],
    reference: true,
  },
  {
    lane: "chain",
    state: "loose-tails",
    specimen: {
      id: "tp53-p72r",
      label: "TP53 P72R",
      gene: "TP53",
      variant: "c.215C>G",
    },
    notes: "Strong core, unstructured tails, tick in a tail: the variant lives outside the foldable world.",
    // `dwell` after `locate`: the lane's rest beat (see `local-failure`).
    beats: ["establish", "locate", "dwell", "settle"],
  },
  {
    lane: "chain",
    state: "solid-ground",
    specimen: {
      id: "brca1-c61g",
      label: "BRCA1 C61G",
      gene: "BRCA1",
      variant: "c.181T>G",
    },
    notes: "Tick on solid line: what routing to the portrait looks like; proves the gate reads from data.",
    // `dwell` after `locate`: the lane's rest beat (see `local-failure`).
    beats: ["establish", "locate", "dwell", "settle"],
    /* docOnly: built for the sheet, excluded from dispatch. Its subject is the routing decision (pLDDT at the site is
       above `plddtSolid`, so the variant goes to the portrait lane), which the system makes rather than shows a
       reader. The smoke asserts exactly one docOnly cell, in this lane. */
    docOnly: true,
  },
];

/* ---- Lane 4, portrait: 8 cells ---- */

const PORTRAIT: StateEntry[] = [
  /* The anchor draws a `foldWindow` centred on the variant (the argument is at `foldWindow` in tokens.ts). Its note
     still describes one drawing per gene and ships verbatim; owed upstream (RULES.md §7.18). */
  {
    lane: "portrait",
    state: "anchor",
    specimen: { id: "brca1-anchor", label: "BRCA1 · per-gene anchor", gene: "BRCA1" },
    notes:
      "The domain drawn once per gene, same frozen projection always; every other state is this drawing plus exactly one operation.",
    beats: ["establish"],
    reference: true,
  },
  {
    lane: "portrait",
    state: "substitution-contacts",
    specimen: {
      id: "brca1-c61g",
      label: "BRCA1 C61G",
      gene: "BRCA1",
      variant: "c.181T>G",
    },
    notes: "The changed residue dark, hairlines to what it touches across the fold: what this position holds.",
    /* `locate` darkens the residue inside its clear ground at its own size; `substitute` grows it, and here the
       growth is the substitution. `substitute` keeps its name because the deck's copy schedule anchors a line to it by
       name (`MS_CLAIMS`); `locate` carries no line, a silent beat by design (`tools/graft-anchors.sh`). */
    beats: ["establish", "locate", "substitute", "contacts", "settle"],
  },
  {
    lane: "portrait",
    state: "sealed-removal",
    specimen: {
      id: "cftr-f508del",
      label: "CFTR F508del",
      gene: "CFTR",
      variant: "c.1521_1523delCTT",
    },
    notes: "One module out, chain closed, tick at the seam.",
    /* `establish` is the reference; `locate` darkens the residue (the chain lane's name for an address arriving,
       §3.6a); `identify` grows it, a beat of its own because ink lands at its beat's end and one beat would swell the
       residue before it darkened (see `tweenMark`'s size hold). `dwell` rests before the removal so the residue isn't
       shown and then lost in one breath; it draws the `identify` frame (`foldSealedRemoval` asks `pastOf`, §8.34). */
    beats: ["establish", "locate", "identify", "dwell", "remove", "seal", "settle"],
  },
  {
    lane: "portrait",
    state: "insertion-bulge",
    specimen: {
      id: "cftr-l138dup",
      label: "CFTR c.413_415dup",
      gene: "CFTR",
      variant: "c.413_415dup",
    },
    notes: "Added modules detour out and return; adjacency claimed, geometry not.",
    /* One event per beat. No `locate`: the subject is the residue that arrives and 138 is only its address, so the
       identifier comes up with it on `arrive`. `arrive` precedes `unjoin` because the other order would show, for a
       beat, `sealed-removal`'s `remove` frame: two cells claiming different variant classes with one picture. */
    beats: ["establish", "arrive", "unjoin", "detour", "return", "settle"],
  },
  {
    lane: "portrait",
    state: "truncated",
    specimen: {
      id: "brca2-k3326x",
      label: "BRCA2 K3326X",
      gene: "BRCA2",
      variant: "c.9976A>T",
    },
    notes: "The chain simply ends; nothing after, because the rest was never made.",
    /* No structure map, so the cell renders on the chain register (§2.13): order and length, a let-go line to the
       stop, all measured, with the chain lane's beats; `locate` lands the bead on the last residue there is. Not
       `absent`: this protein is made (NMD escape is measured, Rafnar 2018), so it draws. */
    beats: ["establish", "locate", "push-in", "settle"], // push-in: moves in on the protein's end
  },
  {
    lane: "portrait",
    state: "stop-loss-extension",
    specimen: {
      id: "palb2-ter1187gln",
      label: "PALB2 c.3559T>C",
      gene: "PALB2",
      variant: "c.3559T>C",
    },
    notes: "The chain runs past its true end in dashed modules.",
    // `locate` names residue 1186, the last there is, and `identify` grows it, as on `sealed-removal`: the extension
    // runs off a finished identifier, not one still arriving.
    beats: ["establish", "locate", "identify", "extend", "settle"],
  },
  {
    lane: "portrait",
    state: "registers",
    specimen: { id: "straddle-window", label: "straddle window", gene: "BRCA1" },
    notes: "One chain straddling solid-confident and hollow-unsure stretches.",
    // single-beat like the anchors: it states a condition of the material,
    // it does not perform an operation on it.
    beats: ["establish"],
  },
  {
    lane: "portrait",
    state: "absent",
    specimen: {
      id: "brca1-r1443x",
      label: "BRCA1 R1443X",
      gene: "BRCA1",
      variant: "c.4327C>T",
    },
    notes: "The framed empty stage with its label: no protein made, emptiness as a designed state.",
    // single-beat, load-bearing: an absent product is never drawn and then
    // erased. Erasing it would say it was made.
    beats: ["establish"],
  },
];

export const STATES: StateEntry[] = [...CODON, ...TRANSCRIPT, ...CHAIN, ...PORTRAIT];

export const LANES: { id: LaneId; index: number; title: string; note: string }[] = [
  {
    id: "codon",
    index: 1,
    title: "codon",
    note: "Fill answers one question: is this codon read as intended.",
  },
  {
    id: "transcript",
    index: 2,
    title: "transcript",
    note: "Gaps between blocks are intron positions; intrusions and pseudo-exons materialize in gaps.",
  },
  {
    id: "chain",
    index: 3,
    title: "chain",
    note: "Integrity encodes confidence: solid where the structure map is reliable, dissolving where not.",
  },
  {
    id: "portrait",
    index: 4,
    title: "portrait",
    note: "Anchor-diff grammar: every state is the anchor plus exactly one operation.",
  },
];

/** Refused, not deferred. A deferred state needs a rule before it gets a cell; an out-of-scope state is not drawn
 *  even when the rule exists, because drawing it would claim a competence the product lacks, so its answer is the
 *  sentence the tool says. `regulatory` arguably belongs here too; moving it is the attachment's call. */
export const OUT_OF_SCOPE: { name: string; statement: string }[] = [
  {
    name: "dosage / copy-number",
    statement:
      "Changes in the number of copies of a gene — duplications, deletions of " +
      "whole genes or larger stretches — are outside the domain this tool " +
      "covers. It reads one transcript at a time and says what happens to the " +
      "message; a change in how many copies of the gene there are is a " +
      "different question, and the tool does not answer it.",
  },
];

/** Named, not built: the strip under lane 4. Text only, no cells. */
export const DEFERRED: { name: string; note?: string }[] = [
  { name: "leaky-splice", note: "false render currently shipping; first post-pilot" },
  { name: "regulatory" },
  { name: "refusal-multi-cause" },
  { name: "interface-vs-buried" },
  { name: "start-loss" },
];

/** The attachment's open decisions, printed beside the cells that carry them. Closed ones stay on the list: a
 *  decision that vanishes reads as one never asked. */
export const OPEN_DECISIONS: string[] = [
  "dosage extra-copy mark: weight vs count-mark (hollow now reserved) — a/b cells. DISSOLVED, not decided: the tool does not draw copy-number change at all, it declines it in a sentence, so there is no extra-copy mark to choose a treatment for. Both cells deleted; see OUT_OF_SCOPE",
  "dim-solid vs faint collapse (transcript never-reached registers). DECIDED: collapse — never-reached material loses its fill and keeps a faint outline, every lane",
  "retain's interior stop: block scale vs post-zoom only. DECIDED (retain settle, 2026-08-15): block scale — the stop is drawn and the intrusion it sits in splits at the sliver, strong+dashed before it, shared faint rung after. -b, which drew no sliver and let the dimming alone carry the claim, is deleted rather than left standing beside the decided cell",
  "deep intronic circle: manufactured seam vs true variant position. DECIDED (deep-intronic single version, 2026-08-15; the mark deleted outright 2026-08-16): NEITHER — no point mark at all. The two treatments were arguing over how to draw one point, and for this specimen they are the same point: the variant MAKES the donor, so the variant's own address and the manufactured seam are the same nucleotide. The strip already draws it twice without a glyph of its own — as the chunk's 3' edge on `mark-chunk`, and as the dashed `seam-hi` the chunk seats through on `splice-in`. A third mark saying it a third time in a third weight is exactly the mistake the junction circle was deleted for. What the pair's `-b` half was really right about survives as a BEAT rather than a mark: `reveal` opens the gap onto the whole intron as a foreshortened hairline, and the chunk is then placed inside it by its own two flanking runs in true proportion — so where in the intron the material came from is shown by the run either side of it, not asserted by a tick. Both cells deleted; one cell, five beats after establish",
  "insertion intrusion dashed-hollow at codon scale: keep vs narrower-solid vs seam tick. DECIDED: none of the three — the intrusion is solid and marked by its entrance",
  "chain termini: ENDCAPS vs CLEAN STOP, rendered as local-failure-a/-b on 2026-08-21. DECIDED 2026-08-22: the CLEAN STOP; -a's serif is deleted along with its `PathMark.endcap` flag and the `terminalTick` token, so nothing on the sheet is left unreachable. The question was real — this lane has claimed in prose since brief 1 that `the protein genuinely ends`, every other lane spends a bleed rule on telling a reader where material stops and the frame begins, and this lane has none to spend. What settles it is LAYOUT rather than glyphs: since the grounding pass this register is `chainLineSpan` of its stage and CENTRED, with 96px of clear ground either side, so nothing about it can read as cropped. The bleed rules exist for registers that run to their own frame edge. The endcap would have answered a question the layout had already answered, and paid for it with a second glyph on a register whose austerity is the point",
  "chain hold caps: BAR vs ROUND, rendered as local-failure-a/-b on 2026-08-21. DECIDED THE SAME DAY: the BAR, applied to every held run in every chain cell; -b is deleted rather than left standing beside a decided cell. A round cap extends a stroke by half its width past each end, so a held run drawn round is `chainHoldStroke` longer than the residues it stands for: 2px at four hairlines, which is +29% on `solid-ground`'s 6.8px coiled-coil run and +105% on `local-failure`'s own 1.9px ChAM fragment. On a long run the two are indistinguishable; the question was whether a lane whose entire subject is WHERE the structure map holds may overstate every held region by one stroke width, and it may not. `square` was never on the ballot: it is flat AND extended, the same error with a different shape. The winning treatment is now assigned in paint.tsx from the register — a cell states what a run IS and the paint layer decides how a hold is capped — so no cell carries a cap flag",
];

export const statesFor = (lane: LaneId): StateEntry[] => STATES.filter((s) => s.lane === lane);

export const cellKey = (s: StateEntry): string => `${s.lane}--${s.state}`;
