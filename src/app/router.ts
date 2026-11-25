// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Hash routes: the one place the address, the history and the tab title are read or written.

import type { DescentState, ListName, Route, Router, SampleId } from "../contracts/app";

type Cut = Exclude<DescentState, "landing">;
const CUTS: readonly Cut[] = ["loading", "all", "coding", "protein", "rare", "yours"];
const SAMPLES: readonly SampleId[] = ["hg003", "hg002", "hg001"];
/** A room's word in the address, by list. */
const ROOM_WORD: Record<ListName, string> = { yours: "variant", carriers: "carrier" };
const LANDING: Route = { at: "landing" };

const isCut = (s: string | undefined): s is Cut => (CUTS as readonly string[]).includes(s ?? "");
const isSample = (s: string | undefined): s is SampleId => (SAMPLES as readonly string[]).includes(s ?? "");
const listOf = (word: string | undefined): ListName | null =>
  word === ROOM_WORD.yours ? "yours" : word === ROOM_WORD.carriers ? "carriers" : null;

function decode(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

/** A file's routes carry no names and no numbers: a room's place in its list is held in the page's memory
 *  (`room`), never the address or the history entry, so neither synced history nor session restore holds even
 *  how long a list is.
 *  An address that names nothing known is the landing. */
export function parse(hash: string, room: number | null = null): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  let sample: SampleId | null = null;
  if (parts[0] === "sample") {
    if (!isSample(parts[1])) return LANDING;
    sample = parts[1];
    parts.splice(0, 2);
  }
  const [head, arg, ...rest] = parts;
  if (rest.length) return LANDING;
  if (head === "read" && isCut(arg)) return { at: "descent", sample, state: arg };
  if (head === "list" && (arg === undefined || arg === "carriers"))
    return { at: "list", sample, which: arg ?? "yours" };
  const which = listOf(head);
  if (which && arg !== undefined) {
    if (sample) {
      const name = decode(arg);
      return name ? { at: "room", sample, which, name } : { at: "list", sample, which };
    }
    // A file's room never has a word after it.
    return LANDING;
  }
  // A file's room: its place comes from the entry's state. An entry without one (a typed address) is its list.
  if (which && !sample && !arg)
    return room !== null ? { at: "room", sample, which, index: room } : { at: "list", sample, which };
  if (sample || arg !== undefined) return LANDING;
  if (head === "genes") return { at: "genes" };
  return LANDING;
}

export function format(r: Route): string {
  const base = "sample" in r && r.sample ? `#/sample/${r.sample}` : "#";
  switch (r.at) {
    case "landing":
      return "#/";
    case "genes":
      return "#/genes";
    case "descent":
      return `${base}/read/${r.state}`;
    case "list":
      return `${base}/list${r.which === "carriers" ? "/carriers" : ""}`;
    case "room":
      return r.sample === null
        ? `${base}/${ROOM_WORD[r.which]}`
        : `${base}/${ROOM_WORD[r.which]}/${encodeURIComponent(r.name)}`;
  }
}

export interface AppRouter extends Router {
  current(): Route;
  /** Leave a side trip: back through history when this page pushed the entry, else to `fallback` in its place. */
  back(fallback: Route): void;
}

/** How many entries this page has pushed under the current one: all an entry's state ever holds. The browser
 *  writes the state into its session-restore files, so nothing from a file goes in it. */
interface Depth {
  depth: number;
}
const depthOf = (state: unknown): number | null => {
  const d = (state as Partial<Depth> | null)?.depth;
  return typeof d === "number" ? d : null;
};
/** A file's room's place in its list; null on any other route. */
const roomOf = (r: Route): number | null => (r.at === "room" && r.sample === null ? r.index : null);
/** Two routes are the same place: the same address, and for a file's room the same place in its list. */
const same = (a: Route, b: Route): boolean => format(a) === format(b) && roomOf(a) === roomOf(b);

export function createRouter(): AppRouter {
  const listeners = new Set<(r: Route) => void>();
  let depth = depthOf(history.state) ?? 0;
  /** Each entry's file room, by its depth: in memory only, gone with the page, as the file's result is. A push
   *  at a depth replaces the entries past it, so a depth names one live entry. */
  const rooms = new Map<number, number>();
  const write = (r: Route, how: "push" | "replace") => {
    if (how === "push") history.pushState({ depth: ++depth } satisfies Depth, "", format(r));
    else history.replaceState({ depth } satisfies Depth, "", format(r));
    const room = roomOf(r);
    if (room === null) rooms.delete(depth);
    else rooms.set(depth, room);
  };
  const current = () => {
    const at = depthOf(history.state);
    return parse(location.hash, at === null ? null : (rooms.get(at) ?? null));
  };

  // Arriving writes the address, it never pushes: history starts wherever the reader came in.
  write(current(), "replace");

  addEventListener("popstate", () => {
    const r = current();
    const known = depthOf(history.state);
    // An entry the browser made itself (a link, a typed address) is one deeper than the last.
    if (known === null) {
      depth += 1;
      write(r, "replace");
    } else depth = known;
    listeners.forEach((cb) => cb(r));
  });

  return {
    parse,
    format,
    current,
    go(r, o) {
      if (same(r, current()) && !o?.replace) return;
      write(r, o?.replace ? "replace" : "push");
      listeners.forEach((cb) => cb(r));
    },
    back(fallback) {
      if (depth > 0) history.back();
      else this.go(fallback, { replace: true });
    },
    on(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
  };
}

/** The back/forward cache would keep a read alive after the person leaves the page, and Back would show it again.
 *  A page put away is blanked first, and a page the cache restores starts over: a file's routes land on the landing,
 *  a sample's re-run from their address. */
export function startOverWhenRestored(root: HTMLElement): void {
  addEventListener("pagehide", (e) => {
    if (e.persisted) root.hidden = true;
  });
  addEventListener("pageshow", (e) => {
    if (e.persisted) location.reload();
  });
}

/** `?theme=light` or `?theme=dark` pins the ground, for checks; otherwise it follows the OS. */
export function themeOverride(): "light" | "dark" | null {
  const t = new URLSearchParams(location.search).get("theme");
  return t === "light" || t === "dark" ? t : null;
}
