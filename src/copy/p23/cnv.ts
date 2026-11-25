// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copy-number changes: their bars, chart, tags, slots and P3 situation, in the shapes model.ts uses. The words are in cnv-seed.ts.

// P2 is ClinGen dosage-led; P3 has the small changes' gate. The bars follow Riggs et al. 2020
// (Genet Med 22:245), with Abou Tayoun et al. 2018's PVS1 strengths for partial changes.
// Every bar is in tenths of a Riggs point (1.00 is 10), so tier words and sums read on the small
// changes' scale; the chart's bands are Riggs's, which differ from Tavtigian's between 6 and 9.
import { CNV_LOF_KNOWN_MIN, CNV_MANY_GENES, PVS1_SHARE } from "../../contracts/constants";
import type { Bar, Ctx, Facts, Kind } from "./model";
import { HARMFUL, HARMLESS, num, pct } from "./words";

// model.ts imports this file, so its figure lookup comes in as an argument: a drawn figure's tags, or none.
type Figures = (f: Facts) => string[] | undefined;

export type Cnv = {
  dir: "loss" | "gain";
  type: string;
  name: string;
  chrom: string;
  start: number;
  end: number;
  size: number;
  copies: number;
  copiesStated: boolean;
  transcript: string;
  /** Where the change sits in the gene's coding sequence. */
  where: "whole" | "start" | "end" | "last-exon" | "inside";
  whole: boolean;
  exons: { first: number; last: number; of: number } | null;
  fullExons: number;
  share: number;
  inFrame: boolean | null;
  plen: number;
  /** Genes in the set whose coding sequence it touches, this one included, and the others' names. */
  genes: number;
  others: string[];
  /** Protein-coding genes it spans, once the bundle carries a gene list; until then the set's own count is the floor. */
  codingGenes?: number;
  rating: { hi: string | null; ts: string | null; hiDisease: string | null; tsDisease: string | null };
  /** A ClinGen region scored 3 for this direction that the change wholly contains, holding this gene. */
  region: { id: string; name: string; score: string; disease: string | null } | null;
  /** Other reviewed, focal ClinVar copy-number changes in the same direction over the same part of the gene. */
  overlaps: { harmful: number; uncertain: number; harmless: number };
  rarity: { measured: false; source: string };
  /** The condition for this direction where it isn't the gene's own (gains; whole-region losses). */
  condition: { id: string; label: string } | null;
};
export type CnvFacts = Facts & { cnv: Cnv };
export const isCnv = (f: Facts): f is CnvFacts => !!(f as { cnv?: Cnv }).cnv;
export type CnvBarId = "deletion" | "duplication" | "overlap" | "svrarity";

/** Tier words on the tenths scale: Riggs's PVS1 levels land where the small changes' tiers do. */
export const cnvTier = (p: number) =>
  p >= 9 ? "very strong" : p >= 4.5 ? "strong" : p >= 3 ? "moderate" : p >= 1 ? "supporting" : "no weight";
/** One step weaker: 1.00 and 0.90 to 0.45, 0.45 to 0.30, 0.30 to 0.15. */
const step = (p: number) => (p >= 9 ? 4.5 : p >= 4.5 ? 3 : p >= 3 ? 1.5 : 0);
const r1 = (x: number) => Math.round(x * 10) / 10;

// ── The gene bar ──
// How much of the gene the change touches, weighed by whether that dosage change causes disease.
// One bar, because Riggs scores the two together (section 2). Base strength by extent:
//   loss  whole gene 10 (2A) · the start 9 (2C-1) · the end, several pieces 9 (2D-4) ·
//         the last piece only 3 (2D-3) · inside, reading thrown off 9 (2E at PVS1) ·
//         inside, in step: 4.5 above the PVS1 share of the protein, 3 at or below
//   gain  whole gene 10 (2A) · inside, reading thrown off 4.5 (2I, presumed in tandem) ·
//         inside in step, or one end inside the gene: 0 (2I, 2J)
// The mechanism scales it: ClinGen 3 (or 30 for a loss), or a scored-3 region it wholly contains,
// full strength; ClinGen 2, or unrated with enough known harmful cut-short variants, one step
// weaker; otherwise no weight.
type Outcome =
  | "loss-whole"
  | "loss-start"
  | "loss-end"
  | "loss-last"
  | "loss-off"
  | "loss-in-large"
  | "loss-in-small"
  | "gain-whole"
  | "gain-off"
  | "gain-in"
  | "gain-edge";
