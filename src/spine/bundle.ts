// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/** Stage 6: Bundle — join record → one record in the frozen data contract.
 *  Claim-keyed: each claim carries its own value, uncertainty type, source,
 *  and what would update it. Foreclosure is a value, never a missing key.
 *
 *  Zygosity needs the rest of the genome only for compound het, and reads it
 *  from the run (RunHets: every record the run kept for the sample), never
 *  from whichever list happens to be handed to bundle. */

import type {
  JoinedVariant,
  Absence,
  Bundle,
  MendelianBundle,
  ObjectType,
  SampleSex,
  Identity,
  Zygosity,
  ZygosityFlag,
  Inheritance,
  InheritanceMode,
  PathogenicityClaim,
  FrequencyClaim,
  ComputationalClaim,
  PenetranceClaim,
  CalibrationKey,
  Foreclosed,
  PenetranceForeclosure,
} from "../contracts/types.ts";
import { harmfulPart } from "./clnsig.ts";
import { isCrossCarrier } from "./condition.ts";
import { isHet, isCarrier, governingMode } from "./funnel.ts";
import { inPar } from "./sex.ts";

export interface BundleContext {
  object_type: ObjectType;
  sex: SampleSex;
  inheritance: Map<string, InheritanceMode[]>; // symbol → every pattern, from inheritance.tsv
  pack_date: string; // data pack the joins read
}

function isAbsent(v: unknown): v is Absence {
  return typeof v === "object" && v !== null && "absent" in v;
}

function foreclosed<R extends string>(reason: R): Foreclosed<R> {
  return { absent: true, reason };
}

export function normalizedKey(v: JoinedVariant): string {
  return `${v.chrom}:${v.pos}:${v.ref}:${v.alt}`;
}

/** Shortest decimal that reads back as the same float32 (gnomAD AFs are
 *  packed as float32; the extra digits of the float64 widening are not data). */
function float32Decimal(x: number): number {
  const f = Math.fround(x);
  for (let p = 1; p <= 9; p++) {
    const d = parseFloat(f.toPrecision(p));
    if (Math.fround(d) === f) return d;
  }
  throw new Error(`float32Decimal: ${x} does not round-trip`);
}

// ── Identity ──

function hgvsP(v: JoinedVariant): Identity["hgvs_p"] {
  if (v.hgvs_p !== null) return v.hgvs_p;
  switch (v.consequence) {
    case "splice_donor":
    case "splice_acceptor":
    case "splice_region":
    case "intronic":
    case "utr":
    case "gene_deletion":
    case "copy_gain":
      return foreclosed("no protein change asserted");
    case "inframe_indel":
      return foreclosed("not computed for inframe indel");
    case "missense":
      if (v.ref.length > 1 && v.ref.length === v.alt.length) {
        return foreclosed("not computed for multi-nucleotide variant");
      }
  }
  throw new Error(`no hgvs_p for ${v.consequence} at ${normalizedKey(v)}`);
}

function identity(v: JoinedVariant): Identity {
  if (v.gene === null || v.transcript === null) {
    throw new Error(`bundle needs a gene: ${normalizedKey(v)}`);
  }
  if (v.hgvs_c === null) throw new Error(`no hgvs_c for ${normalizedKey(v)}`);
  return {
    gene: v.gene,
    transcript: v.transcript,
    hgvs_c: v.hgvs_c,
    hgvs_p: hgvsP(v),
    normalized_key: normalizedKey(v),
    consequence: v.consequence,
    splice_distance: v.splice_distance ?? foreclosed("exonic"),
    exon_edge: v.exon_edge ?? foreclosed("not at an exon edge"),
  };
}

// ── Zygosity ──

/** The sample's het records per gene, built once per run from every record
 *  the run kept for that sample (all chromosomes it read, past cut 5).
 *  Compound het reads this, so it cannot depend on the list given to bundle. */
export interface RunHets {
  chroms: ReadonlySet<string>;
  byGene: ReadonlyMap<string, readonly string[]>; // gene → normalized keys
}

