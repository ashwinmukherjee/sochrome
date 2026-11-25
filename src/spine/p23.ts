// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// What P2 and P3 speak from, for one finding: the joined record, its bundle and its P1 facts in the copy model's shape.

import type { GeneInfo, P23Facts, VariantFacts } from "../contracts/app.ts";
import type { Consequence, JoinedVariant, MendelianBundle } from "../contracts/types.ts";
import { harmfulPart } from "./clnsig.ts";
import { conditionFor, groupOf, isCrossCarrier, mechanismOf } from "./condition.ts";
import { fate as fateOf } from "./facts/dispatch.ts";
import { translate, type GeneModel, type Piece } from "./facts/model.ts";
import { governingMode } from "./funnel.ts";
import { isClinVarRecord } from "./tables.ts";

/** The consequence in Sequence Ontology's words, as the copy model branches on it. */
function soTerm(c: Consequence, ref: string, alt: string): string {
  const inframe = ref.length > alt.length ? "inframe_deletion" : ref.length < alt.length ? "inframe_insertion" : "inframe_indel"; // prettier-ignore
  const terms: Partial<Record<Consequence, string>> = {
    missense: "missense_variant",
    stop_gained: "nonsense",
    frameshift: "frameshift_variant",
    splice_donor: "splice_donor_variant",
    splice_acceptor: "splice_acceptor_variant",
    splice_region: "splice_region_variant",
    synonymous: "synonymous_variant",
    synonymous_splice_region: "synonymous_variant",
    start_lost: "initiator_codon_variant",
    stop_lost: "stop_lost",
    inframe_indel: inframe,
  };
  return terms[c] ?? c;
}

const CLASSES: Record<string, string> = {
  Uncertain_significance: "uncertain",
  Conflicting_classifications_of_pathogenicity: "conflicting",
  Likely_benign: "likely-benign",
  Benign: "benign",
  "Benign/Likely_benign": "benign-likely",
};

/**
 * ClinVar's classification in the copy model's classes. The part before "|" classifies; the rest qualifies.
 * A harmful call labs qualify (low penetrance, or beside a risk-allele call) is read from its harmful part.
 */
export function clinvarClass(clnsig: string): string {
  const first = clnsig.split("|")[0];
  if (/^(VUS-(low|mid|high)|Uncertain_significance\/.*)$/.test(first)) return "uncertain";
  const harmful = harmfulPart(first);
  if (harmful) return harmful.pathogenic ? (harmful.likely ? "pathogenic-likely" : "pathogenic") : "likely-pathogenic";
  return CLASSES[first] ?? "other";
}

/** Whether labs qualify their harmful call: P3 says so, and the gene's usual figure no longer applies. */
export const isLowPenetrance = (clnsig: string): boolean => harmfulPart(clnsig.split("|")[0])?.lowPenetrance ?? false;

/** ClinVar's review status in the copy model's levels. */
export function reviewLevel(revstat: string): string {
  if (/practice.guideline/.test(revstat)) return "guideline";
  if (/expert.panel/.test(revstat)) return "expert";
  if (/multiple.submitters,.no.conflicts/.test(revstat)) return "multiple";
  if (/conflicting/.test(revstat)) return "conflicting";
  if (/single.submitter/.test(revstat)) return "single";
  return "none";
}

/** Whether skipping a coding piece destroys the message: read without it to the first stop, by the F1 rule. */
function skipDestroys(m: GeneModel, piece: Piece): boolean {
  if (piece.bp % 3 === 0 || m.lastJunctionC == null || piece.cLo > m.lastJunctionC) return false;
  const read = translate(m.orfTail.slice(0, piece.cLo - 1) + m.orfTail.slice(piece.cHi));
  if (!read.endsWith("*")) return false;
  return fateOf({ ...m, lastJunctionC: m.lastJunctionC - piece.bp }, read.length).destroyed;
}

type P1 = NonNullable<P23Facts["p1"]>;

/** The piece a broken cut point would skip: before the gap for a donor, after it for an acceptor. */
function skipOf(v: JoinedVariant, m: GeneModel): P1["skip"] {
  if (v.consequence !== "splice_donor" && v.consequence !== "splice_acceptor") return null;
  const gap = m.gaps.find((g) => v.pos >= g.gLo - 3 && v.pos <= g.gHi + 3);
  if (!gap || gap.afterC == null) return null;
  const { afterC } = gap;
  const piece = m.pieces.find((p) => (v.consequence === "splice_donor" ? p.cHi === afterC : p.cLo === afterC + 1));
  if (!piece) return null;
  return {
    exon: piece.exon,
    bp: piece.bp,
    inFrame: piece.bp % 3 === 0,
    share: piece.bp / m.cds.length,
    exons: m.exonCount,
    nmd: skipDestroys(m, piece),
  };
}

