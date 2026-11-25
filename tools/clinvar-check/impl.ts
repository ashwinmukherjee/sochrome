// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// This repo's code behind the suite's contract: the spine's stages, the P2/P3 facts, then every line a room would show.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Finding, GeneInfo, P23Facts, VariantFacts } from "../../src/contracts/app";
import { ROW_MAX } from "../../src/contracts/constants";
import type {
  AnnotatedVariant,
  Identity,
  InheritanceMode,
  JoinedVariant,
  MendelianBundle,
} from "../../src/contracts/types";
import { check as p1Check } from "../../src/copy/p1/claims";
import { linesOf as p1LinesOf, VOICE as VOICE1 } from "../../src/copy/p1/room";
import { context as p1Context, fill as p1Fill } from "../../src/copy/p1/slots";
import {
  type Conditions,
  context as labContext,
  fill as labFill,
  KINDS,
  type Line as LabLine,
  shows as labShows,
  slotsOf,
} from "../../src/copy/p23/model";
import { CONDITIONS, DECISIONS, SEED as P23SEED } from "../../src/copy/p23/seed";
import { roomCopy } from "../../src/copy/room";
import { STATES } from "../../src/render/states";
import { annotate } from "../../src/spine/annotate";
import { bundle, runHets } from "../../src/spine/bundle";
import { dispatch } from "../../src/spine/facts/dispatch";
import { gate as changesProteinGate } from "../../src/spine/gates/changes_protein";
import { gate as codingGate } from "../../src/spine/gates/coding";
import { joinVariant } from "../../src/spine/join";
import { normalize } from "../../src/spine/normalize";
import { parseVcf } from "../../src/spine/parse";
import { p23Facts } from "../../src/spine/p23";
import { pin } from "../../src/spine/pin";
import { described } from "../build-bundle";
import { ROOT } from "../checks/_check";
import { nodeBundle } from "../spine/node-bundle";
import type { CopyLine, Input, Observed, Scenario } from "./contract.ts";
import { foldSource, inputs, modelFor, modesMap, packDate, type Patterns, patternsMap } from "./lab";

const json = <T>(path: string) => JSON.parse(readFileSync(resolve(ROOT, path), "utf8")) as T;

/** The copy as it stands: the saved state over the seed, as a room loads it. */
interface Saved<L> {
  kinds?: Record<string, { status: string; lines: L[] } | undefined>;
  voice?: Record<string, { pick?: number } | undefined>;
  decisions?: Record<string, { pick?: number } | undefined>;
  genes?: Record<string, { ok?: boolean; edited?: boolean; job?: string | null } | undefined>;
  conditions?: Conditions;
}
const P1SAVED = json<Saved<unknown>>("src/copy/json/copy.json");
const recommended = (options: { rec?: boolean }[]) => options.findIndex((o) => o.rec);
const GENE_LINES = json<Record<string, { job: string | null } | undefined>>("src/copy/json/sources/gene-lines.json");
/** The gene's job line as a room resolves it: the owner's when ticked or typed into, else the generated one. */
const jobOf = (g: string): string | null | undefined => {
  const was = P1SAVED.genes?.[g];
  if (was && (was.ok || was.edited)) return was.job;
  if (g in GENE_LINES) return GENE_LINES[g]?.job;
  return was?.job;
};
const BEATS = new Map(STATES.map((s): [string, string[]] => [`${s.lane}--${s.state}`, s.beats]));

const P23SAVED = json<Saved<LabLine>>("src/copy/json/copy23.json");
const P23LINES: Record<string, LabLine[]> = {};
for (const k of KINDS) {
  const was = P23SAVED.kinds?.[k.id];
  P23LINES[k.id] = !was || was.status === "seed" ? (P23SEED[k.id] ?? []) : was.lines;
}
const CONDS: Conditions = {
  ...Object.fromEntries(Object.entries(CONDITIONS).map(([k, v]) => [k, { ...v, ok: false }])),
  ...(P23SAVED.conditions ?? {}),
};
const pick23 = (id: string) =>
  P23SAVED.decisions?.[id]?.pick ?? recommended(DECISIONS.find((d) => d.id === id)?.options ?? []);
const DEC = { verdict: pick23("verdict"), condition: pick23("condition"), carriers: pick23("carriers") };

