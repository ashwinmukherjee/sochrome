// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// P2's and P3's model: facts become tags, bars, slots and the person's situation. The words are in seed.ts and copy23.json.

import {
  AM_BANDS,
  CNV_LOF_KNOWN_MIN,
  GNOMAD_PEOPLE,
  PVS1_SHARE,
  RARE_AF,
  RARITY,
  TAVTIGIAN,
} from "../../contracts/constants";
import CSPEC from "../json/sources/cspec-thresholds.json";
import FIG_TABLE from "../json/sources/figures.json";
import { CNV_KINDS, cnvContext, cnvSlots, isCnv, type Cnv, type CnvBarId } from "./cnv";
import { HARMFUL, HARMLESS, num, pct } from "./words";

export type Facts = {
  key: string;
  gene: string;
  chrom: string;
  hgvs_c: string | null;
  consequence: string | null;
  clinvar: {
    id: string;
    clnsig: string;
    class: string;
    review: string;
    revstat: string;
    stars: number | null;
    conf: Record<string, number> | null;
    /** Labs call it harmful with low penetrance, or harmful beside a risk-allele call. Read from clnsig when unset. */
    lowPenetrance?: boolean;
  } | null;
  gnomad: { af: number | null; af_global: number | null; pop: string; nhomalt: number; filter: string } | null;
  am: { score: number; am_class: string } | null;
  mode: string | null;
  patterns: Record<string, { label: string; validity: string }>;
  set: "yours" | "sampled";
  sample?: string;
  group?: string;
  stratum?: string;
  scenario?: boolean;
  zygosity: string;
  /** The person's copies of X; null when their file's X does not say, and P3 assumes neither. */
  copiesX: number | null;
  p1: {
    consequence: string;
    hgvs_c: string;
    hgvs_p: string | null;
    fate: "destroyed" | "no-stop" | null;
    plen: number;
    lost: number | null;
    runsOn?: boolean;
    skip: { exon: number; bp: number; inFrame: boolean; share: number; exons?: number; nmd?: boolean } | null;
  } | null;
  dosage: { hi: string | null; lofKnown: number };
  /** One lost copy of a cross gene, read under its recessive condition: the gene's dominant one comes from other changes. */
  cross?: boolean;
  /** Copy-number changes only. */
  cnv?: Cnv;
};
export type Line = { id: string; unit: string; when: string[]; t: string };
export type Kind = {
  id: string;
  panel: "P2" | "P3";
  title: string;
  about: string;
  units: Unit[];
  member: (c: Ctx) => boolean;
};
export type Unit = { id: string; label: string; box: "claim" | "row"; required: (c: Ctx) => boolean };
export type Decisions = { verdict: number; condition: number; carriers: number };
export type Bar = {
  id: "labs" | "rarity" | "predict" | "protein" | CnvBarId;
  dir: -1 | 0 | 1;
  pts: number;
  tier: string;
  standIn?: boolean;
  outcome?: string;
  mech?: string;
};
export type Ctx = {
  f: Facts;
  tags: string[];
  p3: string;
  pattern: string | null;
  label: string;
  title: string;
  bars: Bar[];
  points: number;
  chart: string;
};

/** A harmful class that labs qualify: fewer of the people who carry it develop the condition. The reader
 *  sets the class from the harmful part; the gene's figure, drawn for its typical variants, no longer applies. */
export const lowPenetrance = (f: Facts): boolean =>
  !!f.clinvar &&
  HARMFUL.includes(f.clinvar.class) &&
  (f.clinvar.lowPenetrance ?? /low_penetrance|risk_allele/i.test(f.clinvar.clnsig));

