// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { run } from "../e2e/descent";
import type { Check } from "./_check";

export const check: Check = {
  id: "E1",
  title: "The descent plays from an event stream; the tally equals the counts",
  owner: "B",
  run: () => run({ shots: false }),
};
