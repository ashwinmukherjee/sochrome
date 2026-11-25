// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Lint: typescript-eslint strict for everything written here; a named, shorter list for files ported as they stood.

import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import exits from "./tools/checks/lib/exit-guard.js";

/** Ported as is (REBUILD §4.1): behaviour is pinned by parity checks, so their types are not rewritten in v1. */
const PORTED = [
  "src/spine/*.ts",
  "src/spine/gates/*.ts",
  "src/spine/facts/*.ts",
  "src/render/**",
  "src/copy/p1/{schedule,slots,claims,seed}.ts",
  "src/copy/p23/{model,cnv,seed,cnv-seed}.ts",
  "src/ledger/{dirs,data}.ts",
  "src/worker/{stream,sniff}.ts",
  "tools/clinvar-check/{check,fit,contract}.ts",
];

/** The privacy rule (REBUILD §2.0): each way out of the page lives in one named place, and nowhere else. */
const guard = (options = {}) => ({ "exits/no-exit": ["error", options] });

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "public/", "fonts/", "shots/", "test/fixtures/"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  { rules: { "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }] } },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, exits },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-script-url": "error",
      ...guard(),
    },
  },
  { files: ["src/data/**/*.ts"], rules: guard({ allow: ["fetch", "caches"] }) },
  { files: ["src/app/router.ts"], rules: guard({ allow: ["history", "location", "title"] }) },
  { files: ["src/worker/**/*.ts"], rules: guard({ allow: ["postMessage"] }) },
  { files: ["src/app/links.ts"], rules: guard({ links: true }) },
  {
    files: PORTED,
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-dynamic-delete": "off",
      "@typescript-eslint/no-extraneous-class": "off",
      "no-empty": "off",
      "prefer-const": "off",
      "no-useless-escape": "off",
      "no-case-declarations": "off",
      "no-irregular-whitespace": "off",
      "no-control-regex": "off",
      "no-prototype-builtins": "off",
    },
  },
  { files: ["tools/**/*.ts", "*.config.{js,ts}"], rules: { "no-console": "off" } },
);