/** Which of the gene's patterns the person's copies meet: one copy meets a dominant condition, two a recessive one. */
function situation(f: Facts): { kind: string; pattern: string | null } {
  const p = f.patterns,
    has = (m: string) => !!p[m];
  const cls = f.clinvar?.class ?? "absent";
  const settled = HARMFUL.includes(cls);
  const xl = f.chrom === "X" || has("XL");
  let kind: string, pattern: string | null;
  if (xl) {
    pattern = has("XL") ? "XL" : (Object.keys(p)[0] ?? null);
    // An undecided X is never read as two: callers often record one X as two matching copies.
    if (f.copiesX == null) kind = f.zygosity === "hom" ? "x-all" : "x-unclear";
    else kind = f.copiesX === 1 ? "one-x" : f.zygosity === "hom" ? "two-copies" : "two-x";
  } else if (f.zygosity === "hom" && has("AR")) {
    pattern = "AR";
    kind = "two-copies";
  } else if (f.zygosity === "compound_het_unphased" && has("AR")) {
    pattern = "AR";
    kind = "two-changes";
  } else if (has("AD") || has("SD")) {
    pattern = has("AD") ? "AD" : "SD";
    kind = figureFor(f) && !lowPenetrance(f) ? "figure" : "harmful";
  } else if (has("AR")) {
    pattern = "AR";
    kind = "carrier";
  } else {
    pattern = f.mode;
    kind = f.mode === "AR" ? "carrier" : "harmful";
  }
  if (!settled) kind = HARMLESS.includes(cls) ? "harmless" : "not-known";
  return { kind, pattern };
}

