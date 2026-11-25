// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { run } from "../e2e/leak";
import type { Check } from "./_check";

export const check: Check = {
  id: "P1",
  title: "The leak test: nothing from a loaded file reaches any exit; requests equal the manifest",
  owner: "G",
  run: () => run(),
};
