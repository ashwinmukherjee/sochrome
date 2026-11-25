// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenomeResult } from "../../contracts/app";
import { replay } from "../../data/replay";
import { createDescent, stepFrom } from "./controller";
import { CUTS, share, TALLY_WORDS, countsOf } from "./words";

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, `../../../test/fixtures/${name}.result.json`), "utf8"),
  ) as GenomeResult;
const hg002 = fixture("hg002");
const empty = fixture("empty");

const BEATS = { release: 400, ground: 1200, hold: 1400 };
const root = () => ({ dataset: {} as Record<string, string> }) as unknown as HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the descent's controller", () => {
  it("leaves the landing in two beats, then lands each event as late as the arrival is long", () => {
    const el = root();
    const d = createDescent({ root: el, beats: BEATS });
    d.play(replay(hg002, 1000));
    expect(d.get()).toMatchObject({ at: "landing", beat: "release" });
    expect(el.dataset.beat).toBe("release");
    vi.advanceTimersByTime(400);
    expect(d.get()).toMatchObject({ at: "loading", beat: "ground", name: "HG002", counting: 0 });
    vi.advanceTimersByTime(1199);
    expect(d.get().counting).toBe(0);
    vi.advanceTimersByTime(501);
    const mid = d.get();
    expect(mid.beat).toBeNull();
    expect(el.dataset.beat).toBeUndefined();
    expect(mid.counting).toBeGreaterThan(hg002.counts.all * 0.4);
    expect(mid.counting).toBeLessThan(hg002.counts.all * 0.6);
    expect(mid.fill.f[0]).toBe(1);
    expect(mid.fill.done[21]).toBe(false);
    vi.advanceTimersByTime(500);
    expect(d.get()).toMatchObject({ at: "all", result: hg002, counting: hg002.counts.all, reference: null });
  });

  it("counts exactly the records the events carry", () => {
    const d = createDescent({ root: root(), beats: { release: 0, ground: 0, hold: 0 } });
    const events = replay(hg002, 100).map((t) => t.event);
    let fed = 0;
    const per: number[] = [];
    for (const e of events) {
      d.feed(e);
      vi.advanceTimersByTime(0);
      if (e.type === "progress" || e.type === "chrom-done") per[e.chromIndex] = e.records;
      fed = per.reduce((a, n) => a + (n || 0), 0);
      if (e.type !== "done") expect(d.get().counting).toBe(fed);
    }
    expect(fed).toBe(hg002.counts.all);
    expect(d.get().at).toBe("all");
  });

  it("stands a sniff's refusal on the landing, and returns a broken read to it with nothing kept", () => {
    const d = createDescent({ root: root(), beats: BEATS });
    d.feed({ type: "error", reason: "chip", detail: "" });
    expect(d.get()).toMatchObject({ at: "landing", refusal: "chip" });
    const events = replay(hg002, 1000);
    const cut = events.findIndex((t) => t.at > 500);
    d.play([...events.slice(0, cut), { at: 500, event: { type: "error", reason: "broken", detail: "" } }]);
    vi.advanceTimersByTime(1600 + 500);
    const held = d.get();
    expect(held).toMatchObject({ at: "loading", refusal: null });
    expect(held.counting).toBeGreaterThan(0);
    vi.advanceTimersByTime(1399);
    expect(d.get().counting).toBe(held.counting);
    vi.advanceTimersByTime(1);
    expect(d.get()).toMatchObject({ at: "landing", refusal: "broken", result: null, counting: 0, name: null });
  });

  it("says the reference data's fraction only once the file is read and the data is still arriving", () => {
    const d = createDescent({ root: root(), beats: { release: 0, ground: 0, hold: 0 } });
    const events = replay(hg002, 100).map((t) => t.event);
    const sex = events.findIndex((e) => e.type === "sex");
    d.feed(events[0]);
    d.feed({ type: "reference", fraction: 0.3 });
    for (const e of events.slice(1, sex - 30)) d.feed(e);
    vi.advanceTimersByTime(0);
    expect(d.get().reference).toBeNull();
    for (const e of events.slice(sex - 30, sex)) d.feed(e);
    d.feed({ type: "reference", fraction: 0.64 });
    vi.advanceTimersByTime(0);
    expect(d.get()).toMatchObject({ at: "loading", reference: 0.64, counting: hg002.counts.all });
    d.feed({ type: "reference", fraction: 1 });
    vi.advanceTimersByTime(0);
    expect(d.get().reference).toBeNull();
    for (const e of events.slice(sex)) d.feed(e);
    vi.advanceTimersByTime(0);
    expect(d.get().at).toBe("all");
  });

  it("takes the file as read only once the reader says its last byte is read", () => {
    const d = createDescent({ root: root(), beats: { release: 0, ground: 0, hold: 0 } });
    const events = replay(hg002, 100).map((t) => t.event);
    const sex = events.findIndex((e) => e.type === "sex");
    // The reader's way: the last chromosome's progress stops short of the file's end, its end is said, then a
    // closing progress reports every byte read.
    const scan = events.slice(1, sex).filter((_, i, all) => i !== all.length - 2);
    d.feed(events[0]);
    for (const e of scan) d.feed(e);
    d.feed({ type: "reference", fraction: 0.8 });
    vi.advanceTimersByTime(0);
    expect(d.get().reference).toBeNull();
    const last = hg002.parsed.reduce((at, n, i) => (n ? i : at), 0);
    d.feed({
      type: "progress",
      chromIndex: last,
      fraction: 1,
      records: hg002.parsed[last],
      bytesRead: hg002.counts.all,
    });
    d.feed({ type: "reference", fraction: 0.8 });
    vi.advanceTimersByTime(0);
    expect(d.get()).toMatchObject({ reference: 0.8, counting: hg002.counts.all });
  });

  it("with motion reduced, skips the beats and turns a bar solid only when its chromosome is done", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const d = createDescent({ root: root(), beats: BEATS });
    const events = replay(hg002, 100).map((t) => t.event);
    d.feed(events[0]);
    expect(d.get()).toMatchObject({ at: "loading", beat: null });
    d.feed(events[1]);
    vi.advanceTimersByTime(0);
    expect([d.get().fill.f[0], d.get().fill.o[0]]).toEqual([1, 0]);
    for (const e of events.slice(2, 26)) d.feed(e);
    vi.advanceTimersByTime(0);
    expect([d.get().fill.o[0], d.get().fill.done[0]]).toEqual([1, true]);
  });

  it("goes where the route says only once there is a result, and back to a clean landing", () => {
    const d = createDescent({ root: root(), beats: { release: 0, ground: 0, hold: 0 } });
    d.go("rare");
    expect(d.get().at).toBe("landing");
    for (const t of replay(hg002, 10)) d.feed(t.event);
    vi.advanceTimersByTime(0);
    d.go("rare");
    expect(d.get().at).toBe("rare");
    d.go("landing");
    expect(d.get()).toMatchObject({ at: "landing", result: null, refusal: null });
  });
});

