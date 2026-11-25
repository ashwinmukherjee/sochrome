// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Every ink, size and duration, once. tokens.css is generated from this file (npm run tokens).

import {
  BREAKPOINT_PHONE,
  BREAKPOINT_SHORT,
  LEDGER_PHONE,
  LEDGER_PITCH,
  LEDGER_ROWS_SPANNED,
  LIST_PITCH,
  ORIGAMI,
  PACING,
} from "../contracts/constants";

type Rungs = Record<string, string>;

/** SPEC: Colour. Grey is the reference; verdigris is a record from the file and what it reaches. */
export const INK: { light: Rungs; dark: Rungs } = {
  light: {
    "v-void": "#131617",
    "v-paper": "#ECEEEF",
    "v-ground": "#E0E2E5",
    "v-rail": "#D8DBDD",
    "v-unknown": "#B9BCBE",
    "v-uncertain": "#93979A",
    "v-observed": "#44474B",
    "v-text": "#35393D",
    // 4.5:1 on the apparatus ground (REBUILD §8 A1); the deck's #74777A was 3.2:1 there.
    "v-text-2": "#5E6063",
    // The caption greys: every label at 4.5:1 on both grounds. Faint sits where text-2
    // does; axis moves a step toward ink to stay apart from it.
    "v-axis": "#4B4E52",
    "v-faint": "#5D6064",
    // Outlines and hairlines (tuning C3): 3:1 on both grounds, the floor for graphics (WCAG 1.4.11),
    // so the marks that only point don't darken with the faint text grey.
    "v-outline": "#797C80",
    "v-terminal-ref": "#22262A",
    "v-terminal": "#27574D",
    "v-predicted": "#548C85",
    "v-fill": "#BCD8D5",
    "v-lit": "#27574D",
    // The ledger's bars while the read fills them and at the first step: the records read, as a mass.
    "v-read": "#27574D",
    "v-fall": "#A2C2BE",
    "v-halo": "#BCD8D5",
    "v-path": "#B4281E",
    "v-benign": "#0461A7",
  },
  dark: {
    "v-void": "#131617",
    "v-paper": "#131617",
    "v-ground": "#1B1E20",
    "v-rail": "#232629",
    "v-unknown": "#3F4346",
    "v-uncertain": "#65686C",
    "v-observed": "#B9BCBE",
    "v-text": "#D5D7DA",
    "v-text-2": "#898D8F",
    "v-axis": "#A0A4A6",
    "v-faint": "#8A8D90",
    "v-outline": "#6C6F73",
    "v-terminal-ref": "#E3E5E8",
    "v-terminal": "#B0DBD7",
    "v-predicted": "#71A49C",
    "v-fill": "#233E37",
    "v-lit": "#B0DBD7",
    // Dark's lit mint across 23 full bars reads as screen glow; the predicted rung carries light mode's weight.
    "v-read": "#71A49C",
    "v-fall": "#2C4944",
    "v-halo": "#33695F",
    "v-path": "#DA5547",
    "v-benign": "#488ACB",
  },
};

/** Chrome reads roles, never rungs. The label rung is always monochrome. */
export const ROLE: Rungs = {
  ground: "var(--v-ground)",
  "apparatus-ground": "var(--v-rail)",
  // Text takes two levels and no more: --ink for what is primary, --ink-dim for everything
  // secondary, the question and the captions included. The chosen of two captions steps up to --ink.
  ink: "var(--v-text)",
  "ink-dim": "var(--v-text-2)",
  "ink-bar": "var(--v-text-2)",
  // Graphics only: outlines, hairlines, the neutral marks. Text never takes it.
  "ink-outline": "var(--v-outline)",
  hair: "var(--v-rail)",
};

/** The 8 px module; 4 is for chrome only. */
const SPACE = {
  "sp-1": 8,
  "sp-2": 16,
  "sp-3": 24,
  "sp-4": 32,
  "sp-5": 48,
  "sp-6": 64,
  "sp-7": 96,
  "sp-8": 128,
  "sp-9": 192,
  s4: 4,
} as const;

/** The type ladder: size / line. Rules read roles; type inside a graphic never scales. */
export const TYPE = { 1: [11, 16], 2: [13, 17], 3: [16, 22], 4: [20, 26], 5: [24, 32] } as const;

/** What a pointer leaves behind: the marks or rows not pointed at step back to this opacity (ledger, list). */
const HOVER_RECEDE = 0.4;

