// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/** The copy-number cut, in place of Rare: gnomAD's table holds no frequency for these changes, so one counts
 *  only where changing this gene's dosage, in this direction, is a known cause of disease. The test is the
 *  room's own (copy/p23/cnv.ts: `strong`, `unratedLoss`), so a change that passes is one P3 can speak to:
 *  ClinGen rates the direction 3 (or 30 for a loss), the change wholly contains a ClinGen region rated 3, or
 *  it is a loss that takes the gene out of a gene with enough known harmful cut-short variants. A change ClinVar
 *  records, this very span, as harmful passes too: a lab's call is never held back. */

import { CNV_LOF_KNOWN_MIN } from "../../contracts/constants.ts";
import type { CnvFacts } from "../cnv.ts";
import { clinvarClass } from "../p23.ts";

/** A loss the room's figure reads: the gene out, its start or end gone, or the reading thrown off. */
const takesGeneOut = (c: CnvFacts): boolean =>
  c.where === "whole" || c.where === "start" || c.where === "end" || (c.where === "inside" && c.inFrame === false);

export function gate(c: CnvFacts, lofKnown: number, clnsig: string | null): boolean {
  if (clnsig !== null && /pathogenic/.test(clinvarClass(clnsig))) return true;
  const { hi, ts } = c.rating;
  if (c.dir === "gain") return ts === "3" || !!c.region;
  if (hi === "3" || hi === "30" || c.region) return true;
  return hi !== "2" && hi !== "40" && lofKnown >= CNV_LOF_KNOWN_MIN && takesGeneOut(c);
}
