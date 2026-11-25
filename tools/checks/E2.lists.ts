// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { run } from "../e2e/lists";
import type { Check } from "./_check";

export const check: Check = {
  id: "E2",
  title: "The lists and the genes page on the fixtures",
  owner: "C",
  run: () => run({ shots: false }),
};
