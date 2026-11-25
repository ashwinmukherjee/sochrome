// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The descent's controller: read events in, where the descent stands out. The route says which cut; the events say the rest.

import type { DescentState, GenomeResult, ReadEvent, RefusalReason, SexPair } from "../../contracts/app";
import { type Fill, unread } from "../../ledger";

/** Every place the descent can stand: the landing, the read, the five cuts, the list. */
export type DescentAt = DescentState | "list";

export interface DescentView {
  at: DescentAt;
  /** The arrival: the landing letting go, then the unread genome standing a moment before the read. */
  beat: "release" | "ground" | null;
  /** YOUR GENOME's parentheses. */
  name: string | null;
  result: GenomeResult | null;
  /** Loading's paint. */
  fill: Fill;
  /** The pair the sex row names, told by the read as soon as the file's X is read: ahead of the result. */
  sex: SexPair | null;
  /** Records read so far. */
  counting: number;
  /** The file is read and the reference data is still arriving: its fraction. */
  reference: number | null;
  refusal: RefusalReason | null;
}

export interface Descent {
  get(): DescentView;
  subscribe(cb: () => void): () => void;
  /** A read event, from the reader or from a replay. */
  feed(event: ReadEvent): void;
  /** A sample: its events, each at its own time. */
  play(timeline: readonly { at: number; event: ReadEvent }[]): void;
  /** The route's say: a cut, the list, or back to the landing. Ignored until there is a result to stand on. */
  go(to: DescentAt): void;
  dispose(): void;
}

interface DescentOptions {
  /** Carries the beat for the landing's fade, and the tokens that time the beats. */
  root?: HTMLElement;
  /** The beats in ms, where there are no tokens to read. */
  beats?: { release: number; ground: number; hold: number };
}

const STEPS: readonly DescentAt[] = ["all", "coding", "protein", "rare", "yours", "list"];

/** Where a step forward or back lands, or null where there is none. With nothing rare the last cut is stepped over. */
export function stepFrom(at: DescentAt, by: 1 | -1, result: GenomeResult | null): DescentAt | null {
  const i = STEPS.indexOf(at);
  if (i < 0 || !result) return null;
  const over = STEPS[i + by] === "yours" && result.counts.rare === 0 ? 2 * by : by;
  return STEPS[i + over] ?? null;
}

const landing = (refusal: RefusalReason | null): DescentView => ({
  at: "landing",
  beat: null,
  name: null,
  result: null,
  fill: unread(),
  sex: null,
  counting: 0,
  reference: null,
  refusal,
});

