// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The ledger behind its handle: an SVG island that keeps its own state and redraws itself from it.

import type { DescentState, GenomeResult, LedgerHandle, ListName, MountLedger, Rulers } from "../contracts/app";
import { BREAKPOINT_PHONE, CHROM_X, CHROM_Y } from "../contracts/constants";
import { type Drawn, el as svgEl, type Fill, type Fit, fit, type GeneSite, ledger, settled, unread } from "./dirs";
import { findingsByMark, groups, type Listed } from "./marks";
import { NBSP, WORDS } from "./words";

type Standing = DescentState | "list";
type Ev = "enter" | "leave" | "click";
/** What was pointed at: one mark, or a whole row (the list lights a row's set but scrolls only for a mark). */
export type From = "tick" | "row";
type Listener = (keys: string[], from: From) => void;

export interface LedgerIsland extends LedgerHandle {
  on(ev: Ev, cb: Listener): void;
  /** The sex row's pair, known before the result is (a sample's donor): it settles out of "XX/XY" now. */
  sex(pair: string): void;
  /** Measure and redraw now if the room or the pitch changed: a page whose frame just changed (the phone's band)
   *  shows its ledger at its own size from the first frame, not after the resize's wait. */
  refit(): void;
}

interface LedgerOptions {
  /** Where each checked gene sits: the genes' layer. */
  genes?: readonly GeneSite[];
  /** The geometry, each time the ledger is drawn: the caption stands on it. */
  onFit?(f: Fit): void;
  /** The room left of the drawing every row's name needs to stand whole ("Chromosomes XX/XY" the longest):
   *  the host reserves it, so every row names itself at every width. */
  onKeyRoom?(px: number): void;
  /** Drawn where the unread ledger stood and its pair had not settled: the sex row's pair settles out of "XX/XY"
   *  instead of standing at once. */
  settleSex?: boolean;
}

/** How many cuts stand at each state; the classes are cumulative. */
const CUTS = ["coding", "protein", "rare", "yours"] as const;
const DEPTH: Record<Standing, number> = {
  landing: 0,
  loading: 0,
  all: 0,
  coding: 1,
  protein: 2,
  rare: 3,
  yours: 4,
  list: 4,
};
/** A resize redraws once the window has stopped moving. */
const RESIZE_MS = 120;

const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((k, i) => k === b[i]);

