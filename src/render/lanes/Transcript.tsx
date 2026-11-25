// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Lane 2, the transcript: blocks at true proportion, gaps are intron positions where intrusions and pseudo-exons
// appear, a dashed seam is a join the gene doesn't have, and a stop is a black sliver in line, one codon wide.

import React from "react";
import type { StateEntry } from "../states";
import { Stage } from "./stage";

export default function Transcript({ entry }: { entry: StateEntry }) {
  return <Stage entry={entry} />;
}
