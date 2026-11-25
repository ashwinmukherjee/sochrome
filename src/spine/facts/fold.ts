// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/** Portrait and chain facts: the same fields as the renderer's FoldSpecimen and
 *  ChainSpecimen, by the arithmetic the specimens were made with
 *  (cyclic Jacobi PCA, N-to-C orientation, the 40-residue clamped window,
 *  contacts within 8 Å and at least 4 apart in sequence). Browser-portable. */

import {
  BURIED_CN,
  BURIED_RADIUS_A,
  CONTACT_MAX_A,
  CONTACT_MIN_SEP,
  FOLD_WINDOW,
  PLANE_MIN,
  PLDDT_SOLID,
} from "../../contracts/constants.ts";

export interface Fold {
  gene: string;
  uniprot: string;
  length: number;
  residues: { aa1: string; ca: [number, number, number]; plddt: number }[];
}

export interface FoldFacts {
  gene: string;
  uniprot: string;
  start: number;
  end: number;
  markIdx: number;
  points: number[][];
  plddt: number[];
  contacts: number[];
  evr: number[];
  source: string;
  /** the plane keeps at least PLANE_MIN of the window's spread */
  planeHolds: boolean;
  /** E2, a run of changed residues: their window indices; `contacts` is then the run's one
   *  contact set and `contactFrom[k]` the index (into `marks`) each partner is drawn from */
  marks?: number[];
  contactFrom?: number[];
  /** O4: buried, or on the surface at an annotated site, or on the surface */
  o4?: {
    state: "buried" | "surface-site" | "surface";
    cn: number;
    partners?: string[];
    /** UniProt's site annotations were looked up for this protein (cache/sites), so "surface"
     *  means none of them is near, not that nobody looked (the claims audit) */
    checked?: boolean;
  };
}

export interface ChainFacts {
  gene: string;
  uniprot: string | null;
  length: number;
  site: number;
  plddt: number[];
  unmapped?: boolean;
  lastResidue?: number;
  source: string;
  /** WHY THIS IS ON THE CHAIN AND NOT THE FOLD, as one of a fixed list. Copy
   *  that says why may branch on it; copy that doesn't must stay true for every value.
   *  `source` stays the human-readable note. */
  reason: ChainReason;
}

/** low-confidence: AlphaFold's model is under PLDDT_SOLID at the site
 *  no-flat-view:   AlphaFold is confident there, but the site's window doesn't flatten (planeHolds false)
 *  no-model:       AlphaFold DB returns no entry for the UniProt accession (large proteins among them)
 *  partial-model:  AlphaFold's model covers only part of the protein
 *  other-isoform:  the MANE protein isn't UniProt's canonical sequence, which AlphaFold models
 *  not-fetched:    AlphaFold wasn't fetched for this gene */
export type ChainReason =
  "low-confidence" | "no-flat-view" | "no-model" | "partial-model" | "other-isoform" | "not-fetched";

function jacobi3(m: number[][]): [number[], number[][]] {
  const a = m.map((r) => r.slice());
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let it = 0; it < 64; it++) {
    let off = 0;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (i !== j) off += a[i][j] ** 2;
    if (off < 1e-20) break;
    for (let p = 0; p < 2; p++)
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-20) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const sign = theta >= 0 ? 1 : -1;
        const t = sign / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1),
          s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p],
            akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k],
            aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k][p],
            vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
  }
  return [[a[0][0], a[1][1], a[2][2]], [0, 1, 2].map((c) => [v[0][c], v[1][c], v[2][c]])];
}

/** Python's round(): halves go to the even neighbour (86.25 -> 86.2). The
 *  specimens were written by Python, and a half rounded the other way is a
 *  different number in a frozen record. */
function roundHalfEven(x: number, dp: number): number {
  // A double's decimal expansion is finite; 60 places shows it whole for these
  // magnitudes. A tie is an expansion that is exactly ...5 then zeros (86.25);
  // 29.95 is really 29.9499..., which is not one, and multiplying by 10 would
  // hide that (29.95 * 10 === 299.5 in floating point).
  const exact = Math.abs(x).toFixed(Math.min(100, dp + 60));
  const tail = exact.slice(exact.indexOf(".") + 1 + dp);
  if (/^50*$/.test(tail)) {
    const k = 10 ** dp,
      f = Math.floor(Math.abs(x) * k);
    return (Math.sign(x) * (f % 2 === 0 ? f : f + 1)) / k;
  }
  return Number(x.toFixed(dp));
}
const r4 = (x: number) => roundHalfEven(x, 4);
const r3 = (x: number) => roundHalfEven(x, 3);
const r1 = (x: number) => roundHalfEven(x, 1);

export function project(cas: number[][]): { pts: number[][]; evr: number[] } {
  const n = cas.length;
  const mean = [0, 1, 2].map((k) => cas.reduce((s, p) => s + p[k], 0) / n);
  const x = cas.map((p) => [0, 1, 2].map((k) => p[k] - mean[k]));
  const cov = [0, 1, 2].map((a) => [0, 1, 2].map((b) => x.reduce((s, r) => s + r[a] * r[b], 0) / (n - 1)));
  const [vals0, vecs0] = jacobi3(cov);
  const order = [0, 1, 2].sort((i, j) => vals0[j] - vals0[i]);
  const vals = order.map((i) => vals0[i]);
  const vecs = order.map((i) => vecs0[i].slice());
  for (const e of vecs) {
    let big = 0;
    for (let i = 1; i < 3; i++) if (Math.abs(e[i]) > Math.abs(e[big])) big = i;
    if (e[big] < 0) for (let i = 0; i < 3; i++) e[i] = -e[i];
  }
  const dot = (r: number[], e: number[]) => r[0] * e[0] + r[1] * e[1] + r[2] * e[2];
  const xs = x.map((r) => dot(r, vecs[0]));
  const mi = (n - 1) / 2,
    mx = xs.reduce((s, v) => s + v, 0) / n;
  if (xs.reduce((s, v, i) => s + (i - mi) * (v - mx), 0) < 0) for (let i = 0; i < 3; i++) vecs[0][i] = -vecs[0][i];
  const total = vals.reduce((s, v) => s + v, 0) || 1;
  return { pts: x.map((r) => [dot(r, vecs[0]), dot(r, vecs[1])]), evr: vals.map((v) => r4(v / total)) };
}

