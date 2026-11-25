// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// ClinVar's harmful classes that labs qualify: low penetrance, or a harmful call beside a risk-allele one.

const LOW_PENETRANCE = ",_low_penetrance";
const RISK_ALLELE: ReadonlySet<string> = new Set(["Established_risk_allele", "Likely_risk_allele"]);

export interface HarmfulPart {
  pathogenic: boolean;
  likely: boolean;
  /** Labs say it leads to the condition less often than the gene's harmful variants usually do. */
  lowPenetrance: boolean;
}

/**
 * The harmful part of a classification (the CLNSIG before any "|"), or null when it has none or
 * mixes it with anything else. "Pathogenic,_low_penetrance" and "Pathogenic/Likely_risk_allele"
 * are harmful calls with a qualifier; a risk allele alone is not a harmful call.
 */
export function harmfulPart(classification: string): HarmfulPart | null {
  const terms = classification.split("/");
  const bare = terms.map((t) => (t.endsWith(LOW_PENETRANCE) ? t.slice(0, -LOW_PENETRANCE.length) : t));
  const pathogenic = bare.includes("Pathogenic");
  const likely = bare.includes("Likely_pathogenic");
  if (!pathogenic && !likely) return null;
  if (!bare.every((t) => t === "Pathogenic" || t === "Likely_pathogenic" || RISK_ALLELE.has(t))) return null;
  const lowPenetrance = terms.some((t) => t.endsWith(LOW_PENETRANCE)) || bare.some((t) => RISK_ALLELE.has(t));
  return { pathogenic, likely, lowPenetrance };
}
