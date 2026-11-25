// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/** Gate 2: Coding — inside a CDS segment of a protein-coding MANE Select
 *  transcript, or within 8 bp of one. Matches the gnomAD pack's CDS ± 8 bp
 *  windows, so every variant past this gate is in gnomAD scope.
 *  Non-coding exons and non-coding RNA genes fail. */

import { CDS_PADDING } from "../../contracts/constants.ts";
import type { JoinedVariant } from "../../contracts/types.ts";

export function gate(v: JoinedVariant): boolean {
  const pass = v.cds_distance !== null && v.cds_distance <= CDS_PADDING;
  if (pass && !v.normalized) {
    throw new Error(
      `unnormalized indel passed cut 2 (reference too narrow to left-align): ` +
        `${v.chrom}:${v.pos} ${v.ref}>${v.alt} ${v.gene}`,
    );
  }
  return pass;
}