describe("the steps", () => {
  it("run all to the list and back, and stop at either end", () => {
    const forward = ["all", "coding", "protein", "rare", "yours", "list"] as const;
    forward.forEach((at, i) => expect(stepFrom(at, 1, hg002)).toBe(forward[i + 1] ?? null));
    forward.forEach((at, i) => expect(stepFrom(at, -1, hg002)).toBe(forward[i - 1] ?? null));
    expect(stepFrom("loading", 1, null)).toBeNull();
    expect(stepFrom("landing", 1, hg002)).toBeNull();
  });
  it("step over the last cut when nothing is rare", () => {
    expect(stepFrom("rare", 1, empty)).toBe("list");
    expect(stepFrom("list", -1, empty)).toBe("rare");
  });
});

describe("the tally's words", () => {
  it("say a share in plain words", () => {
    expect(share(0.5, 1000)).toBe("Under 0.1%");
    expect(share(5, 1000)).toBe("Under 1%");
    expect(share(40, 100)).toBe("About half");
    expect(share(60, 100)).toBe("About half");
    expect(share(61, 100)).toBe("About 61%");
    expect(share(12, 100)).toBe("About 12%");
    expect(share(0, 0)).toBe("Under 0.1%");
  });
  it("are the decided captions, from the genome's own counts", () => {
    expect(CUTS.map((cut) => TALLY_WORDS.count(cut, countsOf(hg002)))).toEqual([4096123, 3195, 1531, 40, 24]);
    expect(TALLY_WORDS.says.all()).toBe("Places where your genome differs from the reference genome.");
    expect(TALLY_WORDS.says.coding(countsOf(hg002))).toBe(
      "Under 0.1% of them fall in the protein-coding parts of the 2,132 genes checked. The marks show where they are.",
    );
    expect(TALLY_WORDS.says.protein(countsOf(hg002))).toBe(
      "About half of those change the protein. The rest leave it as it was.",
    );
    expect(TALLY_WORDS.says.rare(countsOf(hg002))).toBe(
      "Carried by fewer than 1 in 500 people. Each mark is now one variant, worth a closer look.",
    );
  });
  it("are true of a genome with nothing rare, one carrier, or none", () => {
    expect(TALLY_WORDS.says.rare(countsOf(empty))).toBe(
      "None of those is rare: each is carried by more than 1 in 500 people.",
    );
    expect(TALLY_WORDS.says.yours(countsOf(hg002))).toBe(
      "In genes where a single altered copy can be enough to cause a condition. The other 16 are carriers: in genes where a condition takes two altered copies.",
    );
    expect(TALLY_WORDS.says.yours({ ...countsOf(hg002), carriers: 1 })).toContain("The other one is a carrier");
    expect(TALLY_WORDS.says.yours({ ...countsOf(hg002), carriers: 0 })).toBe(
      "In genes where a single altered copy can be enough to cause a condition.",
    );
  });
});
