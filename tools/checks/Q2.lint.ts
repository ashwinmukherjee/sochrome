// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { type Check, sh } from "./_check";

export const check: Check = {
  id: "Q2",
  title: "ESLint (strict, with the privacy exit guard), Prettier, and no dead code (knip)",
  owner: "G",
  run: () => {
    const e = sh("npx", ["eslint", "."], 30);
    const p = sh("npx", ["prettier", "--check", "."], 30);
    // Unused files, exports, types and dependencies fail: nothing is left behind as the code changes.
    const k = sh("npx", ["knip"], 60);
    return {
      ok: e.ok && p.ok && k.ok,
      detail: [e, p, k]
        .filter((r) => !r.ok)
        .map((r) => r.detail)
        .join("\n"),
    };
  },
};
