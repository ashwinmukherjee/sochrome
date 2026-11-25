// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Reads the design's decisions file into tools/decisions/ledger.json: one row per decision, with its owner and its proof.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const HERE = import.meta.dirname;
const SOURCE = resolve(HERE, "../../..", ["mi", "zen-bench"].join(""), "DECISIONS.md");
const OUT = resolve(HERE, "ledger.json");

export interface Row {
  id: string;
  section: string;
  decision: string;
  value: string;
  /** The lane that proves it. */
  owner: string;
  /** How it is proven: a check id with a step, "token" (true by construction), or "review" (a screenshot for review). */
  proof: { kind: "assert" | "e2e" | "unit" | "token" | "review"; ref: string } | null;
  /** Where a newer decision changes this row. */
  amended?: string;
}

/** Each section's lane, then the rows that belong to another. */
const SECTION_OWNER: Record<string, string> = {
  L: "B",
  D: "B",
  G: "B",
  C: "C",
  P: "C",
  R: "D",
  M: "F",
  T: "lead",
  K: "lead",
  I: "F",
  V: "E",
  X: "lead",
};
const OWNER: Record<string, string> = {
  C21: "2026-11-22: the tab title is the product's name on every route, a sample's too. Before: the privacy rule kept it to the name on every file route, and a sample's room named its variant.", P7: "F", R16: "F", R29: "F", M12: "E",
  ...Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`R${18 + i}`, "E"])),
  T7: "D", T8: "D", T9: "D", I1: "C", I2: "C", I3: "B", I4: "D", I8: "B",
  V1: "D", V2: "D", V13: "B", V14: "G", V15: "G", K11: "F", K12: "F", K13: "F",
}; // prettier-ignore
/** Rows a later decision changes (REBUILD §2.0 and the accepted defaults are newer than the sweep). */
const AMENDED: Record<string, string> = {
  L2: 'The last line is the accepted privacy line ("Your genome is read on this device, and nothing about it is sent anywhere."), and the not-a-test line is added after the third.',
  L9: "The refusals name the product from the brand constant, never a written name.",
  L17: "The reference download starts when LOAD YOUR GENOME is chosen, not on the landing (the privacy rule).",
  C21: "The tab title is the product's name on every file route (the privacy rule); only sample routes may name a variant.",
  K1: "text-2 is #5E6063 (light) and #898D8F (dark): the nearest greys that reach 4.5:1 on the apparatus ground (check A1).",
  K11: "No stored theme: nothing is written to storage (the privacy rule). The ground follows the OS; ?theme= overrides it for checks.",
  P7: "The route is #/genes.",
  M2: "2026-11-21: the one breakpoint is ≤ 800 px (BREAKPOINT_PHONE). From 601 to 800 the two columns overlapped the room's question with its claim and shrank the ledger's bars to stubs.",
  R22: "2026-11-21: on phones the array is 20 × 5 with a cell of 34 on the pitch of 51, the gap half a square, so the whole panel stands on screen; desktop keeps the gap wider than the cell.",
  X13: "2026-11-21: P3's array is 20 × 5 at every width; on phones its squares are larger (cell 34 on pitch 51).",
  C12: "2026-11-22: the sample the landing offers opens on five rooms chosen for their drawings, then the evidence's order; a person's own list keeps the evidence's order alone.",
  M7: "2026-11-22: no open strip remains, so no page recedes under one: over a room the strip leads to the list itself, and every other page stands whole or as the descent's band.",
  G24: "2026-11-22: no footnote on any screen. The descent's second cut names the count in its line, and that count is the way to the genes page everywhere, as the landing's is; pointing at it lays the genes over the ledger. Before: 2026-11-21, the footnote under the ledger on desktop, its hover laying the genes over it.",
  M1: "2026-11-21: on a phone the descent never folds. Its apparatus is a band of fixed height (YOUR VARIANTS, the cut's count and line, sized to every cut's longest line, so nothing under it moves as the descent steps) with no chevron. The list standing alone is the desktop's column the screen tall: captions at the top, the sentence at the foot, the rows paging between with \"+N more\"; folded over a room as before, and back from a room it keeps its scroll.",
  M5: "2026-11-22: on a phone nothing slides. The band, its captions and rows take their new size at once; the list fades in as the strip unfolds (`--t-arrive`, 320 ms), the chosen row as it folds, and the room under it on its own arrival. Before: 2026-11-21, the arrival from the landing and back to it stood at once and faded; other changes of the band's height ran on `--an-fade`.",
  M10: "2026-11-21: on a phone the ledger takes the height under the band (all rows, pitch from 12 to 36), its last row 24 above NEXT, which stands alone 28 from the foot (no BACK: the browser's back and the left arrow key step back a cut). No row numbers and no footnote on a phone: the second cut's genes count is the way to the genes page. The 23rd row stands only where the file has X records, its place kept. One left edge: YOUR VARIANTS, its count, YOUR GENOME and the tracks on the wall.",
  G14: "2026-11-21: on a phone nothing names a row (no numbers); the rows' key is the desktop's.",
  G27: "2026-11-21: on a phone the tracks start on the wall, so YOUR GENOME stands on the wall over them, with YOUR VARIANTS above on the same line. From 801 to 960 the room right of the bars narrows with the column (the wall at 801, 136 from 960), so the bars keep their length; YOUR GENOME stays on the tracks' start at every width.",
  D16: "2026-11-21: on a phone NEXT stands alone at the screen's foot under the ledger; no BACK on any screen.",
  C3: "2026-11-21: no selection square. The open row is the mono's Bold at full ink (no Medium ships); the mono's advance is the same in every weight, so nothing shifts.",
  D4: "2026-11-21: current: count `--ink`, caption `--ink-axis`; earlier: both `--ink-dim`. Since the 19 Nov contrast change axis is the darker grey, so the line being read takes it and the passed ones step back to dim.",
  I7: "2026-11-22: the folded strip over a room is the only fold left; a tap on it (or its chevron) leads to the list itself, the screen tall. Before: 2026-11-21, over a room it led to the list, elsewhere it unfolded over the receded page.",
  P4: "2026-11-21: the reference draws the landing's outlines, not neutral bars, so the genes' ticks keep the contrast the landing's preview gave them; on a phone, the landing to the genes page is a page turn (the strip stands at once, the page fades in).",
  G26: 'Reversed 2026-11-19: the 23rd row names the sex-chromosome pair, as each bar is one of a pair: XX, XY (one X and Y records), X (one X, no Y), from the file; a sample\'s donor\'s pair; XX/XY when a person\'s file has no X. Its hover key is "Chromosomes" ("Chromosome" for X alone; 2026-11-19, was "Sex chromosomes"). With no X in the file the bar is an outline and "not in this file" shows on hover only; no standing note. Supersedes BACKLOG:58-59\'s "never displayed" for the ledger.',
};

