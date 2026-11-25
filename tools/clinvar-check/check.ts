// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The ClinVar suite: real variants through the facts and every room's copy. Flags: --known, --limit n, --only ids.

/* Three kinds of check. (1) The facts against expected.tsv, an independent annotator's reading.
   (2) Each sentence against the facts it states (TEXT_CLAIMS): read off the filled text and tested
   against expected.tsv and ClinVar's row, never against the implementation's own routing.
   (3) The mechanics: a stage that throws, a slot with no value, a line too long for its box, a part
   of a room no line covers. Exits 1 on any problem; with --known, on any problem not in known.tsv. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import type { Input, Expected, Observed, CopyLine } from "./contract.ts";
import { fit } from "./fit.ts";
import { setup, observe, PATHS } from "./impl.ts";
import type { Consequence, InheritanceMode } from "../../src/contracts/types.ts";

const HERE = new URL("./", import.meta.url).pathname;
const args = process.argv.slice(2);
const arg = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};

/* ── inputs ── */
function tsv(path: string): Record<string, string>[] {
  const lines = readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"));
  const h = lines[0].split("\t");
  return lines.slice(1).map((l) => Object.fromEntries(l.split("\t").map((x, i) => [h[i], x])));
}
let V: Input[] = tsv(HERE + "variants.tsv").map(
  (r) => ({ ...r, pos: +r.pos, submitters: r.submitters ? +r.submitters : null }) as unknown as Input,
);
const E = new Map<string, Expected>(
  tsv(HERE + "expected.tsv").map((r) => [
    r.variation_id,
    {
      ...r,
      aa: r.aa ? +r.aa : null,
      plen: r.plen ? +r.plen : null,
      skip_exon: r.skip_exon ? +r.skip_exon : null,
      skip_inframe: r.skip_inframe === "True" ? true : r.skip_inframe === "False" ? false : null,
      tx_ok: r.tx_ok === "True",
    } as unknown as Expected,
  ]),
);
if (arg("--only")) {
  const s = new Set(arg("--only")!.split(","));
  V = V.filter((v) => s.has(v.variation_id));
}
if (arg("--limit")) V = V.slice(0, +arg("--limit")!);
/* known.tsv: kind, a regular expression on the problem's description, why, who */
const KNOWN: { kind: string; re: RegExp }[] =
  args.includes("--known") && existsSync(HERE + "known.tsv")
    ? readFileSync(HERE + "known.tsv", "utf8")
        .split("\n")
        .filter((l) => l && !l.startsWith("#"))
        .map((l) => {
          const [kind, re] = l.split("\t");
          return { kind, re: new RegExp(re) };
        })
    : [];

/* ── findings ── */
type Finding = { kind: string; sub: string; id: string; gene: string; detail: string; text?: string; where?: string };
const F: Finding[] = [];
const add = (kind: string, sub: string, v: Input, detail: string, x: Partial<Finding> = {}) =>
  F.push({ kind, sub, id: v.variation_id, gene: v.gene, detail, ...x });

