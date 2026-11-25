// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { run } from "../e2e/leak";
import type { Check } from "./_check";

/** The leak test's walk on the built site is this check: the HG002 benchmark through the real picker, to the list and every room. */
export const check: Check = {
  id: "E5",
  title: "A real .vcf.gz through the picker reaches the list and every room, on the built site",
  owner: "lead",
  run: () => run(["preview"]),
};
