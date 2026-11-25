// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { run } from "../e2e/history";
import type { Check } from "./_check";

export const check: Check = {
  id: "E3",
  title: "The history walk: back, forward, Esc, deep links",
  owner: "F",
  run: () => run({ shots: false }),
};