/* ── 1. the facts against the oracle ── */
const EFFECT: Record<string, (e: Expected) => boolean> = {
  missense: (e) => e.effect === "missense" || e.effect === "multi-missense",
  synonymous: (e) => e.effect === "synonymous",
  synonymous_splice_region: (e) => e.effect === "synonymous",
  stop_gained: (e) => e.effect === "stop_gained",
  frameshift: (e) => e.effect === "frameshift",
  inframe_indel: (e) => e.effect === "inframe_del" || e.effect === "inframe_ins",
  start_lost: (e) => e.effect === "start_lost",
  stop_lost: (e) => e.effect === "stop_lost" || e.loc === "spans_cds_utr",
  splice_donor: (e) => e.loc === "splice_site" || e.loc === "spans_exon_intron",
  splice_acceptor: (e) => e.loc === "splice_site" || e.loc === "spans_exon_intron",
  // an insertion at +2/+3 or -3/-2 leaves the two essential letters in place: the facts stage reads
  // the letters (dispatch), the oracle only the position, so it calls these splice_site
  splice_region: (e) => e.loc === "splice_region" || e.loc === "spans_exon_intron",
  intronic: (e) => e.loc === "splice_region" || e.loc === "beyond-8",
  utr: (e) => e.loc === "utr" || e.loc === "spans_cds_utr" || e.loc === "beyond-8",
};
const posOf = (hp: string | null) => {
  const m = /^p\.[A-Z][a-z]{2}(\d+)/.exec(hp ?? "");
  return m ? +m[1] : null;
};
function compare(v: Input, e: Expected, o: Observed) {
  if (!e) return;
  // a letter other than A, C, G or T is no change the facts stage can read (normalize drops it)
  const plain = /^[ACGT]+$/.test(v.ref) && /^[ACGT]+$/.test(v.alt);
  if (!plain) {
    if (o.scope !== "out") add("facts", "a record with a non-ACGT letter reached the facts", v, `${v.ref}>${v.alt}`);
    return;
  }
  // a UTR change within 8 letters passes cut 2 by design and stops at the protein gate
  if (e.loc === "utr" && o.annotation?.consequence === "utr") return;
  if (e.scope !== o.scope && !(e.loc === "structural"))
    add(
      "facts",
      `scope: expected ${e.scope}, got ${o.scope}`,
      v,
      `${e.loc}/${e.effect} vs ${o.annotation?.consequence ?? o.scopeWhy ?? "-"}`,
    );
  if (!o.annotation || o.scope !== "in") return;
  const c = o.annotation.consequence;
  const insAtSite = c === "splice_region" && e.loc === "splice_site" && /(dup|ins)/.test(o.annotation.hgvs_c ?? "");
  if (EFFECT[c] && !EFFECT[c](e) && e.scope === "in" && !insAtSite)
    add(
      "facts",
      `consequence: ${c} vs oracle ${e.effect !== "-" ? e.effect : e.loc}`,
      v,
      `${o.annotation.hgvs_c} ${o.annotation.hgvs_p ?? ""}`,
    );
  if (e.plen && o.protein && e.plen !== o.protein.plen)
    add("facts", "protein length differs", v, `oracle ${e.plen}, facts ${o.protein.plen}`);
  const at = posOf(o.annotation.hgvs_p);
  if (at && e.aa && ["missense", "stop_gained"].includes(c) && EFFECT[c](e) && at !== e.aa)
    add("facts", `first amino acid changed differs (${c})`, v, `oracle ${e.aa}, HGVS ${o.annotation.hgvs_p}`);
  if ((c === "stop_gained" || c === "frameshift") && e.fate && o.derived) {
    const exp = /^nmd/.test(e.fate)
      ? "destroyed"
      : e.fate === "nonstop"
        ? "no-stop"
        : /^escape|extension/.test(e.fate)
          ? "made"
          : null;
    const got = o.derived.fate ?? (o.derived.pending.some((p) => /reference ran out/.test(p)) ? "unread" : "made");
    if (exp && exp !== got)
      add(
        "facts",
        `the stop's fate: ${got} vs oracle ${e.fate}`,
        v,
        `${o.annotation.hgvs_c} ${o.annotation.hgvs_p ?? ""}, stop at codon ${o.derived.terminator}, protein ${o.protein?.plen}`,
      );
  }
  if (/splice_(donor|acceptor)/.test(c) && e.skip_inframe != null) {
    const sk = (o.facts && (o as any).labP1?.skip) ?? null;
    if (sk && e.exon_kind === "coding" && sk.inFrame !== e.skip_inframe)
      add(
        "facts",
        "skipped exon's frame differs",
        v,
        `facts ${sk.inFrame ? "in" : "out of"} frame (exon ${sk.exon}), oracle ${e.skip_inframe ? "in" : "out of"} frame (exon ${e.skip_exon})`,
      );
  }
}