interface Tables {
  genes: Map<string, GeneInfo>;
  modes: Map<string, InheritanceMode[]>;
  patterns: Map<string, Patterns>;
  packDate: string;
}
let T: Tables | null = null;
/** Which code ran, for the summary: never a silent switch. */
export const PATHS = { p23: "", copy: "" };
/** Faults planted on purpose (SUITE_PLANT), to prove the suite fails when it should. */
const PLANTS = new Set((process.env.SUITE_PLANT ?? "").split(",").filter(Boolean));

export async function setup(): Promise<void> {
  // The gene data the app ships, built the way tools/build-bundle.ts builds it.
  const shipped = described((await nodeBundle()).genes);
  T = {
    genes: new Map(shipped.map((g) => [g.symbol, g])),
    modes: modesMap(),
    patterns: patternsMap(),
    packDate: packDate(),
  };
  PATHS.p23 = "the app's p23Facts() (src/spine/p23.ts), over the gene data the app ships";
  PATHS.copy = "the copy models";
  if (PLANTS.size) console.error(`planted faults: ${[...PLANTS].join(", ")}`);
}

/** The copies a variant is read under: one copy always; for a gene on X, one X and an X the file leaves undecided (one copy
 *  altered, or every copy); two copies and two changes for a recessive gene. */
function scenarios(chrom: string, modes: string[]): Scenario[] {
  const s: Scenario[] = [{ id: "het", zygosity: "het", copiesX: 2 }];
  if (chrom === "X")
    s.push(
      { id: "one-x", zygosity: "hemi", copiesX: 1 },
      { id: "x-unclear", zygosity: "het", copiesX: null },
      { id: "x-all", zygosity: "hom", copiesX: null },
    );
  if (modes.includes("AR"))
    s.push(
      { id: "hom", zygosity: "hom", copiesX: 2 },
      { id: "two-changes", zygosity: "compound_het_unphased", copiesX: 2 },
    );
  return s;
}

/** The row's name, as the list shows it. */
const nameOf = (a: AnnotatedVariant) => a.hgvs_c ?? `${a.pos}${a.ref}>${a.alt}`;

let roomCopyBuilt: boolean | null = null;
/** What roomCopy() itself returns for a finding, as lines: checked beside the models' once it is built. */
function roomLines(o: Observed, f: Finding, gene: GeneInfo, scenario: string, kinds: Map<string, CopyLine>): void {
  if (roomCopyBuilt === false) return;
  let copy;
  try {
    copy = roomCopy(f, gene);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (roomCopyBuilt === null && /not built yet/.test(message)) {
      roomCopyBuilt = false;
      PATHS.copy = "the copy models (roomCopy() is still a stub: p1Copy and p23Copy are not built yet)";
      return;
    }
    o.throws.push({ stage: "roomCopy", error: message.slice(0, 200) });
    return;
  }
  if (roomCopyBuilt === null) {
    roomCopyBuilt = true;
    PATHS.copy = "the copy models, and roomCopy() for every finding";
  }
  const add = (
    room: CopyLine["room"],
    kind: string,
    unit: string,
    text: string,
    box: CopyLine["box"],
    template = "",
  ) => {
    const twin = kinds.get(`${room}|${scenario}|${text}`);
    if (twin) return;
    const line: CopyLine = { room, scenario, kind: `room:${kind}`, unit, template, text, box, missing: [], implProblems: [] }; // prettier-ignore
    if (box === "row") line.rowMax = room === "P3" ? ROW_MAX.P3 : ROW_MAX.P2;
    o.copy.push(line);
  };
  if (scenario === "het") {
    for (const d of copy.p1)
      for (const l of d.lines)
        add("P1", `${d.drawing.lane}--${d.drawing.kind}`, l.beat ?? "(entrance)", l.text, "claim", l.id);
    add("P2", "p2", "open", copy.p2.open, "claim");
    for (const [id, text] of Object.entries(copy.p2.bars)) if (text) add("P2", "p2", `bar:${id}`, text, "row");
    add("P2", "p2", "verdict", copy.p2.verdict, "claim");
    if (copy.p2.condition) add("P2", "p2", "condition", copy.p2.condition, "claim");
  }
  copy.p3.lines.forEach((text, i) => add("P3", copy.p3.kind, `line:${i + 1}`, text, "claim"));
}

