// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type Check, repoFiles, ROOT } from "./_check";
import { builtFiles } from "./lib/built";

/** A template slot left unfilled: {{DOMAIN}}, {{EMAIL}}. */
const PLACEHOLDER = /\{\{\s*[A-Za-z_][\w.]*\s*\}\}/g;

/** Shipped with the tag beside the licences; brand.ts is where the slots are filled once. */
const RELEASE_FILES = ["src/brand.ts", "README.md", "CITATION.cff"];

/** Every placeholder in one text, as "file:line: slot". */
export function placeholders(file: string, text: string): string[] {
  return text.split("\n").flatMap((line, i) => [...line.matchAll(PLACEHOLDER)].map((m) => `${file}:${i + 1}: ${m[0]}`));
}

export const check: Check = {
  id: "Q4",
  title: "Release: no placeholder left in a built page or in LICENSE",
  owner: "G",
  release: true,
  run: () => {
    const licences = [...repoFiles().filter((f) => /^LICENSE/.test(f)), ...RELEASE_FILES];
    const hits = [
      ...licences.flatMap((f) => placeholders(f, readFileSync(resolve(ROOT, f), "utf8"))),
      ...builtFiles().flatMap((b) => (b.text == null ? [] : placeholders(`dist/${b.path}`, b.text))),
    ];
    return {
      ok: hits.length === 0,
      detail: hits.length
        ? hits.slice(0, 40).join("\n")
        : `${licences.length} release files and the built site, no placeholder`,
    };
  },
};
