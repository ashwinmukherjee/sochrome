// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Lane 4, the portrait: every state is the anchor drawing (a frozen projection of the variant's window) plus one
// operation. Confidence register and operation are separate axes; the thread tells measured backbone from claimed.

import React from "react";
import type { StateEntry } from "../states";
import { FOLD_SPECIMENS } from "../specimens";
import { Stage } from "./stage";
import { chainAddress } from "./Chain";

/** A cell with no placeable fold renders on the chain register (§2.13) and takes its caption rule from `Chain.tsx`.
 *  Gated on placeability, the question `foldFrame` asks: a fold's x is a projection axis, so a placed cell has no
 *  residue index to caption. */
export default function Portrait({ entry }: { entry: StateEntry }) {
  const address = FOLD_SPECIMENS[entry.state] ? undefined : chainAddress(entry.state);
  return <Stage entry={entry} address={address} />;
}
