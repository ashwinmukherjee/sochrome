// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Bootstrap only: writes test/fixtures/*.result.json from the sibling repos' outputs, until build-samples replaces it.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { Finding, GenomeResult, Mark, P23Facts, SampleId, VariantFacts } from "../src/contracts/app";
import { CHROMS, CHROM_X } from "../src/contracts/constants";
import type { Identity, JoinedVariant, MendelianBundle } from "../src/contracts/types";
import { annotate } from "../src/spine/annotate";
import { bundle, runHets } from "../src/spine/bundle";
import { dispatch, type FoldSource } from "../src/spine/facts/dispatch";
import type { GeneModel } from "../src/spine/facts/model";
import { joinVariant, parseGnomadWindows } from "../src/spine/join";
import { normalize } from "../src/spine/normalize";
import { parseVcf } from "../src/spine/parse";
import { pin } from "../src/spine/pin";
import { loadPackedTable, loadReferenceIndex, lookupExact, readGnomadPayload } from "../src/spine/tables";

const HERE = resolve(import.meta.dirname, "..");
const UP = resolve(HERE, "..");
const SPINE = resolve(UP, ["mi", "zen-spine"].join(""));
const BENCH = resolve(UP, ["mi", "zen-bench"].join(""));
const LAB = resolve(UP, ["mi", "zen-lab"].join(""));
const DATA = resolve(UP, ["mi", "zen-data"].join(""), "out");
const CLINVAR = resolve(UP, "raw/clinvar/clinvar.vcf.gz");
/** ClinVar's release the packs were built from. */
const DATA_DATE = "2026-10-19";

interface LabHelpers {
  CLASS(raw: string): string;
  REVIEW(revstat: string): string;
  conflictCounts(conf: string): Record<string, number> | null;
  patternsMap(): Map<string, Record<string, { label: string; validity: string }>>;
  dosageMap(): Map<string, string>;
  lofKnownMap(genes: Set<string>): Promise<Map<string, number>>;
  modesMap(): Map<string, string[]>;
  governing(modes: string[] | undefined, twoCopies: boolean): string | null;
  genesInSet(): Set<string>;
  p1Lab(
    a: { consequence: string; hgvs_c: string; hgvs_p: string | null },
    m: GeneModel,
    pos: number,
    fate: string | null,
    terminator: number | null,
  ): P23Facts["p1"];
  foldSource(transcript: string): FoldSource;
}
interface Loaders {
  modelFor(chrom: string, transcript: string): GeneModel;
  chromData(chrom: string): { get: (pos: number, n: number) => string | null };
}
const lab = (await import(resolve(BENCH, "scripts/lab-facts.ts"))) as LabHelpers;
const load = (await import(resolve(SPINE, "src/facts/load.ts"))) as Loaders;