/* ── 2. what a sentence states, tested against the facts it states ── */
const PANEL_BA1 = new Set<string>(
  (
    JSON.parse(readFileSync(HERE + "../../src/copy/json/sources/cspec-thresholds.json", "utf8")).thresholds as {
      gene: string;
      ba1?: unknown;
    }[]
  )
    .filter((r) => r.ba1)
    .map((r) => r.gene),
);
const PAR = [
  [10001, 2781479],
  [155701383, 156030895],
];
const inPar = (v: Input) => v.chrom === "X" && PAR.some(([s, e]) => v.pos >= s && v.pos <= e);
const WORDN: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
};
const nOf = (s: string) => WORDN[s.toLowerCase()] ?? +s.replace(/,/g, "");
type TC = {
  id: string;
  says: string;
  re: RegExp;
  rooms?: string[];
  holds: (x: { v: Input; e: Expected; o: Observed; l: CopyLine; m: RegExpExecArray }) => boolean | null;
};
const HARMFUL_CLASSES = ["P", "LP", "P/LP"];
export const TEXT_CLAIMS: TC[] = [
  {
    id: "one-swap",
    says: "one amino acid is swapped",
    re: /swaps a single amino acid/,
    holds: ({ e }) => e.effect === "missense",
  },
  {
    id: "position-of",
    says: "the change is at position N of a protein M long",
    re: /at position ([\d,]+) of ([\d,]+)/,
    rooms: ["P1"],
    holds: ({ e, m }) =>
      e.plen == null ? null : nOf(m[2]) === e.plen && (e.effect !== "missense" || e.aa == null || nOf(m[1]) === e.aa),
  },
  {
    id: "removes-aa",
    says: "amino acids are removed",
    re: /removes (\w+) amino acids?/,
    holds: ({ e }) => e.effect === "inframe_del",
  },
  {
    id: "adds-aa",
    says: "amino acids are added",
    re: /adds (\w+) amino acids?/,
    holds: ({ e }) => e.effect === "inframe_ins",
  },
  {
    id: "now-stop",
    says: "a codon now reads as a stop",
    re: /now reads as a stop|is now a stop|cuts the protein short/,
    holds: ({ e }) => e.effect === "stop_gained" || e.effect === "frameshift",
  },
  {
    id: "destroyed",
    says: "the cell destroys the message",
    re: /destroys the (shortened )?message|no protein is made|makes no protein/,
    holds: ({ e, l }) =>
      /^nmd/.test(e.fate) || e.fate === "nonstop" || e.fate === "ext:None"
        ? true
        : /start|later start/.test(l.text)
          ? null
          : false,
  },
  {
    id: "shorter-made",
    says: "a shorter protein is made",
    re: /makes a shorter protein|shortened protein is still made|Most of the protein is still made/,
    holds: ({ e }) => /^escape/.test(e.fate),
  },
  // the oracle files a frameshift whose new stop lands a codon or two past the old one, short of
  // its own threshold, under escape:last-exon: no verdict from it there
  {
    id: "longer-made",
    says: "a longer protein is made",
    re: /makes a longer protein/,
    holds: ({ e }) =>
      e.fate === "extension" || e.effect === "stop_lost" ? true : e.fate === "escape:last-exon" ? null : false,
  },
  {
    id: "silent",
    says: "every amino acid stays the same",
    re: /every amino acid in the protein stays the same|the change is silent/,
    holds: ({ e }) => e.effect === "synonymous",
  },
  {
    id: "splice-signal",
    says: "it breaks a signal for joining the gene's pieces",
    re: /breaks a signal for joining/,
    holds: ({ e }) => (e.loc === "splice_site" || e.loc === "spans_exon_intron" ? true : null),
  },
  {
    id: "skip-out",
    says: "skipping the piece throws the reading off",
    re: /skipped and everything after it misread/,
    holds: ({ e }) => (e.skip_inframe == null ? null : !e.skip_inframe),
  },
  {
    id: "skip-in",
    says: "skipping the piece keeps the reading",
    re: /removing .* of the protein|small piece of the protein is likely skipped/,
    holds: ({ e }) => (e.skip_inframe == null ? null : e.skip_inframe),
  },
  {
    id: "expert",
    says: "a panel of specialists reviewed it",
    re: /panel of specialists/,
    holds: ({ v }) => v.review === "expert" || v.review === "guideline",
  },
  {
    id: "several-labs",
    says: "several labs reviewed it and all agree",
    re: /Several labs reviewed it independently, and all call it/,
    holds: ({ v }) => v.review === "multiple" && (v.submitters == null ? null : v.submitters >= 2),
  },
  {
    id: "one-lab",
    says: "one clinical lab reviewed it",
    re: /A clinical lab reviewed it|The lab that reviewed it/,
    holds: ({ v }) => v.review === "single",
  },
  {
    id: "lab-classified",
    says: "a lab has classified it",
    re: /A lab has classified it as/,
    holds: ({ v }) => !["none", "no-classification"].includes(v.review) || v.class !== "other",
  },
  {
    id: "labs-uncertain",
    says: "labs call it uncertain",
    re: /classify it as uncertain/,
    holds: ({ v }) => v.class === "VUS" || /VUS|Uncertain/.test(v.clnsig),
  },
  {
    id: "n-labs",
    says: "N labs reviewed it and split",
    re: /Of (\w+) labs that reviewed it/,
    holds: ({ v, m }) => (v.class !== "conflicting" ? false : v.submitters == null ? null : nOf(m[1]) <= v.submitters),
  },
  {
    id: "no-lab",
    says: "no lab has classified it",
    re: /No lab has classified it yet/,
    holds: ({ v }) => !["P", "LP", "P/LP", "VUS", "LB", "B", "B/LB", "conflicting"].includes(v.class),
  },
  // AC0: gnomAD lists the allele but no high-quality genotype carries it, so "not seen" holds.
  // outside_scope: the pack never held it (its anchor base lies outside CDS +-8), so it doesn't.
  {
    id: "unseen",
    says: "it hasn't been seen in gnomAD",
    re: /hasn't been seen among/,
    holds: ({ o }) => ["not_in_table", "ac0"].includes(o.join?.gnomad?.absent),
  },
  // 5% is BA1's general cut-off; a gene's expert panel can set a lower one (CSpec)
  {
    id: "very-common",
    says: "far too many people carry it for a rare condition",
    re: /far too many for it to cause/,
    holds: ({ v, o }) =>
      PANEL_BA1.has(v.gene) ? null : (o.join?.gnomad?.af ?? o.join?.gnomad?.af_global ?? 0) >= 0.05,
  },
  {
    id: "not-classed",
    says: "labs haven't called it harmful or harmless",
    re: /haven't called it harmful or harmless/,
    holds: ({ v }) => !/athogenic|enign/.test(v.clnsig.split("|")[0]),
  },
  {
    id: "predict",
    says: "a missense prediction exists",
    re: /A computer prediction/,
    holds: ({ e, o }) => e.effect === "missense" && !!o.join?.am,
  },
  {
    id: "on-x",
    says: "the gene is on the X chromosome",
    re: /sits on the X chromosome/,
    holds: ({ v }) => v.chrom === "X",
  },
  {
    id: "one-x-enough",
    says: "with one copy of X, this copy alone can cause it",
    re: /Since you have one copy of X/,
    holds: ({ v }) => v.chrom === "X" && !inPar(v),
  },
  {
    id: "dominant",
    says: "one copy can be enough to cause the condition",
    re: /one copy can be enough to cause/,
    holds: ({ o, l }) => {
      const lab = o.lab?.[l.scenario];
      if (!lab) return null;
      const p = lab.pattern;
      return p === "AD" || p === "SD" || p === "XL";
    },
  },
  {
    id: "recessive",
    says: "the condition takes two altered copies",
    re: /only develops with two altered copies|takes two altered copies|two altered copies of this gene are what cause/i,
    holds: ({ o, l }) => {
      const lab = o.lab?.[l.scenario];
      return lab ? lab.pattern === "AR" : null;
    },
  },
  {
    id: "carrier-safe",
    says: "you won't develop it",
    re: /you won't develop it/,
    holds: ({ v, o, l }) => {
      const lab = o.lab?.[l.scenario];
      if (!lab) return null;
      // the gene must have no dominant pattern (a carrier of one harmful BRCA1 copy is at risk)
      const pats = Object.keys((o as any).labPatterns ?? {});
      return !pats.includes("AD") && !pats.includes("SD") && !(v.chrom === "X");
    },
  },
  {
    id: "harmful-condition",
    says: "it's linked to the condition (a settled harmful variant)",
    re: /^It's linked to /,
    holds: ({ v }) => HARMFUL_CLASSES.includes(v.class) || /^(Pathogenic|Likely_pathogenic)/.test(v.clnsig),
  },
];