// ── P3's figures ──
// Read from cited sources (json/sources/figures.json) and checked against them; no
// clinician has reviewed them. The records P3 draws are marked p3_first; a gene can have several,
// told apart by the codons they cover. A gene held here says it in sentences.
type Complement = "XX" | "XY" | "any";
export type Fig = {
  outcome: string;
  baseline: number;
  added: number;
  /** From families who came to a clinic: P3 says it may run high for someone found by testing. */
  families: boolean;
  source: string;
  flags: string[];
};
type FigRec = {
  gene: string;
  outcome: string;
  complement: string;
  p3_first?: boolean;
  p3_use?: string;
  /** The protein positions this record covers, inclusive; none means any variant. */
  codons?: [number, number][];
  /** Missense changes only. */
  missense?: boolean;
  ascertainment?: string;
  baseline: { value: number };
  with_variant: { value: number; source: { citation: string } };
  flags?: string[];
};
const plainOutcome = (o: string) => o.replace("by late adulthood (~age 70)", "by age 70").replace(/\s*\([^)]*\)/g, "");
/** Genes whose figure stays out of the product: P3 says it in sentences. */
const HELD: Record<string, string> = {
  MYBPC3: "pooled across the thickened-heart-muscle genes, not this gene's own",
  MYH7: "pooled across the thickened-heart-muscle genes, not this gene's own",
  LMNA: "pooled across the enlarged-heart genes, not this gene's own",
};
type Drawn = { complement: Complement; codons?: [number, number][]; missense: boolean; fig: Fig };
/** Each gene's figures in the table's order. */
export const FIGURES: Record<string, Drawn[]> = {};
for (const r of (FIG_TABLE as unknown as { records: FigRec[] }).records) {
  if (!r.p3_first || r.p3_use !== "squares" || HELD[r.gene]) continue;
  const baseline = Math.round(r.baseline.value),
    total = Math.round(r.with_variant.value);
  (FIGURES[r.gene] ??= []).push({
    complement: r.complement as Complement,
    codons: r.codons,
    missense: !!r.missense,
    fig: {
      outcome: plainOutcome(r.outcome),
      baseline,
      added: total - baseline,
      families: r.ascertainment === "clinic/family",
      source: r.with_variant.source.citation,
      flags: r.flags ?? [],
    },
  });
}
/** The protein position an HGVS p. names first ("p.Cys634Arg", "p.(Met918Thr)"), if any. */
const codonOf = (p: string | null | undefined): number | null => {
  const m = p?.match(/^p\.\(?[A-Z][a-z]{2}(\d+)/);
  return m ? Number(m[1]) : null;
};
/**
 * The figure for this variant: among the gene's records whose codons and change it fits, the one for
 * this person's copies of X (one copy reads XY), else the gene's own. Sex is never named.
 */
export const figureFor = (
  f: Pick<Facts, "gene" | "copiesX"> & Partial<Pick<Facts, "consequence" | "p1">>,
): Fig | undefined => {
  const codon = codonOf(f.p1?.hgvs_p);
  const missense = /missense/.test(f.p1?.consequence ?? f.consequence ?? "");
  const fits = (d: Drawn) =>
    (!d.missense || missense) && (!d.codons || (codon != null && d.codons.some(([a, b]) => codon >= a && codon <= b)));
  // A record for these codons wins over the gene-wide one.
  const here = (FIGURES[f.gene] ?? []).filter(fits).sort((a, b) => +!a.codons - +!b.codons);
  // Undecided X: only a figure that pools both.
  const own = f.copiesX === 1 ? "XY" : f.copiesX === 2 ? "XX" : null;
  return ((own && here.find((d) => d.complement === own)) || here.find((d) => d.complement === "any"))?.fig;
};
/** What a drawn figure tells P3's lines: no one gets it anyway, or the figure comes from families. */
export const figureTags = (fig: Fig): string[] => [
  ...(fig.baseline === 0 ? ["figure:no-baseline"] : []),
  ...(fig.families ? ["figure:families"] : []),
];

/** Carriers are about twice the allele frequency: "1 in N", to two significant figures. */
const round1in = (af: number) => {
  const n = 1 / (2 * af);
  const p = Math.pow(10, Math.max(0, Math.floor(Math.log10(n)) - 1));
  return Math.max(2, Math.round(n / p) * p);
};
const DB_PEOPLE = `about ${(Math.round(GNOMAD_PEOPLE / 10_000) * 10_000).toLocaleString("en-US")} people`;

// ── P2's bars ──
// ACMG's evidence as vectors, a strength and a direction, added up on Tavtigian's point scale.
//   labs     what labs saw that can't be shown here, weighted so their call alone lands in its own
//            class, one step weaker for a single lab.
//   rarity   BA1, BS1 and PM2 (at supporting: ClinGen SVI 2020) at the gene's expert-panel thresholds
//            where the CSpec registry has them, else the general ones. Compared on gnomAD's raw
//            GroupMax frequency, so a panel's filtering-frequency rule is met a little too easily.
//   predict  AlphaMissense at ClinGen's calibrated strengths (Bergquist et al. 2025, Table 1).
//   protein  PVS1 by ClinGen's decision tree (Abou Tayoun et al. 2018), from P1's facts and the
//            gene's dosage rating. Not modelled: critical regions, LoF-tolerant exons, cryptic
//            splice sites, initiation codons.
const TIER = (p: number) =>
  p >= 8 ? "very strong" : p >= 4 ? "strong" : p >= 2 ? "moderate" : p >= 1 ? "supporting" : "no weight";

type Rule = { op: string; value: number | null };
type Spec = { gene: string; spec: string; pattern?: string; ba1?: Rule | null; bs1?: Rule | null; pm2?: Rule | null };
const OPS = CSPEC.general as unknown as Record<"BA1" | "BS1" | "PM2", { op: string }>;
const GENERAL: Record<"BA1" | "BS1" | "PM2", Rule> = {
  BA1: { op: OPS.BA1.op, value: RARITY.BA1 },
  BS1: { op: OPS.BS1.op, value: RARITY.BS1 },
  PM2: { op: OPS.PM2.op, value: RARITY.PM2 },
};
const PANELS = new Map<string, Spec[]>();
for (const r of CSPEC.thresholds as unknown as Spec[]) PANELS.set(r.gene, [...(PANELS.get(r.gene) ?? []), r]);
const NUMERIC = new Set(["gt", "ge", "lt", "le", "absent"]);
/** Does this allele frequency meet the rule? Unseen counts as 0. */
function meets(af: number, r: Rule): boolean {
  const v = r.value ?? 0;
  return r.op === "gt"
    ? af > v
    : r.op === "ge"
      ? af >= v
      : r.op === "lt"
        ? af < v
        : r.op === "le"
          ? af <= v
          : r.op === "absent"
            ? af === 0
            : false;
}
/** The gene's thresholds. Several panels merge cautiously: the highest BA1 and BS1, the lowest PM2.
 *  A criterion no panel states as a number takes the general threshold. */
function rarityRules(f: Facts): { ba1: Rule; bs1: Rule; pm2: Rule } {
  let specs = PANELS.get(f.gene) ?? [];
  if (specs.some((s) => s.pattern && f.patterns[s.pattern]))
    specs = specs.filter((s) => !s.pattern || f.patterns[s.pattern]);
  const pick = (k: "ba1" | "bs1" | "pm2", hi: boolean, general: Rule): Rule => {
    const rs = specs.map((s) => s[k]).filter((r): r is Rule => !!r && NUMERIC.has(r.op));
    if (!rs.length) return general;
    return rs.reduce((a, b) => ((b.value ?? 0) > (a.value ?? 0) === hi ? b : a));
  };
  return {
    ba1: pick("ba1", true, GENERAL.BA1),
    bs1: pick("bs1", true, GENERAL.BS1),
    pm2: pick("pm2", false, GENERAL.PM2),
  };
}

/** The labs' call alone lands in its own class: [several labs or a panel, one lab]. */
const LAB: Record<string, [number, number]> = {
  pathogenic: [TAVTIGIAN.harmful, TAVTIGIAN.likelyHarmful],
  "pathogenic-likely": [TAVTIGIAN.harmful, TAVTIGIAN.likelyHarmful],
  "likely-pathogenic": [TAVTIGIAN.likelyHarmful, 4],
  benign: [TAVTIGIAN.harmless, -3],
  "benign-likely": [TAVTIGIAN.harmless, -3],
  "likely-benign": [-3, -1],
};

function barsOf(f: Facts): Bar[] {
  const out: Bar[] = [];
  const cv = f.clinvar,
    cls = cv?.class ?? "absent";
  const firm = cv && ["expert", "guideline", "multiple"].includes(cv.review);
  const lp = LAB[cls] ? LAB[cls][firm ? 0 : 1] : 0;
  out.push({
    id: "labs",
    dir: Math.sign(lp) as -1 | 0 | 1,
    pts: Math.abs(lp),
    tier: lp ? TIER(Math.abs(lp)) : "no weight",
  });
  const af = afOf(f) ?? 0,
    rr = rarityRules(f);
  if (meets(af, rr.ba1)) out.push({ id: "rarity", dir: -1, pts: 8, tier: "stand-alone" });
  else if (meets(af, rr.bs1)) out.push({ id: "rarity", dir: -1, pts: 4, tier: "strong" });
  else if (meets(af, rr.pm2)) out.push({ id: "rarity", dir: 1, pts: 1, tier: "supporting" });
  else out.push({ id: "rarity", dir: 0, pts: 0, tier: "no weight" });
  if (f.consequence === "missense_variant" && f.am) {
    const a = f.am.score;
    // The harmful bands run strongest first (+4 down to +1); the harmless ones weakest first (−1 to −3).
    const hi = AM_BANDS.harmful.findIndex((t) => a >= t);
    const lo = AM_BANDS.harmless.filter((t) => a <= t).length;
    const [dir, pts] = hi >= 0 ? [1, AM_BANDS.harmful.length - hi] : lo ? [-1, lo] : [0, 0];
    out.push({ id: "predict", dir: dir as -1 | 0 | 1, pts, tier: TIER(pts) });
  }
  const p1 = f.p1,
    pc = p1?.consequence ?? "";
  if (p1 && /stop_gained|frameshift|splice_donor|splice_acceptor/.test(pc)) {
    const big = (share: number) => (share > PVS1_SHARE ? 4 : 2);
    let base: number, outcome: string;
    if (/splice/.test(pc)) {
      const sk = p1.skip;
      // An out-of-frame skip escapes decay when the skipped piece is the last or next-to-last;
      // with neither field on record, decay is assumed.
      const nmd = sk ? (sk.nmd ?? (sk.exons != null ? sk.exon < sk.exons - 1 : true)) : true;
      if (!sk) {
        base = 4;
        outcome = "skip-unknown";
      } else if (!sk.inFrame && nmd) {
        base = 8;
        outcome = "skip-out";
      } else if (!sk.inFrame) {
        base = big(sk.share);
        outcome = "skip-out";
      } else {
        base = big(sk.share);
        outcome = sk.share > PVS1_SHARE ? "skip-in-large" : "skip-in-small";
      }
    } else if (p1.fate === "destroyed") {
      base = 8;
      outcome = "destroyed";
    } else if (p1.fate === "no-stop") {
      base = big(p1.lost ?? 1);
      outcome = "no-stop";
    } else {
      base = big(p1.lost ?? 1);
      outcome = (p1.lost ?? 1) > PVS1_SHARE ? "escapes-large" : "escapes-small";
    }
    // Whether losing the gene causes disease: ClinGen's rating, else known harmful cut-short variants, one step weaker.
    const hi = f.dosage?.hi ?? null,
      known = f.dosage?.lofKnown ?? 0;
    const mech =
      hi === "3" || hi === "30"
        ? "clingen"
        : hi === "2"
          ? "clingen-some"
          : hi !== "40" && known >= CNV_LOF_KNOWN_MIN
            ? "clinvar"
            : "none";
    const step = (p: number) => (p >= 8 ? 4 : p >= 4 ? 2 : 1);
    const pts = mech === "none" ? 0 : mech === "clingen" ? base : step(base);
    out.push({ id: "protein", dir: pts ? 1 : 0, pts, tier: TIER(pts), outcome, mech });
  }
  return out;
}
/** Tavtigian's bands; a stand-alone harmless bar settles it on its own. */
function chartOf(bars: Bar[]): { points: number; chart: string } {
  const points = bars.reduce((a, b) => a + b.dir * b.pts, 0);
  const chart = bars.some((b) => b.tier === "stand-alone")
    ? "benign"
    : points >= TAVTIGIAN.harmful
      ? "pathogenic"
      : points >= TAVTIGIAN.likelyHarmful
        ? "likely-pathogenic"
        : points <= TAVTIGIAN.harmless
          ? "benign"
          : points <= TAVTIGIAN.likelyHarmless
            ? "likely-benign"
            : "uncertain";
  return { points, chart };
}

/** The frequency the copy speaks from: gnomAD's GroupMax, or its overall one when GroupMax is missing. */
export const afOf = (f: Facts): number | null => f.gnomad?.af ?? f.gnomad?.af_global ?? null;

function tagsOf(f: Facts, kind: string): string[] {
  const t: string[] = [];
  const cv = f.clinvar;
  const cls = cv?.class ?? "absent";
  t.push(`class:${cls}`);
  t.push(
    HARMFUL.includes(cls)
      ? "harmful"
      : HARMLESS.includes(cls)
        ? "harmless"
        : cls === "conflicting"
          ? "disagree"
          : cls === "absent"
            ? "unclassified"
            : cls === "other"
              ? "unclassed"
              : "uncertain",
  );
  if (cls === "likely-pathogenic" || cls === "likely-benign") t.push("likely");
  if (lowPenetrance(f)) t.push("penetrance:low");
  const rv = !cv ? "none" : cv.review === "guideline" ? "expert" : cv.review;
  t.push(`review:${rv}`);
  if (cv?.conf) {
    const k = Object.keys(cv.conf);
    if (k.some((x) => /athogenic/.test(x))) t.push("calls:harmful");
    if (k.some((x) => /enign/.test(x))) t.push("calls:harmless");
    if (k.some((x) => /Uncertain/.test(x))) t.push("calls:uncertain");
  }
  const af = afOf(f);
  t.push(
    af == null || af === 0
      ? "freq:unseen"
      : af < RARE_AF
        ? "freq:rare"
        : af < RARITY.BA1
          ? "freq:common"
          : "freq:very-common",
  );
  const bars = barsOf(f),
    { chart } = chartOf(bars);
  const bar = (id: string) => bars.find((b) => b.id === id);
  const lean = (b?: Bar) =>
    !b
      ? "none"
      : b.dir > 0
        ? `harmful-${b.tier.replace(" ", "-")}`
        : b.dir < 0
          ? `harmless-${b.tier.replace(" ", "-")}`
          : "no-weight";
  t.push(`predict:${lean(bar("predict"))}`, `rarity:${lean(bar("rarity"))}`, `labs:${lean(bar("labs"))}`);
  const pb = bar("protein");
  if (pb) t.push(`protein:${pb.outcome}`, `protein:mech-${pb.mech}`);
  if (pb && f.p1?.runsOn) t.push("protein:runs-on");
  t.push(`chart:${chart}`);
  const group = (x: string) => (HARMFUL.includes(x) ? "harmful" : HARMLESS.includes(x) ? "harmless" : "open");
  if (["absent", "conflicting", "uncertain", "other"].includes(cls)) t.push("chart:labs-open");
  else t.push(group(chart) === group(cls) ? "chart:agrees" : "chart:differs");
  const c = f.consequence ?? "";
  t.push(
    /nonsense|frameshift/.test(c)
      ? "cut:stops"
      : /splice/.test(c)
        ? "cut:splice"
        : /missense/.test(c)
          ? "cut:swap"
          : /synonymous/.test(c)
            ? "cut:silent"
            : /inframe/.test(c)
              ? "cut:inframe"
              : "cut:other",
  );
  t.push(`p3:${kind}`);
  // A cross gene's dominant condition comes from other changes: a carrier line names the recessive one.
  if (kind === "carrier" && f.cross) t.push("gene:cross");
  const fig = figureFor(f);
  if (fig) t.push(...figureTags(fig));
  return t;
}

/** What a condition with no reviewed name is called: gene-anchored, never ClinGen's raw label. */
const UNNAMED = "a condition linked to this gene";

export type Conditions = Record<string, { name: string; about: string; ok?: boolean }>;
/** Plain words for the classes, per verdict decision. "Very likely" is ACMG's "likely":
 *  more than 90% certain (Richards et al. 2015). */
export const VERDICTS: Record<string, string[]> = {
  pathogenic: ["harmful", "harmful"],
  "likely-pathogenic": ["very likely harmful", "likely harmful"],
  "pathogenic-likely": ["harmful", "harmful or likely harmful"],
  "likely-benign": ["very likely harmless", "likely harmless"],
  benign: ["harmless", "harmless"],
  "benign-likely": ["harmless", "harmless or likely harmless"],
};
export function slotsOf(c: Ctx, d: Decisions, conds: Conditions): Record<string, string | null> {
  const f = c.f,
    cv = f.clinvar;
  const s: Record<string, string | null> = {};
  s.gene = f.gene;
  const clin = c.label;
  const cn = clin ? conds[clin] : undefined;
  // A condition with no reviewed name reads the gene-anchored fallback, never ClinGen's raw label;
  // so does a gene with a pattern and no condition on record.
  const named = cn?.name?.trim() || null;
  s.condition = !clin
    ? c.pattern
      ? UNNAMED
      : null
    : d.condition === 0
      ? (named ?? UNNAMED)
      : d.condition === 1
        ? clin
        : `a condition linked to ${f.gene}`;
  // The first mention adds what the condition is; every later line uses the name alone.
  s.conditionfull = !s.condition
    ? null
    : !clin || (d.condition === 0 && !named)
      ? "a condition caused by changes in this gene"
      : d.condition === 0 && cn?.about
        ? `${s.condition}, ${cn.about}`
        : s.condition;
  // Once P3 has said it, an unnamed condition is "this condition"; a named one keeps its name.
  s.conditionagain = s.condition === UNNAMED ? "this condition" : s.condition;
  s.labcall = cv && VERDICTS[cv.class] ? VERDICTS[cv.class][d.verdict] : null;
  s.verdict = VERDICTS[c.chart] ? VERDICTS[c.chart][d.verdict] : null;
  s.lean = /pathogenic/.test(c.chart) ? "toward harmful" : /benign/.test(c.chart) ? "toward harmless" : null;
  const af = afOf(f);
  s.carriers =
    af && af > 0
      ? d.carriers === 0
        ? `about 1 in ${round1in(af).toLocaleString("en-US")} people`
        : `about ${(2 * af * 100).toPrecision(2)}% of people`
      : null;
  s.db = DB_PEOPLE;
  if (cv?.conf) {
    const conf = cv.conf;
    const n = (re: RegExp) =>
      Object.entries(conf)
        .filter(([k]) => re.test(k))
        .reduce((a, [, v]) => a + v, 0);
    const h = n(/athogenic/),
      u = n(/Uncertain/),
      b = n(/enign/);
    s.labs = num(h + u + b);
    const say = (n: number, w: string) => `${num(n)} say${n === 1 ? "s" : ""} ${w}`;
    const parts = [h && say(h, "harmful"), u && say(u, "uncertain"), b && say(b, "harmless")].filter(
      Boolean,
    ) as string[];
    s.split = parts.length > 1 ? parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1] : (parts[0] ?? null);
  } else {
    s.labs = null;
    s.split = null;
  }
  const share = (x: number | null | undefined) => (x == null ? null : pct(x));
  s.lost = share(f.p1?.lost);
  // A cut-short protein always loses its end.
  const gone = f.p1?.lost != null ? Math.round(f.p1.lost * f.p1.plen) : null;
  s.lostaa = gone == null ? null : `${num(gone)} amino acid${gone === 1 ? "" : "s"}`;
  s.skipped = share(f.p1?.skip?.share);
  const fig = figureFor(f);
  if (fig) {
    s.outcome = fig.outcome;
    s.baseline = num(fig.baseline);
    s.added = num(fig.added);
    s.total = num(fig.baseline + fig.added);
    s.none = num(100 - fig.baseline - fig.added);
  }
  if (isCnv(c.f)) Object.assign(s, cnvSlots(c));
  return s;
}

