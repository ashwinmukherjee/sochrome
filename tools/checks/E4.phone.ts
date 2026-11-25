// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { run } from "../e2e/phone";
import type { Check } from "./_check";

export const check: Check = {
  id: "E4",
  title: "Phone: 320 and 390, no sideways scroll, tap to pair",
  owner: "F",
  run: () => run({ shots: false }),
};