function plant(v: Input, o: Observed): void {
  if (o.scope !== "in") return;
  const line = (text: string, missing: string[] = []): CopyLine => ({ room: "P2", scenario: "het", kind: "planted", unit: "planted", template: "planted", text, box: "claim", missing, implProblems: [] }); // prettier-ignore
  if (PLANTS.has("facts") && o.protein) o.protein.plen += 1;
  if (PLANTS.has("slot")) o.copy.push(line("The codon still spells ⟨from?⟩.", ["from"]));
  if (PLANTS.has("claim") && v.review === "single") o.copy.push(line("A panel of specialists reviewed it."));
  if (PLANTS.has("overflow")) o.copy.push(line(Array.from({ length: 40 }, () => "overlong").join(" ") + "."));
  if (PLANTS.has("throw")) o.throws.push({ stage: "planted", error: "a planted throw" });
  if (PLANTS.has("gap")) o.gaps.push({ room: "P2", kind: "planted", unit: "planted", tags: [], why: "a planted gap" });
  const beside = o as Observed & { labP1?: { skip: { inFrame: boolean } | null }; labPatterns?: object };
  if (PLANTS.has("frame") && beside.labP1?.skip)
    beside.labP1 = { skip: { ...beside.labP1.skip, inFrame: !beside.labP1.skip.inFrame } };
  if (PLANTS.has("carrier")) {
    beside.labPatterns = { AD: { label: "planted", validity: "Definitive" } };
    o.copy.push(line("As a carrier, you won't develop it."));
  }
}

export function observe(v: Input): Observed {
  const o = run(v);
  if (PLANTS.size) plant(v, o);
  return o;
}