/** P3 closes by pointing to a clinical lab and a genetic counselor once a variant is settled harmful for
 *  the person, and to a counselor for a carrier; never for an uncertain or harmless one. */
const SETTLED_FOR_YOU = ["figure", "harmful", "two-copies", "two-changes", "one-x", "two-x", "x-unclear", "x-all"];
const nextOf = (p3: string): "settled" | "carrier" | null => {
  const kind = p3.replace(/^cnv-/, "");
  return kind === "carrier" ? "carrier" : SETTLED_FOR_YOU.includes(kind) || kind === "extra" ? "settled" : null;
};

export function context(f: Facts): Ctx {
  const c = isCnv(f)
    ? cnvContext(f, (x) => {
        const fig = figureFor(x);
        return fig && figureTags(fig);
      })
    : smallContext(f);
  const next = nextOf(c.p3);
  if (next) c.tags.push(`next:${next}`);
  return c;
}
function smallContext(f: Facts): Ctx {
  const { kind, pattern } = situation(f);
  const bars = barsOf(f),
    { points, chart } = chartOf(bars);
  const label = pattern
    ? (f.patterns[pattern]?.label ?? Object.values(f.patterns)[0]?.label ?? "")
    : (Object.values(f.patterns)[0]?.label ?? "");
  const name =
    f.hgvs_c && !/^NC_/.test(f.hgvs_c) ? f.hgvs_c : (f.consequence ?? "").replace(/_variant$/, "").replace(/_/g, " ");
  const tags = tagsOf(f, kind);
  if (!label) tags.push("condition:none");
  if (!pattern || pattern === "other") tags.push("pattern:none");
  return { f, tags, p3: kind, pattern, label, title: `${f.gene} ${name}`, bars, points, chart };
}

