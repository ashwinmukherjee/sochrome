// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The drafts: the decisions every template inherits, a first line for every unit, and plain names for conditions.

import type { Line } from "./model";
import { CNV_SEED, CNV_CONDITIONS } from "./cnv-seed";

// The voice (SPEC: the voice, round 1): the truthful line, "this variant", AP numbers, "isn't known",
// one sentence per line, American spelling. A saved entry in copy23.json overrides its draft here.
export type Decision = {
  id: string;
  title: string;
  why: string;
  live: boolean;
  options: { label: string; detail: string; rec?: boolean; example?: string }[];
};

export const DECISIONS: Decision[] = [
  {
    id: "verdict",
    live: true,
    title: "Plain words for ClinVar's classes",
    why: "P2 carries no ClinVar label (decided): the verdict says it in plain words. The {verdict} slot fills from this, so changing it changes every verdict line.",
    options: [
      {
        label: 'Likely pathogenic is "very likely harmful"',
        rec: true,
        detail:
          'ACMG defines likely pathogenic as more than 90% certain (Richards et al. 2015: "greater than 90% certainty"). "Likely" in everyday English reads nearer 60%, so "very likely" is the truer word. Mirrored for likely benign.',
        example: "Together, the evidence says this variant is very likely harmful.",
      },
      {
        label: 'Likely pathogenic is "likely harmful"',
        detail: "ClinVar's own word, in plain English. Shorter; undersells the certainty.",
        example: "Together, the evidence says this variant is likely harmful.",
      },
    ],
  },
  {
    id: "condition",
    live: true,
    title: "How P3 names the condition",
    why: "P3 said \"this cancer\" because every fixture was BRCA1. ClinGen's labels are clinical (\"hypercholesterolemia, familial, 1\"), and some don't fit the variant's mechanism (GCK's label is hyperinsulinism; GCK loss causes mild high blood sugar). The {condition} slot fills from this.",
    options: [
      {
        label: "A plain name per condition, reviewed",
        rec: true,
        detail:
          "Round 4 has a drafted plain name for each condition P3 names here. At scale, the same table for every gene that reaches a settled harmful P3; unreviewed falls back to the third option.",
        example: "You carry one copy of this variant, and cystic fibrosis takes two altered copies.",
      },
      {
        label: "ClinGen's label as is",
        detail: "No table to keep, but clinical and sometimes wrong for the mechanism.",
        example: "…and hypercholesterolemia, familial, 1 takes…",
      },
      {
        label: '"A condition linked to {gene}"',
        detail: "Always true, never informative.",
        example: "…and a condition linked to CFTR takes two altered copies.",
      },
    ],
  },
  {
    id: "carriers",
    live: true,
    title: "How often people carry it",
    why: "The {carriers} slot, in P2's body and rarity row. gnomAD gives an allele frequency; people carrying it is about twice that.",
    options: [
      {
        label: '"About 1 in 4,700 people"',
        rec: true,
        detail: 'The tally\'s own form ("fewer than 1 in 500 people"). Rounded to two significant figures.',
        example: "About 1 in 4,700 people carry it.",
      },
      {
        label: '"About 0.021% of people"',
        detail: "Exact-feeling, but small percentages are hard to picture.",
        example: "About 0.021% of people carry it.",
      },
    ],
  },
  {
    id: "unsettled",
    live: false,
    title: "P3 doesn't name the condition until the variant is settled",
    why: "Drafted this way. Your HTT D1157G is uncertain, and HTT's condition is Huntington disease, which is caused by a repeat expansion that isn't read here. \"How often it leads to Huntington disease\" would frighten someone over a single-letter change. EGFR (lung cancer) and KIT have the same problem: somatic conditions.",
    options: [
      {
        label: "Name it only once settled harmful",
        rec: true,
        detail:
          "Not known and harmless stay generic; the condition appears where the variant is established to cause it.",
      },
      { label: "Name it everywhere", detail: "More specific, and wrong or alarming for some genes." },
    ],
  },
  {
    id: "who",
    live: false,
    title: "Who P3 talks about",
    why: 'Drafted this way: the figure is about people ("100 people who carry this variant"), the other cases about you.',
    options: [
      {
        label: "Figures about people, the rest about you",
        rec: true,
        detail:
          "A figure is a property of a group; saying \"your chance\" overclaims. A carrier's or an X copy's situation is about you specifically.",
      },
      {
        label: "Everything about you",
        detail: 'Warmer, but "you have a 65% chance" is a claim about one person the figure can\'t make.',
      },
    ],
  },
];

