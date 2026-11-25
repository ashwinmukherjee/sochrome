// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { run } from "../e2e/layout";
import type { Check } from "./_check";

export const check: Check = {
  id: "L1",
  title: "In-page layout asserts at 1440, 1024, 390 and 320 on every route, in Suisse",
  owner: "G",
  run: () => run(),
};
