// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/** Gate 5: Gene validity — gene must be in the gene-set (loaded from validity.tsv). */

import type { JoinedVariant } from "../../contracts/types.ts";

let validGenes: Set<string> | null = null;

/** Initialize the gate with the validity gene set. Must be called before gate(). */
export function initValidity(genes: Set<string>): void {
  validGenes = genes;
}

export function gate(v: JoinedVariant): boolean {
  if (!validGenes) {
    throw new Error("gene_validity gate not initialized — call initValidity() first");
  }
  if (!v.gene) return false;
  return validGenes.has(v.gene);
}
