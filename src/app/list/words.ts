// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Every word the list and the genes page say. Captions are written in sentence case; CSS sets them uppercase.

import type { ListName } from "../../contracts/app";
import { NBSP } from "../../ledger";

const fmt = (n: number) => n.toLocaleString("en-US");

export const LIST_WORDS = {
  caption: { yours: "Your variants", carriers: "Carriers" } satisfies Record<ListName, string>,
  count: (n: number) => `${NBSP}(${fmt(n)})`,
  /** The list's sentence: what the list is, never a verdict (SPEC, the list's sentence). */
  sentence: {
    yours: "Rare changes in genes where a single altered copy can be enough to cause a condition.",
    carriers:
      "Rare changes in genes where a condition takes two altered copies. Yours are single copies, which on their own don't cause it.",
  } satisfies Record<ListName, string>,
  nothing: (genes: number) =>
    `No rare changes in the ${fmt(genes)} genes checked. Other genes, and other kinds of change, were not examined.`,
  more: (n: number) => `+${fmt(n)} more`,
  top: "Back to top",
  genes: "Genes checked",
  /** The genes page's sentence: what the set is and what it leaves out. The set is ClinGen's
   *  Definitive and Strong gene-disease ratings and ACMG SF v3.2, on MANE Select (the data repo's genes.py); MANE has
   *  19,363 genes, so about 17,000 others. */
  genesSentence:
    "Genes with strong or definitive evidence that changes in them cause an inherited condition. About 17,000 other genes aren't checked.",
  back: "Back",
} as const;
