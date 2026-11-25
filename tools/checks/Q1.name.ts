// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { BRAND } from "../../src/brand";
import { type Check, repoFiles, ROOT } from "./_check";

/** The product's name, and the working name the old repos carry, in any spelling. */
const NAMES = [
  BRAND.name,
  BRAND.name.replaceAll(" ", "-"),
  BRAND.name.replaceAll(" ", ""),
  ["mi", "zen"].join(""),
  ["ca", "irn"].join(""),
];
const pattern = new RegExp(NAMES.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i");
const TEXT = /\.(ts|tsx|js|mjs|css|html|json|md|txt|sh|py|cff|svg)$/;

/** The renderer's gallery and the dev pages: captions for the people building it, never shown in the product. */
const GALLERY =
  /^src\/render\/(System\.tsx|lanes\/stage\.tsx|probe\.ts|states\.ts)$|\/dev\/|Dev\.tsx$|Harness\.tsx$|\.test\.tsx?$/;
const DOT = / · /;

/** V15: no " · " strung onto a label, in any string or JSX text the app could show. Comments are free. */
export function dotted(): string[] {
  const hits: string[] = [];
  for (const f of repoFiles()) {
    if (!/^src\/.+\.(tsx?|json)$/.test(f) || GALLERY.test(f)) continue;
    const text = readFileSync(resolve(ROOT, f), "utf8");
    if (!DOT.test(text)) continue;
    if (f.endsWith(".json")) {
      if (DOT.test(text)) hits.push(`${f}: a string carries " · "`);
      continue;
    }
    const src = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true);
    const visit = (n: ts.Node) => {
      if ((ts.isStringLiteralLike(n) || ts.isTemplateLiteralToken(n) || ts.isJsxText(n)) && DOT.test(n.text))
        hits.push(`${f}:${src.getLineAndCharacterOfPosition(n.getStart()).line + 1}: ${n.text.trim().slice(0, 80)}`);
      ts.forEachChild(n, visit);
    };
    visit(src);
  }
  return hits;
}

/** Written from brand.ts by tools/third-party.ts, and held fresh by Q5: the name there is the source's, not a copy. */
const BUILT = new Set(["public/credits.txt"]);

export const check: Check = {
  id: "Q1",
  title: 'The product\'s name appears only in src/brand.ts; no " · " strung onto a label',
  owner: "G",
  run: () => {
    const hits: string[] = [];
    for (const f of repoFiles()) {
      if (
        !/^(src|public|tools)\//.test(f) ||
        f === "src/brand.ts" ||
        BUILT.has(f) ||
        !TEXT.test(f) ||
        f.startsWith("public/data/")
      )
        continue;
      readFileSync(resolve(ROOT, f), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (pattern.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`);
        });
    }
    const dots = dotted();
    return {
      ok: hits.length === 0 && dots.length === 0,
      detail: [
        hits.length ? `${hits.length} lines name the product:\n${hits.slice(0, 40).join("\n")}` : "",
        dots.length ? `${dots.length} labels have " · " strung onto them (V15):\n${dots.join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  },
};