export function runHets(sampleRecords: JoinedVariant[], chroms: Iterable<string>): RunHets {
  const read = new Set(chroms);
  const byGene = new Map<string, string[]>();
  for (const v of sampleRecords) {
    if (!read.has(v.chrom)) throw new Error(`runHets: ${normalizedKey(v)} is on a chromosome the run did not read`);
    if (v.gene === null || !isHet(v.gt)) continue;
    const keys = byGene.get(v.gene) ?? [];
    keys.push(normalizedKey(v));
    byGene.set(v.gene, keys);
  }
  return { chroms: read, byGene };
}

/** Other het records of the run in v's gene. A het record missing from the
 *  run's set means the set is not this run's: throw rather than guess. */
function partners(v: JoinedVariant, hets: RunHets): string[] {
  if (!hets.chroms.has(v.chrom)) throw new Error(`run did not read ${v.chrom}: ${normalizedKey(v)}`);
  if (!isHet(v.gt)) return [];
  const key = normalizedKey(v);
  const inGene = hets.byGene.get(v.gene as string) ?? [];
  if (!inGene.includes(key)) throw new Error(`het ${key} is not in the run's het set`);
  return inGene.filter((k) => k !== key);
}

function zygosity(v: JoinedVariant, sex: SampleSex, hetsInGene: string[]): Zygosity {
  const alleles = v.gt.split(/[\/|]/);
  const refs = alleles.filter((a) => a === "0").length;
  const alts = alleles.filter((a) => a !== "0" && a !== ".").length;
  const hemizygous = v.chrom === "chrX" && !inPar(v.pos);
  const flags: ZygosityFlag[] = hemizygous && sex === "unknown" ? ["sex_unknown"] : [];

  if (hemizygous && sex === "male") {
    if (refs === 0 && alts >= 1 && new Set(alleles).size === 1) return { state: "hemi", flags };
    throw new Error(`genotype ${v.gt} on male chrX at ${normalizedKey(v)}`);
  }
  if (alleles.length === 2 && refs === 1 && alts === 1) {
    return hetsInGene.length > 0
      ? { state: "compound_het_unphased", with: hetsInGene, flags }
      : { state: "het", flags };
  }
  if (alleles.length === 2 && alts === 2 && alleles[0] === alleles[1]) {
    return { state: "hom", flags };
  }
  throw new Error(`genotype ${v.gt} has no zygosity state at ${normalizedKey(v)}`);
}

// ── Inheritance ──

/** Every pattern the gene has, and the one that governs this record (governingMode): two copies
 *  are hom, or two changes in the gene (compound het, phase unknown, so treated as possibly
 *  both copies). The table's loader has already rejected unknown patterns. */
function inheritance(
  v: JoinedVariant,
  gene: string,
  table: Map<string, InheritanceMode[]>,
  zyg: Zygosity,
): Inheritance {
  const modes = table.get(gene);
  if (modes === undefined) return { mode: foreclosed("no mode recorded"), modes: [] };
  const twoCopies = zyg.state === "hom" || zyg.state === "compound_het_unphased";
  // One lost copy of a cross gene is read under the recessive pattern.
  const mode = isCrossCarrier(gene, modes, v.consequence, zyg.state === "het") ? "AR" : governingMode(modes, twoCopies);
  return { mode, modes: [...modes] };
}

// ── Claims ──

type PathogenicityState = "settled" | "conflicting" | "unmeasured";

/** CLNSIG is "|"-separated: the first part is the classification, the rest
 *  are qualifiers (risk_factor, drug_response, other, ...). Both verbatim. */
function splitClnsig(raw: string): { clnsig: string; qualifiers: string[] } {
  const [clnsig, ...qualifiers] = raw.split("|");
  if (clnsig === "" || qualifiers.includes("")) throw new Error(`clnsig ${raw}: empty part`);
  return { clnsig, qualifiers };
}

const BENIGN_SIDE: Set<string> = new Set(["Benign", "Likely_benign"]);
const CONFLICTING = "Conflicting_classifications_of_pathogenicity";

