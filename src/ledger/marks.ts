// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Where marks land: coincident marks snapped as they are placed, and each rare mark matched to its finding.

import type { GenomeResult, ListName, Mark } from "../contracts/app";
import { CHROMS } from "../contracts/constants";

/** Marks of one level within this many pixels of their run's first draw as one. */
const COINCIDENT_PX = 1;

/**
 * The column each mark of one row draws in. Positions round to whole pixels, so two variants under a pixel
 * apart can land in adjacent columns and read as one wider mark of another kind: within a level, a mark
 * within a pixel of its run's first takes that column. (SPEC: one mark, one group.)
 */
export function columns(marks: readonly Mark[], xOf: (m: Mark) => number): Map<Mark, number> {
  const out = new Map<Mark, number>();
  const byLevel = new Map<number, { m: Mark; x: number }[]>();
  for (const m of marks) {
    const level = byLevel.get(m[3]) ?? [];
    level.push({ m, x: xOf(m) });
    byLevel.set(m[3], level);
  }
  for (const level of byLevel.values()) {
    level.sort((a, b) => a.x - b.x);
    let anchor = -Infinity;
    for (const { m, x } of level) {
      if (x - anchor > COINCIDENT_PX) anchor = x;
      out.set(m, anchor);
    }
  }
  return out;
}

const spot = (chromIndex: number, pos: number, gene: string) => `${chromIndex}:${pos}:${gene}`;

/** A finding's key is `chr<name>:<pos>:…:<gene>`: the place its mark stands. */
function spotOf(key: string): string | null {
  const parts = key.split(":");
  const chromIndex = (CHROMS as readonly string[]).indexOf(parts[0].replace(/^chr/i, ""));
  const pos = Number.parseInt(parts[1] ?? "", 10);
  const gene = parts.at(-1);
  return chromIndex < 0 || !Number.isFinite(pos) || !gene ? null : spot(chromIndex, pos, gene);
}

export interface Listed {
  key: string;
  list: ListName;
}

/**
 * Each rare mark's finding. A finding with no mark is a broken result: it throws where a developer will see it,
 * and elsewhere its row simply has no tick.
 */
export function findingsByMark(result: GenomeResult, strict: boolean): Map<Mark, Listed> {
  const waiting = new Map<string, Mark[]>();
  for (const m of result.marks) {
    if (m[3] !== 3) continue;
    const at = spot(m[0], m[1], m[5]);
    waiting.set(at, [...(waiting.get(at) ?? []), m]);
  }
  const out = new Map<Mark, Listed>();
  const lists: [ListName, GenomeResult["yours"]][] = [
    ["yours", result.yours],
    ["carriers", result.carriers],
  ];
  for (const [list, findings] of lists) {
    for (const f of findings) {
      const at = spotOf(f.key);
      const marks = at ? waiting.get(at) : undefined;
      const carrier = list === "carriers" ? 1 : 0;
      const i = marks
        ? Math.max(
            0,
            marks.findIndex((m) => m[4] === carrier),
          )
        : -1;
      const mark = marks?.[i];
      if (!mark) {
        if (strict) throw new Error(`the ledger has no mark for the finding at ${at ?? "an unreadable key"}`);
        continue;
      }
      marks.splice(i, 1);
      out.set(mark, { key: f.key, list });
    }
  }
  return out;
}

/** One mark, one group: the findings of one list that share a row and a column, in the list's own order. */
export function groups(
  ticks: readonly { key: string; list: ListName; row: number; x: number }[],
): Map<string, string[]> {
  const at = new Map<string, string[]>();
  for (const t of ticks) {
    const id = `${t.list}:${t.row}:${t.x}`;
    at.set(id, [...(at.get(id) ?? []), t.key]);
  }
  const out = new Map<string, string[]>();
  for (const keys of at.values()) for (const k of keys) out.set(k, keys);
  return out;
}