function outcomeOf(c: Cnv): { outcome: Outcome; base: number } {
  if (c.dir === "loss") {
    if (c.where === "whole") return { outcome: "loss-whole", base: 10 };
    if (c.where === "start") return { outcome: "loss-start", base: 9 };
    if (c.where === "end") return { outcome: "loss-end", base: 9 };
    if (c.where === "last-exon") return { outcome: "loss-last", base: 3 };
    if (!c.inFrame) return { outcome: "loss-off", base: 9 };
    return c.share > PVS1_SHARE ? { outcome: "loss-in-large", base: 4.5 } : { outcome: "loss-in-small", base: 3 };
  }
  if (c.where === "whole") return { outcome: "gain-whole", base: 10 };
  if (c.where === "inside") return c.inFrame ? { outcome: "gain-in", base: 0 } : { outcome: "gain-off", base: 4.5 };
  return { outcome: "gain-edge", base: 0 };
}
type Mech = "clingen" | "clingen-region" | "clingen-some" | "clinvar" | "unlikely" | "none";
function mechOf(f: CnvFacts, outcome: Outcome): Mech {
  const c = f.cnv;
  const triplo = outcome === "gain-whole";
  const s = triplo ? c.rating.ts : c.rating.hi;
  if (s === "3" || (!triplo && s === "30")) return "clingen";
  if (c.region && (outcome === "loss-whole" || outcome === "gain-whole")) return "clingen-region";
  if (s === "2") return "clingen-some";
  if (s === "40") return "unlikely";
  if (!triplo && (f.dosage?.lofKnown ?? 0) >= CNV_LOF_KNOWN_MIN) return "clinvar";
  return "none";
}
/** A change over this many genes can't be read from one of them (Riggs 2020, section 3): P2 says so and P3 declines. */
const manyGenes = (c: Cnv) => (c.codingGenes ?? c.genes) > CNV_MANY_GENES;
/** A strong rating for this direction: what P3's gate and the figure need. */
const strongMech = (m: Mech) => m === "clingen" || m === "clingen-region";
type GeneBar = Bar & { outcome: Outcome; mech: Mech };

/** The labs' bar on Riggs's bands: [several labs or a panel, one lab]. */
const LAB: Record<string, [number, number]> = {
  pathogenic: [10, 9],
  "pathogenic-likely": [10, 9],
  "likely-pathogenic": [9, 4.5],
  benign: [-10, -9],
  "benign-likely": [-10, -9],
  "likely-benign": [-9, -4.5],
};

/** Similar ClinVar changes: Riggs 4E's size both ways, one per record up to three; no weight when mixed or uncertain. */
function overlapBar(c: Cnv): Bar {
  const { harmful: h, harmless: b, uncertain: u } = c.overlaps;
  const outcome = h && b ? "mixed" : h ? "harmful" : b ? "harmless" : u ? "uncertain" : "none";
  const pts = outcome === "harmful" ? Math.min(3, h) : outcome === "harmless" ? Math.min(3, b) : 0;
  const dir = outcome === "harmful" ? 1 : outcome === "harmless" ? -1 : 0;
  return { id: "overlap", dir, pts, tier: cnvTier(pts), outcome };
}

/** Rarity needs a population set of copy-number changes. The bundle holds none, so the bar is not drawn;
 *  its kind and line stay drafted for when one is. */
const SV_RARITY_MEASURED = false;
const rarityBar = (): Bar => ({ id: "svrarity", dir: 0, pts: 0, tier: "not measured", outcome: "not-measured" });

export function cnvBars(f: CnvFacts): Bar[] {
  const c = f.cnv,
    cv = f.clinvar,
    cls = cv?.class ?? "absent";
  const firm = cv && ["expert", "guideline", "multiple"].includes(cv.review);
  const lp = LAB[cls] ? LAB[cls][firm ? 0 : 1] : 0;
  const out: Bar[] = [
    { id: "labs", dir: Math.sign(lp) as -1 | 0 | 1, pts: Math.abs(lp), tier: lp ? cnvTier(Math.abs(lp)) : "no weight" },
  ];
  const { outcome, base } = outcomeOf(c);
  const mech = mechOf(f, outcome);
  const pts = !base ? 0 : strongMech(mech) ? base : mech === "clingen-some" || mech === "clinvar" ? step(base) : 0;
  out.push({
    id: c.dir === "loss" ? "deletion" : "duplication",
    dir: pts ? 1 : 0,
    pts,
    tier: cnvTier(pts),
    outcome,
    mech,
  });
  out.push(overlapBar(c));
  if (SV_RARITY_MEASURED) out.push(rarityBar());
  return out;
}
/** Riggs's bands, on tenths. */
export function cnvChart(bars: Bar[]): { points: number; chart: string } {
  const points = r1(bars.reduce((a, b) => a + b.dir * b.pts, 0));
  const chart =
    points >= 9.9
      ? "pathogenic"
      : points >= 9
        ? "likely-pathogenic"
        : points > -9
          ? "uncertain"
          : points > -9.9
            ? "likely-benign"
            : "benign";
  return { points, chart };
}
const geneBar = (bars: Bar[]): GeneBar => {
  const b = bars.find((x) => x.id === "deletion" || x.id === "duplication");
  if (!b) throw new Error("a copy-number change has no gene bar");
  return b as GeneBar;
};