/** How far a first-sight arrow travels the way it points. */
const CUE_TRAVEL = 3;

/** Durations in ms. */
export const MOTION = {
  fade: 1200,
  move: 1400,
  beat: 600,
  release: 400,
  swap: 300,
  /** A view arriving by navigation (the list, the genes page, the ledger come back to): quick, so going somewhere
   *  feels immediate. `fade` stays for what the descent narrates. */
  arrive: 320,
  turn: 280,
  hover: 150,
  press: 120,
  cue: 1700,
  /** A first-sight cue waits this long after its view lands (Next, the first variant). */
  "cue-after": 1800,
  "an-draw": 400,
  "an-hold": 500,
  "an-read": PACING.AN_READ,
  "an-say": PACING.AN_SAY,
  "an-move": 260,
  "an-wave": 45,
  "an-land": 120,
  "an-fade": 320,
  "an-dolly": 700,
} as const;
const EASE = "cubic-bezier(0.45, 0, 0.15, 1)";

/** The room's stations, measured from the pinned frame's top, and the frame both columns share. */
const FRAME = {
  desktop: {
    wall: 44,
    "col-w": 300,
    "col-zone": 384,
    "station-q": 80,
    "station-c": 112,
    "claim-zone": 120,
    "station-s": 272,
    "station-r": 352,
    "gap-below": 48,
    "stage-w": 768,
    "stage-h-p1": 384,
    "stage-h-p2": 192,
    "stage-h-p3": 424,
    "w-spine": 540,
    "w-spine-p2": 620,
    "p3-array-top": 32,
    "p3-ledger-gap": 64,
  },
  phone: {
    wall: 20,
    "col-zone": 0,
    "station-q": 40,
    "station-c": 64,
    "claim-zone": 104,
    "station-s": 192,
    "station-r": 232,
    "gap-below": 24,
    "stage-h-p1": 320,
    "stage-h-p2": 192,
    "stage-h-p3": 360,
    "p3-array-top": 16,
    "p3-ledger-gap": 24,
  },
  /** A short phone screen: every gap a step tighter. */
  short: {
    "station-q": 32,
    "station-c": 56,
    "station-s": 176,
    "station-r": 216,
    "gap-below": 16,
    "stage-h-p3": 336,
    "p3-array-top": 16,
    "p3-ledger-gap": 24,
  },
} as const;

const CAPTION = { offset: 56, track: "0.16em", mark: 9, labelBox: 15, firstLine: 132 } as const;
export const STRIP = { h: 48, base: 30 } as const;
/** P3's columns: 20 × 5 at every width; a phone takes larger squares instead. */
export const P3_COLS = { desktop: 20, phone: 20 } as const;

const FONT = {
  standin: {
    sans: '"Inter Variable", system-ui, sans-serif',
    serif: '"Source Serif 4 Variable", Georgia, serif',
    mono: '"IBM Plex Mono", ui-monospace, Menlo, monospace',
  },
  suisse: {
    sans: '"Suisse Intl", system-ui, sans-serif',
    serif: '"Suisse Works", Georgia, serif',
    mono: '"Suisse Mono", ui-monospace, Menlo, monospace',
  },
} as const;

const px = (o: Record<string, number>) => Object.entries(o).map(([k, v]) => `  --${k}: ${v}px;`);
const block = (sel: string, lines: string[]) => `${sel} {\n${lines.join("\n")}\n}`;
const inks = (r: Rungs) => Object.entries(r).map(([k, v]) => `  --${k}: ${v};`);
const fonts = (f: { sans: string; serif: string; mono: string }) => [
  `  --sans: ${f.sans};`,
  `  --serif: ${f.serif};`,
  `  --mono: ${f.mono};`,
];