/** Fill a line: {slot}, and {Slot} capitalised. */
export function fill(t: string, slots: Record<string, string | null>): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = t.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = slots[k.toLowerCase()];
    if (v == null) {
      missing.push(k);
      return `{${k}}`;
    }
    return k[0] === k[0].toUpperCase() ? v[0].toUpperCase() + v.slice(1) : v;
  });
  return { text, missing };
}
/** A line shows when its variant has every tag listed; a leading ! means not. */
export const shows = (l: Line, c: Ctx) =>
  l.when.every((w) => (w.startsWith("!") ? !c.tags.includes(w.slice(1)) : c.tags.includes(w)));

const always = () => true;
const has = (id: string) => (c: Ctx) => c.bars.some((b) => b.id === id);
const leads = (id: string, title: string, about: string): Kind => ({
  id: `p3-${id}`,
  panel: "P3",
  title,
  about,
  member: (c: Ctx) => c.p3 === id,
  units: [
    { id: "lead:1", label: "Line 1", box: "claim", required: always },
    { id: "lead:2", label: "Line 2", box: "claim", required: () => false },
    { id: "lead:3", label: "Line 3", box: "claim", required: () => false },
    { id: "lead:4", label: "Line 4", box: "claim", required: () => false },
  ],
});
/** P2 is an opening line, a bar per piece of evidence with its tier word and one sentence, and a
 *  verdict; P3 is one kind per situation. */
