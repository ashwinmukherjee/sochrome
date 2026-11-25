// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The drafted templates, one set per kind of drawing. The saved copy (json/copy.json) overrides a kind once it is edited there.

export type Line = {
  id: string;
  beat: string | null;
  at?: "start" | "end";
  lag?: number;
  when: string[];
  t: string;
  /** a word in the line: its animation waits until the reader reaches it (schedule.ts pace) */
  cue?: string;
  /** breaths between two changes under this line, in place of the default 1.5 (schedule.ts pace) */
  gap?: number;
  /** what it asserts beyond its slots (claims.ts); [] for nothing; absent: unaudited */
  claims?: string[];
};
/** A kind as the saved copy holds it: `scrub` is its reading-time multiplier; a `seed` status means untouched. */
export type KindState = { lines: Line[]; scrub: number; status: "seed" | "drafting" | "done"; note: string };

/* The voice every template is written in: the room opens on the gene line ({opening}); "This variant";
   a line says what is established and never infers an effect on function; numbers in AP style
   (positions and lengths always numerals); the captions' own terms (codon, exon, amino acid), each
   explained once; "isn't known" only where ClinVar leaves the variant open; American spelling; one
   sentence per line, at most one line per beat. A second drawing in a room opens on where we are
   ("On the protein, …"), not on the gene line again. */

let n = 0;
const L = (beat: string | null, t: string, when: string[] = [], o: Partial<Line> = {}): Line => ({
  id: `s${++n}`,
  beat,
  when,
  t,
  ...o,
});

