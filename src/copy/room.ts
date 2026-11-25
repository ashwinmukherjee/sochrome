// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Everything a room says, filled for one finding. Throws on a missing slot in dev; declines visibly in production.

import type { Finding, GeneInfo, RoomCopy } from "../contracts/app";
import { p1Copy } from "./p1/room";
import { p23Copy } from "./p23/room";

export function roomCopy(f: Finding, gene: GeneInfo | undefined): RoomCopy {
  return { p1: p1Copy(f, gene), ...p23Copy(f, gene) };
}

/** The room's own words. Labels are written in sentence case and set uppercase by the caption role. */
export const ROOM = {
  questions: { p1: "What does this variant do?", p2: "How sure are we?", p3: "What does it mean for you?" },
  stations: { p1: "Effect", p2: "Evidence", p3: "Odds" },
  stationsLabel: "Jump to section",
  next: "Next variant",
  back: "Back to your variants",
  scroll: "Scroll",
} as const;
