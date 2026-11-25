// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// What a template can say about one variant: its tags (the branches a line can be limited to) and its slots (the facts a line can name).

/* Both come from the facts record only, so a template fills the same way for any variant of the
   kind. A line shows when every one of its tags is present.

   Template syntax:
     {slot}           the value; numbers formatted by the voice's number rule
     {slot:noun}      a count with its noun: "two letters", "one letter" ("noun/plural" for
                      irregular plurals)
     {Slot}           capitalised (for {Variant} at the start of a sentence)
   An unknown slot renders as ⟨slot?⟩, so a gap in the facts shows instead of hiding. */

import type { Drawing, VariantFacts } from "../../contracts/app";

/** ClinVar leaves the variant open: uncertain (its VUS subclasses included), conflicting, or not in
 *  ClinVar. Only then may a line say its effect "isn't known"; a classed variant's effect is left to
 *  P2's evidence. A record never looked up counts as classed: say nothing rather than guess. */
export const isOpen = (v: VariantFacts) =>
  /^(Uncertain_significance|Conflicting_classifications_of_pathogenicity|not in ClinVar|VUS-(low|mid|high)|Uncertain_significance\/VUS-(low|mid|high))$/.test(
    v.clinvar?.clnsig ?? "",
  );
export type Ctx = {
  kind: string;
  tags: string[];
  slots: Record<string, string | number>;
  v: VariantFacts;
  d: Drawing;
  i: number;
};

const AA: Record<string, string> = {
  Ala: "alanine",
  Arg: "arginine",
  Asn: "asparagine",
  Asp: "aspartic acid",
  Cys: "cysteine",
  Gln: "glutamine",
  Glu: "glutamic acid",
  Gly: "glycine",
  His: "histidine",
  Ile: "isoleucine",
  Leu: "leucine",
  Lys: "lysine",
  Met: "methionine",
  Phe: "phenylalanine",
  Pro: "proline",
  Ser: "serine",
  Thr: "threonine",
  Trp: "tryptophan",
  Tyr: "tyrosine",
  Val: "valine",
  Ter: "a stop",
};
const LETTER: Record<string, string> = { A: "an A", C: "a C", G: "a G", T: "a T" };

export const kindOf = (d: Drawing) => `${d.lane}--${d.kind}`;

/** the protein change, from HGVS p.: one swap, a run, or nothing usable */
function pChange(p: string) {
  const m = /^p\.([A-Z][a-z]{2})(\d+)([A-Z][a-z]{2}|=)$/.exec(p || "");
  if (m)
    return {
      from: AA[m[1]] ?? m[1],
      to: m[3] === "=" ? (AA[m[1]] ?? m[1]) : (AA[m[3]] ?? m[3]),
      site: +m[2],
      same: m[3] === "=",
    };
  return null;
}
/** the DNA letter change, from HGVS c. (a single-letter swap only) */
function cChange(c: string) {
  const m = /([ACGT])>([ACGT])$/.exec(c || "");
  return m ? { ref: LETTER[m[1]], alt: LETTER[m[2]] } : null;
}

