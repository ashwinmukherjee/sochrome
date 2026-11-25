// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import ts from "typescript";
import { type Check, repoFiles, ROOT } from "./_check";

/** What each part of src may import, besides itself. A part is a folder under src or a top-level file. */
const ALLOWED: Record<string, string[]> = {
  contracts: [],
  brand: [],
  typeface: [],
  "third-party": [],
  spine: ["contracts"],
  data: ["contracts", "spine"],
  worker: ["contracts", "spine", "data"],
  render: ["contracts"],
  copy: ["contracts", "render/states", "brand"],
  ledger: ["contracts"],
  styles: ["contracts"],
  app: [
    "contracts",
    "spine",
    "data",
    "worker",
    "render",
    "copy",
    "ledger",
    "brand",
    "typeface",
    "third-party",
    "styles",
  ],
};
/** Packages a part may import: app any, the drawing React, the read pako. */
const PACKAGES: Record<string, RegExp> = { app: /./, render: /^react(-dom)?(\/|$)/, worker: /^pako$/, data: /^pako$/ };
/** Tests run in node under vitest. */
const TEST_PACKAGES = /^(node:|vitest$)/;

/** "src/render/states.ts" is in part "render", and is also the narrower target "render/states". */
function partOf(path: string): { part: string; target: string } | null {
  const m = /^src\/([^/]+?)(?:\.[a-z]+)?(?:\/(.*?))?(?:\.[a-z]+)?$/.exec(path);
  if (!m) return null;
  const [, part, rest] = m;
  return { part, target: rest ? `${part}/${rest.replace(/\/index$/, "")}` : part };
}

/** Every module specifier a file names: imports, re-exports, import(), and new URL(…, import.meta.url). */
export function specifiers(file: string, text: string): { spec: string; line: number; typeOnly: boolean }[] {
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const out: { spec: string; line: number; typeOnly: boolean }[] = [];
  const add = (n: ts.Node, typeOnly = false) => {
    if (ts.isStringLiteralLike(n))
      out.push({ spec: n.text, line: src.getLineAndCharacterOfPosition(n.getStart()).line + 1, typeOnly });
  };
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n)) add(n.moduleSpecifier, !!n.importClause?.isTypeOnly);
    else if (ts.isExportDeclaration(n) && n.moduleSpecifier) add(n.moduleSpecifier, n.isTypeOnly);
    else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0])
      add(n.arguments[0]);
    else if (
      ts.isNewExpression(n) &&
      n.expression.getText() === "URL" &&
      n.arguments?.[1]?.getText() === "import.meta.url"
    )
      add(n.arguments[0]);
    ts.forEachChild(n, visit);
  };
  visit(src);
  return out;
}

/** Why one import breaks the table, or null. */
export function breach(file: string, spec: string, dev: boolean, typeOnly = false): string | null {
  const from = partOf(file);
  if (!from) return null;
  // The contract is the hub for shared types; it may name any part's types, never its values.
  if (from.part === "contracts" && typeOnly) return null;
  if (!spec.startsWith(".")) {
    if (dev && TEST_PACKAGES.test(spec)) return null;
    if (spec.startsWith("node:")) return `node built-in ${spec}`;
    return PACKAGES[from.part]?.test(spec) ? null : `package ${spec}`;
  }
  const path = normalize(join(dirname(file), spec)).split("?")[0];
  if (!path.startsWith("src/"))
    return `${path} is outside src (a view takes GenomeResult and Finding, never a pack or fixture)`;
  const to = partOf(path);
  if (!to || to.part === from.part) return null;
  if (to.part === "checks") return from.part === "app" && dev ? null : "checks";
  const ok = ALLOWED[from.part];
  if (!ok) return `${from.part} has no row in the table`;
  return ok.some((a) => to.target === a || to.target.startsWith(`${a}/`)) ? null : to.target;
}

export const check: Check = {
  id: "C5",
  title: "Module boundaries: each folder imports only what it is allowed",
  owner: "G",
  run: () => {
    const problems: string[] = [];
    let edges = 0;
    for (const f of repoFiles().filter((x) => x.startsWith("src/") && /\.tsx?$/.test(x))) {
      const dev = /\.(test|dev)\.tsx?$|\/dev\//.test(f);
      for (const { spec, line, typeOnly } of specifiers(f, readFileSync(join(ROOT, f), "utf8"))) {
        edges++;
        const why = breach(f, spec, dev, typeOnly);
        if (why) problems.push(`${f}:${line}: imports ${spec} (${why})`);
      }
    }
    return {
      ok: problems.length === 0,
      detail: problems.length ? problems.slice(0, 40).join("\n") : `${edges} imports, all within bounds`,
    };
  },
};
