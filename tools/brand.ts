// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Fills the files that can't import brand.ts: LICENSE's notice, README.md, CITATION.cff. With --check, fails on a diff.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BRAND } from "../src/brand";

const ROOT = resolve(import.meta.dirname, "..");
const check = process.argv.includes("--check");
const fill = (s: string) =>
  s
    .replaceAll("%NAME%", BRAND.name)
    .replaceAll("%OWNER%", BRAND.owner)
    .replaceAll("%YEAR%", String(BRAND.year))
    .replaceAll("%DOMAIN%", BRAND.domain)
    .replaceAll("%EMAIL%", BRAND.email)
    .replaceAll("%VERSION%", JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).version as string);

const out: [string, string][] = [
  ["README.md", fill(readFileSync(resolve(ROOT, "tools/templates/README.md"), "utf8"))],
  ["CITATION.cff", fill(readFileSync(resolve(ROOT, "tools/templates/CITATION.cff"), "utf8"))],
];
const licence = readFileSync(resolve(ROOT, "LICENSE"), "utf8").split("\n");
licence[0] = fill("Required Notice: Copyright %YEAR% %OWNER% (https://%DOMAIN%)");
out.push(["LICENSE", licence.join("\n")]);

let stale = 0;
for (const [file, text] of out) {
  const path = resolve(ROOT, file);
  if (check) {
    if (readFileSync(path, "utf8") !== text) {
      process.stderr.write(`${file} is stale: run npm run brand\n`);
      stale++;
    }
  } else writeFileSync(path, text);
}
process.exit(stale ? 1 : 0);
