// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Every frame of every built cell and every fixture drawing, at three stage widths: nothing leaves the stage, and no identifier covers material.

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Finding, GenomeResult } from "../../src/contracts/app";
import { isBuilt, sample, timeline } from "../../src/render/frames";
import { type Box, clearSquare, markBox, visible } from "../../src/render/ink";
import { cellKey, STATES, type StateEntry } from "../../src/render/states";
import { setStageW, visual as V } from "../../src/render/tokens";
import { variantEntry } from "../../src/render/variant";
import { type Check, type Result, ROOT } from "./_check";

/** Desktop's widest stage, the room's stage, and a 390 px phone's column. */
const WIDTHS = [940, 768, 358];
const SAMPLES = 41;
/** Half a px of slack: a hairline centred on an edge is on the stage. */
const SLACK = 0.5;
const DIR = resolve(ROOT, "test/fixtures");

const overlap = (a: Box, b: Box) =>
  Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > SLACK && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > SLACK;

/** Every built cell, then every drawing of every finding in the fixtures, once each. */
function entries(): { entry: StateEntry; tag: string }[] {
  const out = STATES.filter(isBuilt).map((entry) => ({ entry, tag: cellKey(entry) }));
  const seen = new Set<string>();
  for (const file of readdirSync(DIR)
    .filter((f) => f.endsWith(".result.json"))
    .sort()) {
    const r = JSON.parse(readFileSync(resolve(DIR, file), "utf8")) as GenomeResult;
    for (const f of [...r.yours, ...r.carriers] as Finding[]) {
      f.facts.drawings.forEach((d, k) => {
        const tag = `${f.facts.gene} ${f.name} [${d.lane}--${d.kind}]`;
        if (seen.has(`${f.key}#${k}`)) return;
        seen.add(`${f.key}#${k}`);
        out.push({ entry: variantEntry({ ...d, id: `audit${seen.size}`, label: f.facts.gene }), tag });
      });
    }
  }
  return out;
}

function run(): Result {
  const findings = new Map<string, Set<string>>();
  const note = (kind: string, what: string) => findings.set(kind, (findings.get(kind) ?? new Set()).add(what));
  const all = entries();
  const before = V.stageW;
  try {
    for (const W of WIDTHS) {
      setStageW(W);
      for (const { entry, tag } of all) {
        const { total } = timeline(entry);
        const protein = entry.lane === "portrait" || entry.lane === "chain";
        for (let k = 0; k < SAMPLES; k++) {
          const f = sample(entry, (k / (SAMPLES - 1)) * total);
          for (const m of f.marks) {
            const lost = Object.entries(m).filter(([, x]) => typeof x === "number" && !Number.isFinite(x));
            if (lost.length)
              note(`${W} a mark has no position`, `${tag}: ${m.kind} ${m.key} (${lost.map(([n]) => n).join(", ")})`);
          }
          const seen = visible(f);
          for (const m of seen) {
            const b = markBox(m);
            if (!b) continue;
            const span = `x ${b.x0.toFixed(1)}..${b.x1.toFixed(1)} of ${V.stageW}`;
            const outside = b.x0 < -SLACK || b.x1 > V.stageW + SLACK;
            if (b.y0 < -SLACK || b.y1 > f.h + SLACK)
              note(
                `${W} off-stage vertically`,
                `${tag}: ${m.kind} ${m.key} y ${b.y0.toFixed(1)}..${b.y1.toFixed(1)} of ${f.h}`,
              );
            if (m.kind === "label" && outside) note(`${W} type leaves the stage`, `${tag}: "${m.text}" ${span}`);
            // A chain identifier's halo may overhang the left margin, so the line stays flush with the text.
            const overhang = m.kind === "bead" && b.x0 >= -clearSquare(m) / 2 - SLACK && b.x1 <= V.stageW + SLACK;
            if (protein && m.kind !== "label" && outside && !overhang)
              note(`${W} off-stage horizontally (protein lanes)`, `${tag}: ${m.kind} ${m.key} ${span}`);
          }
          for (const id of seen) {
            if (id.kind !== "bead" && id.kind !== "clearing") continue;
            const half = (id.kind === "bead" ? clearSquare(id) : id.size) / 2;
            const clear = { x0: id.x - half, y0: id.y - half, x1: id.x + half, y1: id.y + half };
            for (const m of seen) {
              if (m === id || (m.kind !== "block" && m.kind !== "sliver" && m.kind !== "label")) continue;
              const b = markBox(m);
              if (b && overlap(clear, b))
                note(`${W} identifier overlaps material`, `${tag}: ${id.kind} over ${m.kind} ${m.key} (sample ${k})`);
            }
          }
        }
      }
    }
  } finally {
    setStageW(before);
  }
  const lines = [...findings].flatMap(([kind, set]) => [`${kind} (${set.size})`, ...[...set].map((x) => `  ${x}`)]);
  return {
    ok: findings.size === 0,
    detail: findings.size
      ? lines.slice(0, 60).join("\n")
      : `no findings: ${all.length} drawings (26 cells, ${all.length - 26} from the fixtures), ${SAMPLES} frames each, at ${WIDTHS.join(", ")}`,
  };
}

export const check: Check = { id: "R2", title: "Nothing leaves the stage at 940, 768 and 358", owner: "D", run };
