// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Mark } from "../../src/contracts/app";
import { ACCEPTED, REGROUPED } from "../spine/accepted";
import { readSample, sampleDiffers, type Differ } from "../spine/parity";
import { PATHS, SAMPLES, type Sample } from "../spine/paths";
import type { Check } from "./_check";

interface LabFile {
  all: number;
  parsed: number[];
  counts: { coding: number; protein: number; validity: number };
  split: { survivors: number; carriers: number };
  marks: Mark[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const say = (d: Differ) => `${d.sample} ${d.at}: ${JSON.stringify(d.was)} → ${JSON.stringify(d.now)}`;

/** The descent's numbers and marks against the ledger lab's, made from the earlier spine's funnel. */
async function descentProblems(sample: Sample): Promise<string[]> {
  const lab = JSON.parse(readFileSync(resolve(PATHS.lab, "data", `lab.${sample}.json`), "utf8")) as LabFile;
  const r = await readSample(sample);
  // The accepted regrouping moves findings from carriers to YOUR VARIANTS: the lab's numbers and marks, moved the same way.
  const moved = REGROUPED.filter((g) => g.sample === sample).flatMap((g) => g.positions);
  const marks = lab.marks.map((m): Mark =>
    m[4] === 1 && moved.includes(m[1]) ? [m[0], m[1], m[2], m[3], 0, m[5]] : m,
  );
  const was = { all: lab.all, coding: lab.counts.coding, protein: lab.counts.protein, rare: lab.counts.validity, yours: lab.split.survivors + moved.length, carriers: lab.split.carriers - moved.length }; // prettier-ignore
  return [
    same(r.parsed, lab.parsed) ? "" : `${sample}: records per chromosome differ`,
    same(r.counts, was) ? "" : `${sample}: counts ${JSON.stringify(r.counts)} were ${JSON.stringify(was)}`,
    same(r.marks, marks) ? "" : `${sample}: the marks differ`,
  ].filter(Boolean);
}

export const check: Check = {
  id: "S1",
  title: "Spine parity on HG001 and HG002: bundles, facts and P2/P3 facts against today's outputs",
  owner: "A-spine",
  run: async () => {
    const problems: string[] = [];
    const counts = ACCEPTED.map(() => 0);
    let seen = 0;
    for (const sample of SAMPLES) {
      for (const d of await sampleDiffers(sample)) {
        seen++;
        const rule = ACCEPTED.findIndex((a) => a.match(d));
        if (rule < 0) problems.push(`unexplained: ${say(d)}`);
        else counts[rule]++;
      }
      problems.push(...(await descentProblems(sample)));
    }
    ACCEPTED.forEach((a, i) => {
      if (counts[i] !== a.count) problems.push(`accepted ${a.count}, found ${counts[i]}: ${a.why}`);
    });
    const accepted = ACCEPTED.map((a, i) => `  ${counts[i]}  ${a.why}`).join("\n");
    return {
      ok: problems.length === 0,
      detail: problems.length
        ? problems.slice(0, 40).join("\n")
        : `bundles, facts and P2/P3 facts: ${seen} differs, all accepted; counts and marks equal\n${accepted}`,
    };
  },
};