export const SEED: Record<string, Line[]> = {
  "chain--local-failure": [
    L(null, "{opening}", ["first"], { claims: [] }),
    L("establish", "Its shape has been predicted, but only some parts with confidence.", ["first", "unsure"], {
      claims: ["predicted", "some-confident", "some-unconfident"],
    }),
    L(
      "establish",
      "No prediction of its full shape is available, so it is drawn as a plain line, end to end.",
      ["first", "no-structure"],
      { claims: ["no-full-prediction"] },
    ),
    L(
      "establish",
      "Its shape has been predicted with confidence here, but this part doesn't lie flat enough to draw.",
      ["first", "no-flat"],
      { claims: ["predicted", "site-confident-not-flat"] },
    ),
    L(
      "establish",
      "On the protein, its shape has been predicted, but only some parts with confidence.",
      ["second", "unsure"],
      { claims: ["predicted", "some-confident", "some-unconfident"] },
    ),
    L(
      "establish",
      "No prediction of the protein's full shape is available, so it is drawn as a plain line, end to end.",
      ["second", "no-structure"],
      { claims: ["no-full-prediction"] },
    ),
    L(
      "establish",
      "On the protein, its shape has been predicted with confidence here, but this part doesn't lie flat enough to draw.",
      ["second", "no-flat"],
      { claims: ["predicted", "site-confident-not-flat"] },
    ),
    L(
      "locate",
      "{Variant} swaps a single amino acid, {from} for {to}, at position {site} of {length}.",
      ["first", "swap"],
      { claims: ["one-swap"] },
    ),
    L("locate", "{Variant} removes {n:amino acid} at position {site} of {length}.", ["first", "removes"], {
      claims: ["aa-removed"],
    }),
    L(
      "locate",
      "{Variant} swaps {n:amino acid} side by side, starting at position {site} of {length}.",
      ["first", "swaps"],
      { claims: ["several-in-a-row"] },
    ),
    L("locate", "{Variant} adds {n:amino acid} at position {site} of {length}.", ["first", "adds"], {
      claims: ["aa-added"],
    }),
    L("locate", "The change sits at position {site} of {length}.", ["second"], { claims: [] }),
    L(
      "settle",
      "It lands in a part where the prediction isn't confident, and what the change does there isn't known.",
      ["unsure", "open"],
      { claims: ["site-unconfident", "effect-unknown"] },
    ),
    L("settle", "It lands in a part where the prediction isn't confident.", ["unsure", "classed"], {
      claims: ["site-unconfident"],
    }),
    L("settle", "What the change does to the protein isn't known.", ["no-structure", "open"], {
      claims: ["effect-unknown"],
    }),
    L("settle", "What the change does to that shape isn't known.", ["no-flat", "open"], { claims: ["effect-unknown"] }),
  ],
  "portrait--substitution-contacts": [
    L(null, "{opening}", ["first"], { claims: [] }),
    // On `locate`, where the site marker grows in; the swap darkens under this same line.
    L("locate", "{Variant} swaps a single amino acid, {from} for {to}.", ["one"], { claims: ["one-swap"] }),
    L("locate", "{Variant} swaps two amino acids side by side.", ["two"], { claims: ["two-adjacent"] }),
    L("locate", "{Variant} swaps {n:amino acid} in a row.", ["run"], { claims: ["run-adjacent"] }),
    L("locate", "{Variant} swaps {n:amino acid} within a stretch of {span}.", ["apart"], { claims: ["several-apart"] }),
    // The contacts beat draws a line to each neighbor, so the line points at them, uncounted: a count reads as a score.
    L(
      "contacts",
      "It sits inside the folded protein; the lines join it to what it touches in this stretch.",
      ["buried", "touching"],
      { claims: ["buried", "touches-neighbors"] },
    ),
    L(
      "contacts",
      "It sits on the protein's surface; the lines join it to what it touches in this stretch.",
      ["surface", "touching"],
      { claims: ["surface", "touches-neighbors"] },
    ),
    L(
      "contacts",
      "It sits on the surface, where {partners} binds; the lines join it to what it touches here.",
      ["surface-site", "touching"],
      { claims: ["site-partner", "touches-neighbors"] },
    ),
    L("contacts", "It sits inside the folded protein.", ["buried", "alone"], { claims: ["buried"] }),
    L("contacts", "It sits on the protein's surface.", ["surface", "alone"], { claims: ["surface"] }),
    L("contacts", "It sits on the surface, where {partners} binds.", ["surface-site", "alone"], {
      claims: ["site-partner"],
    }),
    L("settle", "What the swap does to that shape isn't known.", ["buried", "open"], {
      at: "end",
      claims: ["effect-unknown"],
    }),
    L(
      "settle",
      "No other molecule is recorded binding there, and what the swap does isn't known.",
      ["surface", "open"],
      { at: "end", claims: ["no-site-on-record", "effect-unknown"] },
    ),
    L("settle", "No other molecule is recorded binding there.", ["surface", "classed"], {
      at: "end",
      claims: ["no-site-on-record"],
    }),
    L("settle", "Whether the swap changes that binding isn't known.", ["surface-site", "open"], {
      at: "end",
      claims: ["site-partner", "effect-unknown"],
    }),
  ],
  "transcript--foreclosed-junction": [
    L(null, "{opening}", ["first"], { claims: [] }),
    L(
      "locate",
      "Its message is stitched from pieces called exons; to find where one ends, the cell reads these {signal:letter}.",
      ["donor"],
      { claims: ["donor"] },
    ),
    L(
      "locate",
      "Its message is stitched from pieces called exons; to find where one begins, the cell reads these {signal:letter}.",
      ["acceptor"],
      { claims: ["acceptor"] },
    ),
    L("break", "{Variant} changes the cut point itself, so the edge can't be found as written.", ["broken"], {
      claims: ["at-cut-point"],
    }),
    L("hold", "{Variant} changes one of them, so the cut may be made less often.", ["weakened", "single"], {
      claims: ["in-signal", "single-letter-site"],
    }),
    L("hold", "{Variant} removes {letters:letter} here, including some of them.", ["weakened", "many"], {
      claims: ["in-signal"],
    }),
    L("hold", "{Variant} sits just outside them, so the letters the cell reads are unchanged.", ["beside"], {
      claims: ["outside-signal"],
    }),
    L("hold", "Whether the cut changes isn't known.", ["weakened", "open"], { at: "end", claims: ["cut-unknown"] }),
    L("hold", "Whether it affects the cut isn't known.", ["beside", "open"], { at: "end", claims: ["cut-unknown"] }),
    L("hold", "What the cell does instead isn't known.", ["broken", "open"], { at: "end", claims: ["cut-unknown"] }),
  ],
  "transcript--double-agent": [
    L(null, "{opening}", ["first"], { claims: [] }),
    L("mark-both", "{Variant} changes a letter at the edge of an exon, swapping {from} for {to}.", ["swap"], {
      claims: ["exon-edge-letter", "one-swap"],
    }),
    L(
      "mark-both",
      "{Variant} changes a letter at the edge of an exon; the amino acid it spells stays {from}.",
      ["silent"],
      { claims: ["exon-edge-letter", "same-aa"] },
    ),
    L("mark-both", "{Variant} changes a letter at the edge of an exon, and its codon now reads as a stop.", ["stop"], {
      claims: ["exon-edge-letter", "now-stop"],
    }),
    L("mark-both", "{Variant} changes the letters at the edge of an exon.", ["other"], {
      claims: ["exon-edge-letter"],
    }),
    L("hold", "That letter has two jobs: it spells part of a codon, and it helps mark where the message is cut.", [], {
      claims: ["exon-edge-letter"],
    }),
    L("hold", "What the change does to the cut isn't known.", ["open"], { at: "end", claims: ["cut-unknown"] }),
  ],
  "codon--nonsense": [
    L(null, "{opening}", ["first"], { claims: [] }),
    // The letter changes as the line arrives, then the codon flips to a stop under the same line.
    L(
      "swap-cell",
      "{Variant} changes one DNA letter, {ref} to {alt}, and the three-letter codon it sits in now reads as a stop.",
      ["first", "one-letter"],
      { claims: ["one-letter", "now-stop"] },
    ),
    L(
      "swap-cell",
      "{Variant} changes {letters:DNA letter} in a row, and a three-letter codon among them now reads as a stop.",
      ["first", "letters"],
      { claims: ["now-stop"] },
    ),
    L("swap-cell", "Read in three-letter codons, the changed one is now a stop.", ["second"], { claims: ["now-stop"] }),
    // The fate, by the facts stage's rule: destroyed, survives as a shorter or longer protein, or no stop at all.
    L("settle", "The stop comes too early, so the cell destroys the message and no protein is made.", ["no-protein"], {
      at: "end",
      claims: ["message-destroyed"],
    }),
    L(
      "settle",
      "The stop comes near the end, so the message survives and makes a shorter protein.",
      ["then-truncated-fold"],
      { at: "end", claims: ["shorter-protein"] },
    ),
    L(
      "settle",
      "The stop comes near the end, so the message survives and makes a shorter protein.",
      ["then-truncated"],
      { at: "end", claims: ["shorter-protein"] },
    ),
  ],
  "transcript--copies": [
    L(null, "{opening}", ["first"], { claims: [] }),
    L("change", "{Variant} deletes one of your two copies of the gene.", ["one-lost"], { claims: ["one-copy-lost"] }),
    L("settle", "The other copy still makes the protein, but less of it is made.", ["one-lost"], {
      at: "end",
      claims: ["one-copy-lost", "less-protein"],
    }),
    L("change", "{Variant} deletes both copies of the gene, so none of the protein can be made.", ["all-lost"], {
      claims: ["all-copies-lost"],
    }),
    L("change", "{Variant} gives you an extra copy of the gene.", ["gained"], { claims: ["copy-gained"] }),
    L("settle", "With {to:copy/copies}, more of the protein is made.", ["gained"], {
      at: "end",
      claims: ["copy-gained", "more-protein"],
    }),
  ],
  "transcript--piece-deleted": [
    L(null, "{opening}", ["first"], { claims: [] }),
    L(
      "skip-fade",
      "Its message is stitched from pieces called exons; {variant} deletes one of them, {letters:DNA letter} long.",
      [],
      { claims: ["piece-deleted"] },
    ),
    L(
      "regroup",
      "The message is read in three-letter codons, so every codon after the gap is misread.",
      ["thrown-off"],
      { claims: ["frame-thrown"] },
    ),
    L("reveal-stop", "The misreading hits a stop {after:codon} later.", ["thrown-off"], {
      at: "end",
      claims: ["tx-stop-ahead"],
    }),
    L(
      "skip-close",
      "That's exactly {codons:three-letter codon}, so the reading stays in step and the protein is made {codons:amino acid} shorter.",
      ["in-step"],
      { at: "end", claims: ["frame-kept"] },
    ),
  ],
  "transcript--piece-duplicated": [
    L(null, "{opening}", ["first"], { claims: [] }),
    L(
      "admit-intron",
      "Its message is stitched from pieces called exons; {variant} repeats one of them, {letters:DNA letter} long.",
      [],
      { claims: ["piece-duplicated"] },
    ),
    L("regroup", "The message is read in three-letter codons, so every codon after it is misread.", ["thrown-off"], {
      claims: ["frame-thrown"],
    }),
    L("reveal-stop", "The misreading hits a stop inside the copy itself.", ["stop-in-copy"], {
      at: "end",
      claims: ["stop-in-copy"],
    }),
    L("reveal-stop", "The misreading hits a stop {after:codon} later.", ["stop-later"], {
      at: "end",
      claims: ["tx-stop-ahead"],
    }),
    L(
      "settle",
      "That's exactly {codons:three-letter codon}, so the reading stays in step and the protein is made {codons:amino acid} longer.",
      ["in-step"],
      { at: "end", claims: ["frame-kept"] },
    ),
  ],
  "portrait--truncated-fold": [
    L("establish", "On the protein, the stop falls here.", ["second"], { claims: [] }),
    L("identify", "This is the last amino acid made.", [], { claims: ["shorter-protein"] }),
    L("truncate", "Everything after it, {missing:amino acid}, is never made.", [], { claims: ["shorter-protein"] }),
    L("settle", "What the shorter protein can still do isn't known.", ["open"], {
      at: "end",
      claims: ["effect-unknown"],
    }),
  ],
  "portrait--truncated": [
    L("establish", "On the protein, the stop falls here.", ["second"], { claims: [] }),
    L("locate", "This is the last amino acid made, at position {made} of {length}.", [], {
      claims: ["shorter-protein"],
    }),
    L("push-in", "Everything after it, {missing:amino acid}, is never made.", [], { claims: ["shorter-protein"] }),
    L("settle", "What the shorter protein can still do isn't known.", ["open"], {
      at: "end",
      claims: ["effect-unknown"],
    }),
  ],
  "codon--silent": [
    L(null, "{opening}", ["first"], { claims: [] }),
    L("swap-cell", "{Variant} changes a single DNA letter, {ref} to {alt}.", ["first", "plain"], {
      claims: ["one-letter"],
    }),
    L(
      "swap-cell",
      "{Variant} changes one DNA letter, {ref} to {alt}, in the codon where reading starts.",
      ["first", "start-kept"],
      { claims: ["one-letter", "start-now-atg"] },
    ),
    L(
      "swap-cell",
      "{Variant} changes one DNA letter, {ref} to {alt}, in the codon that ends the protein.",
      ["first", "stop-kept"],
      { claims: ["one-letter", "stop-kept"] },
    ),
    L("swap-cell", "Read in three-letter codons, the change is silent.", ["second"], { claims: ["same-aa"] }),
    L("settle", "The codon still spells {from}, so every amino acid in the protein stays the same.", ["plain"], {
      at: "end",
      claims: ["same-aa"],
    }),
    L("settle", "That codon still reads as a stop, so the protein ends where it did.", ["stop-kept"], {
      at: "end",
      claims: ["stop-kept"],
    }),
    L("settle", "That codon still reads as a start, so reading begins where it did.", ["start-kept"], {
      at: "end",
      claims: ["start-now-atg"],
    }),
  ],
  "codon--in-frame-del": [
    L(null, "{opening}", ["first"], { claims: [] }),
    L("delete", "{Variant} removes {letters:DNA letter} in a row: exactly {codons:three-letter codon}.", ["aligned"], {
      claims: ["codon-aligned"],
    }),
    L(
      "delete",
      "{Variant} removes {letters:DNA letter} in a row, cutting across the three-letter codons.",
      ["straddles"],
      { claims: ["codon-straddled"] },
    ),
    L(
      "settle",
      "The reading stays in step, so the rest of the protein is made in full, {codons:amino acid} shorter.",
      ["aligned"],
      { at: "end", claims: ["in-step", "aa-removed"] },
    ),
    L("settle", "The reading stays in step; the codons either side join into a new one.", ["straddles"], {
      at: "end",
      claims: ["in-step", "codon-straddled"],
    }),
  ],
  "portrait--sealed-removal": [
    L("locate", "On the protein, the missing piece was here.", ["second"], { claims: [] }),
    L("remove", "The chain loses {removed:amino acid}.", [], { claims: [] }),
    L("seal", "The chain closes over the gap.", [], { claims: [] }),
    L("settle", "What that does to the shape isn't known.", ["open"], { at: "end", claims: ["effect-unknown"] }),
  ],
  "codon--in-frame-ins": [
    L(null, "{opening}", ["first"], { claims: [] }),
    L("admit", "{Variant} adds {letters:DNA letter}: exactly {codons:three-letter codon}.", ["aligned"], {
      claims: ["codon-aligned"],
    }),
    L("admit", "{Variant} adds {letters:DNA letter}, cutting into a three-letter codon.", ["straddles"], {
      claims: ["codon-straddled", "in-step"],
    }),
    L(
      "settle",
      "The reading stays in step, so the protein is made in full, with {codons:extra amino acid}.",
      ["pure"],
      { at: "end", claims: ["in-step", "aa-added"] },
    ),
    L("settle", "The reading stays in step, but the codon it cuts into now spells something else.", ["rewrites"], {
      at: "end",
      claims: ["in-step"],
    }),
  ],
  "portrait--insertion-bulge": [
    L("establish", "On the protein, the extra piece goes in here.", ["second"], { claims: [] }),
    L("unjoin", "The chain bulges out to make room for it.", [], { claims: [] }),
    L("settle", "What that does to the shape isn't known.", ["open"], { at: "end", claims: ["effect-unknown"] }),
  ],
  "codon--frameshift-del": [
    L(null, "{opening}", ["first"], { claims: [] }),
    L("delete", "{Variant} deletes {letters:DNA letter}.", [], { claims: [] }),
    L("regroup", "The message is read in three-letter codons, so every codon after the gap is misread.", [], {
      claims: [],
    }),
    L("reveal-stop", "The misreading hits a stop {after:codon} later.", ["stop"], {
      at: "end",
      claims: ["stop-ahead"],
    }),
    L(
      "settle",
      "The stop comes too early, so the cell destroys the message and no protein is made.",
      ["stop", "no-protein"],
      { at: "end", claims: ["message-destroyed"] },
    ),
    L(
      "settle",
      "The stop comes near the end, so the message survives and makes a shorter protein.",
      ["stop", "then-truncated-fold"],
      { at: "end", claims: ["shorter-protein"] },
    ),
    L(
      "settle",
      "The stop comes near the end, so the message survives and makes a shorter protein.",
      ["stop", "then-truncated"],
      { at: "end", claims: ["shorter-protein"] },
    ),
    L(
      "settle",
      "The stop comes past the protein's own end, so the message survives and makes a longer protein.",
      ["stop", "then-stop-loss-extension"],
      { at: "end", claims: ["longer-protein"] },
    ),
    L(
      "settle",
      "The misreading never meets a stop, so the cell destroys the message and no protein is made.",
      ["no-stop", "no-protein"],
      { at: "end", claims: ["no-stop-ahead", "no-stop-no-protein"] },
    ),
  ],
  "codon--frameshift-ins": [
    L(null, "{opening}", ["first"], { claims: [] }),
    L("intrude", "{Variant} adds {letters:extra DNA letter}.", [], { claims: [] }),
    L("regroup", "The message is read in three-letter codons, so every codon after it is misread.", [], { claims: [] }),
    L("reveal-stop", "The misreading hits a stop {after:codon} later.", ["stop"], {
      at: "end",
      claims: ["stop-ahead"],
    }),
    L(
      "settle",
      "The stop comes too early, so the cell destroys the message and no protein is made.",
      ["stop", "no-protein"],
      { at: "end", claims: ["message-destroyed"] },
    ),
    L(
      "settle",
      "The stop comes near the end, so the message survives and makes a shorter protein.",
      ["stop", "then-truncated-fold"],
      { at: "end", claims: ["shorter-protein"] },
    ),
    L(
      "settle",
      "The stop comes near the end, so the message survives and makes a shorter protein.",
      ["stop", "then-truncated"],
      { at: "end", claims: ["shorter-protein"] },
    ),
    L(
      "settle",
      "The stop comes past the protein's own end, so the message survives and makes a longer protein.",
      ["stop", "then-stop-loss-extension"],
      { at: "end", claims: ["longer-protein"] },
    ),
    L(
      "settle",
      "The misreading never meets a stop, so the cell destroys the message and no protein is made.",
      ["no-stop", "no-protein"],
      { at: "end", claims: ["no-stop-ahead", "no-stop-no-protein"] },
    ),
  ],
  "codon--start-loss": [
    L(null, "{opening}", ["first"], { claims: [] }),
    L("locate", "{Variant} changes the three-letter codon where reading starts, {startFrom} to {startTo}.", [], {
      claims: ["start-changed"],
    }),
    // Then where reading begins instead, by the scanning rule.
    L("hold", "Reading can't begin where it should.", [], { at: "end", claims: ["start-changed"] }),
    L(
      "hold",
      "It begins instead at the next start, so the protein is made without its first {lost:amino acid}.",
      ["restart-in-step"],
      { claims: ["restart-in-step"] },
    ),
    L(
      "hold",
      "The next start is out of step, so the message is misread and no working protein is made.",
      ["restart-out-of-step"],
      { claims: ["restart-out-of-step"] },
    ),
    L("hold", "No later start follows, so no protein is made.", ["no-restart"], { claims: ["no-restart"] }),
    L("hold", "What losing that beginning does isn't known.", ["restart-in-step", "open"], {
      claims: ["restart-in-step", "effect-unknown"],
    }),
  ],
  "codon--stop-loss": [
    L(null, "{opening}", ["first"], { claims: [] }),
    // `read-past` has no line, so it plays under this one, after a doubled pause (`gap`) so the new letter registers first.
    L(
      "dissolve-stop",
      "{Variant} changes the three-letter codon that ends the protein, so reading runs on past it.",
      [],
      { gap: 3, claims: ["stop-lost"] },
    ),
    L("reveal-stop", "It meets a new stop {extra:codon} later.", ["new-stop"], { at: "end", claims: ["stop-ahead"] }),
    L(
      "settle",
      "No new stop comes, so the cell destroys the message and no protein is made.",
      ["no-stop", "no-protein"],
      { at: "end", claims: ["no-stop-ahead", "no-stop-no-protein"] },
    ),
    L("settle", "The message survives, so a longer protein is made.", ["new-stop"], {
      at: "end",
      claims: ["longer-protein"],
    }),
  ],
  "portrait--stop-loss-extension": [
    L("identify", "On the protein, this was the last amino acid.", ["second"], { claims: [] }),
    L("extend", "Now {extension:amino acid} more follow it.", [], { claims: [] }),
    L("settle", "What the extra length does isn't known.", ["open"], { at: "end", claims: ["effect-unknown"] }),
  ],
};