// Ids are stable: s-lines are the first draft, c-lines were added for cases the ClinVar suite met.
let n = 0;
const L = (unit: string, t: string, when: string[] = []): Line => ({ id: `s${++n}`, unit, when, t });
let cn = 0;
const C = (unit: string, t: string, when: string[] = []): Line => ({ id: `c${++cn}`, unit, when, t });

// P2: one plain clause, or two joined by "and" or "but"; no semicolons or colons; the
// subject first; no insider names. A fact, then a short sentence on what it means. A bar's weight is its
// length, never the sentence's hedging.
const NOT_SETTLED = ["!labs:no-weight"];
let nn = 0;
const N = (unit: string, t: string, when: string[] = []): Line => ({ id: `n${++nn}`, unit, when, t });
// Lines for a harmful class labs qualify as low penetrance, with ids of their own.
const P = (id: string, unit: string, t: string, when: string[] = []): Line => ({ id, unit, when, t });
const LESS_OFTEN = "Labs note that it leads to the condition less often than most harmful variants in this gene do.";
export const SEED: Record<string, Line[]> = {
  ...CNV_SEED,
  // The opening leaves the reading to the chart. The condition is its own beat after the verdict, settled harmful only.
  "p2-frame": [
    L("open", "Here is the evidence on whether this variant is harmful, weighed piece by piece."),
    L("verdict", "Together, the evidence says this variant is {verdict}.", [
      "!chart:uncertain",
      "!chart:differs",
      "!chart:labs-open",
    ]),
    L("verdict", "The evidence here leans {lean}, but no lab has reached a verdict.", [
      "chart:labs-open",
      "!chart:uncertain",
      "!disagree",
    ]),
    // Labs that disagree have each reached a verdict, just not the same one.
    L("verdict", "The evidence here leans {lean}, but labs disagree on a verdict.", [
      "chart:labs-open",
      "!chart:uncertain",
      "disagree",
    ]),
    L("verdict", "There isn't enough evidence to say whether this variant is harmful.", [
      "chart:uncertain",
      "!chart:differs",
    ]),
    L(
      "verdict",
      "On the evidence here, this variant looks {verdict}, but labs that have seen more call it {labcall}.",
      ["chart:differs", "!chart:uncertain"],
    ),
    L("verdict", "There isn't enough evidence here to decide, but labs that have seen more call it {labcall}.", [
      "chart:differs",
      "chart:uncertain",
    ]),
    L("condition", "It's linked to {conditionfull}.", ["harmful", "!condition:none"]),
    C("condition", "It's linked to a condition caused by changes in {gene}.", ["harmful", "condition:none"]),
  ],
  "p2-labs": [
    L("bar:labs", "A panel of specialists reviewed the evidence and calls it {labcall}.", [
      "review:expert",
      ...NOT_SETTLED,
    ]),
    L("bar:labs", "Several labs reviewed it independently, and all call it {labcall}.", [
      "review:multiple",
      ...NOT_SETTLED,
    ]),
    L("bar:labs", "A clinical lab reviewed it and calls it {labcall}.", ["review:single", ...NOT_SETTLED]),
    L("bar:labs", "A lab has classified it as {labcall}.", ["review:none", ...NOT_SETTLED]),
    L("bar:labs", "Labs that reviewed it classify it as uncertain, so their view doesn't shift the verdict.", [
      "uncertain",
      "!review:single",
    ]),
    L("bar:labs", "The lab that reviewed it classifies it as uncertain, so its view doesn't shift the verdict.", [
      "uncertain",
      "review:single",
    ]),
    L(
      "bar:labs",
      "Of the {labs} classifications labs have submitted, {split}, so together their view doesn't shift the verdict.",
      ["disagree"],
    ),
    L("bar:labs", "No lab has classified it yet.", ["unclassified"]),
    C(
      "bar:labs",
      "Labs that reviewed it haven't called it harmful or harmless, so their view doesn't shift the verdict.",
      ["unclassed"],
    ),
  ],
  "p2-rarity": [
    L(
      "bar:rarity",
      "{Carriers} carry it, far too many for it to cause a rare condition. That alone is enough to call it harmless.",
      ["rarity:harmless-stand-alone"],
    ),
    L(
      "bar:rarity",
      "{Carriers} carry it, more than most rare conditions allow. That counts strongly against it being harmful.",
      ["rarity:harmless-strong"],
    ),
    L("bar:rarity", "It hasn't been seen among {db} tested. That leans slightly toward it being harmful.", [
      "rarity:harmful-supporting",
      "freq:unseen",
    ]),
    L("bar:rarity", "{Carriers} carry it, which is very rare. That leans slightly toward it being harmful.", [
      "rarity:harmful-supporting",
      "!freq:unseen",
    ]),
    L("bar:rarity", "{Carriers} carry it. That's rare, but not rare enough to shift the verdict.", [
      "rarity:no-weight",
    ]),
  ],
  "p2-predict": [
    L("bar:predict", "A computer prediction says the swap almost certainly damages the protein.", [
      "predict:harmful-strong",
    ]),
    L("bar:predict", "A computer prediction says the swap very likely damages the protein.", [
      "predict:harmful-moderate",
    ]),
    L("bar:predict", "A computer prediction says the swap likely damages the protein.", ["predict:harmful-supporting"]),
    L("bar:predict", "A computer prediction says the protein very likely tolerates the swap.", [
      "predict:harmless-moderate",
    ]),
    L("bar:predict", "A computer prediction says the protein likely tolerates the swap.", [
      "predict:harmless-supporting",
    ]),
    L(
      "bar:predict",
      "A computer prediction can't tell whether the swap damages the protein. That doesn't shift the verdict.",
      ["predict:no-weight"],
    ),
  ],
  "p2-protein": [
    L(
      "bar:protein",
      "It cuts the protein short, and the cell destroys the shortened message, so this copy makes no protein.",
      ["protein:destroyed", "!protein:mech-none"],
    ),
    L("bar:protein", "It shifts the reading so no stop is ever reached, and everything after the change is misread.", [
      "protein:no-stop",
      "!protein:mech-none",
    ]),
    L(
      "bar:protein",
      "It cuts off the end of the protein, {lost} of its length. The shortened protein is still made, so it's less certain to stop the protein working.",
      ["protein:escapes-large", "!protein:mech-none", "!protein:runs-on"],
    ),
    L(
      "bar:protein",
      "It cuts off only the very end of the protein, {lost} of its length. Most of the protein is still made.",
      ["protein:escapes-small", "!protein:mech-none", "!protein:runs-on"],
    ),
    C(
      "bar:protein",
      "It shifts the reading near the end, so the last {lost} of the protein is misread and runs on past its usual end.",
      ["protein:runs-on", "!protein:mech-none"],
    ),
    L(
      "bar:protein",
      "It breaks a signal for joining the gene's pieces, so a piece is likely skipped and everything after it misread.",
      ["protein:skip-out", "!protein:mech-none"],
    ),
    L(
      "bar:protein",
      "It breaks a signal for joining the gene's pieces, so a piece is likely skipped, removing {skipped} of the protein.",
      ["protein:skip-in-large", "!protein:mech-none"],
    ),
    L(
      "bar:protein",
      "It breaks a signal for joining the gene's pieces, so a small piece of the protein is likely skipped.",
      ["protein:skip-in-small", "!protein:mech-none"],
    ),
    L(
      "bar:protein",
      "It breaks a signal for joining the gene's pieces, but what that does to the protein isn't known.",
      ["protein:skip-unknown", "!protein:mech-none"],
    ),
    L(
      "bar:protein",
      "It cuts the protein short, but losing this gene isn't known to cause disease. That doesn't shift the verdict.",
      ["protein:mech-none", "!cut:splice", "!protein:runs-on"],
    ),
    C(
      "bar:protein",
      "It breaks a signal for joining the gene's pieces, but losing this gene isn't known to cause disease. That doesn't shift the verdict.",
      ["protein:mech-none", "cut:splice"],
    ),
    C(
      "bar:protein",
      "It shifts the reading near the end, but losing this gene isn't known to cause disease. That doesn't shift the verdict.",
      ["protein:mech-none", "protein:runs-on"],
    ),
  ],
  // P3: the first line stands on its own and opens on your copies; one idea per beat.
  // A figure is about people; every other case is about you.
  "p3-figure": [
    L("beat:hundred", "Picture 100 people who carry this variant."),
    L("beat:baseline", "About {baseline} of them would get {outcome} anyway, as anyone might.", [
      "!figure:no-baseline",
    ]),
    L("beat:baseline", "Without this variant, almost none of them would get {outcome}.", ["figure:no-baseline"]),
    L("beat:added", "This variant adds about {added} more, for {total} in all."),
    L("beat:hold", "No genome can say which of the 100 any one person is."),
    L("row:baseline", "About {baseline} in 100 get {outcome}, with or without this variant.", ["!figure:no-baseline"]),
    L("row:baseline", "Fewer than 1 in 100 people without this variant get it.", ["figure:no-baseline"]),
    L("row:added", "This variant adds about {added} in 100, for {total} in all."),
    L("row:none", "The other {none} in 100 don't, even with this variant."),
    // A figure from families who came to a clinic overstates the risk for someone found by testing.
    L(
      "beat:families",
      "These figures come from families already known to have the condition, so they may run high for others.",
    ),
  ],
  "p3-harmful": [
    L("lead:1", "You carry one copy of this variant, and one copy can be enough to cause {condition}.", [
      "!pattern:none",
    ]),
    L("lead:2", "There isn't yet a reliable figure for how likely that is.", ["!pattern:none", "!penetrance:low"]),
    P("p1", "lead:2", LESS_OFTEN, ["!pattern:none", "penetrance:low"]),
    P("p2", "lead:3", "There isn't yet a reliable figure for how likely that is.", ["!pattern:none", "penetrance:low"]),
    C("lead:1", "You carry one copy of this variant.", ["pattern:none"]),
    C("lead:2", "How many altered copies of this gene it takes to cause disease isn't on record here.", [
      "pattern:none",
    ]),
  ],
  "p3-carrier": [
    L("lead:1", "You carry one copy of this variant."),
    L("lead:2", "{Condition} only develops with two altered copies."),
    L("lead:3", "So you won't develop it, but you could pass this variant on to your children.", ["!gene:cross"]),
    // In a cross gene "it" could be read as the gene's other, dominant condition, which
    // comes from other kinds of change. "Isn't known to" because a small risk is reported in a few.
    L("lead:3", "So you won't develop this condition, but you could pass this variant on to your children.", [
      "gene:cross",
    ]),
    L("lead:4", "This gene is also linked to another condition, but a change like this isn't known to cause it.", [
      "gene:cross",
    ]),
  ],
  "p3-two-copies": [
    L("lead:1", "Both of your copies of this gene carry this variant."),
    L("lead:2", "Two altered copies of this gene are what cause {condition}."),
    P("p3", "lead:3", LESS_OFTEN, ["penetrance:low"]),
  ],
  "p3-two-changes": [
    L("lead:1", "You carry this variant and a second harmful change in the same gene."),
    L("lead:2", "If they're on different copies, they can cause {condition}."),
    C("lead:3", "If they're on the same copy, they don't, and your genome file can't show which."),
  ],
  "p3-one-x": [
    L("lead:1", "This gene sits on the X chromosome."),
    L("lead:2", "Since you have one copy of X, this altered copy can be enough to cause {condition}."),
    P("p4", "lead:3", LESS_OFTEN, ["penetrance:low"]),
  ],
  "p3-two-x": [
    L("lead:1", "This gene sits on the X chromosome."),
    L("lead:2", "You have two copies of X, and this variant is on one of them."),
    L("lead:3", "Often your other copy covers for it, but {condition} can still cause symptoms."),
  ],
  // The file's X doesn't say one copy or two: give both, assume neither.
  "p3-x-unclear": [
    L("lead:1", "This gene sits on the X chromosome, but your genome file doesn't show how many copies of X you have."),
    L("lead:2", "With one copy of X, this altered copy can be enough to cause {condition}."),
    L("lead:3", "With two, your other copy often covers for it, though it can still cause symptoms."),
  ],
  "p3-x-all": [
    L("lead:1", "This gene sits on the X chromosome, and every copy of it you have carries this variant."),
    L("lead:2", "That can be enough to cause {condition}."),
  ],
  "p3-not-known": [
    L("lead:1", "Labs don't yet know whether this variant is harmful, so for now it says nothing about your health.", [
      "!disagree",
    ]),
    L("lead:1", "Labs disagree about whether this variant is harmful, so for now it says nothing about your health.", [
      "disagree",
    ]),
  ],
  "p3-harmless": [
    L("lead:1", "This variant is harmless: it doesn't change your chance of any condition linked to this gene."),
  ],
  // P3's last beat, as signed off. A genome file isn't made to clinical standards, so the
  // confirming comes first.
  "p3-next": [
    N("next:1", "Before you act on this, a clinical lab should confirm it, since genome files can be wrong.", [
      "next:settled",
    ]),
    N("next:2", "A genetic counselor can explain what it means for you and your family.", ["next:settled"]),
    N("next:1", "If you're planning a family, a genetic counselor can explain what it means for your children.", [
      "next:carrier",
    ]),
  ],
};