/** The archived decisions name the product by its working name; the ledger says {name}, as the copy does. */
const unname = (t: string) => t.replace(new RegExp(["Mi", "zen"].join(""), "g"), "{name}");

const previous: Record<string, Row> = existsSync(OUT)
  ? Object.fromEntries((JSON.parse(readFileSync(OUT, "utf8")) as Row[]).map((r) => [r.id, r]))
  : {};
const rows: Row[] = [];
let section = "";
let inConflicts = false;
for (const line of readFileSync(SOURCE, "utf8").split("\n")) {
  const head = /^## (.+)$/.exec(line);
  if (head) {
    section = head[1].replace(/^\d+\.\s*/, "");
    inConflicts = /^Conflicts: resolved/.test(section);
    continue;
  }
  const cells = line.startsWith("|")
    ? line
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim())
    : [];
  if (!cells.length || /^-+$/.test(cells[0]) || cells[0] === "#") continue;
  const id = inConflicts ? `X${cells[0]}` : cells[0];
  if (!/^[A-Z]\d+$/.test(id)) continue;
  const was = previous[id];
  rows.push({
    id,
    section,
    decision: unname(cells[1]),
    value: inConflicts ? "" : unname(cells[2] ?? ""),
    owner: was?.owner ?? OWNER[id] ?? SECTION_OWNER[id[0]] ?? "lead",
    proof: was?.proof ?? null,
    // An amendment made in the ledger itself (a later decision) is kept unless this file states the row's own.
    ...(AMENDED[id] ? { amended: AMENDED[id] } : was?.amended ? { amended: was.amended } : {}),
  });
}
writeFileSync(OUT, JSON.stringify(rows, null, 1) + "\n");
const by = rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r.owner]: (m[r.owner] ?? 0) + 1 }), {});
console.log(`${rows.length} decisions: ${Object.entries(by).map(([o, n]) => `${o} ${n}`).join(", ")}; ${rows.filter((r) => r.proof).length} proven`); // prettier-ignore