function run(v: Input): Observed {
  const o: Observed = {
    id: v.variation_id,
    throws: [],
    scope: "out",
    facts: null,
    copy: [],
    gaps: [],
    implProblems: [],
  };
  const stage = <X>(name: string, f: () => X): X | undefined => {
    try {
      return f();
    } catch (e) {
      o.throws.push({ stage: name, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
      return undefined;
    }
  };
  if (!T) throw new Error("setup() has not run");
  const t = T;
  const chr = `chr${v.chrom}`;
  const I = stage("load", () => inputs(v.chrom));
  if (!I) return o;
  const recs = stage(
    "parse",
    () =>
      parseVcf(
        `#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tS\n${chr}\t${v.pos}\t.\t${v.ref}\t${v.alt}\t.\tPASS\t.\tGT\t0/1\n`,
      )[1],
  );
  if (!recs) return o;
  const norm = stage("normalize", () => normalize(recs, I.refBin, I.refIdx));
  if (!norm) return o;
  const pinned = stage("pin", () => pin(norm, I.tx));
  if (!pinned) return o;
  const row = pinned.find((p) => p.gene === v.gene);
  o.pinnedTo = pinned.map((p) => p.gene).filter((g): g is string => !!g);
  if (!row) {
    o.scopeWhy = pinned.length ? `pinned to ${o.pinnedTo.join(", ") || "no gene"}, not ${v.gene}` : "not pinned";
    return o;
  }
  const a = stage("annotate", () => annotate([row], I.tx, I.refBin, I.refIdx)[0]);
  if (!a) return o;
  const j: JoinedVariant | undefined = stage("join", () => joinVariant(a, I.clinvar, I.gnomad, I.am, I.windows));
  if (!j) return o;
  const coding = stage("gate:coding", () => codingGate(j));
  const changes = changesProteinGate(j);
  const transcript = a.transcript ?? "";
  o.annotation = {
    consequence: a.consequence,
    hgvs_c: a.hgvs_c,
    hgvs_p: a.hgvs_p,
    transcript,
    cds_distance: a.cds_distance,
    splice_distance: a.splice_distance,
    exon_edge: a.exon_edge,
    normalized_key: `${a.chrom}:${a.pos}:${a.ref}:${a.alt}`,
  };
  const cvHit = "absent" in j.clinvar ? null : j.clinvar;
  const gn = "absent" in j.gnomad ? null : j.gnomad;
  const am = "absent" in j.alphamissense ? null : j.alphamissense;
  o.join = {
    clinvar: cvHit
      ? { variation_id: cvHit.variation_id, clnsig: cvHit.clnsig, stars: cvHit.review_stars, hgvs_c: cvHit.hgvs_c }
      : null,
    gnomad: gn
      ? { af: gn.af_grpmax, af_global: gn.af_global, filter: gn.filter, nhomalt: gn.nhomalt, pop: gn.grpmax_pop }
      : { absent: "absent" in j.gnomad ? j.gnomad.reason : "" },
    am,
  };
  o.gates = { coding: !!coding, changesProtein: changes };
  if (!coding) {
    o.scopeWhy = `cut 2: ${a.cds_distance == null ? "no coding sequence" : `${a.cds_distance} letters from the coding sequence`}`;
    return o;
  }
  o.scope = "in";
  const modes = t.modes.get(v.gene) ?? [];
  const b = stage(
    "bundle",
    () =>
      bundle(
        j,
        { object_type: "mendelian", sex: "unknown", inheritance: t.modes, pack_date: t.packDate },
        runHets([j], [chr]),
      ) as MendelianBundle,
  );
  if (b) o.bundle = { zygosity: b.zygosity.state, inheritance: b.inheritance };

  const m = stage("model", () => modelFor(v.chrom, transcript));
  if (!m) return o;
  const fs = foldSource(transcript);
  o.protein = {
    status: fs.status,
    uniprot: fs.uniprot,
    note: fs.note,
    plen: m.protein.length,
    pieces: m.pieces.length,
    tailComplete: m.tailComplete,
  };
  const id = {
    gene: v.gene,
    transcript,
    hgvs_c: a.hgvs_c,
    hgvs_p: a.hgvs_p ?? { absent: true, reason: "no protein change asserted" },
    normalized_key: `${chr}:${a.pos}:${a.ref}:${a.alt}`,
    consequence: a.consequence,
    splice_distance: a.splice_distance ?? { absent: true, reason: "exonic" },
    exon_edge: a.exon_edge ?? { absent: true, reason: "not at an exon edge" },
  } as Identity;
  const cv = {
    variation_id: cvHit?.variation_id ?? null,
    stars: cvHit?.review_stars ?? null,
    clnsig: cvHit?.clnsig ?? null,
  };
  const f: VariantFacts | undefined = stage("dispatch", () => dispatch(id, m, cv, fs, `cc:${v.variation_id}`, I.get));
  if (!f) return o;
  o.facts = f;
  const fateD = f.drawings.find((d) => d.fate)?.fate ?? null;
  const codon = f.drawings.map((d) => d.codon).find(Boolean) as { terminator?: number; seam?: number } | undefined;
  o.derived = {
    fate: fateD,
    terminator: codon?.terminator ?? null,
    seam: codon?.seam ?? null,
    row: f.row,
    drawings: f.drawings.map((d) => `${d.lane}--${d.kind}`),
    pending: f.pending,
    junction:
      f.drawings.map((d) => (d.transcript as { junction?: unknown } | undefined)?.junction).find(Boolean) ?? null,
  };

  stage("p1", () => {
    for (let i = 0; i < f.drawings.length; i++) {
      const d = f.drawings[i];
      const c = p1Context(f, i);
      const lines = p1LinesOf(c.kind);
      if (!lines || !lines.length) {
        o.gaps.push({ room: "P1", kind: c.kind, unit: "(any)", tags: c.tags, why: "no template for this drawing" });
        continue;
      }
      const beats = d.beats ?? BEATS.get(c.kind) ?? [];
      const shown = lines.filter((l) => l.when.every((tag) => c.tags.includes(tag)));
      for (const l of shown) {
        // The room has no such beat here, so the line is dropped.
        if (l.beat != null && !beats.includes(l.beat)) continue;
        const fl = p1Fill(l.t, c, jobOf(f.gene), VOICE1);
        const cl = p1Check(l.claims, c);
        const ip: string[] = [];
        if (cl.untrue.length) ip.push(`claim untrue here: ${cl.untrue.join(", ")}`);
        if (cl.unknown.length) ip.push(`no such claim: ${cl.unknown.join(", ")}`);
        if (cl.unaudited) ip.push("claims not declared");
        o.copy.push({ room: "P1", scenario: "het", kind: c.kind, unit: l.beat ?? "(entrance)", template: l.id, text: fl.text, box: "claim", missing: fl.missing, implProblems: ip, drawing: i }); // prettier-ignore
      }
      const written = new Set(lines.map((l) => l.beat).filter((x): x is string => !!x));
      // A classed variant's effect is P2's to weigh, so a beat whose lines all say "isn't known" stays
      // empty for it by decision. A gap is a beat with no line even when the variant is read as open.
      const asOpen = c.tags.map((tag) => (tag === "classed" ? "open" : tag));
      for (const bt of beats)
        if (
          written.has(bt) &&
          !shown.some((l) => l.beat === bt) &&
          !lines.some((l) => l.beat === bt && l.when.every((tag) => asOpen.includes(tag)))
        )
          o.gaps.push({ room: "P1", kind: c.kind, unit: bt, tags: c.tags, why: "no line shows for this beat" });
      if (!shown.some((l) => l.beat != null && beats.includes(l.beat)))
        o.gaps.push({ room: "P1", kind: c.kind, unit: "(all beats)", tags: c.tags, why: "only the opening shows" });
    }
  });

  stage("p23", () => {
    if (!b) throw new Error("no bundle to read the P2/P3 facts from");
    const gene = t.genes.get(v.gene);
    // The app's own facts, under each copy scenario: p23Facts reads the copies from the bundle's zygosity.
    const factsFor = (sc: Scenario): P23Facts =>
      p23Facts(j, { ...b, zygosity: { ...b.zygosity, state: sc.zygosity } } as MendelianBundle, f, m, gene, sc.copiesX as 1 | 2 | null); // prettier-ignore
    const het = factsFor(scenarios(v.chrom, modes)[0]);
    // check.ts reads these two beside the contract: the skipped piece's frame, and the gene's ClinGen patterns.
    Object.assign(o, { labP1: het.p1, labPatterns: t.patterns.get(v.gene) ?? {} });
    for (const sc of scenarios(v.chrom, modes)) {
      const lf = sc.id === "het" ? het : factsFor(sc);
      const c = labContext(lf);
      const slots = slotsOf(c, DEC, CONDS);
      o.lab ??= {};
      o.lab[sc.id] = {
        tags: c.tags,
        p3: c.p3,
        pattern: c.pattern,
        label: c.label,
        chart: c.chart,
        points: c.points,
        bars: c.bars.map((x) => `${x.id}:${x.dir > 0 ? "+" : x.dir < 0 ? "-" : ""}${x.pts}`),
      };
      const mine = new Map<string, CopyLine>();
      for (const k of KINDS) {
        if (!k.member(c)) continue;
        // P2 doesn't depend on the copies.
        if (k.panel === "P2" && sc.id !== "het") continue;
        for (const u of k.units) {
          const hit = P23LINES[k.id].filter((l) => l.unit === u.id && labShows(l, c));
          if (!hit.length) {
            if (u.required(c))
              o.gaps.push({ room: k.panel, scenario: sc.id, kind: k.id, unit: u.id, tags: c.tags, why: "no line covers this" }); // prettier-ignore
            continue;
          }
          const fl = labFill(hit[0].t, slots);
          const line: CopyLine = { room: k.panel as CopyLine["room"], scenario: sc.id, kind: k.id, unit: u.id, template: hit[0].id, text: fl.text, box: u.box, missing: fl.missing, implProblems: hit.length > 1 ? [`${hit.length} lines compete`] : [] }; // prettier-ignore
          if (u.box === "row") line.rowMax = k.panel === "P3" ? ROW_MAX.P3 : ROW_MAX.P2;
          o.copy.push(line);
          mine.set(`${line.room}|${sc.id}|${line.text}`, line);
        }
      }
      if (sc.id === "het") for (const l of o.copy) if (l.room === "P1") mine.set(`P1|het|${l.text}`, l);
      if (gene) {
        const finding: Finding = { key: `${id.normalized_key}:${v.gene}`, name: nameOf(a), bundle: b, facts: f, p23: lf, lowConfidence: false }; // prettier-ignore
        roomLines(o, finding, gene, sc.id, mine);
      }
    }
  });
  return o;
}
