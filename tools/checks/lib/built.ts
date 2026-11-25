// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The built site, made once per run, so every check of the output reads what this tree builds.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { build } from "../../e2e/browser";
import { ROOT } from "../_check";

export const DIST = resolve(ROOT, "dist");
const TEXT = /\.(html|js|mjs|css|json|txt|svg|xml|map|webmanifest)$/;

let done = false;

interface BuiltFile {
  /** Relative to dist/. */
  path: string;
  /** null for a binary file. */
  text: string | null;
}

export function builtFiles(): BuiltFile[] {
  if (!done) {
    build("dist");
    done = true;
  }
  const out: BuiltFile[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const at = resolve(dir, name);
      if (statSync(at).isDirectory()) walk(at);
      else out.push({ path: relative(DIST, at), text: TEXT.test(name) ? readFileSync(at, "utf8") : null });
    }
  };
  walk(DIST);
  return out;
}
