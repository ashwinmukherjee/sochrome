// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// How the first hand-checked flagship records (fixtures/june) map onto a bundle's fields. Read by regress.ts.

import type { Claim, Foreclosed, MendelianBundle } from "../../src/contracts/types";

export interface FieldMapping {
  /** Dotted path in the earlier record. */
  june: string;
  /** The bundle's leaf paths this row accounts for. */
  contract: string[];
  fromJune: (v: unknown) => unknown;
  fromContract: (b: MendelianBundle) => unknown;
}

function claim<K extends Claim["kind"]>(b: MendelianBundle, kind: K): Extract<Claim, { kind: K }> {
  return b.claims.find((c) => c.kind === kind) as Extract<Claim, { kind: K }>;
}

export const isForeclosed = (x: unknown): x is Foreclosed<string> =>
  typeof x === "object" && x !== null && "absent" in x;

/** The earlier record's null and a bundle's foreclosure both read as absent. */
const ABSENT = "absent";

/** Sequence Ontology's term to the bundle's consequence. */
const SO_TO_CONSEQUENCE: Record<string, string> = {
  missense_variant: "missense",
  frameshift_variant: "frameshift",
  stop_gained: "stop_gained",
  start_lost: "start_lost",
  splice_donor_variant: "splice_donor",
  splice_acceptor_variant: "splice_acceptor",
  splice_region_variant: "splice_region",
  synonymous_variant: "synonymous",
  inframe_deletion: "inframe_indel",
  inframe_insertion: "inframe_indel",
  intron_variant: "intronic",
  "5_prime_UTR_variant": "utr",
  "3_prime_UTR_variant": "utr",
};

const ACCESSION_TO_CHROM: Record<string, string> = { "NC_000016.10": "chr16", "NC_000017.11": "chr17" };

const keyPart = (b: MendelianBundle, i: number) => b.identity.normalized_key.split(":")[i];
const pathogenicity = (b: MendelianBundle) => claim(b, "pathogenicity");
const variationId = (b: MendelianBundle) => {
  const id = pathogenicity(b).source.variation_id;
  return isForeclosed(id) ? ABSENT : id;
};
const same = (v: unknown) => v;

export const MAPPINGS: FieldMapping[] = [
  { june: "gene", contract: ["identity.gene"], fromJune: same, fromContract: (b) => b.identity.gene },
  {
    june: "mane_transcript",
    contract: ["identity.transcript"],
    fromJune: same,
    fromContract: (b) => b.identity.transcript,
  },
  { june: "hgvs_c", contract: ["identity.hgvs_c"], fromJune: same, fromContract: (b) => b.identity.hgvs_c },
  {
    june: "hgvs_p",
    contract: ["identity.hgvs_p"],
    fromJune: (v) => (v === null ? ABSENT : v),
    fromContract: (b) => (isForeclosed(b.identity.hgvs_p) ? ABSENT : b.identity.hgvs_p),
  },
  {
    june: "hgvs_full",
    contract: ["identity.transcript", "identity.gene", "identity.hgvs_c", "identity.hgvs_p"],
    fromJune: same,
    fromContract: (b) =>
      `${b.identity.transcript}(${b.identity.gene}):${b.identity.hgvs_c}` +
      (isForeclosed(b.identity.hgvs_p) ? "" : ` (${b.identity.hgvs_p})`),
  },
  {
    june: "consequence_so",
    contract: ["identity.consequence"],
    fromJune: (v) => {
      const term = SO_TO_CONSEQUENCE[v as string];
      if (term === undefined) throw new Error(`unmapped SO term ${String(v)}`);
      return term;
    },
    fromContract: (b) => b.identity.consequence,
  },
  {
    june: "grch38.chr",
    contract: ["identity.normalized_key"],
    fromJune: (v) => `chr${String(v)}`,
    fromContract: (b) => keyPart(b, 0),
  },
  {
    june: "grch38.pos",
    contract: ["identity.normalized_key"],
    fromJune: same,
    fromContract: (b) => Number(keyPart(b, 1)),
  },
  {
    june: "grch38.start",
    contract: ["identity.normalized_key"],
    fromJune: same,
    fromContract: (b) => Number(keyPart(b, 1)),
  },
  {
    // SPDI counts between bases from 0: a substitution's VCF position is one more.
    june: "canonical_spdi",
    contract: ["identity.normalized_key"],
    fromJune: (v) => {
      const [acc, p, ref, alt] = (v as string).split(":");
      const chrom = ACCESSION_TO_CHROM[acc];
      if (chrom === undefined) throw new Error(`unmapped accession ${acc}`);
      if (ref.length !== 1 || alt.length !== 1) throw new Error(`SPDI ${String(v)} is not a substitution`);
      return `${chrom}:${Number(p) + 1}:${ref}:${alt}`;
    },
    fromContract: (b) => b.identity.normalized_key,
  },
  {
    june: "clinvar_classification",
    contract: ["claims.pathogenicity.value.clnsig"],
    fromJune: (v) => (v as string).replaceAll(" ", "_"),
    fromContract: (b) => {
      const p = pathogenicity(b).value;
      return isForeclosed(p) ? ABSENT : p.clnsig;
    },
  },
  {
    june: "review_stars",
    contract: ["claims.pathogenicity.value.review_stars"],
    fromJune: same,
    fromContract: (b) => {
      const p = pathogenicity(b).value;
      return isForeclosed(p) ? ABSENT : p.review_stars;
    },
  },
  {
    june: "variation_id",
    contract: ["claims.pathogenicity.source.variation_id"],
    fromJune: (v) => Number(v),
    fromContract: variationId,
  },
  {
    june: "clinvar_id",
    contract: ["claims.pathogenicity.source.variation_id"],
    fromJune: (v) => Number((v as string).replace(/^VCV/, "")),
    fromContract: variationId,
  },
];

/** Fields of the earlier records with nothing in a bundle to compare to, and why. */
export const JUNE_ONLY: Record<string, string> = {
  common_name: "display label",
  uniprot: "protein accession: the facts stage's",
  isoform: "protein isoform: the facts stage's",
  consequence_all: "every transcript's terms; a bundle reads one transcript",
  "structure_map.kind": "structure map: the facts stage's",
  "structure_map.residues": "structure map: the facts stage's",
  "structure_map.reason": "structure map: the facts stage's",
  "grch38.cytogenetic": "band label",
  "grch38.display": "display string",
  "grch38.stop": "span end",
  review_status: "a bundle carries the stars, not the status text",
  last_evaluated: "ClinVar record metadata",
  submissions: "ClinVar record metadata",
  variant_type: "ClinVar record metadata",
  selection_note: "authoring note",
  source: "fetch provenance",
};