/** P1's facts as P2's protein bar reads them. */
function p1Of(v: JoinedVariant, f: VariantFacts, m: GeneModel): P1 {
  const plen = m.protein.length;
  const cutShort = v.consequence === "stop_gained" || v.consequence === "frameshift";
  const at = v.hgvs_p ? Number(/(\d+)/.exec(v.hgvs_p)?.[1] ?? NaN) : NaN;
  const terminator = f.drawings.map((d) => d.codon).find(Boolean)?.terminator ?? null;
  return {
    consequence: v.consequence,
    hgvs_c: f.hgvs_c,
    hgvs_p: v.hgvs_p,
    fate: f.drawings.find((d) => d.fate)?.fate ?? null,
    plen,
    runsOn: v.consequence === "frameshift" && terminator != null && terminator - 1 > plen,
    lost: cutShort && Number.isFinite(at) ? Math.max(0, 1 - at / plen) : null,
    skip: skipOf(v, m),
  };
}

function clinvarOf(v: JoinedVariant): P23Facts["clinvar"] {
  const cv = v.clinvar;
  if ("absent" in cv) return null;
  const revstat = cv.clnrevstat.replace(/_/g, " ").replace(/ ,/g, ",");
  const facts: NonNullable<P23Facts["clinvar"]> & { lowPenetrance?: true } = {
    id: String(cv.variation_id),
    clnsig: cv.clnsig,
    class: clinvarClass(cv.clnsig),
    review: reviewLevel(revstat),
    revstat,
    stars: cv.review_stars,
    conf: isClinVarRecord(cv) ? cv.conf : null,
  };
  // Carried only when labs qualify the call: the copy model reads its absence as no qualifier.
  if (isLowPenetrance(cv.clnsig)) facts.lowPenetrance = true;
  return facts;
}

function gnomadOf(v: JoinedVariant): P23Facts["gnomad"] {
  const g = v.gnomad;
  if ("absent" in g) return null;
  return { af: g.af_grpmax, af_global: g.af_global, pop: g.grpmax_pop, nhomalt: g.nhomalt, filter: g.filter };
}

/**
 * One finding's facts for P2 and P3.
 * `copiesX` is the person's copies of X; null when the file's X does not say (P3 then assumes neither).
 */
export function p23Facts(
  v: JoinedVariant,
  b: MendelianBundle,
  f: VariantFacts,
  m: GeneModel,
  gene: GeneInfo | undefined,
  copiesX: 1 | 2 | null,
): P23Facts {
  const zygosity = b.zygosity.state;
  const modes = gene?.modes ?? [];
  const twoCopies = zygosity === "hom" || zygosity === "compound_het_unphased";
  // One lost copy of a cross gene is told under the recessive condition alone.
  const crossed = isCrossCarrier(b.identity.gene, modes, v.consequence, zygosity === "het");
  const patterns = Object.fromEntries(
    Object.entries(gene?.conditions ?? {})
      .filter(([mode]) => !crossed || mode === "AR")
      .map(([mode, c]) => [mode, { label: c.label, validity: c.validity }]),
  );
  const p1 = p1Of(v, f, m);
  const mode = crossed ? "AR" : modes.length ? governingMode(modes, twoCopies) : null;
  const chrom = v.chrom.replace(/^chr/, "");
  // Where a gene's conditions differ by what the change does, every pattern the copies meet names the one picked.
  const group = groupOf(chrom, Object.keys(patterns), zygosity, mode);
  const cv = "absent" in v.clinvar ? null : v.clinvar;
  const picked = group && conditionFor(b.identity.gene, group, mechanismOf(v.consequence), p1.fate, cv?.clnsig ?? null, cv && isClinVarRecord(cv) ? cv.mondo : []); // prettier-ignore
  if (picked)
    for (const pattern of Object.keys(patterns))
      if (groupOf(chrom, [pattern], zygosity, pattern) === group) patterns[pattern] = { label: picked.label, validity: picked.validity }; // prettier-ignore
  return {
    key: b.identity.normalized_key.replace(/^chr/, ""),
    gene: b.identity.gene,
    chrom,
    hgvs_c: b.identity.hgvs_c,
    consequence: soTerm(v.consequence, v.ref, v.alt),
    clinvar: clinvarOf(v),
    gnomad: gnomadOf(v),
    am: "absent" in v.alphamissense ? null : { score: v.alphamissense.score, am_class: v.alphamissense.am_class },
    mode,
    patterns,
    set: "yours",
    zygosity,
    copiesX,
    p1,
    dosage: { hi: gene?.dosage.hi ?? null, lofKnown: gene?.dosage.lofKnown ?? 0 },
    ...(crossed ? { cross: true } : {}),
  };
}