export function createDescent(options: DescentOptions = {}): Descent {
  const root = options.root ?? document.documentElement;
  const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const token = (name: string) => Number.parseFloat(getComputedStyle(root).getPropertyValue(name)) || 0;
  // A file that breaks is held where it broke for one move's length.
  const beats = () =>
    options.beats ?? { release: token("--t-release"), ground: token("--t-fade"), hold: token("--t-move") };

  let view = landing(null);
  const listeners = new Set<() => void>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  /** Events wait out the arrival: each lands this long after it was fed, so the read keeps its own shape. */
  let lag = 0;
  let queue: { due: number; event: ReadEvent }[] = [];
  let pump: ReturnType<typeof setTimeout> | null = null;
  let records: number[] = [];
  let bytes = { read: 0, total: 0 };
  let referenceAt: number | null = null;
  /** A chromosome is being read: its progress has come, its end has not. */
  let midRead = false;
  let broken = false;

  const set = (next: Partial<DescentView>) => {
    view = { ...view, ...next };
    if (view.beat) root.dataset.beat = view.beat;
    else delete root.dataset.beat;
    listeners.forEach((cb) => cb());
  };
  const after = (ms: number, run: () => void) => {
    const t = setTimeout(() => {
      timers.delete(t);
      run();
    }, ms);
    timers.add(t);
  };
  const clear = () => {
    timers.forEach(clearTimeout);
    timers.clear();
    if (pump) clearTimeout(pump);
    pump = null;
    queue = [];
    lag = 0;
    records = [];
    bytes = { read: 0, total: 0 };
    referenceAt = null;
    midRead = false;
    broken = false;
  };

  /** A genome is on its way: the landing lets go, the unread genome stands, then the events land. */
  function begin(e: Extract<ReadEvent, { type: "start" }>) {
    const refusal = view.refusal;
    clear();
    bytes.total = e.bytesTotal;
    const ground = () => {
      set({ ...landing(null), at: "loading", name: e.displayName, beat: lag ? "ground" : null });
      if (lag) after(b.ground, () => set({ beat: null }));
    };
    const b = still() ? { release: 0, ground: 0, hold: beats().hold } : beats();
    lag = b.release + b.ground;
    if (!lag) return ground();
    set({ ...landing(refusal), beat: "release" });
    after(b.release, ground);
  }

  function land(e: ReadEvent) {
    if (broken || view.at !== "loading") return;
    const fill = { f: [...view.fill.f], o: [...view.fill.o], done: [...view.fill.done], noX: view.fill.noX };
    let sex = view.sex;
    // With motion reduced there is no wipe: a bar turns solid when its chromosome is done.
    const wipe = !still();
    switch (e.type) {
      case "reference":
        referenceAt = e.fraction;
        break;
      case "progress":
        records[e.chromIndex] = e.records;
        bytes.read = e.bytesRead;
        // The reader's closing progress (every byte read) comes after its last chromosome is done.
        midRead = !fill.done[e.chromIndex];
        fill.f[e.chromIndex] = wipe ? e.fraction : 1;
        fill.o[e.chromIndex] = wipe || fill.done[e.chromIndex] ? 1 : 0;
        break;
      case "chrom-done":
        records[e.chromIndex] = e.records;
        fill.f[e.chromIndex] = fill.o[e.chromIndex] = e.records ? 1 : 0;
        fill.done[e.chromIndex] = true;
        midRead = false;
        break;
      case "sex":
        fill.noX = e.copiesX === null;
        sex = e.pair;
        break;
      case "done":
        return set({ at: "all", result: e.result, counting: e.result.counts.all, reference: null });
      case "error": {
        // The fill stops where the file broke and stands a moment; then the landing, with nothing kept.
        broken = true;
        queue = [];
        return after(beats().hold, () => {
          clear();
          set(landing(e.reason));
        });
      }
      case "start":
        return;
    }
    // The file is read when its last byte has been reported and no chromosome is mid-read.
    const read = !midRead && bytes.total > 0 && bytes.read >= bytes.total;
    set({
      fill,
      sex,
      counting: records.reduce((a, n) => a + (n || 0), 0),
      reference: read && referenceAt !== null && referenceAt < 1 ? referenceAt : null,
    });
  }

  function drain() {
    pump = null;
    const now = performance.now();
    while (queue.length && queue[0].due <= now) {
      const { event } = queue[0];
      queue.shift();
      land(event);
    }
    if (queue.length) pump = setTimeout(drain, queue[0].due - now);
  }

  const self: Descent = {
    get: () => view,
    subscribe(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    feed(event) {
      if (event.type === "start") return begin(event);
      // Turned away before anything began: the refusal stands on the landing.
      if (event.type === "error" && view.at === "landing" && !view.beat) return set({ refusal: event.reason });
      queue.push({ due: performance.now() + lag, event });
      if (!pump) pump = setTimeout(drain, lag);
    },
    play(timeline) {
      const first = timeline.find((t) => t.event.type === "start");
      if (!first || first.event.type !== "start") return;
      begin(first.event);
      for (const t of timeline) if (t !== first) after(t.at, () => self.feed(t.event));
    },
    go(to) {
      if (to === "landing") {
        clear();
        return set(landing(null));
      }
      if (view.result && to !== "loading" && to !== view.at) set({ at: to });
    },
    dispose() {
      clear();
      delete root.dataset.beat;
      listeners.clear();
    },
  };
  return self;
}