// ── P3: the small changes' gate, plus the direction's rating ──
// Settled harmful: the labs call it harmful, the chart agrees, and ClinGen rates this direction
// strongly for the gene. A settled loss that takes the gene out, in a gene with a curated figure,
// takes that figure. Labs harmless resolves to nothing. Everything else declines, saying why.
const FIGURE_OUTCOMES: Outcome[] = ["loss-whole", "loss-start", "loss-end", "loss-off"];
/** ClinGen's dosage ratings; anything else is unrated. */
const RATED = /^(0|1|2|3|30|40)$/;
function cnvSituation(
  f: CnvFacts,
  bars: Bar[],
  chart: string,
  FIGURES: Figures,
): { kind: string; pattern: string | null; why: string | null } {
  const c = f.cnv,
    p = f.patterns,
    has = (m: string) => !!p[m];
  const cls = f.clinvar?.class ?? "absent";
  const gb = geneBar(bars);
  const strong =
    c.dir === "loss" ? c.rating.hi === "3" || c.rating.hi === "30" || !!c.region : c.rating.ts === "3" || !!c.region;
  const pattern = has("AD") ? "AD" : has("SD") ? "SD" : has("XL") ? "XL" : has("AR") ? "AR" : f.mode;
  if (HARMLESS.includes(cls)) return { kind: "harmless", pattern, why: null };
  // A gene ClinGen hasn't rated strongly: a loss that takes the gene out still settles when enough known
  // harmful cut-short variants show that losing it is the mechanism. Gains keep the strict gate.
  const unratedLoss = c.dir === "loss" && gb.mech === "clinvar" && FIGURE_OUTCOMES.includes(gb.outcome);
  const many = manyGenes(c);
  const settled =
    HARMFUL.includes(cls) && ["pathogenic", "likely-pathogenic"].includes(chart) && (strong || unratedLoss) && !many;
  const why = !HARMFUL.includes(cls)
    ? "open"
    : many
      ? "many-genes"
      : gb.outcome === "gain-off"
        ? "dup-breaks"
        : !strong && !unratedLoss
          ? `labs-only-${c.dir}`
          : "open";
  if (!settled) return { kind: "cnv-not-known", pattern, why };
  if (c.dir === "gain") return { kind: "cnv-extra", pattern, why: null };
  if (f.chrom === "X" || pattern === "XL")
    return {
      kind:
        f.copiesX == null
          ? c.copies === 0
            ? "cnv-x-all"
            : "cnv-x-unclear"
          : f.copiesX === 1
            ? "cnv-one-x"
            : "cnv-two-x",
      pattern: "XL",
      why: null,
    };
  const recessive = c.rating.hi === "30" || (!has("AD") && !has("SD") && has("AR"));
  const ar = has("AR") ? "AR" : pattern;
  if (c.copies === 0)
    return recessive ? { kind: "cnv-two-copies", pattern: ar, why: null } : { kind: "cnv-harmful", pattern, why: null };
  if (recessive) return { kind: "cnv-carrier", pattern: ar, why: null };
  if (FIGURES(f) && FIGURE_OUTCOMES.includes(gb.outcome)) return { kind: "figure", pattern, why: null };
  return { kind: "cnv-harmful", pattern, why: null };
}

/** The small changes' labs and chart tags, then the change's own. "harmful" means settled harmful here;
 *  a labs-harmful change that isn't settled carries "labs:harmful-call". */
