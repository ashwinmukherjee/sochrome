// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { type Check, sh } from "./_check";

export const check: Check = {
  id: "E8",
  title: "The ledger: every state, the row key never clipped, linked highlighting, at four widths",
  owner: "B",
  run: () => sh("npx", ["tsx", "tools/e2e/ledger.ts"]),
};
