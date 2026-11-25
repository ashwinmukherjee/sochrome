// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Where each checked gene sits, for the ledger's genes layer: from the gene set the bundle ships.

import type { GeneInfo } from "../../contracts/app";
import { CHROMS } from "../../contracts/constants";
import type { GeneSite } from "../../ledger";

const NONE: readonly GeneSite[] = [];

export function sitesOf(genes: readonly GeneInfo[] | null): readonly GeneSite[] {
  if (!genes) return NONE;
  return genes.map((g) => ({
    symbol: g.symbol,
    chromIndex: CHROMS.indexOf(g.chrom as (typeof CHROMS)[number]),
    pos: g.pos,
  }));
}