/* ── 3. the mechanics ── */
const SLOT = /\{(\w+)\}|⟨(\w+)\?⟩/;
function lineChecks(v: Input, e: Expected, o: Observed) {
  for (const l of o.copy) {
    const where = `${l.room} ${l.kind} ${l.unit}${l.scenario !== "het" ? ` (${l.scenario})` : ""} [${l.template}]`;
    if (l.missing.length || SLOT.test(l.text))
      add(
        "missing slot",
        `${l.room} ${l.kind} ${l.unit}: {${[...new Set(l.missing)].join(", ") || SLOT.exec(l.text)![1]}}`,
        v,
        "",
        { text: l.text, where },
      );
    if (l.box === "claim") {
      const r = fit(l.text);
      for (const b of r)
        if (b.over)
          add(
            "overflow",
            `${l.room} ${l.kind} ${l.unit}: ${b.label} ${b.lines} lines (max ${b.max})${b.borderline ? ", borderline" : ""}`,
            v,
            "",
            { text: l.text, where },
          );
    } else if (l.rowMax && l.text.length > l.rowMax)
      add("overflow", `${l.room} ${l.kind} ${l.unit}: row ${l.text.length} characters (max ${l.rowMax})`, v, "", {
        text: l.text,
        where,
      });
    for (const p of l.implProblems)
      add("impl", `${l.room} ${l.kind} ${l.unit}: ${p.replace(/\d+ lines compete/, "lines compete")}`, v, p, {
        text: l.text,
        where,
      });
    for (const tc of TEXT_CLAIMS) {
      if (tc.rooms && !tc.rooms.includes(l.room)) continue;
      const m = tc.re.exec(l.text);
      if (!m) continue;
      const h = e ? tc.holds({ v, e, o, l, m }) : null;
      if (h === false)
        add("wrong claim", `${tc.id}: ${tc.says}`, v, `${l.room} ${l.kind} ${l.unit}`, { text: l.text, where });
    }
  }
  for (const g of o.gaps)
    add("no line", `${g.room} ${g.kind} ${g.unit}: ${g.why}`, v, g.tags.join(" "), {
      where: `${g.room}${g.scenario && g.scenario !== "het" ? ` (${g.scenario})` : ""}`,
    });
  for (const t of o.throws)
    add(
      "throws",
      `${t.stage}: ${t.error.replace(/\d+:\d+[^\s]*|chr\w+:\d+[^\s]*|c\.[^\s]+|NM_[\d.]+/g, "…").slice(0, 90)}`,
      v,
      t.error,
    );
}
/* odd genes: what about the gene, not the variant, makes the facts unusual */
const ODD = new Map<string, Set<string>>();
function oddGene(v: Input, e: Expected, o: Observed) {
  const note = (k: string) => (ODD.get(k) ?? ODD.set(k, new Set()).get(k)!).add(v.gene);
  if (e && !e.tx_ok)
    note("MANE coding sequence isn't a clean ORF (no ATG start, a stop inside, or not a multiple of 3)");
  if (o.protein?.status === "no-uniprot-match") note("UniProt's protein isn't the MANE protein (P1 draws no fold)");
  if (o.protein?.status === "no-alphafold-model") note("no AlphaFold model (or a partial one)");
  if (o.protein && o.protein.pieces > 150) note("more than 150 coding pieces");
  if (o.protein && !o.protein.tailComplete) note("the shipped reference ends before the message does");
  if ((o.pinnedTo?.length ?? 0) > 1) note("coding sequence overlaps another gene's");
  if (/-/.test(v.gene)) note("readthrough or hyphenated symbol");
  if (inPar(v)) note("on X's pseudoautosomal region (two copies in everyone)");
  if (o.facts?.drawings?.some((d: any) => d.standIn)) note("drawn with a stand-in");
}