function cnvTags(
  f: CnvFacts,
  bars: Bar[],
  chart: string,
  sit: { kind: string; why: string | null },
  FIGURES: Figures,
): string[] {
  const t: string[] = [],
    cv = f.clinvar,
    c = f.cnv;
  const cls = cv?.class ?? "absent";
  t.push(`class:${cls}`);
  if (sit.kind !== "harmless" && sit.kind !== "cnv-not-known") t.push("harmful");
  else if (HARMLESS.includes(cls)) t.push("harmless");
  else if (cls === "conflicting") t.push("disagree");
  else if (cls === "absent") t.push("unclassified");
  else if (HARMFUL.includes(cls)) t.push("labs:harmful-call");
  else t.push("uncertain");
  if (cls === "likely-pathogenic" || cls === "likely-benign") t.push("likely");
  t.push(`review:${!cv ? "none" : cv.review === "guideline" ? "expert" : cv.review}`);
  if (cv?.conf) {
    const k = Object.keys(cv.conf);
    if (k.some((x) => /athogenic/.test(x))) t.push("calls:harmful");
    if (k.some((x) => /enign/.test(x))) t.push("calls:harmless");
    if (k.some((x) => /Uncertain/.test(x))) t.push("calls:uncertain");
  }
  const lean = (b?: Bar) =>
    !b
      ? "none"
      : b.dir > 0
        ? `harmful-${b.tier.replace(" ", "-")}`
        : b.dir < 0
          ? `harmless-${b.tier.replace(" ", "-")}`
          : "no-weight";
  t.push(`labs:${lean(bars.find((b) => b.id === "labs"))}`);
  t.push(`chart:${chart}`);
  const group = (x: string) => (HARMFUL.includes(x) ? "harmful" : HARMLESS.includes(x) ? "harmless" : "open");
  if (["absent", "conflicting", "uncertain"].includes(cls)) t.push("chart:labs-open");
  else t.push(group(chart) === group(cls) ? "chart:agrees" : "chart:differs");
  t.push(`cnv:${c.dir}`, c.whole ? "cnv:whole" : "cnv:partial");
  if (c.genes > 1) t.push("cnv:others");
  if (c.copies === 0) t.push("cnv:both-copies");
  const gb = geneBar(bars);
  const weight = strongMech(gb.mech) ? "full" : gb.mech === "clingen-some" || gb.mech === "clinvar" ? "some" : "none";
  // Over many genes the gene bar's sentence says so, in place of the extent and the mechanism.
  if (manyGenes(c)) t.push("cnv:many-genes", "gene:many-genes");
  else t.push(`gene:${gb.outcome}`, `gene:mech-${gb.mech}`, `gene:weight-${weight}`);
  // ClinGen's rating for the direction the copy reads: loss for a deletion, an extra copy for a whole gain.
  const rd = (c.dir === "gain" && c.whole ? c.rating.ts : c.rating.hi) ?? "unrated";
  t.push(`rating:${RATED.test(rd) ? rd : "unrated"}`);
  t.push(`overlap:${bars.find((b) => b.id === "overlap")?.outcome ?? "none"}`);
  if (bars.some((b) => b.id === "svrarity")) t.push("svrarity:not-measured");
  t.push(`p3:${sit.kind}`);
  if (sit.why) t.push(`decline:${sit.why}`);
  if (sit.kind === "figure") t.push(...(FIGURES(f) ?? []));
  // A deletion read as a carrier in a gene that also has a dominant condition (ClinGen rates its loss recessive).
  if (sit.kind === "cnv-carrier" && (f.patterns.AD || f.patterns.SD)) t.push("gene:cross");
  return t;
}

/** The slots a copy-number line uses, beside model.ts's own. */
export function cnvSlots(c: Ctx): Record<string, string | null> {
  if (!isCnv(c.f)) return {};
  const x = c.f.cnv,
    s: Record<string, string | null> = {};
  s.change = x.dir === "loss" ? "deletion" : "duplication";
  // Exons are "pieces", as P1's splice lines call them.
  s.pieces = !x.exons
    ? null
    : x.exons.first === x.exons.last
      ? `piece ${x.exons.first}`
      : x.exons.last === x.exons.first + 1
        ? `pieces ${x.exons.first} and ${x.exons.last}`
        : `pieces ${x.exons.first} to ${x.exons.last}`;
  s.npieces = x.exons ? num(x.exons.of) : null;
  s.share = x.whole ? null : pct(x.share);
  // The other genes it reaches are counted in the gene set only, so "at least".
  const o = x.others.length;
  s.along = o ? `, along with at least ${num(o)} other gene${o === 1 ? "" : "s"},` : "";
  const ov = x.overlaps,
    n =
      ov.harmful && !ov.harmless
        ? ov.harmful
        : !ov.harmful && ov.harmless
          ? ov.harmless
          : !ov.harmful && !ov.harmless
            ? ov.uncertain
            : ov.harmful + ov.harmless;
  s.similar = n ? `${n === 1 ? "one other" : num(n) + " other"} ${s.change}${n === 1 ? "" : "s"}` : null;
  return s;
}

