// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Every word the tally says. Each caption is worked out from the genome's own counts, so it is true of any genome.

import type { GenomeResult } from "../../contracts/app";
import { RARE_AF } from "../../contracts/constants";

/** The tally's counts, and how many genes were read: the coding caption names them. */
type Counts = GenomeResult["counts"] & { genes: number };
/** The counts a caption reads, from a result. */
export const countsOf = (r: GenomeResult): Counts => ({ ...r.counts, genes: r.checked.genes });
export const CUTS = ["all", "coding", "protein", "rare", "yours"] as const;
type Cut = (typeof CUTS)[number];

export const fmt = (n: number) => n.toLocaleString("en-US");

/** One copy at the rare cut's frequency: carried by about one person in this many. */
const ONE_IN = Math.round(1 / (2 * RARE_AF));

/** A share in plain words. */
export function share(part: number, whole: number): string {
  const pct = whole > 0 ? (part / whole) * 100 : 0;
  if (pct < 0.1) return "Under 0.1%";
  if (pct < 1) return "Under 1%";
  if (pct >= 40 && pct <= 60) return "About half";
  return `About ${Math.round(pct)}%`;
}

function carriers(n: number): string {
  if (n === 0) return "";
  return n === 1
    ? " The other one is a carrier: in a gene where a condition takes two altered copies."
    : ` The other ${fmt(n)} are carriers: in genes where a condition takes two altered copies.`;
}

/** Counts as wide as a genome's can be: the lines they make are the longest each cut can say, so the phone's
 *  band, sized to them from the start of a read, holds whatever the read turns out to say. */
export const WIDEST: Counts = {
  all: 9_999_999,
  coding: 99_999,
  protein: 99_999,
  rare: 9_999,
  yours: 9_999,
  carriers: 9_999,
  genes: 99_999,
};

/** The second cut's line in three parts: the genes' count is the way to the genes page on a phone. */
function codingLine(c: Counts): [before: string, genes: string, after: string] {
  return [
    `${share(c.coding, c.all)} of them fall in the protein-coding parts of the `,
    `${fmt(c.genes)} genes`,
    " checked. The marks show where they are.",
  ];
}

export const TALLY_WORDS = {
  caption: "Your variants",
  label: "The descent, cut by cut",
  count: (cut: Cut, c: Counts): number => c[cut],
  says: {
    all: () => "Places where your genome differs from the reference genome.",
    coding: (c) => codingLine(c).join(""),
    protein: (c) => `${share(c.protein, c.coding)} of those change the protein. The rest leave it as it was.`,
    rare: (c) =>
      c.rare
        ? `Carried by fewer than 1 in ${fmt(ONE_IN)} people. Each mark is now one variant, worth a closer look.`
        : `None of those is rare: each is carried by more than 1 in ${fmt(ONE_IN)} people.`,
    yours: (c) => `In genes where a single altered copy can be enough to cause a condition.${carriers(c.carriers)}`,
  } satisfies Record<Cut, (c: Counts) => string>,
  codingLine,
  next: "Next",
  explore: "Explore",
  reference: (fraction: number) => `Reference data ${Math.round(fraction * 100)}%`,
} as const;