/* ── run ── */
await setup();
mkdirSync(HERE + "out", { recursive: true });
const obsOut: string[] = [];
const t0 = Date.now();
const S: { v: Input; o: Observed; bad: boolean }[] = [];
for (const [i, v] of V.entries()) {
  const e = E.get(v.variation_id)!;
  let o: Observed;
  try {
    o = observe(v);
  } catch (err) {
    o = {
      id: v.variation_id,
      throws: [{ stage: "observe", error: String(err) }],
      scope: "out",
      facts: null,
      copy: [],
      gaps: [],
      implProblems: [],
    };
  }
  const n0 = F.length;
  compare(v, e, o);
  lineChecks(v, e, o);
  oddGene(v, e, o);
  S.push({ v, o, bad: F.length > n0 });
  obsOut.push(JSON.stringify({ ...o, facts: undefined }));
  if (i % 250 === 249) process.stderr.write(`  ${i + 1}/${V.length} (${((Date.now() - t0) / 1000).toFixed(0)} s)\n`);
}
writeFileSync(HERE + "out/observed.jsonl", obsOut.join("\n") + "\n");

/* ── report ── */
const known = (f: Finding) => KNOWN.some((k) => k.kind === f.kind && k.re.test(f.sub));
const live = F.filter((f) => !known(f));
const L: string[] = [];
const tally = (key: (x: (typeof S)[number]) => string) => {
  const t = new Map<string, { n: number; in: number; bad: number }>();
  for (const x of S) {
    const k = key(x);
    const r = t.get(k) ?? t.set(k, { n: 0, in: 0, bad: 0 }).get(k)!;
    r.n++;
    if (x.o.scope === "in") r.in++;
    if (x.bad) r.bad++;
  }
  return [...t.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .map(
      ([k, r]) =>
        `  ${k.padEnd(28)} ${String(r.n).padStart(5)}  in scope ${String(r.in).padStart(5)}  with a problem ${String(r.bad).padStart(5)}`,
    )
    .join("\n");
};
L.push(
  `ClinVar check: ${S.length} variants, ${S.filter((x) => x.o.scope === "in").length} in scope, ${S.filter((x) => x.bad).length} with a problem; ${F.length} problems (${live.length} not in known.tsv) in ${((Date.now() - t0) / 1000).toFixed(0)} s.`,
);
L.push(
  `Copy lines read: ${S.reduce((a, x) => a + x.o.copy.length, 0)} (P1 ${S.reduce((a, x) => a + x.o.copy.filter((l) => l.room === "P1").length, 0)}, P2 ${S.reduce((a, x) => a + x.o.copy.filter((l) => l.room === "P2").length, 0)}, P3 ${S.reduce((a, x) => a + x.o.copy.filter((l) => l.room === "P3").length, 0)}).`,
);
const byKind = new Map<string, Finding[]>();
for (const f of F) (byKind.get(f.kind) ?? byKind.set(f.kind, []).get(f.kind)!).push(f);
L.push(`P2/P3 facts from ${PATHS.p23}. Copy from ${PATHS.copy}.`);
for (const kind of ["throws", "facts", "wrong claim", "missing slot", "overflow", "no line", "impl"]) {
  const fs = byKind.get(kind) ?? [];
  L.push(`\n== ${kind}: ${fs.length} ==`);
  const subs = new Map<string, Finding[]>();
  for (const f of fs) (subs.get(f.sub) ?? subs.set(f.sub, []).get(f.sub)!).push(f);
  for (const [sub, xs] of [...subs.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const ids = [...new Set(xs.map((x) => x.id))];
    L.push(`  ${String(xs.length).padStart(5)}  ${sub}${xs.every(known) ? "  (known)" : ""}`);
    for (const x of xs.filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i).slice(0, 2))
      L.push(
        `         e.g. VCV ${x.id} ${x.gene}${x.detail ? `: ${x.detail.slice(0, 140)}` : ""}${x.text ? `\n              "${x.text}"` : ""}`,
      );
    if (ids.length > 2) L.push(`         (${ids.length} variants)`);
  }
}
L.push(`\n== odd genes (in this set) ==`);
for (const [k, gs] of ODD)
  L.push(
    `  ${String(gs.size).padStart(4)}  ${k}: ${[...gs].sort().slice(0, 14).join(", ")}${gs.size > 14 ? ", …" : ""}`,
  );
L.push(`\n== counts by stratum ==`);
L.push(" consequence (ClinVar MC)\n" + tally((x) => x.v.consequence));
L.push(" class\n" + tally((x) => x.v.class));
L.push(" review\n" + tally((x) => x.v.review));
L.push(" chromosome\n" + tally((x) => x.v.chrom));
L.push(
  " facts stage (spine consequence)\n" +
    tally((x) => x.o.annotation?.consequence ?? `(${x.o.scopeWhy ?? "none"})`.replace(/\d+ letters/, "N letters")),
);
L.push(" P3 situation (one copy)\n" + tally((x) => x.o.lab?.het?.p3 ?? "-"));
writeFileSync(HERE + "out/summary.txt", L.join("\n") + "\n");
writeFileSync(
  HERE + "out/findings.tsv",
  "kind\tsub\tvariation_id\tgene\tdetail\twhere\ttext\n" +
    F.map((f) => [f.kind, f.sub, f.id, f.gene, f.detail, f.where ?? "", f.text ?? ""].join("\t")).join("\n") +
    "\n",
);
console.log(L.join("\n"));
process.exitCode = live.length ? 1 : 0;
