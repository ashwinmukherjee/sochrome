// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/** Gate 3: Changes protein — consequence is NOT synonymous, intronic, utr, or intergenic.
 *  synonymous_splice_region passes (it's near a splice site). */

import type { JoinedVariant } from "../../contracts/types.ts";

const EXCLUDED: Set<string> = new Set(["synonymous", "intronic", "utr", "intergenic"]);

export function gate(v: JoinedVariant): boolean {
  return !EXCLUDED.has(v.consequence);
}
