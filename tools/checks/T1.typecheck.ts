// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { type Check, sh } from "./_check";

export const check: Check = {
  id: "T1",
  title: "TypeScript, strict, over the whole tree",
  owner: "lead",
  run: () => sh("npx", ["tsc", "--noEmit"]),
};