export function context(v: VariantFacts, i: number): Ctx {
  const d = v.drawings[i];
  const kind = kindOf(d);
  const tags: string[] = [i === 0 ? "first" : "second"];
  const next = v.drawings[i + 1],
    prev = v.drawings[i - 1];
  if (next) tags.push(`then-${next.kind}`);
  // No protein follows: the drawing itself carries that, not a second, empty drawing.
  if (d.fate) tags.push("no-protein");
  if (prev) tags.push(`after-${prev.kind}`);
  const s: Record<string, string | number> = { gene: v.gene };
  const pc = pChange(v.hgvs_p),
    cc = cChange(v.hgvs_c);
  if (pc) {
    s.from = pc.from;
    s.to = pc.to;
    s.site = pc.site;
  }
  if (cc) {
    s.ref = cc.ref;
    s.alt = cc.alt;
  }
  if (v.plen) s.length = v.plen;
  // the codon record of this variant, if any drawing has one (siblings read it too)
  const codon = v.drawings.map((x) => x.codon as any).find(Boolean);
  const fold = d.fold as any,
    chain = d.chain as any,
    tx = d.transcript as any;
  const cons = v.consequence;
  const change =
    cons === "missense"
      ? "swap"
      : cons === "synonymous"
        ? "silent"
        : cons === "stop_gained"
          ? "stop"
          : cons === "inframe_indel"
            ? codon && codon.netBaseDelta > 0
              ? "adds"
              : "removes"
            : cons;
  switch (kind) {
    case "chain--local-failure": {
      // From the facts' reason, not from `unmapped`: a confident site whose window won't lie flat is
      // neither unsure nor unmapped. A missense record need not be one swap (a delins of two or more).
      const many = change === "swap" && !pc;
      tags.push(
        chain.reason === "low-confidence" ? "unsure" : chain.reason === "no-flat-view" ? "no-flat" : "no-structure",
        many ? "swaps" : change,
      );
      s.site = chain.site;
      s.length = chain.length;
      if (many) {
        const m = /^p\.[A-Z][a-z]{2}(\d+)_[A-Z][a-z]{2}(\d+)delins/.exec(v.hgvs_p);
        if (m) {
          s.site = +m[1];
          s.n = +m[2] - +m[1] + 1;
        }
      }
      if (codon) {
        s.n = Math.abs(codon.words) || Math.abs(codon.netBaseDelta) / 3;
      }
      break;
    }
    case "portrait--substitution-contacts": {
      const o4 = fold.o4?.state ?? "none";
      // The spine marks every residue one same-length edit changes, so three or more, or a gap where a
      // middle codon still spells the same amino acid, can both happen.
      const mk: number[] = fold.marks ?? [],
        inRow = mk.every((x, j) => j === 0 || x === mk[j - 1] + 1);
      tags.push(o4, mk.length <= 1 ? "one" : !inRow ? "apart" : mk.length === 2 ? "two" : "run");
      if (mk.length > 1) {
        s.n = mk.length;
        s.span = mk[mk.length - 1] - mk[0] + 1;
      }
      // The neighbors the drawing's contact lines join it to: the copy counts what is drawn.
      s.contacts = fold.contacts?.length ?? 0;
      tags.push(+s.contacts > 0 ? "touching" : "alone");
      if (fold.o4?.partners?.length) s.partners = fold.o4.partners.slice(0, 2).join(" and ");
      if (!pc && v.hgvs_p) {
        const m = /^p\.([A-Z][a-z]{2})(\d+)_([A-Z][a-z]{2})(\d+)delins/.exec(v.hgvs_p);
        if (m) s.site = +m[2];
      }
      s.length = fold.length;
      break;
    }
    /* Dosage: copies of the gene, and a piece of it deleted or duplicated. */
    case "transcript--copies": {
      const from = tx.copiesFrom ?? 2,
        to = tx.copies ?? from;
      tags.push(to === 0 ? "all-lost" : to < from ? "one-lost" : "gained");
      s.from = from;
      s.to = to;
      break;
    }
    case "transcript--piece-deleted": {
      tags.push(tx.inFrame ? "in-step" : "thrown-off");
      s.letters = tx.skipBp;
      if (tx.inFrame) s.codons = tx.skipBp / 3;
      else if (tx.stopCodon != null) s.after = tx.stopCodon - Math.ceil(tx.skipLo / 3);
      break;
    }
    case "transcript--piece-duplicated": {
      const a = tx.admitted;
      tags.push(a.inFrame ? "in-step" : "thrown-off");
      s.letters = a.nt;
      if (a.inFrame) s.codons = a.nt / 3;
      else if (a.stopWithinNt != null) tags.push("stop-in-copy");
      else if (tx.stopCodon != null) {
        tags.push("stop-later");
        s.after = tx.stopCodon - Math.ceil(a.afterC / 3);
      }
      break;
    }
    case "transcript--foreclosed-junction": {
      const J = tx.junction ?? {};
      tags.push(J.state ?? "unknown", J.side ?? "", (J.offsets?.length ?? 1) > 1 ? "many" : "single");
      // The signal's size comes from the facts' window, never a number kept here.
      if (J.window) s.signal = J.window.exon + J.window.intron;
      s.into = Math.abs(tx.locusOffset ?? J.offsets?.[0] ?? 0);
      s.letters = J.offsets?.length ?? 1;
      break;
    }
    case "transcript--double-agent": {
      const p2 = pChange(tx.consequence);
      // A frameshift or in-frame change at the edge is none of the three.
      tags.push(p2?.same ? "silent" : /Ter$/.test(tx.consequence) ? "stop" : p2 ? "swap" : "other");
      if (p2) {
        s.from = p2.from;
        s.to = p2.to;
        s.site = p2.site;
      }
      break;
    }
    case "codon--silent": {
      const c = d.codon as any;
      tags.push(c.startTo ? "start-kept" : /Ter\d+=/.test(c.consequence) ? "stop-kept" : "plain");
      if (c.startFrom) {
        s.startFrom = c.startFrom;
        s.startTo = c.startTo;
      }
      s.site = c.seam;
      break;
    }
    case "codon--nonsense": {
      const c = d.codon as any;
      // Two or three letters may change at once (a delins).
      const ins = /delins([ACGT]+)$/.exec(v.hgvs_c);
      tags.push(cc ? "one-letter" : "letters");
      if (!cc && ins) s.letters = ins[1].length;
      s.site = c.terminator;
      s.left = c.residues - c.terminator + 1;
      break;
    }
    case "codon--in-frame-del":
    case "codon--in-frame-ins": {
      const c = d.codon as any;
      tags.push(c.aligned ? "aligned" : "straddles");
      /* The protein gains amino acids and nothing else (p. dup or ins), or a codon it cuts into spells
         something new too (p. delins). */
      if (kind === "codon--in-frame-ins") tags.push(/delins/.test(v.hgvs_p) ? "rewrites" : "pure");
      s.letters = Math.abs(c.netBaseDelta);
      s.codons = Math.abs(c.words) || Math.abs(c.netBaseDelta) / 3;
      s.site = c.seam;
      break;
    }
    case "codon--frameshift-del":
    case "codon--frameshift-ins": {
      const c = d.codon as any;
      tags.push(c.terminator != null ? "stop" : "no-stop");
      s.letters = Math.abs(c.netBaseDelta);
      s.site = c.seam;
      if (c.terminator != null) {
        s.after = c.terminator - c.seam;
        s.early = c.residues - c.terminator + 1;
      }
      break;
    }
    case "codon--start-loss": {
      const c = d.codon as any;
      s.startFrom = c.startFrom;
      s.startTo = c.startTo;
      /* Where reading begins instead, by the spine's scanning rule. A record with no `restart` field gets no
         fate tag, so no fate line shows. */
      if (c.restart === null) tags.push("no-restart");
      else if (c.restart) {
        tags.push(c.restart.inStep ? "restart-in-step" : "restart-out-of-step");
        if (c.restart.inStep) s.lost = c.restart.codon - 1;
      }
      break;
    }
    case "codon--stop-loss": {
      const c = d.codon as any;
      tags.push(c.terminator != null ? "new-stop" : "no-stop");
      s.site = c.seam;
      if (c.terminator != null) s.extra = c.terminator - c.trueEnd;
      break;
    }
    case "portrait--truncated-fold": {
      s.length = fold.length;
      if (codon?.terminator != null) {
        s.made = codon.terminator - 1;
        s.missing = fold.length - (codon.terminator - 1);
      }
      break;
    }
    /* The stop on the chain, when the fold isn't confident where it falls. */
    case "portrait--truncated": {
      s.length = chain.length;
      if (codon?.terminator != null) {
        s.made = codon.terminator - 1;
        s.missing = chain.length - (codon.terminator - 1);
      }
      break;
    }
    case "portrait--sealed-removal":
      s.removed = fold.removed;
      s.length = fold.length;
      break;
    case "portrait--insertion-bulge":
      s.added = fold.added;
      s.length = fold.length;
      break;
    case "portrait--stop-loss-extension": {
      tags.push(chain ? "chain" : "fold");
      s.extension = (fold ?? chain).extension;
      s.length = (fold ?? chain).length;
      break;
    }
  }
  tags.push(isOpen(v) ? "open" : "classed");
  return { kind, tags: tags.filter(Boolean), slots: s, v, d, i };
}

