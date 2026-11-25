// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { type Check, sh } from "./_check";

export const check: Check = {
  id: "T3",
  title: "Generated files are fresh: tokens.css and the icon, and the files filled from brand.ts",
  owner: "lead",
  run: () => {
    const t = sh("npx", ["tsx", "tools/tokens.ts", "--check"]);
    const b = sh("npx", ["tsx", "tools/brand.ts", "--check"]);
    return {
      ok: t.ok && b.ok,
      detail: [t, b]
        .filter((r) => !r.ok)
        .map((r) => r.detail)
        .join("\n"),
    };
  },
};
