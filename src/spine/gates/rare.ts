// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/** Gate 4: Rare — gnomAD AF_grpmax under RARE_AF, else global AF under it.
 *  Absent passes as unobserved: not_in_table, ac0 (allele failed QC), and
 *  grpmax_missing (no frequency carried yet).
 *  outside_scope passes too: cut 2 now measures the changed bases (pin.ts,
 *  0bd726a), but the gnomAD pack is keyed by the VCF anchor within CDS ± 8 bp, so a deletion
 *  anchored outside the window that reaches into it (HG001 DNAH12 chr3:57446013) was never in
 *  the pack. Unmeasured, it stays in the list; the copy must not say "hasn't been seen" for it
 *  (clinvar-check known.tsv "unseen"; the rebuild packs gnomAD by the changed span). */

import { RARE_AF } from "../../contracts/constants.ts";
import type { JoinedVariant, Absence } from "../../contracts/types.ts";

function isAbsent(v: unknown): v is Absence {
  return typeof v === "object" && v !== null && "absent" in v;
}

export function gate(v: JoinedVariant): boolean {
  if (isAbsent(v.gnomad)) {
    return true;
  }
  const af = v.gnomad.af_grpmax ?? v.gnomad.af_global;
  if (af === null) throw new Error(`gnomAD hit with no frequency: ${v.chrom}:${v.pos}`);
  return af < RARE_AF;
}