export const KINDS: Kind[] = [
  {
    id: "p2-frame",
    panel: "P2",
    title: "Opening and verdict",
    about:
      "The line before the bars and the line after them. The verdict follows the chart, which adds up the bars; where the chart lands somewhere other than the labs' own call, the card says so.",
    member: always,
    units: [
      { id: "open", label: "Opening", box: "claim", required: always },
      { id: "verdict", label: "Verdict", box: "claim", required: always },
      { id: "condition", label: "Condition", box: "claim", required: (c) => c.tags.includes("harmful") },
    ],
  },
  {
    id: "p2-labs",
    panel: "P2",
    title: "The labs' bar",
    about:
      "What labs saw that can't be shown here, weighted so their call alone lands in its own class, one step weaker for a single lab. No weight when they're uncertain, disagree, or haven't looked.",
    member: has("labs"),
    units: [{ id: "bar:labs", label: "Labs", box: "row", required: always }],
  },
  {
    id: "p2-rarity",
    panel: "P2",
    title: "The rarity bar",
    about:
      "How many people carry it. Too common to cause a rare condition (stand-alone, or strong); unseen or very rare leans slightly harmful; in between, no weight. The gene's expert-panel thresholds where one exists, else the general ones.",
    member: has("rarity"),
    units: [{ id: "bar:rarity", label: "Rarity", box: "row", required: always }],
  },
  {
    id: "p2-predict",
    panel: "P2",
    title: "The prediction bar",
    about: "AlphaMissense, for changes that swap one amino acid, at ClinGen's calibrated strengths.",
    member: has("predict"),
    units: [{ id: "bar:predict", label: "Prediction", box: "row", required: always }],
  },
  {
    id: "p2-protein",
    panel: "P2",
    title: "The protein bar",
    about:
      "Changes that cut the protein short or break a splice signal: what happens to the message, and whether losing the gene causes disease.",
    member: has("protein"),
    units: [{ id: "bar:protein", label: "Protein", box: "row", required: always }],
  },
  {
    id: "p3-figure",
    panel: "P3",
    title: "A figure",
    about: "Harmful, one copy can be enough, and the curated table has a figure. The hundred people.",
    member: (c) => c.p3 === "figure",
    units: [
      { id: "beat:hundred", label: "Beat 1, the hundred", box: "claim", required: always },
      { id: "beat:baseline", label: "Beat 2, baseline", box: "claim", required: always },
      { id: "beat:added", label: "Beat 3, added", box: "claim", required: always },
      { id: "beat:hold", label: "Beat 4, the hold", box: "claim", required: always },
      { id: "row:baseline", label: "Row, baseline", box: "row", required: always },
      { id: "row:added", label: "Row, added", box: "row", required: always },
      { id: "row:none", label: "Row, unaffected", box: "row", required: always },
      {
        id: "beat:families",
        label: "Beat 5, from families",
        box: "claim",
        required: (c) => c.tags.includes("figure:families"),
      },
    ],
  },
  leads("harmful", "Harmful, no figure", "Harmful, one copy can be enough, but no curated figure."),
  leads("carrier", "Carrier", "Harmful, one copy, in a gene where a condition takes two."),
  leads("two-copies", "Two copies", "Harmful, on both copies of a gene where two cause a condition."),
  leads(
    "two-changes",
    "Two different changes",
    "Harmful, with a second harmful change in the same recessive gene; which copies they're on isn't known.",
  ),
  leads("one-x", "One copy of X", "Harmful, X-linked, and the person has one copy of X."),
  leads("two-x", "Two copies of X", "Harmful, X-linked, on one of the person's two copies of X."),
  leads(
    "x-unclear",
    "Copies of X unclear",
    "Harmful, X-linked, on one copy; the file doesn't say whether the person has one copy of X or two.",
  ),
  leads(
    "x-all",
    "Every copy, copies of X unclear",
    "Harmful, X-linked, on every copy the person has; the file doesn't say how many.",
  ),
  leads("not-known", "Not known", "Not settled (uncertain, disagreeing or not in ClinVar). P3 declines."),
  leads("harmless", "Harmless", "ClinVar classes it harmless. P3 resolves to nothing."),
  ...CNV_KINDS,
  {
    id: "p3-next",
    panel: "P3",
    title: "What to do next",
    about:
      "P3's last beat. Settled harmful for you: confirm it with a clinical lab, then a genetic counselor. A carrier: a counselor, if planning a family. Nothing for uncertain or harmless variants.",
    member: (c) => c.tags.some((t) => t.startsWith("next:")),
    units: [
      { id: "next:1", label: "Line 1", box: "claim", required: always },
      { id: "next:2", label: "Line 2", box: "claim", required: (c) => c.tags.includes("next:settled") },
    ],
  },
];
