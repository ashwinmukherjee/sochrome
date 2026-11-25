// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The app's state: the route and the genomes in memory. All of it dies with the page; the read itself is the descent's.

import type { Finding, GeneInfo, GenomeResult, ListName, Route, SampleId } from "../contracts/app";

/** Whose genome: a shipped sample, or the one file the person loaded. */
export type Source = SampleId | "file";

interface AppState {
  route: Route;
  /** The last route that was not a side trip: what the genes page stands over. */
  under: Route;
  results: Partial<Record<Source, GenomeResult>>;
  /** null until the gene set has arrived. */
  genes: GeneInfo[] | null;
}

type Action =
  | { type: "route"; route: Route }
  | { type: "genes"; genes: GeneInfo[] }
  | { type: "result"; source: Source; result: GenomeResult }
  /** A new read of a source begins: its last result is let go. */
  | { type: "forget"; source: Source };

const sideTrip = (r: Route) => r.at === "genes";

export const initial = (route: Route): AppState => ({
  route,
  under: sideTrip(route) ? { at: "landing" } : route,
  results: {},
  genes: null,
});

/** The genome a route shows; null for the routes that need none. */
export function sourceOf(r: Route): Source | null {
  return r.at === "descent" || r.at === "list" || r.at === "room" ? (r.sample ?? "file") : null;
}

export function reduce(s: AppState, a: Action): AppState {
  switch (a.type) {
    case "route":
      return { ...s, route: a.route, under: sideTrip(a.route) ? s.under : a.route };
    case "genes":
      return { ...s, genes: a.genes };
    case "result":
      return s.results[a.source] === a.result ? s : { ...s, results: { ...s.results, [a.source]: a.result } };
    case "forget": {
      const { [a.source]: _gone, ...results } = s.results;
      return { ...s, results };
    }
  }
}

/** A sample's room is named in the address by its gene and its variant. */
export const nameOf = (f: Finding): string => `${f.bundle.identity.gene}-${f.name}`;

/** The finding a room route names in a list's rows, as they stand; null when the list holds none such. */
export function opened(
  rows: readonly Finding[],
  r: Extract<Route, { at: "room" }>,
): { finding: Finding; index: number } | null {
  const index = r.sample === null ? r.index : rows.findIndex((f) => nameOf(f) === r.name);
  const finding = rows[index];
  return finding ? { finding, index } : null;
}

/** The route of a finding's room, in the genome `source` names. */
export function roomRoute(source: Source, which: ListName, rows: readonly Finding[], key: string): Route | null {
  const index = rows.findIndex((f) => f.key === key);
  const finding = rows[index];
  if (!finding) return null;
  return source === "file"
    ? { at: "room", sample: null, which, index }
    : { at: "room", sample: source, which, name: nameOf(finding) };
}