/**
 * Settled: a harmful call, with or without a low-penetrance or risk-allele qualifier (harmfulPart),
 * or every "/"-term harmless. Conflicting: ClinVar's conflict class. Everything else is unmeasured
 * and claims nothing: VUS and its subclasses, a risk allele alone, drug response, association,
 * protective, Affects, other, not_provided and the no-classification classes.
 */
function pathogenicityState(v: JoinedVariant): PathogenicityState {
  if (isAbsent(v.clinvar)) return "unmeasured";
  const { clnsig } = splitClnsig(v.clinvar.clnsig);
  if (harmfulPart(clnsig)) return "settled";
  if (clnsig.split("/").every((t) => BENIGN_SIDE.has(t))) return "settled";
  if (clnsig === CONFLICTING) return "conflicting";
  return "unmeasured";
}

const WOULD_UPDATE: Record<PathogenicityState, string[]> = {
  settled: [],
  conflicting: ["resolution among submitters"],
  unmeasured: ["a functional assay"],
};

function pathogenicity(v: JoinedVariant, packDate: string): PathogenicityClaim {
  const cv = v.clinvar;
  if (isAbsent(cv) && cv.reason !== "not_in_table") {
    throw new Error(`clinvar absence ${cv.reason} at ${normalizedKey(v)}`);
  }
  let value: PathogenicityClaim["value"];
  if (isAbsent(cv)) value = foreclosed("not_in_table");
  else {
    const { clnsig, qualifiers } = splitClnsig(cv.clnsig);
    value = { clnsig, qualifiers, review_stars: cv.review_stars };
    // Low penetrance is carried wherever ClinVar puts it, never dropped.
    const carried = [clnsig, ...qualifiers].join("|");
    if (cv.clnsig.includes("low_penetrance") && !carried.includes("low_penetrance")) {
      throw new Error(`low_penetrance dropped from ${cv.clnsig} at ${normalizedKey(v)}`);
    }
  }
  return {
    kind: "pathogenicity",
    value,
    uncertainty: "epistemic",
    source: {
      table: "clinvar",
      pack_date: packDate,
      variation_id: isAbsent(cv) ? foreclosed("not_in_table") : cv.variation_id,
    },
    what_would_update: [...WOULD_UPDATE[pathogenicityState(v)]],
  };
}

/** The pack carries INFO/AF on every gnomAD record; a hit without it is a pack error. */
function globalAf(af: number | null, v: JoinedVariant): number {
  if (af === null) throw new Error(`gnomad hit with no af_global at ${normalizedKey(v)}`);
  return float32Decimal(af);
}

function frequency(v: JoinedVariant, packDate: string): FrequencyClaim {
  const g = v.gnomad;
  let value: FrequencyClaim["value"];
  if (isAbsent(g)) {
    if (g.reason === "not_missense") throw new Error(`gnomad absence not_missense at ${normalizedKey(v)}`);
    value = foreclosed(g.reason);
  } else if (g.af_grpmax !== null) {
    value = { af: float32Decimal(g.af_grpmax), basis: "af_grpmax", pop: g.grpmax_pop };
  } else if (g.af_global !== null) {
    value = { af: float32Decimal(g.af_global), basis: "af_global" };
  } else {
    throw new Error(`gnomad hit with no frequency at ${normalizedKey(v)}`);
  }
  return {
    kind: "frequency",
    value,
    uncertainty: "measured",
    source: {
      table: "gnomad",
      pack_date: packDate,
      filter: isAbsent(g) ? foreclosed("no gnomad record") : g.filter,
      af_global: isAbsent(g) ? foreclosed("no gnomad record") : globalAf(g.af_global, v),
    },
    what_would_update: foreclosed("derived for pathogenicity only"),
  };
}

const CALIBRATION_KEY: CalibrationKey = {
  modality: foreclosed("calibration surface not built"),
  distance_to_target: foreclosed("calibration surface not built"),
  raw_effect_vs_floor: foreclosed("calibration surface not built"),
  cell_track_match: foreclosed("calibration surface not built"),
  decirc_channel: foreclosed("calibration surface not built"),
};