/* ---- numbers and nouns ---- */
const ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
function inWords(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? "-" + ONES[n % 10] : "");
  if (n < 1000) return ONES[Math.floor(n / 100)] + " hundred" + (n % 100 ? " and " + inWords(n % 100) : "");
  return (
    inWords(Math.floor(n / 1000)) + " thousand" + (n % 1000 ? (n % 1000 < 100 ? " and " : " ") + inWords(n % 1000) : "")
  );
}
/** The voice's number rule. 0: words for one to nine, numerals from 10 (AP style). 1: always words. 2: always numerals. */
export function num(n: number, rule: number): string {
  if (!Number.isFinite(n)) return String(n);
  n = Math.round(n);
  if (rule === 2 || (rule === 0 && n >= 10)) return n.toLocaleString("en-US"); // 0: AP and NYT, one to nine in words
  return inWords(n);
}
function plural(noun: string, n: number) {
  const [one, many] = noun.includes("/") ? noun.split("/") : [noun, noun.replace(/(s|x|ch|sh)$/, "$1e") + "s"];
  if (n === 1) return one;
  // "amino acid" -> "amino acids"; "extra DNA letter" -> "extra DNA letters"
  return many;
}

const LABELS = new Set(["site", "length"]);
export type Voice = { numbers: number; variant: string; opening: number };
/* "The {gene} gene" names the gene outright, since most rooms open on a protein drawing whose caption
   never says "gene"; "spells out" keeps the reading frame the later lines build on. */
