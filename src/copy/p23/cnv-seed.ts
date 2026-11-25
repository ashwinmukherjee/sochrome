// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copy-number changes: a first line for every unit, under seed.ts's rules. Exons are "pieces", as P1 calls them.

import type { Line } from "./model";

let n = 0;
const L = (unit: string, t: string, when: string[] = []): Line => ({ id: `c${++n}`, unit, when, t });

// Lines for a change spanning many genes, with ids of their own.
const M = (id: string, unit: string, t: string, when: string[] = []): Line => ({ id, unit, when, t });

export const CNV_SEED: Record<string, Line[]> = {
  // The gene bar: how much of the gene, then whether that matters. A weak mechanism collapses the extent to one line.
  "p2-deletion": [
    M(
      "m1",
      "bar:deletion",
      "It removes a stretch of the genome holding {gene} and many other genes, so its effect can't be read from this gene alone.",
      ["gene:many-genes"],
    ),
    L("bar:deletion", "It removes one whole copy of the gene{along}, and losing this gene is known to cause disease.", [
      "gene:loss-whole",
      "gene:weight-full",
      "!gene:mech-clingen-region",
      "!cnv:both-copies",
    ]),
    L("bar:deletion", "It removes both copies of the gene{along}, and losing this gene is known to cause disease.", [
      "gene:loss-whole",
      "gene:weight-full",
      "!gene:mech-clingen-region",
      "cnv:both-copies",
    ]),
    L(
      "bar:deletion",
      "It removes a whole stretch of the genome holding this gene{along}, and losing that stretch is known to cause disease.",
      ["gene:mech-clingen-region"],
    ),
    L(
      "bar:deletion",
      "It removes the whole gene{along}, but it's only partly established that losing this gene causes disease.",
      ["gene:loss-whole", "gene:weight-some"],
    ),
    L(
      "bar:deletion",
      "It removes the whole gene{along}, but losing this gene isn't known to cause disease. That doesn't shift the verdict.",
      ["gene:loss-whole", "gene:weight-none"],
    ),
    L(
      "bar:deletion",
      "It removes the start of the gene, {pieces} of its {npieces}, so this copy can't make the protein.",
      ["gene:loss-start", "gene:weight-full"],
    ),
    L(
      "bar:deletion",
      "It removes the end of the gene, {pieces} of its {npieces}, so the cell likely destroys this copy's message.",
      ["gene:loss-end", "gene:weight-full"],
    ),
    L(
      "bar:deletion",
      "It removes only the gene's last piece, {share} of the protein. A protein missing its end may still partly work.",
      ["gene:loss-last", "gene:weight-full"],
    ),
    L(
      "bar:deletion",
      "It removes {pieces} of the gene's {npieces} and throws the reading off, so the cell likely destroys this copy's message.",
      ["gene:loss-off", "gene:weight-full"],
    ),
    L(
      "bar:deletion",
      "It removes {pieces} of the gene's {npieces}, {share} of the protein, but the reading stays in step, so a shorter protein may still be made.",
      ["gene:loss-in-large", "gene:weight-full"],
    ),
    L(
      "bar:deletion",
      "It removes {pieces} of the gene's {npieces}, a small part of the protein, and the reading stays in step.",
      ["gene:loss-in-small", "gene:weight-full"],
    ),
    L(
      "bar:deletion",
      "It removes {pieces} of the gene's {npieces}, but it's only partly established that losing this gene causes disease.",
      ["cnv:partial", "gene:weight-some"],
    ),
    L(
      "bar:deletion",
      "It removes {pieces} of the gene's {npieces}, but losing this gene isn't known to cause disease. That doesn't shift the verdict.",
      ["cnv:partial", "gene:weight-none"],
    ),
  ],
  "p2-duplication": [
    M(
      "m2",
      "bar:duplication",
      "It adds an extra copy of a stretch of the genome holding {gene} and many other genes, so its effect can't be read from this gene alone.",
      ["gene:many-genes"],
    ),
    L(
      "bar:duplication",
      "It adds an extra copy of the whole gene{along}, and an extra copy of this gene is known to cause disease.",
      ["gene:gain-whole", "gene:weight-full", "!gene:mech-clingen-region"],
    ),
    L(
      "bar:duplication",
      "It adds an extra copy of a stretch of the genome holding this gene{along}, and an extra copy of that stretch is known to cause disease.",
      ["gene:mech-clingen-region"],
    ),
    L(
      "bar:duplication",
      "It adds an extra copy of the whole gene{along}, but it's only partly established that an extra copy causes disease.",
      ["gene:gain-whole", "gene:weight-some"],
    ),
    L(
      "bar:duplication",
      "It adds an extra copy of the whole gene{along}, but an extra copy of this gene isn't known to cause disease. That doesn't shift the verdict.",
      ["gene:gain-whole", "gene:weight-none"],
    ),
    L(
      "bar:duplication",
      "It copies {pieces} of the gene's {npieces}. If the copy sits inside the gene, as most do, it throws the reading off and breaks this copy.",
      ["gene:gain-off", "gene:weight-full"],
    ),
    L(
      "bar:duplication",
      "It copies {pieces} of the gene's {npieces}, which likely breaks this copy, but it's only partly established that losing this gene causes disease.",
      ["gene:gain-off", "gene:weight-some"],
    ),
    L(
      "bar:duplication",
      "It copies {pieces} of the gene's {npieces}, but losing this gene isn't known to cause disease. That doesn't shift the verdict.",
      ["gene:gain-off", "gene:weight-none"],
    ),
    L(
      "bar:duplication",
      "It copies {pieces} of the gene's {npieces} and the reading stays in step, so it isn't expected to stop the gene working.",
      ["gene:gain-in"],
    ),
    L(
      "bar:duplication",
      "It copies part of the gene from one end, which leaves a whole copy in place. That doesn't shift the verdict.",
      ["gene:gain-edge"],
    ),
  ],
  "p2-overlap": [
    L("bar:overlap", "Labs have called {similar} over the same part of this gene harmful.", ["overlap:harmful"]),
    L("bar:overlap", "Labs have called {similar} over the same part of this gene harmless.", ["overlap:harmless"]),
    L(
      "bar:overlap",
      "Labs disagree about {similar} over the same part of this gene, so they don't shift the verdict.",
      ["overlap:mixed"],
    ),
    L(
      "bar:overlap",
      "Labs have classified {similar} over the same part of this gene as uncertain, so they don't shift the verdict.",
      ["overlap:uncertain"],
    ),
    L("bar:overlap", "No lab has classified another {change} over the same part of this gene.", ["overlap:none"]),
  ],
  "p2-svrarity": [
    L(
      "bar:svrarity",
      "How many people carry a {change} like this isn't measured here yet, so it doesn't shift the verdict.",
      ["svrarity:not-measured"],
    ),
  ],
  "p3-cnv-harmful": [
    L("lead:1", "This deletion removes one of your two copies of {gene}.", ["cnv:whole"]),
    L("lead:1", "This deletion removes part of one of your two copies of {gene}.", ["cnv:partial"]),
    L("lead:2", "Losing one working copy can be enough to cause {condition}."),
    L("lead:3", "There isn't yet a reliable figure for how likely that is."),
  ],
  "p3-cnv-carrier": [
    L("lead:1", "This deletion removes one of your two copies of {gene}.", ["cnv:whole"]),
    L("lead:1", "This deletion removes part of one of your two copies of {gene}.", ["cnv:partial"]),
    L("lead:2", "{Condition} only develops when both copies are lost or altered."),
    L("lead:3", "So you won't develop it, but you could pass this deletion on to your children.", ["!gene:cross"]),
    // As for a small change: the gene's dominant condition isn't one a lost copy causes.
    L("lead:3", "So you won't develop this condition, but you could pass this deletion on to your children.", [
      "gene:cross",
    ]),
    L("lead:4", "This gene is also linked to another condition, but a deletion like this isn't known to cause it.", [
      "gene:cross",
    ]),
  ],
  "p3-cnv-two-copies": [
    L("lead:1", "Both of your copies of {gene} are missing."),
    L("lead:2", "Losing both copies is what causes {condition}."),
  ],
  "p3-cnv-one-x": [
    L("lead:1", "This gene sits on the X chromosome."),
    L("lead:2", "Since you have one copy of X, this deletion leaves you without a working copy of {gene}."),
    L("lead:3", "That can be enough to cause {condition}."),
  ],
  "p3-cnv-two-x": [
    L("lead:1", "This gene sits on the X chromosome."),
    L("lead:2", "You have two copies of X, and this deletion is on one of them."),
    L("lead:3", "Often your other copy covers for it, but {condition} can still cause symptoms."),
  ],
  "p3-cnv-x-unclear": [
    L("lead:1", "This gene sits on the X chromosome, but your genome file doesn't show how many copies of X you have."),
    L("lead:2", "With one copy of X, this deletion can be enough to cause {condition}."),
    L("lead:3", "With two, your other copy often covers for it, though it can still cause symptoms."),
  ],
  "p3-cnv-x-all": [
    L("lead:1", "This gene sits on the X chromosome, and this deletion removes every copy of {gene} you have."),
    L("lead:2", "That can be enough to cause {condition}."),
  ],
  "p3-cnv-extra": [
    L("lead:1", "This duplication gives you an extra copy of {gene}.", ["!gene:mech-clingen-region"]),
    L("lead:1", "This duplication gives you an extra copy of a stretch of the genome that includes {gene}.", [
      "gene:mech-clingen-region",
    ]),
    L("lead:2", "An extra copy can be enough to cause {condition}."),
    L("lead:3", "There isn't yet a reliable figure for how likely that is."),
  ],
  // Declining says why, truthfully: labs open; labs harmful but the gene's dosage isn't established; or a
  // duplication that breaks the gene only if the copy sits inside it.
  "p3-cnv-not-known": [
    M("m3", "lead:1", "This {change} covers many genes, so what it means for you can't be read from {gene} alone.", [
      "decline:many-genes",
    ]),
    L("lead:1", "Labs don't yet know whether this {change} is harmful, so for now it says nothing about your health.", [
      "decline:open",
    ]),
    L("lead:1", "Labs call this deletion harmful, but losing {gene} hasn't yet been reviewed as a cause of disease.", [
      "decline:labs-only-loss",
      "rating:unrated",
    ]),
    L("lead:1", "Labs call this deletion harmful, but losing {gene} is thought not to cause disease on its own.", [
      "decline:labs-only-loss",
      "rating:40",
    ]),
    L("lead:1", "Labs call this deletion harmful, but the evidence that losing {gene} causes disease is still thin.", [
      "decline:labs-only-loss",
      "!rating:unrated",
      "!rating:40",
    ]),
    L(
      "lead:1",
      "Labs call this duplication harmful, but an extra copy of {gene} hasn't yet been reviewed as a cause of disease.",
      ["decline:labs-only-gain", "rating:unrated"],
    ),
    L(
      "lead:1",
      "Labs call this duplication harmful, but there's no good evidence that an extra copy of {gene} causes disease.",
      ["decline:labs-only-gain", "!rating:unrated"],
    ),
    L("lead:1", "Labs call this duplication harmful, and it likely breaks one copy of {gene}.", ["decline:dup-breaks"]),
    L("lead:2", "Until that's settled, there's no reliable way to say what it means for you.", [
      "decline:labs-only-loss",
      "!rating:40",
    ]),
    L("lead:2", "So it tells you nothing about your risk through {gene}.", ["decline:labs-only-loss", "rating:40"]),
    L("lead:2", "Until that's settled, there's no reliable way to say what it means for you.", [
      "decline:labs-only-gain",
    ]),
    L("lead:2", "But that depends on where the copied piece sits, which your genome file can't show.", [
      "decline:dup-breaks",
    ]),
    L("lead:3", "So there's no reliable way yet to say what it means for you.", ["decline:dup-breaks"]),
  ],
};

