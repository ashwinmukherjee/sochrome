// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Each cell's marks by identity (GLITCHES B6): a mark deleted, added or renamed is a failure, not a free change.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Drawing } from "../../src/contracts/app";
import { type Check, type Result, ROOT } from "./_check";

const GOLDEN = resolve(import.meta.dirname, "R3.golden.json");
const FIXTURES = resolve(ROOT, "test/fixtures");

/** One sample's marks: each one's `data-mark` (its kind) and key, which is what a tween holds on to. */
type Ids = string[];
interface Sampled {
  /** `rest` is the beat complete; `mid` is halfway through the move into it. */
  beats: { beat: string; rest: Ids; mid: Ids; end: Ids }[];
}
type Inventory = Record<string, Sampled>;

/** What is recorded per drawing: every identity once, then each sample as ranges of indices into that list. */
interface Recorded {
  ids: string[];
  beats: Record<string, { rest: string; mid: string }>;
}

const ranges = (xs: number[]): string => {
  const out: string[] = [];
  for (let i = 0; i < xs.length; i++) {
    let j = i;
    while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++;
    out.push(i === j ? `${xs[i]}` : `${xs[i]}-${xs[j]}`);
    i = j;
  }
  return out.join(",");
};
const unranges = (s: string): number[] =>
  s
    ? s.split(",").flatMap((r) => {
        const [a, b = a] = r.split("-").map(Number);
        return Array.from({ length: b - a + 1 }, (_, k) => a + k);
      })
    : [];

async function sampleAll(): Promise<Inventory> {
  const { STATES } = await import("../../src/render/states");
  const { frame, isBuilt, sample, timeline } = await import("../../src/render/frames");
  const { variantEntry } = await import("../../src/render/variant");
  type Entry = (typeof STATES)[number];
  const ids = (f: { marks: { kind: string; key: string }[] }): Ids => f.marks.map((m) => `${m.kind}:${m.key}`);
  const out: Inventory = {};
  const take = (name: string, entry: Entry) => {
    const { phases } = timeline(entry);
    out[name] = {
      beats: entry.beats.map((beat, i) => {
        const ph = phases[i];
        return {
          beat,
          rest: ids(frame(entry, beat)),
          mid: ph ? ids(sample(entry, ph.at + ph.dur / 2)) : ids(frame(entry, beat)),
          end: ph ? ids(sample(entry, ph.at + ph.dur)) : ids(frame(entry, beat)),
        };
      }),
    };
  };
  for (const e of STATES) if (isBuilt(e)) take(`cell ${e.lane}--${e.state}`, e);
  // Each fixture drawing as the room mounts it: the drawing's own records through variantEntry.
  const seen = new Set<string>();
  for (const file of readdirSync(FIXTURES)
    .filter((f) => f.endsWith(".result.json"))
    .sort()) {
    const r = JSON.parse(readFileSync(resolve(FIXTURES, file), "utf8")) as Record<"yours" | "carriers", { key: string; facts: { drawings: Drawing[] } }[]>; // prettier-ignore
    for (const f of [...r.yours, ...r.carriers])
      f.facts.drawings.forEach((d, k) => {
        const name = `finding ${f.key} #${k} ${d.lane}--${d.kind}`;
        if (seen.has(name)) return;
        seen.add(name);
        take(name, variantEntry({ ...d, id: `r3-${seen.size}` }));
      });
  }
  return out;
}

/** The cell's own rules, which hold without any record: what a tween may and may not do to a mark. */
function rules(name: string, s: Sampled): string[] {
  const bad: string[] = [];
  const kindOf = new Map<string, string>();
  const say = (what: string) => bad.push(`${name}: ${what}`);
  s.beats.forEach(({ beat, rest, mid, end }, i) => {
    for (const [at, list] of [
      ["rest", rest],
      ["mid-beat", mid],
    ] as const) {
      const dup = list.filter((x, k) => list.indexOf(x) !== k);
      if (dup.length) say(`${beat} ${at}: the same mark twice (${[...new Set(dup)].slice(0, 3).join(", ")})`);
      for (const id of list) {
        const [kind, key] = [id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1)];
        const was = kindOf.get(key);
        if (was && was !== kind) say(`${beat} ${at}: ${key} changes identity, ${was} to ${kind}`);
        kindOf.set(key, kind);
      }
    }
    // A beat lands on its rest: the boundary belongs to the beat it ends.
    const r = new Set(rest);
    const e = new Set(end);
    const offEnd = [...r].filter((x) => !e.has(x)).concat([...e].filter((x) => !r.has(x)));
    if (offEnd.length) say(`${beat}: the beat's end is not its rest (${offEnd.slice(0, 3).join(", ")})`);
    // Mid-beat, only what leaves or arrives may be missing, and nothing comes from outside the two rests.
    const from = new Set(i === 0 ? [] : s.beats[i - 1].rest);
    const m = new Set(mid);
    // Except the last beat's crossfade: a block or seam going faint leaves as `key~was` while it arrives faint.
    const fading = (x: string) =>
      i === s.beats.length - 1 && /^(block|seam):.*~was$/.test(x) && from.has(x.slice(0, -4)) && r.has(x.slice(0, -4));
    const appears = mid.filter((x) => !from.has(x) && !r.has(x) && !fading(x));
    const vanishes = [...from].filter((x) => r.has(x) && !m.has(x));
    if (appears.length) say(`${beat} mid-beat: ${appears.slice(0, 3).join(", ")} in neither rest`);
    if (vanishes.length) say(`${beat} mid-beat: ${vanishes.slice(0, 3).join(", ")} gone between two rests that hold it`); // prettier-ignore
  });
  return bad;
}