export const OPENINGS = ["The {gene} gene spells out a protein that {job}.", "{gene}'s job is to {jobInf}."];
/** A gene with no honest line: too little is recorded about what its protein does, so its job is `null` and the opening says so. */
export const OPENING_NO_JOB = "The {gene} gene spells out a protein whose job isn't yet well understood.";
/** A gene whose line has not been reviewed shows no job. */
export const OPENING_PLAIN = "The {gene} gene spells out a protein.";

export function fill(
  t: string,
  c: Ctx,
  job: string | null | undefined,
  voice: Voice,
): { text: string; missing: string[] } {
  const missing: string[] = [];
  const slots: Record<string, string | number> = { ...c.slots, variant: voice.variant };
  if (job) {
    slots.job = job;
    slots.jobInf = job.replace(/^(\w+?)s\b/, "$1");
  }
  const openT =
    job === null ? OPENING_NO_JOB : job === undefined ? OPENING_PLAIN : (OPENINGS[voice.opening] ?? OPENINGS[0]);
  t = t.replace(/\{opening\}/g, openT);
  const text = t.replace(/\{(\w+)(?::([^}]+))?\}/g, (_, name: string, noun?: string) => {
    const key = name[0].toLowerCase() + name.slice(1);
    const v = slots[key];
    if (v == null || v === "") {
      missing.push(key);
      return `⟨${key}?⟩`;
    }
    // Positions and lengths are labels, not counts: always numerals, so "position 99 of 3,056" never mixes forms.
    const fmt = (n: number) => (LABELS.has(key) ? n.toLocaleString("en-US") : num(n, voice.numbers));
    let out = typeof v === "number" ? (noun ? `${fmt(v)} ${plural(noun, v)}` : fmt(v)) : String(v);
    if (name[0] !== name[0].toLowerCase()) out = out[0].toUpperCase() + out.slice(1);
    return out;
  });
  // a sentence never starts lower-case
  return { text: text.replace(/^(\s*)([a-z])/, (_, a, b) => a + b.toUpperCase()), missing };
}
