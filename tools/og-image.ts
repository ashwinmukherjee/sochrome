// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Draws the link previews: the ledger as the genes view shows it, every chromosome at its real length and every
// checked gene at its real place, in the light tokens. Two shapes, as the apps crop differently:
// public/og-wide.png (1200 x 630) for X's large card, which shows it whole; public/og-square.png (1200 x 1200) for
// everything else (Slack, iMessage and the rest), which crop to a square or show it whole.
// Run after a token or gene change.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { INK } from "../src/styles/tokens";
import { openBrowser } from "./e2e/browser";

const ROOT = resolve(import.meta.dirname, "..");

interface Shape {
  file: string;
  w: number;
  h: number;
  /** Where the bars start, and the width chromosome 1 spans: clear of X's 40 px crop on every side. */
  x0: number;
  span: number;
  pitch: number;
  bar: number;
  tick: number;
}

const SHAPES: Shape[] = [
  { file: "public/og-wide.png", w: 1200, h: 630, x0: 150, span: 900, pitch: 20, bar: 7, tick: 1.6 },
  { file: "public/og-square.png", w: 1200, h: 1200, x0: 150, span: 900, pitch: 40, bar: 14, tick: 2.6 },
];

const ink = INK.light;
const lengths = (JSON.parse(readFileSync(resolve(ROOT, "src/ledger/rulers.json"), "utf8")) as { genomic: number[] })
  .genomic;
/** The 2,132 checked genes as [symbol, chromosome index, position]: the set genes.pack holds, kept for the dev pages. */
const genes = JSON.parse(readFileSync(resolve(ROOT, "src/app/descent/dev/genes.dev.json"), "utf8")) as [
  string,
  number,
  number,
][];

function svg(s: Shape): string {
  const rows = 23;
  const top = Math.round((s.h - ((rows - 1) * s.pitch + s.bar)) / 2);
  const px = (bp: number) => (bp / lengths[0]) * s.span;
  const parts: string[] = [];
  for (let r = 0; r < rows; r++) {
    const y = top + r * s.pitch;
    const sex = r === 22;
    // The sex row is drawn at X's length and as an outline, as the genes view draws it.
    const w = px(lengths[sex ? 22 : r]);
    parts.push(
      sex
        ? `<rect x="${s.x0 + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${s.bar - 1}" fill="none" stroke="${ink["v-uncertain"]}" stroke-width="${Math.max(1, s.bar / 7)}"/>`
        : `<rect x="${s.x0}" y="${y}" width="${w.toFixed(2)}" height="${s.bar}" fill="${ink["v-fill"]}"/>`,
    );
    const ticks = genes
      .filter((g) => g[1] === r)
      .map(
        (g) =>
          `<rect x="${Math.min(s.x0 + px(g[2]), s.x0 + w - s.tick).toFixed(2)}" y="${y}" width="${s.tick}" height="${s.bar}"/>`,
      );
    parts.push(`<g fill="${ink["v-terminal"]}">${ticks.join("")}</g>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s.w}" height="${s.h}" viewBox="0 0 ${s.w} ${s.h}"><rect width="${s.w}" height="${s.h}" fill="${ink["v-ground"]}"/>${parts.join("")}</svg>`;
}

const { browser, close } = await openBrowser();
try {
  const tab = await browser.newPage();
  for (const s of SHAPES) {
    await tab.setViewport({ width: s.w, height: s.h, deviceScaleFactor: 1 });
    await tab.setContent(`<!doctype html><style>html,body{margin:0}svg{display:block}</style>${svg(s)}`);
    writeFileSync(
      resolve(ROOT, s.file),
      await tab.screenshot({ type: "png", clip: { x: 0, y: 0, width: s.w, height: s.h } }),
    );
    process.stdout.write(`${s.file}: ${s.w} x ${s.h}\n`);
  }
} finally {
  await close();
}
