// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Lane 1, the codon: fill answers whether a codon is read as intended (solid yes, hollow wrong frame, black stop,
// absent gone). Hollow means wrong frame at codon scale and nothing else; everything drawn derives from the tokens.

import React from "react";
import type { StateEntry } from "../states";
import { Stage } from "./stage";

export default function Codon({ entry }: { entry: StateEntry }) {
  return <Stage entry={entry} />;
}