export function cnvContext(f: CnvFacts, FIGURES: Figures): Ctx {
  const bars = cnvBars(f),
    { points, chart } = cnvChart(bars);
  const sit = cnvSituation(f, bars, chart, FIGURES);
  const c = f.cnv;
  const label =
    c.condition?.label ??
    (sit.pattern ? f.patterns[sit.pattern]?.label : undefined) ??
    Object.values(f.patterns)[0]?.label ??
    "";
  const ex = c.exons
    ? c.exons.first === c.exons.last
      ? `exon ${c.exons.first}`
      : `exons ${c.exons.first}-${c.exons.last}`
    : "";
  const what =
    c.dir === "loss"
      ? c.whole
        ? c.copies === 0
          ? "deletion of both copies"
          : "whole-gene deletion"
        : `deletion, ${ex}`
      : c.whole
        ? "whole-gene duplication"
        : `duplication, ${ex}`;
  return {
    f,
    tags: cnvTags(f, bars, chart, sit, FIGURES),
    p3: sit.kind,
    pattern: sit.pattern,
    label,
    title: `${f.gene} ${what}`,
    bars,
    points,
    chart,
  };
}

// The copy-number kinds. P2's frame and labs bar, and P3's figure and harmless, are the small
// changes' own kinds, shared: their lines read the same tags.
const always = () => true;
const has = (id: string) => (c: Ctx) => c.bars.some((b) => b.id === id);
const bar = (id: string, label: string) => [{ id: `bar:${id}`, label, box: "row" as const, required: always }];
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
  ],
});
export const CNV_KINDS: Kind[] = [
  {
    id: "p2-deletion",
    panel: "P2",
    title: "Deletion: the gene bar",
    member: has("deletion"),
    units: bar("deletion", "Gene"),
    about:
      "How much of the gene a deletion removes, weighed by whether losing the gene causes disease (ClinGen's haploinsufficiency rating).",
  },
  {
    id: "p2-duplication",
    panel: "P2",
    title: "Duplication: the gene bar",
    member: has("duplication"),
    units: bar("duplication", "Gene"),
    about:
      "What a duplication does to the gene. A whole extra copy counts only where ClinGen rates the gene, or a region it fully covers, triplosensitive. A copied piece that throws the reading off breaks the gene if it sits in tandem. Nearly every duplication lands uncertain.",
  },
  {
    id: "p2-overlap",
    panel: "P2",
    title: "Similar changes in ClinVar",
    member: has("overlap"),
    units: bar("overlap", "Similar"),
    about:
      "Other reviewed ClinVar records in the same direction over the same part of this gene, at most three genes long.",
  },
  {
    id: "p2-svrarity",
    panel: "P2",
    title: "Rarity, for copy-number changes",
    member: has("svrarity"),
    units: bar("svrarity", "Rarity"),
    about: "How many people carry a change like this: not measured until a population set is in the bundle.",
  },
  leads(
    "cnv-harmful",
    "Deletion, harmful",
    "Settled harmful, one copy can be enough, no curated figure (or a deletion that keeps the reading in step, or takes only the last piece).",
  ),
  leads("cnv-carrier", "Deletion, carrier", "Settled harmful, one copy lost in a gene where a condition takes two."),
  leads("cnv-two-copies", "Deletion of both copies", "Settled harmful, both copies of a recessive gene lost."),
  leads("cnv-one-x", "Deletion, one copy of X", "Settled harmful, X-linked, and the person has one copy of X."),
  leads("cnv-two-x", "Deletion, two copies of X", "Settled harmful, X-linked, on one of the person's two copies of X."),
  leads(
    "cnv-x-unclear",
    "Deletion, copies of X unclear",
    "Settled harmful, X-linked, on one copy; the file doesn't say how many copies of X.",
  ),
  leads(
    "cnv-x-all",
    "Deletion of every copy, copies of X unclear",
    "Settled harmful, X-linked, removing every copy; the file doesn't say how many.",
  ),
  leads(
    "cnv-extra",
    "Duplication, harmful",
    "Settled harmful: labs call it harmful and ClinGen rates an extra copy of the gene, or a region it covers, as causing disease.",
  ),
  leads(
    "cnv-not-known",
    "Copy-number change, not known",
    "Not settled: labs uncertain, disagreeing or silent, or labs call it harmful but ClinGen doesn't rate this direction strongly for the gene. P3 declines.",
  ),
];
