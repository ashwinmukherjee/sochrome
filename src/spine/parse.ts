// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Stage 1: VCF text to records, one per ALT allele.

import type { VcfRecord } from "../contracts/types.ts";

/** A gVCF's stand-in for any allele not seen. */
const isNonRef = (alt: string): boolean => alt === "<NON_REF>" || alt === "<*>";
/** Letters in capitals: VCF allows either case, and every later stage compares capitals. A symbolic
 *  allele (<DEL>, a breakend) is left as written. */
const upper = (allele: string): string => (/^[a-z]+$/i.test(allele) ? allele.toUpperCase() : allele);
/** Whether a genotype holds a copy of its record's allele. */
const carried = (gt: string): boolean => gt.split(/[/|]/).some((a) => a !== "0" && a !== ".");

/** One data line's records: one per ALT allele the genotype carries, its genotype rewritten so
 *  this allele is 1 and every other allele 0. An allele the person has no copy of is no record of
 *  theirs, and nor is a gVCF's <NON_REF>, so a reference block gives none. Fewer than ten columns: none. */
export function parseLine(line: string): VcfRecord[] {
  const cols = line.split("\t");
  if (cols.length < 10) return [];
  const chrom = cols[0];
  const pos = parseInt(cols[1], 10);
  const id = cols[2];
  const ref = upper(cols[3]);
  const qual = cols[5] === "." ? 0 : parseFloat(cols[5]);
  const filter = cols[6];
  const info = cols[7];
  const gtAt = cols[8].split(":").indexOf("GT");
  const gt = gtAt >= 0 ? cols[9].split(":")[gtAt] : "./.";
  const alts = cols[4].split(",").map(upper);
  if (alts.length === 1) return isNonRef(alts[0]) || !carried(gt) ? [] : [{ chrom, pos, id, ref, alt: alts[0], qual, filter, info, gt }]; // prettier-ignore
  const sep = gt.includes("|") ? "|" : "/";
  const alleles = gt.split(/[/|]/).map(Number);
  return alts
    .map((alt, i) => ({
      chrom,
      pos,
      id,
      ref,
      alt,
      qual,
      filter,
      info,
      gt: alleles.map((a) => (a === i + 1 ? 1 : 0)).join(sep),
    }))
    .filter((r) => !isNonRef(r.alt) && carried(r.gt));
}

/** Data lines to records. */
export function parseLines(lines: readonly string[]): VcfRecord[] {
  return lines.flatMap(parseLine);
}

/** VCF text to [header lines, records]. */
export function parseVcf(text: string): [string[], VcfRecord[]] {
  const headers: string[] = [];
  const records: VcfRecord[] = [];
  for (const line of text.split("\n")) {
    if (line === "" || line === "\r") continue;
    if (line.startsWith("#")) headers.push(line);
    else records.push(...parseLine(line));
  }
  return [headers, records];
}
