// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Lane 3, the chain: a filled bar where the structure map holds, a dotted trace where it lets go, cut once at
// `plddtSolid` (also the routing threshold). End to end, no ruler, no datum; RULES.md §3.7, §7.14.

import React from "react";
import type { StateEntry } from "../states";
import { CHAIN_SPECIMENS } from "../specimens";
import { Stage } from "./stage";

/** The cell's caption: the bead marks the position and the residue number prints here, read off the specimen table
 *  so a residue index is written in one place. Shared with `Portrait.tsx`, whose unplaceable chain draws on this
 *  register (§2.13). A chain that ends early says where, out of its reference length. */
export function chainAddress(state: string): string | undefined {
  /* the `-[ab]` strip, as in frames.ts and probe.ts: a pair is one specimen drawn twice, so both halves caption the
     same residue */
  const spec = CHAIN_SPECIMENS[state.replace(/-[ab]$/, "")];
  if (!spec) return undefined;
  return spec.lastResidue != null
    ? `ends at residue ${spec.lastResidue.toLocaleString("en-US")}` + ` of ${spec.length.toLocaleString("en-US")}`
    : `residue ${spec.site}`;
}

export default function Chain({ entry }: { entry: StateEntry }) {
  return <Stage entry={entry} address={chainAddress(entry.state)} />;
}
