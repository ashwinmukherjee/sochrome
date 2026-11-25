// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import * as constants from "../../src/contracts/constants";
import { type Check, repoFiles, ROOT } from "./_check";

const HOME = "src/contracts/constants.ts";
/** Tokens are the other single home for values; a coincidence there is not a restatement. */
const TOKENS = new Set(["src/styles/tokens.ts", "src/render/tokens.ts"]);
/** Two or more significant digits, not a round number: a value that only a restated threshold explains. */
export function distinctive(v: number): boolean {
  const digits = Math.abs(v).toPrecision(15).replace(/e.*$/, "").replace(".", "").replace(/^0+/, "").replace(/0+$/, "");
  return digits.length >= 2 && !(Number.isInteger(v) && Math.abs(v) < 100);
}

/** Every number in the contract, with the name it lives under. */
function shared(): Map<number, string> {
  const out = new Map<number, string>();
  const walk = (v: unknown, name: string) => {
    if (typeof v === "number") {
      if (distinctive(v) && !out.has(v)) out.set(v, name);
    } else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${name}.${k}`);
  };
  for (const [k, v] of Object.entries(constants)) walk(v, k);
  return out;
}

/** Numeric literals in code; comments and strings never match. */
export function restated(file: string, text: string, values: Map<number, string>): string[] {
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const hits: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isNumericLiteral(n)) {
      const v = Number(n.text);
      const neg = ts.isPrefixUnaryExpression(n.parent) && n.parent.operator === ts.SyntaxKind.MinusToken;
      const name = values.get(neg ? -v : v);
      if (name) {
        const line = src.getLineAndCharacterOfPosition(n.getStart()).line + 1;
        hits.push(`${file}:${line}: ${neg ? "-" : ""}${n.getText()} restates ${name}`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return hits;
}

export const check: Check = {
  id: "C4",
  title: "No shared constant restated outside contracts/constants.ts",
  owner: "G",
  run: () => {
    const values = shared();
    const hits = repoFiles()
      .filter(
        (f) => f.startsWith("src/") && /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && f !== HOME && !TOKENS.has(f),
      )
      .flatMap((f) => restated(f, readFileSync(resolve(ROOT, f), "utf8"), values));
    return {
      ok: hits.length === 0,
      detail: hits.length ? hits.slice(0, 40).join("\n") : `${values.size} shared values, none restated`,
    };
  },
};