export function mountLedger(
  el: HTMLElement,
  result: GenomeResult | null,
  rulers: Rulers,
  options: LedgerOptions = {},
): LedgerIsland {
  const narrow = matchMedia(`(max-width: ${BREAKPOINT_PHONE}px)`);
  const probe = document.createElement("i");
  probe.className = "ledger-pitch";
  el.prepend(probe);
  const found = result ? findingsByMark(result, import.meta.env.DEV) : new Map<never, Listed>();
  const listeners: Record<Ev, Set<Listener>> = { enter: new Set(), leave: new Set(), click: new Set() };
  const emit = (ev: Ev, keys: string[], from: From) => listeners[ev].forEach((cb) => cb(keys, from));

  /** The sex row's pair told ahead of the result; a redraw stands on it. */
  let known: string | null = null;
  let at: Standing = "landing";
  /** The genes page stands over whatever state the ledger was in. */
  let page = false;
  let which: ListName = "yours";
  let genesMode: "off" | "overlay" | "reference" = "off";
  let fill: Fill = unread();
  let lit: string[] | null = null;
  /** The pointer's own: a mark's group, and the row it is over. */
  let pointed: string[] | null = null;
  let hoverRow = -1;

  let drawn: Drawn | null = null;
  let drawnAs = "";
  let tickOf = new Map<string, { rect: SVGRectElement; row: number; list: ListName }>();
  let groupOf = new Map<string, string[]>();
  let timer = 0;
  const rafs = new Set<number>();
  const timers = new Set<number>();

  const token = (name: string) => (still() ? 0 : Number.parseFloat(getComputedStyle(el).getPropertyValue(name)) || 0);
  const frames = (n: number, then: () => void) => {
    const id = requestAnimationFrame(() => {
      rafs.delete(id);
      if (n > 1) frames(n - 1, then);
      else then();
    });
    rafs.add(id);
  };
  const after = (ms: number, then: () => void) => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      then();
    }, ms);
    timers.add(id);
  };
  /** Rows answer the pointer on the landing (by name: nothing is counted yet), from the first count on, and under
   *  the genes page (counting its genes); never during the read. */
  const live = () => page || at === "landing" || (!!result && at !== "loading");
  /** The checked genes per row, for the genes page's key: the 23rd row counts X's and Y's. */
  const genesOn = new Map<number, number>();
  for (const g of options.genes ?? []) {
    const c = g.chromIndex === CHROM_Y ? CHROM_X : g.chromIndex;
    genesOn.set(c, (genesOn.get(c) ?? 0) + 1);
  }

  /** The host's padding is the room a row's key may stand in; the drawing takes the width between. */
  const measure = (): Fit | null => {
    const host = getComputedStyle(el);
    const room = { lead: Number.parseFloat(host.paddingLeft) || 0, air: Number.parseFloat(host.paddingRight) || 0 };
    const w = el.clientWidth - room.lead - room.air;
    const pitch = Number.parseFloat(getComputedStyle(probe).height);
    if (!(w > 0) || !Number.isFinite(pitch)) return null;
    return fit(w, pitch, narrow.matches, room);
  };
  const drawnKey = (f: Fit) => `${f.w}:${f.pitch}:${f.narrow}:${f.lead}:${f.air}`;

  function build() {
    const f = measure();
    if (!f) return;
    drawn?.svg.remove();
    const sex = result?.sexPair ?? known ?? WORDS.sexUnknown;
    // The first drawing after the read starts from the pair the read stood on, and settles; a redraw stands at once.
    const settling = !drawn && !!options.settleSex && sex !== WORDS.sexUnknown;
    const d = ledger(
      { marks: result?.marks ?? [], rulers, genes: options.genes ?? [], sex: settling ? WORDS.sexUnknown : sex },
      f,
    );
    if (settling && d.unknownSex) settle(d.unknownSex, sex);
    drawn = d;
    drawnAs = drawnKey(f);

    const ticks = d.ticks.flatMap((t) => {
      const finding = found.get(t.mark);
      return finding ? [{ ...t, ...finding }] : [];
    });
    tickOf = new Map(ticks.map((t) => [t.key, t]));
    groupOf = groups(ticks);
    const hits = svgEl("g", { class: "hits" }, d.svg);
    const done = new Set<string[]>();
    for (const t of ticks) {
      const keys = groupOf.get(t.key) ?? [t.key];
      if (done.has(keys)) continue;
      done.add(keys);
      const hit = d.hit(hits, t);
      hit.dataset.list = t.list;
      hit.addEventListener("pointerenter", () => point(keys));
      hit.addEventListener("pointerleave", () => point(null));
      hit.addEventListener("click", () => emit("click", keys, "tick"));
    }
    d.rows.forEach(({ band }, c) => {
      band.addEventListener("pointerenter", () => overRow(c));
      band.addEventListener("pointerleave", () => overRow(-1));
    });

    el.append(d.svg);
    options.onFit?.(f);
    options.onKeyRoom?.(d.keyRoom());
    instantly(apply);
  }

  /** "XX/XY" to the pair the file shows, its right edge still: "XX/" fades; for XX the Y turns to an X in place,
   *  for X it fades too. */
  function settle(parts: NonNullable<Drawn["unknownSex"]>, to: string) {
    const swap = token("--t-swap");
    const out = (s: SVGTSpanElement) => s.classList.add("out");
    frames(2, () => {
      out(parts.lead);
      if (to !== "XY") out(parts.last);
      after(swap, () => {
        parts.lead.remove();
        if (to === "X") {
          parts.last.remove();
          // One chromosome: the key turns singular with it.
          const key = parts.mid.parentElement?.querySelector(".key");
          if (key) key.textContent = `${WORDS.key}${NBSP}`;
        }
        if (to === "XX") {
          parts.last.textContent = "X";
          parts.last.classList.remove("out");
        }
      });
    });
  }

  function instantly(run: () => void) {
    const svg = drawn?.svg;
    svg?.classList.add("instant");
    run();
    frames(2, () => svg?.classList.remove("instant"));
  }

  function apply() {
    if (!drawn) return;
    const cl = drawn.svg.classList;
    const depth = genesMode === "reference" ? 0 : DEPTH[at];
    CUTS.forEach((cut, i) => cl.toggle(cut, depth > i));
    cl.toggle("filling", at === "loading");
    cl.toggle("empty", at === "landing" && genesMode !== "reference");
    cl.toggle("menu", at === "list");
    cl.toggle("carriers", at === "list" && which === "carriers");
    cl.toggle("live", live());
    cl.toggle("genes-page", page);
    cl.toggle("genes-on", genesMode !== "off");
    cl.toggle("genes-ref", genesMode === "reference");
    if (at === "landing") fill = unread();
    else if (at !== "loading" && result) fill = settled(result.parsed, result.copiesX === null);
    drawn.paint(fill);
    relight();
  }

  /** The keys a row lists: its standing ticks in the list. */
  function rowKeys(c: number): string[] {
    if (at !== "list" || c < 0) return [];
    return [...tickOf].filter(([, t]) => t.row === c && t.list === which).map(([k]) => k);
  }

  /** A chromosome's variants at the cut the descent is on: the rows sum to the tally. Y is read, never drawn. */
  function rowCount(c: number): { n: number; y: number } {
    if (!result) return { n: 0, y: 0 };
    const count = (chrom: number) => {
      if (at === "all") return result.parsed[chrom] ?? 0;
      const level = at === "coding" ? 1 : at === "protein" ? 2 : 3;
      const standing = (carrier: number) =>
        at === "list" ? (which === "carriers") === !!carrier : at !== "yours" || !carrier;
      return result.marks.reduce((n, m) => n + +(m[0] === chrom && m[3] >= level && standing(m[4])), 0);
    };
    const y = c === CHROM_X ? count(CHROM_Y) : 0;
    return { n: count(c) + y, y };
  }

  function relight() {
    if (!drawn) return;
    const { svg, rows, genes } = drawn;
    svg.querySelectorAll(".hot").forEach((m) => m.classList.remove("hot"));
    if (page) {
      // Under the genes page the ledger's objects are genes: a name and its tick are one.
      for (const symbol of lit ?? []) genes.get(symbol)?.classList.add("hot");
      svg.classList.toggle("gfocus", !!lit?.length);
    }
    const row = live() ? hoverRow : -1;
    const ofRow = rowKeys(row);
    const keys = page || !live() ? [] : (pointed ?? lit ?? ofRow);
    for (const k of keys) tickOf.get(k)?.rect.classList.add("hot");
    // A variant wins over the chromosome it sits on; a chromosome's set never grows.
    const asRow = !pointed && ofRow.length > 0 && same(keys, ofRow);
    const group = keys.length ? groupOf.get(keys[0]) : undefined;
    const single = !asRow && !!group && keys.every((k) => groupOf.get(k) === group);
    svg.classList.toggle("linking", keys.length > 0);
    svg.classList.toggle("single", single);
    if (!page) svg.classList.remove("gfocus");

    const variantRow = single ? (tickOf.get(keys[0])?.row ?? -1) : -1;
    const focus = variantRow >= 0 ? variantRow : row;
    svg.classList.toggle("focusing", focus >= 0);
    rows.forEach(({ g }, c) => {
      const on = c === focus;
      const { n } = on && variantRow < 0 && !page ? rowCount(c) : { n: 0 };
      // On the landing a row is named, not counted: nothing is read yet, which its outline already says. Under the
      // genes page every row counts its genes.
      const counted = on && variantRow < 0 && (page || at !== "landing");
      // The 23rd row with no X read says so where its count would stand, on hover only.
      const unread = !page && c === CHROM_X && fill.noX && n === 0;
      g.classList.toggle("focus", on);
      g.classList.toggle("keyed", on);
      g.classList.toggle("counted", counted);
      if (on) drawn?.key(c);
      if (counted) drawn?.count(c, page ? WORDS.genes(genesOn.get(c) ?? 0) : unread ? WORDS.notInFile : WORDS.count(n));
    });
  }

  function point(keys: string[] | null) {
    const was = pointed;
    pointed = keys;
    relight();
    if (keys) emit("enter", keys, "tick");
    else if (was) emit("leave", was, "tick");
  }

  function overRow(c: number) {
    const was = rowKeys(hoverRow);
    hoverRow = c;
    relight();
    // Under the genes page a row is a chromosome's genes, not the list's variants: no one else is told.
    if (page) return;
    const now = rowKeys(c);
    if (was.length) emit("leave", was, "row");
    if (now.length) emit("enter", now, "row");
  }

  const observer = new ResizeObserver(() => {
    clearTimeout(timer);
    timer = window.setTimeout(
      () => {
        const next = measure();
        if (next && drawnKey(next) !== drawnAs) build();
      },
      drawn ? RESIZE_MS : 0,
    );
  });
  observer.observe(el);
  observer.observe(probe);
  build();

  return {
    sex(pair) {
      if (known === pair) return;
      known = pair;
      const parts = drawn?.unknownSex;
      if (!drawn || !parts) return;
      drawn.unknownSex = null;
      settle(parts, pair);
    },
    state(s, o) {
      const animate = o?.animate ?? true;
      const from = DEPTH[at];
      if (s === "genes") page = true;
      else {
        // Arriving at the list always opens on YOUR VARIANTS; CARRIERS is a choice made there.
        if (s === "list" && at !== "list") which = "yours";
        if (s !== at) pointed = null;
        at = s;
        page = false;
      }
      if (!drawn) return Promise.resolve();
      if (!animate) instantly(apply);
      else apply();
      const to = DEPTH[at];
      const ms = !animate
        ? 0
        : to === 3 && from < 3
          ? token("--tw") + token("--t-move")
          : Math.max(from, to) >= 3
            ? token("--t-move")
            : token("--t-fade");
      return new Promise((done) => {
        if (ms) after(ms, done);
        else frames(2, done);
      });
    },
    paint(next) {
      fill = next;
      if (at === "loading") drawn?.paint(fill);
    },
    list(next) {
      which = next;
      // The ticks swap at once: the widening is the descent's, not a list switch's.
      instantly(apply);
    },
    light(keys) {
      lit = keys?.length ? keys : null;
      relight();
    },
    genes(mode) {
      genesMode = mode;
      apply();
    },
    on(ev, cb) {
      listeners[ev].add(cb);
    },
    refit() {
      clearTimeout(timer);
      const next = measure();
      if (next && drawnKey(next) !== drawnAs) build();
    },
    dispose() {
      observer.disconnect();
      clearTimeout(timer);
      rafs.forEach(cancelAnimationFrame);
      timers.forEach(clearTimeout);
      for (const set of Object.values(listeners)) set.clear();
      drawn?.svg.remove();
      probe.remove();
      drawn = null;
    },
  };
}

mountLedger satisfies MountLedger;
