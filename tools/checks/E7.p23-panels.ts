// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { run } from "../e2e/p23";
import type { Check } from "./_check";

export const check: Check = {
  id: "E7",
  title: "The P2 and P3 panels: geometry at every beat, the arrival wave, pairing by hover and by tap",
  owner: "E",
  run: () => run({ shots: false }),
};