function computational(v: JoinedVariant, packDate: string): ComputationalClaim {
  const am = v.alphamissense;
  if (isAbsent(am) && am.reason !== "not_missense" && am.reason !== "not_in_table") {
    throw new Error(`alphamissense absence ${am.reason} at ${normalizedKey(v)}`);
  }
  return {
    kind: "computational",
    value: isAbsent(am)
      ? foreclosed(am.reason as "not_missense" | "not_in_table")
      : { score: am.score, am_class: am.am_class },
    uncertainty: "predicted",
    source: { table: "alphamissense", pack_date: packDate },
    calibration_key: { ...CALIBRATION_KEY },
    what_would_update: foreclosed("derived for pathogenicity only"),
  };
}

function penetrance(v: JoinedVariant, inh: Inheritance, zyg: Zygosity): PenetranceClaim {
  let reason: PenetranceForeclosure;
  const carrier = isCarrier(inh.modes, "0/1", true) || isCrossCarrier(v.gene ?? "", inh.modes, v.consequence, true);
  if (zyg.state === "het" && carrier) reason = "recessive carrier: question malformed";
  else if (pathogenicityState(v) !== "settled") reason = "upstream unresolved";
  else reason = "no estimate for gene";
  return {
    kind: "penetrance",
    value: foreclosed(reason),
    uncertainty: "aleatoric",
    source: foreclosed("penetrance table not built"),
    what_would_update: foreclosed("derived for pathogenicity only"),
  };
}

// ── Bundle ──

/** Build one bundle. hets: the run's het set for this sample (runHets). */
export function bundle(v: JoinedVariant, ctx: BundleContext, hets: RunHets): Bundle {
  if (ctx.object_type !== "mendelian") {
    throw new Error(`object type ${ctx.object_type} is reserved: no builder`);
  }
  const id = identity(v);
  const zyg = zygosity(v, ctx.sex, partners(v, hets));
  const inh = inheritance(v, id.gene, ctx.inheritance, zyg);
  const b: MendelianBundle = {
    object_type: "mendelian",
    identity: id,
    zygosity: zyg,
    inheritance: inh,
    claims: [
      pathogenicity(v, ctx.pack_date),
      frequency(v, ctx.pack_date),
      computational(v, ctx.pack_date),
      penetrance(v, inh, zyg),
    ],
  };
  return b;
}

/** Bundle a list of one sample's records against the run's het set. The list
 *  may be any subset of the run: zygosity does not read it. */
export function bundleGenome(vs: JoinedVariant[], ctx: BundleContext, hets: RunHets): Bundle[] {
  return vs.map((v) => bundle(v, ctx, hets));
}

/** Compound het is a property of the run: each record bundled alone must get
 *  the zygosity it gets in the full list. Throws on the first that differs. */
export function assertZygosityFromRun(vs: JoinedVariant[], ctx: BundleContext, hets: RunHets): void {
  const all = bundleGenome(vs, ctx, hets);
  vs.forEach((v, i) => {
    const alone = JSON.stringify((bundle(v, ctx, hets) as MendelianBundle).zygosity);
    const inList = JSON.stringify((all[i] as MendelianBundle).zygosity);
    if (alone !== inList) throw new Error(`zygosity of ${normalizedKey(v)} depends on the list: ${alone} vs ${inList}`);
  });
}

/** Throw on any null or undefined anywhere in a bundle tree. JSON.stringify
 *  drops undefined keys silently, so the emitted text alone cannot show them. */
export function assertNoNullish(x: unknown, path = "$"): void {
  if (x === null || x === undefined) throw new Error(`${String(x)} at ${path}`);
  if (Array.isArray(x)) x.forEach((e, i) => assertNoNullish(e, `${path}[${i}]`));
  else if (typeof x === "object") {
    for (const [k, e] of Object.entries(x)) assertNoNullish(e, `${path}.${k}`);
  }
}
