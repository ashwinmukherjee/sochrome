// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { type Check, sh } from "./_check";

export const check: Check = {
  id: "R4",
  title: "The room: its stations, three panels in sequence, P1 paced by its copy, NEXT VARIANT",
  owner: "D",
  run: () => sh("npx", ["tsx", "tools/e2e/room-shots.ts"]),
};
