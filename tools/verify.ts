// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// npm run verify [ids…] [--owner X] [--strict] [--release]: runs every check in tools/checks and reports each one.

import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Check } from "./checks/_check";

const DIR = resolve(import.meta.dirname, "checks");
const args = process.argv.slice(2);
const strict = args.includes("--strict");
const release = args.includes("--release");
const ownerAt = args.indexOf("--owner");
const owner = ownerAt >= 0 ? args[ownerAt + 1] : null;
const ids = args
  .filter((a, i) => !a.startsWith("--") && (ownerAt < 0 || i !== ownerAt + 1))
  .map((a) => a.toUpperCase());

const checks: Check[] = [];
for (const file of readdirSync(DIR)
  .filter((f) => /^[A-Z]+\d+\..+\.ts$/.test(f))
  .sort()) {
  const mod = (await import(resolve(DIR, file))) as { check?: Check };
  if (!mod.check) throw new Error(`${file} exports no check`);
  checks.push(mod.check);
}
const chosen = checks.filter(
  (c) => (!ids.length || ids.includes(c.id)) && (!owner || c.owner.split(/[, ]+/).includes(owner)),
);

let failed = 0;
let pending = 0;
let releaseOnly = 0;
for (const c of chosen) {
  if (!c.run) {
    pending++;
    console.log(`  not built  ${c.id.padEnd(3)} ${c.title}  [${c.owner}]`);
    continue;
  }
  const t = Date.now();
  let r;
  try {
    r = await c.run();
  } catch (e) {
    r = { ok: false, detail: e instanceof Error ? (e.stack ?? e.message) : String(e) };
  }
  const held = !r.ok && c.release && !release;
  if (held) releaseOnly++;
  else if (!r.ok) failed++;
  console.log(
    `  ${r.ok ? "pass     " : held ? "FAIL rel " : "FAIL     "}  ${c.id.padEnd(3)} ${c.title}  [${c.owner}]  ${Date.now() - t} ms`,
  );
  if (r.detail && (!r.ok || args.includes("--verbose"))) console.log(r.detail.replace(/^/gm, "             "));
}
console.log(
  `\n${chosen.length - failed - pending - releaseOnly} pass, ${failed} fail, ${pending} not built` +
    (releaseOnly ? `, ${releaseOnly} failing that gate only the release (verify --release)` : ""),
);
process.exit(failed || (strict && pending) ? 1 : 0);