// Draft names for the conditions only copy-number changes name: a gain or a whole-region loss has its own.
export const CNV_CONDITIONS: Record<string, { name: string; about: string }> = {
  "CHARGE syndrome": { name: "CHARGE syndrome", about: "" },
  "rhabdoid tumor predisposition syndrome 2": { name: "rhabdoid tumor predisposition syndrome", about: "" },
  "congenital disorder of glycosylation type 1E": { name: "a congenital disorder of glycosylation", about: "" },
  "HBA1-related alpha thalassemia spectrum": { name: "alpha thalassemia", about: "" },
  "Norrie disease": { name: "Norrie disease", about: "" },
  "Koolen-de Vries syndrome": { name: "Koolen-de Vries syndrome", about: "" },
  "autosomal recessive limb-girdle muscular dystrophy": { name: "limb-girdle muscular dystrophy", about: "" },
  "Joubert syndrome 3": { name: "Joubert syndrome", about: "" },
  "X-linked retinoschisis": { name: "X-linked retinoschisis", about: "" },
  "complex neurodevelopmental disorder": { name: "a complex neurodevelopmental disorder", about: "" },
  "GATA4-related congenital heart disease with or without pancreatic hypoplasia or diabetes": {
    name: "GATA4-related congenital heart disease",
    about: "",
  },
  "progressive muscular dystrophy": { name: "Duchenne or Becker muscular dystrophy", about: "" },
  "microcephaly with lissencephaly and/or hydranencephaly": { name: "microcephaly with lissencephaly", about: "" },
  "chromosome 17q12 duplication syndrome": {
    name: "17q12 duplication syndrome",
    about: "which can delay development and learning",
  },
  "Pelizaeus-Merzbacher spectrum disorder": {
    name: "Pelizaeus-Merzbacher disease",
    about: "which damages the brain and spinal cord",
  },
};