// Draft plain names: the name people use, a short description said once at the first
// mention, no subtype numbers. A name shows in the product only once reviewed.
export const CONDITIONS: Record<string, { name: string; about: string }> = {
  ...CNV_CONDITIONS,
  "BRCA1-related cancer predisposition": { name: "hereditary breast and ovarian cancer", about: "" },
  "BRCA2-related cancer predisposition": { name: "hereditary breast and ovarian cancer", about: "" },
  "Lynch syndrome": { name: "Lynch syndrome", about: "an inherited risk of colon and uterine cancer" },
  "Li-Fraumeni syndrome": { name: "Li-Fraumeni syndrome", about: "an inherited risk of many kinds of cancer" },
  "hypercholesterolemia, familial, 1": { name: "familial hypercholesterolemia", about: "inherited high cholesterol" },
  "hypertrophic cardiomyopathy": { name: "hypertrophic cardiomyopathy", about: "a thickening of the heart muscle" },
  "long QT syndrome": { name: "long QT syndrome", about: "a disorder of the heart's rhythm" },
  "familial thoracic aortic aneurysm and aortic dissection": {
    name: "thoracic aortic aneurysm and dissection",
    about: "a weakening of the body's main artery",
  },
  phenylketonuria: { name: "phenylketonuria (PKU)", about: "in which the body can't break down part of protein" },
  "congenital factor XI deficiency": {
    name: "factor XI deficiency",
    about: "which causes bleeding after injury or surgery",
  },
  "neuronal ceroid lipofuscinosis": { name: "Batten disease", about: "which damages the brain and eyes" },
  "CDKL5 disorder": { name: "CDKL5 deficiency disorder", about: "a severe epilepsy that starts in infancy" },
  "hyperinsulinism due to glucokinase deficiency": {
    name: "congenital hyperinsulinism",
    about: "which causes low blood sugar",
  },
  "Brown-Vialetto-van Laere syndrome 2": {
    name: "Brown-Vialetto-Van Laere syndrome",
    about: "which damages the nerves for hearing and movement",
  },
  "von Hippel-Lindau disease": { name: "von Hippel-Lindau disease", about: "which causes tumors in several organs" },
  "Fabry disease": { name: "Fabry disease", about: "which damages the kidneys, heart and nerves" },
  "Sotos syndrome": { name: "Sotos syndrome", about: "an overgrowth condition of childhood" },
  "congenital thrombotic thrombocytopenic purpura": {
    name: "congenital TTP",
    about: "a disorder that causes small blood clots",
  },
  "FOXG1 disorder": { name: "FOXG1 syndrome", about: "a severe disorder of early brain development" },
  "autosomal recessive polycystic kidney disease": {
    name: "recessive polycystic kidney disease",
    about: "which causes cysts in the kidneys and liver",
  },
  "CHRNG-associated hypo-akinesia disorder of prenatal onset": {
    name: "multiple pterygium syndrome",
    about: "which limits a baby's movement before birth",
  },
  "infantile convulsions and choreoathetosis": {
    name: "infantile convulsions and choreoathetosis",
    about: "seizures in babies and movement attacks later",
  },
  "Leigh syndrome": { name: "Leigh syndrome", about: "a disorder of the brain's energy supply" },
  "citrullinemia type I": { name: "citrullinemia", about: "which lets ammonia build up in the blood" },
  neutropenia: { name: "neutropenia", about: "a shortage of white blood cells" },
  "telangiectasia, hereditary hemorrhagic, type 2": {
    name: "hereditary hemorrhagic telangiectasia (HHT)",
    about: "which causes fragile blood vessels that bleed",
  },
  "cystic fibrosis": { name: "cystic fibrosis", about: "" },
  "X-linked complex neurodevelopmental disorder": {
    name: "X-linked complex neurodevelopmental disorder",
    about: "which affects learning and can cause seizures",
  },
  "lissencephaly spectrum disorders": { name: "lissencephaly", about: "in which the brain's surface fails to fold" },
};
