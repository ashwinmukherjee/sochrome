// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { run } from "../e2e/a11y";
import type { Check } from "./_check";

export const check: Check = {
  id: "A1",
  title: "Accessibility: contrast, nothing by colour alone, keyboard, text alternatives, reduced motion",
  owner: "G",
  run: () => run(),
};