/** The whole of tokens.css. */
export function tokensCss(): string {
  const d = FRAME.desktop;
  const root = [
    ...inks(INK.light),
    ...Object.entries(ROLE).map(([k, v]) => `  --${k}: ${v};`),
    ...px(SPACE),
    ...Object.entries(TYPE).flatMap(([n, [t, lh]]) => [`  --t-${n}: ${t}px;`, `  --lh-${n}: ${lh}px;`]),
    "  --t-serif-l: var(--t-5);",
    "  --lh-serif-l: var(--lh-5);",
    "  --t-serif-m: var(--t-4);",
    "  --lh-serif-m: var(--lh-4);",
    "  --t-sans-body: var(--t-3);",
    "  --lh-sans-body: var(--lh-3);",
    "  --t-mono-row: var(--t-2);",
    "  --lh-mono-row: var(--lh-2);",
    "  --t-mono-note: var(--t-1);",
    "  --lh-mono-note: var(--lh-1);",
    "  --caption-size: var(--t-1);",
    `  --caption-track: ${CAPTION.track};`,
    `  --caption-offset: ${CAPTION.offset}px;`,
    `  --rail-mark: ${CAPTION.mark}px;`,
    `  --lane-label-box: ${CAPTION.labelBox}px;`,
    ...fonts(FONT.standin),
    `  --ease: ${EASE};`,
    ...Object.entries(MOTION).map(([k, v]) => `  --${k.startsWith("an-") ? k : `t-${k}`}: ${v}ms;`),
    "  --tw: var(--t-fade);",
    ...px(d),
    "  --claim-to-stage: calc(var(--station-s) - var(--station-c) - var(--claim-zone));",
    "  --rail-top: var(--station-q);",
    `  --first-line: ${CAPTION.firstLine}px;`,
    `  --pitch: clamp(${LEDGER_PITCH.min}px, calc((100dvh - 2 * var(--first-line)) / ${LEDGER_ROWS_SPANNED}), ${LEDGER_PITCH.max}px);`,
    `  --list-pitch: ${LIST_PITCH}px;`,
    `  --strip-h: ${STRIP.h}px;`,
    `  --strip-base: ${STRIP.base}px;`,
    `  --hover-recede: ${HOVER_RECEDE};`,
    `  --cue-travel: ${CUE_TRAVEL}px;`,
    `  --p3-cols: ${P3_COLS.desktop};`,
    `  --og-layout: 100%;`,
    `  --og-gutter: ${ORIGAMI.S.gutter}px;`,
  ];
  const og = (Object.entries(ORIGAMI) as [string, { from: number; layout: number; gutter: number; col: number }][]).map(
    ([, g]) =>
      block(`@media (min-width: ${g.from}px)`, [
        block("  :root", [
          `    --og-layout: ${g.layout}px;`,
          `    --og-gutter: ${g.gutter}px;`,
          `    --og-col: ${g.col}px;`,
        ]),
      ]),
  );
  const p = FRAME.phone;
  // The phone ledger's numbers fill the margin exactly: its tracks start on the wall.
  if (LEDGER_PHONE.col + LEDGER_PHONE.gut !== p.wall)
    throw new Error(`LEDGER_PHONE (${LEDGER_PHONE.col} + ${LEDGER_PHONE.gut}) must equal the phone's wall, ${p.wall}`);
  const phone = block(`@media (max-width: ${BREAKPOINT_PHONE}px)`, [
    block("  :root", [
      ...px(p).map((l) => `  ${l}`),
      "    --stage-w: calc(100vw - 2 * var(--wall));",
      "    --w-spine: var(--stage-w);",
      "    --w-spine-p2: var(--stage-w);",
      "    --t-serif-l: var(--t-4);",
      "    --lh-serif-l: var(--lh-4);",
      "    --t-serif-m: var(--t-3);",
      "    --lh-serif-m: var(--lh-3);",
      `    --p3-cols: ${P3_COLS.phone};`,
      `    --ledger-pitch-min: ${LEDGER_PITCH.phoneMin}px;`,
    ]),
  ]);
  const short = block(`@media (max-width: ${BREAKPOINT_PHONE}px) and (max-height: ${BREAKPOINT_SHORT}px)`, [
    block(
      "  :root",
      px(FRAME.short).map((l) => `  ${l}`),
    ),
  ]);
  return [
    "/* Copyright 2026 Ashwin Mukherjee */",
    "/* SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0 */",
    "/* Generated from tokens.ts by tools/tokens.ts. Edit tokens.ts, never this file. */",
    "",
    block(":root", root),
    "",
    block("@media (prefers-color-scheme: dark)", [
      block(
        '  :root:not([data-theme="light"])',
        inks(INK.dark).map((l) => `  ${l}`),
      ),
    ]),
    "",
    block(':root[data-theme="dark"]', inks(INK.dark)),
    "",
    block(':root[data-typeface="suisse"]', fonts(FONT.suisse)),
    "",
    ...og.flatMap((b) => [b, ""]),
    phone,
    "",
    short,
    "",
  ].join("\n");
}
