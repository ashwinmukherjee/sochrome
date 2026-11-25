// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The list's order: by how strongly the evidence points to an effect, never by risk (C12).

import type { Finding, GenomeResult, ListName, SampleId } from "../../contracts/app";
import { CHROMS } from "../../contracts/constants";

/** ClinVar's classes, strongest evidence first; anything unrecorded sits between uncertain and benign. */
const CLASS_RANK: Readonly<Record<string, number>> = {
  Pathogenic: 0,
  "Pathogenic/Likely_pathogenic": 1,
  Likely_pathogenic: 2,
  Conflicting_classifications_of_pathogenicity: 3,
  Uncertain_significance: 4,
  Likely_benign: 6,
  "Benign/Likely_benign": 7,
  Benign: 8,
};
const NOT_IN_CLINVAR = 5;
/** The sample the landing offers opens on the rooms whose drawings show the most: these lead its list, in this
 *  order, and the rest follow by evidence. A person's own list is the evidence's order alone. */
const SAMPLE_LEAD: Partial<Record<SampleId, Partial<Record<ListName, readonly string[]>>>> = {
  hg003: {
    yours: [
      "chr15:71811519:ACAG:A:NR2E3", // a deletion, then the folded protein it leaves
      "chr2:21004623:TC:T:APOB", // a frameshift reading on to an early stop
      "chr4:54703788:C:T:KIT", // a swap in the folded protein, with what it touches
      "chr1:155346383:C:G:ASH1L", // a splice change, then the protein
      "chr1:3430950:G:GGAC:PRDM16", // an insertion
    ],
  },
};

/** No AlphaMissense score: the scale's middle, so it neither leads nor trails. */
const NO_SCORE = 0.5;

function evidence(f: Finding): [number, number, number] {
  const [p, , am] = f.bundle.claims;
  const cls = "clnsig" in p.value ? (CLASS_RANK[p.value.clnsig] ?? NOT_IN_CLINVAR) : NOT_IN_CLINVAR;
  const stars = "review_stars" in p.value ? p.value.review_stars : 0;
  const score = "score" in am.value ? am.value.score : NO_SCORE;
  return [cls, -stars, -score];
}

function place(f: Finding): [number, number] {
  const [chrom, pos] = f.bundle.identity.normalized_key.split(":");
  const i = CHROMS.indexOf((chrom ?? "").replace(/^chr/, "") as (typeof CHROMS)[number]);
  return [i < 0 ? CHROMS.length : i, Number(pos)];
}

/** A new array, ordered by ClinVar class, review stars, AlphaMissense score, then genome order. */
export function order(findings: readonly Finding[]): Finding[] {
  const keyed = findings.map((f) => ({ f, e: [...evidence(f), ...place(f)] }));
  keyed.sort((a, b) => {
    for (let i = 0; i < a.e.length; i++) {
      const d = (a.e[i] ?? 0) - (b.e[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  });
  return keyed.map((k) => k.f);
}

/** A list as it stands: a sample's lead first, where it has one, then the evidence's order. */
export function listed(result: GenomeResult, which: ListName): Finding[] {
  const ordered = order(result[which]);
  const lead = result.source.kind === "sample" ? (SAMPLE_LEAD[result.source.id]?.[which] ?? []) : [];
  const first = lead.flatMap((key) => ordered.filter((f) => f.key === key));
  return [...first, ...ordered.filter((f) => !first.includes(f))];
}
