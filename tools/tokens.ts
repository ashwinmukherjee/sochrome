// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Writes the files drawn from tokens.ts: src/styles/tokens.css, and the site's icon (a square of the verdigris,
// the same in light and dark) as public/favicon.svg and the 180 px public/apple-touch-icon.png.
// With --check, fails if any file on disk differs.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { INK, tokensCss } from "../src/styles/tokens";

const ROOT = resolve(import.meta.dirname, "..");
/** The icon's one colour: the light ground's verdigris, kept in dark mode too, so the mark never changes. */
const ICON = INK.light["v-terminal"];

/** A PNG of one colour, square: RGB, no alpha, every row the same. */
function squarePng(size: number, hex: string): Buffer {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const row = Buffer.from([0, ...Array.from({ length: size }, () => rgb).flat()]);
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit, RGB, deflate, no filter, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: size }, () => row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const OUT: [string, string | Buffer][] = [
  ["src/styles/tokens.css", tokensCss()],
  [
    "public/favicon.svg",
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="${ICON}"/></svg>\n`,
  ],
  ["public/apple-touch-icon.png", squarePng(180, ICON)],
];

let stale = 0;
for (const [file, content] of OUT) {
  const path = resolve(ROOT, file);
  if (process.argv.includes("--check")) {
    let now: Buffer | null = null;
    try {
      now = readFileSync(path);
    } catch {
      // Missing is stale.
    }
    if (!now?.equals(Buffer.from(content))) {
      process.stderr.write(`${file} is stale: run npm run tokens\n`);
      stale++;
    }
  } else writeFileSync(path, content);
}
process.exit(stale ? 1 : 0);