const json = <T>(path: string) => JSON.parse(readFileSync(path, "utf8")) as T;
const buf = (path: string): ArrayBuffer => {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

const genes = lab.genesInSet();
const modes = lab.modesMap();
const patterns = lab.patternsMap();
const dosage = lab.dosageMap();
const lofKnown = await lab.lofKnownMap(genes);
const packDate = json<{ pack_date: string }>(resolve(DATA, "manifest.json")).pack_date;

/** The consequence in ClinVar's words, as the P2/P3 model reads it. */
const SO = (c: string, ref: string, alt: string): string =>
  (
    ({
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
      inframe_indel:
        ref.length > alt.length ? "inframe_deletion" : ref.length < alt.length ? "inframe_insertion" : "inframe_indel",
    }) as Record<string, string>
  )[c] ?? c;

const AA: Record<string, string> = {
  Ala: "A",
  Arg: "R",
  Asn: "N",
  Asp: "D",
  Cys: "C",
  Gln: "Q",
  Glu: "E",
  Gly: "G",
  His: "H",
  Ile: "I",
  Leu: "L", // prettier-ignore
  Lys: "K",
  Met: "M",
  Phe: "F",
  Pro: "P",
  Ser: "S",
  Thr: "T",
  Trp: "W",
  Tyr: "Y",
  Val: "V",
  Ter: "*", // prettier-ignore
};
/** A row's variant name: the protein change in one-letter form when it is a simple one, else the cDNA change. */
function variantName(b: MendelianBundle): string {
  const p = b.identity.hgvs_p;
  const m = typeof p === "string" ? /^p\.([A-Z][a-z]{2})(\d+)([A-Z][a-z]{2})$/.exec(p) : null;
  return m && AA[m[1]] && AA[m[3]] ? `${AA[m[1]]}${m[2]}${AA[m[3]]}` : b.identity.hgvs_c;
}

/** ClinVar's own record for each key: its review status and, where labs disagree, how they split. */
function clinvarRecords(keys: string[]): Map<string, { id: string; clnsig: string; revstat: string; conf: string }> {
  const regions = resolve(mkdtempSync(resolve(tmpdir(), "fixtures-")), "regions.tsv");
  writeFileSync(regions, keys.map((k) => k.split(":")).map(([c, p]) => `${c}\t${p}\t${p}`).join("\n") + "\n"); // prettier-ignore
  const out = execFileSync("bcftools", ["query", "-R", regions, "-f", "%CHROM\t%POS\t%REF\t%ALT\t%ID\t%INFO/CLNSIG\t%INFO/CLNREVSTAT\t%INFO/CLNSIGCONF\n", CLINVAR], { maxBuffer: 1 << 28 }).toString(); // prettier-ignore
  const by = new Map<string, { id: string; clnsig: string; revstat: string; conf: string }>();
  for (const line of out.split("\n").filter(Boolean)) {
    const [c, p, r, a, id, clnsig, revstat, conf] = line.split("\t");
    by.set(`${c}:${p}:${r}:${a}`, { id, clnsig, revstat: revstat.replace(/_/g, " ").replace(/ ,/g, ","), conf });
  }
  return by;
}

const packs = new Map<string, ReturnType<typeof loadPackedTable>>();
const gnomadPack = (chrom: string) => {
  if (!packs.has(chrom)) packs.set(chrom, loadPackedTable(buf(resolve(DATA, `gnomad.chr${chrom}.bin`))));
  return packs.get(chrom) as ReturnType<typeof loadPackedTable>;
};

/** What P2 and P3 speak from, for one finding. */
function p23Of(
  b: MendelianBundle,
  f: VariantFacts,
  cv: Map<string, { id: string; clnsig: string; revstat: string; conf: string }>,
  copiesX: number,
): P23Facts {
  const [chr, posS, ref, alt] = b.identity.normalized_key.split(":");
  const chrom = chr.replace(/^chr/, "");
  const pos = +posS;
  const key = `${chrom}:${pos}:${ref}:${alt}`;
  const gene = b.identity.gene;
  const rec = cv.get(key);
  const patho = b.claims[0].value;
  const am = b.claims[2].value;
  const pack = gnomadPack(chrom);
  const at = lookupExact(pack, pos, ref, alt);
  const gn = at == null ? null : readGnomadPayload(pack.payload, at);
  const fate = f.drawings.find((d) => d.fate)?.fate ?? null;
  const terminator =
    (f.drawings.map((d) => d.codon).find(Boolean) as { terminator?: number } | undefined)?.terminator ?? null;
  const geneModes = modes.get(gene) ?? [];
  const zygosity = b.zygosity.state;
  return {
    key,
    gene,
    chrom,
    hgvs_c: b.identity.hgvs_c,
    consequence: SO(b.identity.consequence, ref, alt),
    clinvar: rec
      ? { id: rec.id, clnsig: rec.clnsig, class: lab.CLASS(rec.clnsig), review: lab.REVIEW(rec.revstat), revstat: rec.revstat, stars: "absent" in patho ? null : patho.review_stars, conf: lab.conflictCounts(rec.conf) } // prettier-ignore
      : null,
    gnomad: gn
      ? { af: gn.af_grpmax, af_global: gn.af_global, pop: gn.grpmax_pop, nhomalt: gn.nhomalt, filter: gn.filter }
      : null,
    am: "absent" in am ? null : am,
    mode: lab.governing(geneModes, zygosity === "hom" || zygosity === "compound_het_unphased"),
    patterns: patterns.get(gene) ?? {},
    set: "yours",
    zygosity,
    copiesX,
    p1: lab.p1Lab(
      {
        consequence: b.identity.consequence,
        hgvs_c: b.identity.hgvs_c,
        hgvs_p: typeof b.identity.hgvs_p === "string" ? b.identity.hgvs_p : null,
      },
      load.modelFor(chr, b.identity.transcript),
      pos,
      fate,
      terminator,
    ),
    dosage: { hi: dosage.get(gene) ?? null, lofKnown: lofKnown.get(gene) ?? 0 },
  };
}

const finding = (b: MendelianBundle, f: VariantFacts, p23: P23Facts): Finding => ({
  key: `${b.identity.normalized_key}:${b.identity.gene}`,
  name: variantName(b),
  bundle: b,
  facts: f,
  p23,
  lowConfidence: false,
});

interface LabFile {
  all: number;
  parsed: number[];
  counts: { coding: number; protein: number; rare: number; validity: number };
  marks: Mark[];
}
interface Bundles {
  survivors: MendelianBundle[];
  carriers: MendelianBundle[];
  throws: GenomeResult["throws"];
}

/** A sample, from the spine's own outputs. The GIAB files have no X; the donor's X count is public. */
function sample(id: SampleId, bundlesFile: string, factsFile: string, donorX: 1 | 2): GenomeResult {
  const bundles = json<Bundles>(resolve(SPINE, "out", bundlesFile));
  const facts = new Map(json<VariantFacts[]>(resolve(SPINE, "out", factsFile)).map((f) => [f.id, f]));
  const l = json<LabFile>(resolve(LAB, "data", `lab.${id}.json`));
  const all = [...bundles.survivors, ...bundles.carriers];
  const cv = clinvarRecords(all.map((b) => b.identity.normalized_key.replace(/^chr/, "")));
  const make = (b: MendelianBundle): Finding => {
    const f = facts.get(`${id}:${b.identity.normalized_key}:${b.identity.gene}`);
    if (!f) throw new Error(`${id}: no facts for ${b.identity.normalized_key} ${b.identity.gene}`);
    return finding(b, f, p23Of(b, f, cv, donorX));
  };
  const yours = bundles.survivors.map(make);
  const carriers = bundles.carriers.map(make);
  if (yours.length + carriers.length !== l.counts.validity)
    throw new Error(`${id}: ${yours.length} + ${carriers.length} is not ${l.counts.validity}`);
  return {
    source: { kind: "sample", id },
    displayName: id.toUpperCase(),
    copiesX: null,
    sexPair: donorX === 1 ? "XY" : "XX",
    parsed: l.parsed,
    counts: {
      all: l.all,
      coding: l.counts.coding,
      protein: l.counts.protein,
      rare: l.counts.validity,
      yours: yours.length,
      carriers: carriers.length,
    },
    marks: l.marks,
    yours,
    carriers,
    checked: { genes: genes.size, leftOut: 0, coverage: "vcf" },
    dataDate: DATA_DATE,
    throws: bundles.throws,
  };
}

/** One variant through the spine's stages, as a file with one record would be read. */
function through(
  chrom: string,
  pos: number,
  ref: string,
  alt: string,
  gene: string,
  gt: string,
  copiesX: number,
): Finding {
  const c = `chr${chrom}`;
  const refBin = buf(resolve(DATA, `reference.${c}.bin`));
  const refIdx = loadReferenceIndex(readFileSync(resolve(DATA, `reference.${c}.json`), "utf8"));
  const tx = json<Parameters<typeof pin>[1]>(resolve(DATA, `transcripts.${c}.json`));
  const [, recs] = parseVcf(
    `#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tS\n${c}\t${pos}\t.\t${ref}\t${alt}\t.\tPASS\t.\tGT\t${gt}\n`,
  );
  const row = pin(normalize(recs, refBin, refIdx), tx).find((p) => p.gene === gene);
  if (!row) throw new Error(`${gene} ${chrom}:${pos} did not pin`);
  const a = annotate([row], tx, refBin, refIdx)[0];
  const table = (kind: string) => loadPackedTable(buf(resolve(DATA, `${kind}.${c}.bin`)));
  const j: JoinedVariant = joinVariant(a, table("clinvar"), table("gnomad"), table("alphamissense"), parseGnomadWindows(readFileSync(resolve(DATA, `cds_windows.${c}.bed`), "utf8"))); // prettier-ignore
  const ctx = {
    object_type: "mendelian",
    sex: copiesX === 1 ? "male" : "female",
    inheritance: modes,
    pack_date: packDate,
  } as unknown as Parameters<typeof bundle>[1];
  const b = bundle(j, ctx, runHets([j], [c])) as MendelianBundle;
  const id: Identity = b.identity;
  const cvInfo = "absent" in j.clinvar ? { variation_id: null, stars: null, clnsig: null } : { variation_id: j.clinvar.variation_id, stars: j.clinvar.review_stars, clnsig: j.clinvar.clnsig }; // prettier-ignore
  const f = dispatch(
    id,
    load.modelFor(c, id.transcript),
    cvInfo,
    lab.foldSource(id.transcript),
    `x:${id.normalized_key}:${gene}`,
    load.chromData(c).get,
  );
  return finding(b, f, p23Of(b, f, clinvarRecords([`${chrom}:${a.pos}:${a.ref}:${a.alt}`]), copiesX));
}

const hg002 = sample("hg002", "bundles.hg002.json", "facts.hg002.json", 1);
const hg001 = sample("hg001", "bundles.json", "facts.json", 2);

/** A genome with nothing rare: the descent ends at 0 and the list is the negative screen. */
const empty: GenomeResult = {
  ...hg002,
  counts: { ...hg002.counts, rare: 0, yours: 0, carriers: 0 },
  marks: hg002.marks.map((m): Mark => (m[3] === 3 ? [m[0], m[1], m[2], 2, 0, ""] : m)),
  yours: [],
  carriers: [],
};

/** A file that has an X, read as one copy of X: three X-linked findings added to the sample. */
const X_VARIANTS: [number, string, string, string][] = [
  [31180394, "A", "T", "DMD"],
  [22190447, "G", "A", "PHEX"],
  [153725495, "T", "TGGCTCCTGC", "ABCD1"],
];
const xs = X_VARIANTS.map(([pos, ref, alt, gene]) => through("X", pos, ref, alt, gene, "1", 1));
const X_RECORDS = 98_112;
const xOne: GenomeResult = {
  ...hg002,
  displayName: "X-ONE",
  copiesX: 1,
  sexPair: "X",
  parsed: hg002.parsed.map((n, i) => (i === CHROM_X ? X_RECORDS : n)),
  counts: {
    all: hg002.counts.all + X_RECORDS,
    coding: hg002.counts.coding + xs.length,
    protein: hg002.counts.protein + xs.length,
    rare: hg002.counts.rare + xs.length,
    yours: hg002.counts.yours + xs.length,
    carriers: hg002.counts.carriers,
  },
  marks: [
    ...hg002.marks,
    ...xs.map((f): Mark => [CHROM_X, +f.bundle.identity.normalized_key.split(":")[1], 0, 3, 0, f.bundle.identity.gene]),
  ],
  yours: [...hg002.yours.map((f) => ({ ...f, p23: { ...f.p23, copiesX: 1 } })), ...xs],
};

const OUT = resolve(HERE, "test/fixtures");
for (const [name, r] of Object.entries({ hg002, hg001, empty, "x-one": xOne })) {
  if (r.parsed.length !== CHROMS.length) throw new Error(`${name}: parsed has ${r.parsed.length} entries`);
  if (r.parsed.reduce((a, b) => a + b, 0) !== r.counts.all) throw new Error(`${name}: parsed does not sum to all`);
  if (r.counts.yours + r.counts.carriers !== r.counts.rare) throw new Error(`${name}: yours + carriers is not rare`);
  writeFileSync(resolve(OUT, `${name}.result.json`), JSON.stringify(r) + "\n");
  console.log(
    `${name}: ${r.counts.all} → ${r.counts.coding} → ${r.counts.protein} → ${r.counts.rare} → ${r.counts.yours} + ${r.counts.carriers} carriers; marks ${r.marks.length}`,
  );
}