export function foldWindow(length: number, site: number, n = FOLD_WINDOW): [number, number] {
  const w = Math.min(n, length);
  const start = Math.max(1, Math.min(site - Math.floor(w / 2), length - w + 1));
  return [start, start + w - 1];
}

const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function foldFacts(fold: Fold, site: number, start?: number, end?: number): FoldFacts {
  const [lo, hi] = start != null && end != null ? [start, end] : foldWindow(fold.length, site);
  const seg = fold.residues.slice(lo - 1, hi);
  const { pts, evr } = project(seg.map((r) => r.ca));
  const a = fold.residues[site - 1].ca;
  const contacts: number[] = [];
  for (let j = lo; j <= hi; j++) {
    if (Math.abs(j - site) < CONTACT_MIN_SEP) continue;
    if (Math.round(dist(a, fold.residues[j - 1].ca) * 100) / 100 <= CONTACT_MAX_A) contacts.push(j - lo);
  }
  return {
    gene: fold.gene,
    uniprot: fold.uniprot,
    start: lo,
    end: hi,
    markIdx: site - lo,
    points: pts.map((p) => [r3(p[0]), r3(p[1])]),
    plddt: seg.map((r) => r1(r.plddt)),
    contacts,
    evr,
    source: `AlphaFold DB ${fold.uniprot}, PCA over residues ${lo}-${hi} computed in the spine's facts stage`,
    planeHolds: r4(evr[0] + evr[1]) >= PLANE_MIN,
  };
}

export function chainFacts(
  fold: Fold | null,
  gene: string,
  length: number,
  site: number,
  why: string,
  reason: ChainReason,
  lastResidue?: number,
): ChainFacts {
  const tail = lastResidue != null && lastResidue !== length ? { lastResidue } : {};
  if (!fold) return { gene, uniprot: null, length, site, plddt: [], unmapped: true, ...tail, source: why, reason };
  return {
    gene,
    uniprot: fold.uniprot,
    length,
    site,
    plddt: fold.residues.map((r) => r1(r.plddt)),
    ...tail,
    source: `AlphaFold DB ${fold.uniprot}`,
    reason,
  };
}

/** E2: a run of consecutive changed residues. One contact set: every residue in
 *  the window within CONTACT_MAX_A of any changed residue and at least CONTACT_MIN_SEP from all
 *  of them in sequence, each drawn once, from the nearest changed residue. */
export function runFacts(fold: Fold, sites: number[]): FoldFacts {
  const f = foldFacts(fold, sites[0]);
  const marks = sites.map((r) => r - f.start).filter((i) => i >= 0 && i < f.points.length);
  const contacts: number[] = [],
    contactFrom: number[] = [];
  for (let j = f.start; j <= f.end; j++) {
    if (sites.some((r) => Math.abs(j - r) < CONTACT_MIN_SEP)) continue;
    let best = -1,
      bestD = Infinity;
    sites.forEach((r, k) => {
      const d = Math.round(dist(fold.residues[r - 1].ca, fold.residues[j - 1].ca) * 100) / 100;
      if (d <= CONTACT_MAX_A && d < bestD) {
        bestD = d;
        best = k;
      }
    });
    if (best >= 0) {
      contacts.push(j - f.start);
      contactFrom.push(best);
    }
  }
  return { ...f, marks, contacts, contactFrom };
}

/** O4's burial: residues whose C-alpha lies within 10 A of this one's, across the whole model.
 *  The cut is calibrated on the design's own references: BRCA1 C61 (21) and CFTR F508 (19) are
 *  buried (structural); a residue under BURIED_CN is on the surface. */
export function neighbourCount(fold: Fold, site: number): number {
  const a = fold.residues[site - 1].ca;
  let n = 0;
  for (const r of fold.residues) {
    const d = dist(a, r.ca);
    if (d > 0 && d <= BURIED_RADIUS_A) n++;
  }
  return n;
}
export function o4Of(
  fold: Fold,
  sites: number[],
  features: { kind: string; start: number; end: number; partner: string }[],
): NonNullable<FoldFacts["o4"]> {
  const cn = Math.max(...sites.map((r) => neighbourCount(fold, r)));
  if (cn >= BURIED_CN) return { state: "buried", cn };
  const hits = features.filter((f) => sites.some((r) => r >= f.start && r <= f.end));
  const partners = [...new Set(hits.map((f) => plainPartner(f.partner)))].slice(0, 2);
  return partners.length ? { state: "surface-site", cn, partners } : { state: "surface", cn };
}

/** UniProt's ligand names, said plainly where there is a plain word for them (ions); anything
 *  else passes through as UniProt writes it. */
const PLAIN: Record<string, string> = {
  "Ca(2+)": "calcium",
  "Mg(2+)": "magnesium",
  "Zn(2+)": "zinc",
  "Fe cation": "iron",
  "Fe(2+)": "iron",
  "Fe(3+)": "iron",
  "Mn(2+)": "manganese",
  "Cu(2+)": "copper",
  "Cu cation": "copper",
  "K(+)": "potassium",
  "Na(+)": "sodium",
  heme: "heme",
};
export const plainPartner = (p: string) => PLAIN[p] ?? p;