function record(inv: Inventory): Record<string, Recorded> {
  return Object.fromEntries(
    Object.entries(inv).map(([name, s]) => {
      const ids = [...new Set(s.beats.flatMap((b) => [...b.rest, ...b.mid]))].sort();
      const at = new Map(ids.map((x, k) => [x, k]));
      const enc = (l: Ids) => ranges([...new Set(l)].map((x) => at.get(x) ?? -1).sort((a, b) => a - b));
      return [name, { ids, beats: Object.fromEntries(s.beats.map((b) => [b.beat, { rest: enc(b.rest), mid: enc(b.mid) }])) }]; // prettier-ignore
    }),
  );
}

/** The inventory against its record, naming each mark that came or went. */
function compare(inv: Inventory, golden: Record<string, Recorded>): string[] {
  const bad: string[] = [];
  for (const name of new Set([...Object.keys(inv), ...Object.keys(golden)])) {
    const s = inv[name];
    const g = golden[name];
    if (!s || !g) {
      bad.push(`${name}: ${s ? "not in the record" : "recorded, no longer drawn"}`);
      continue;
    }
    const beats = s.beats.map((b) => b.beat);
    if (beats.join() !== Object.keys(g.beats).join())
      bad.push(`${name}: beats ${beats.join(" ")}, recorded ${Object.keys(g.beats).join(" ")}`);
    for (const b of s.beats) {
      const rec = g.beats[b.beat];
      if (!rec) continue;
      for (const at of ["rest", "mid"] as const) {
        const want = new Set(unranges(rec[at]).map((k) => g.ids[k]));
        const got = new Set(b[at]);
        const added = [...got].filter((x) => !want.has(x));
        const gone = [...want].filter((x) => !got.has(x));
        if (added.length || gone.length)
          bad.push(`${name}: ${b.beat} ${at === "mid" ? "mid-beat" : "at rest"}: ${[...gone.slice(0, 3).map((x) => `lost ${x}`), ...added.slice(0, 3).map((x) => `new ${x}`)].join(", ")}`); // prettier-ignore
      }
    }
  }
  return bad;
}

/** Faults planted in a copy of the inventory: each must be caught, or the check proves nothing. */
const named = (inv: Inventory, prefix: string) => Object.keys(inv).filter((n) => n.startsWith(prefix));
const last = (s: Sampled) => s.beats[s.beats.length - 1];
const PLANTS: Record<string, (inv: Inventory) => void> = {
  // B6 itself: one mark deleted from a cell, at rest and mid-beat alike.
  deleted: (inv) => {
    const cell = inv[named(inv, "cell ")[0]];
    const victim = last(cell).rest[0];
    for (const b of cell.beats) for (const l of [b.rest, b.mid, b.end]) l.splice(0, l.length, ...l.filter((x) => x !== victim)); // prettier-ignore
  },
  // A mark that changes kind under the same key.
  renamed: (inv) => {
    const b = last(inv[named(inv, "finding ")[0]]);
    const [kind, ...key] = b.rest[0].split(":");
    const as = `${kind === "block" ? "tick" : "block"}:${key.join(":")}`;
    b.rest[0] = as;
    b.end[0] = as;
  },
  // A mark only the middle of a move shows.
  flicker: (inv) => {
    const cells = named(inv, "cell ");
    last(inv[cells[cells.length - 1]]).mid.push("tick:planted");
  },
};

async function run(): Promise<Result> {
  const inv = await sampleAll();
  const cells = Object.keys(inv).filter((k) => k.startsWith("cell ")).length;
  const drawings = Object.keys(inv).length - cells;
  if (process.argv.includes("--record")) writeFileSync(GOLDEN, JSON.stringify(record(inv), null, 2) + "\n");
  const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, Recorded>;
  const check = (i: Inventory) => [...Object.entries(i).flatMap(([n, s]) => rules(n, s)), ...compare(i, golden)];
  const problems = check(inv);
  if (cells !== 26) problems.push(`${cells} built cells, not 26`);
  const missed = Object.entries(PLANTS)
    .filter(([, plant]) => {
      const copy = structuredClone(inv);
      plant(copy);
      return check(copy).length <= problems.length;
    })
    .map(([id]) => id);
  if (missed.length) problems.push(`planted faults not caught: ${missed.join(", ")}`);
  const samples = Object.values(inv).reduce((n, s) => n + s.beats.length * 2, 0);
  const marks = Object.values(inv).reduce((n, s) => n + s.beats.reduce((k, b) => k + b.rest.length + b.mid.length, 0), 0); // prettier-ignore
  return {
    ok: problems.length === 0,
    detail: problems.length
      ? problems.slice(0, 40).join("\n") + (problems.length > 40 ? `\n…and ${problems.length - 40} more` : "")
      : `${cells} cells and ${drawings} fixture drawings, ${samples} samples (each beat at rest and mid-beat), ${marks} marks: every one where the record and the cell's rules put it. ${Object.keys(PLANTS).length} of ${Object.keys(PLANTS).length} planted faults caught`,
  };
}

export const check: Check = { id: "R3", title: "Each cell's marks, by identity", owner: "G", run };
