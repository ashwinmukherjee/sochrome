// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// A finding's key and the name its row shows.

import type { Identity } from "../contracts/types.ts";

const ONE_LETTER: Record<string, string> = {
  Ala: "A", Arg: "R", Asn: "N", Asp: "D", Cys: "C", Gln: "Q", Glu: "E", Gly: "G", His: "H", Ile: "I", Leu: "L",
  Lys: "K", Met: "M", Phe: "F", Pro: "P", Ser: "S", Thr: "T", Trp: "W", Tyr: "Y", Val: "V", Ter: "*",
}; // prettier-ignore

/** Unique within a result: one variant in two genes is two findings. */
export const findingKey = (i: Pick<Identity, "normalized_key" | "gene">): string => `${i.normalized_key}:${i.gene}`;

/** The protein change in one-letter form when it is one residue for another (C61G), else the cDNA change. */
export function variantName(i: Pick<Identity, "hgvs_c" | "hgvs_p">): string {
  const m = typeof i.hgvs_p === "string" ? /^p\.([A-Z][a-z]{2})(\d+)([A-Z][a-z]{2})$/.exec(i.hgvs_p) : null;
  return m && ONE_LETTER[m[1]] && ONE_LETTER[m[3]] ? `${ONE_LETTER[m[1]]}${m[2]}${ONE_LETTER[m[3]]}` : i.hgvs_c;
}
