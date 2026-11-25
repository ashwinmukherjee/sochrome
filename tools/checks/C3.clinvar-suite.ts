// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type Check, ROOT } from "./_check";

const SUITE = "tools/clinvar-check";
/** Variants that reach a room, of the 3,000: a change here is a change in the spine's scope, and needs a reason. */
const IN_SCOPE = 2814;
/** Each planted fault, and the finding that must come back for it. */
const PLANTS: [plant: string, kind: string, sub: RegExp][] = [
  ["throw", "throws", /^planted/],
  ["facts", "facts", /^protein length differs/],
  ["frame", "facts", /^skipped exon's frame differs/],
  ["claim", "wrong claim", /^expert:/],
  ["carrier", "wrong claim", /^carrier-safe:/],
  ["slot", "missing slot", /planted/],
  ["overflow", "overflow", /planted/],
  ["gap", "no line", /planted/],
];

function suite(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync("npx", ["tsx", `${SUITE}/check.ts`, "--known", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1 << 28,
    env: { ...process.env, ...env },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}
const count = (summary: string, section: string) => Number(new RegExp(`^== ${section}: (\\d+) ==`, "m").exec(summary)?.[1] ?? NaN); // prettier-ignore

export const check: Check = {
  id: "C3",
  title: "The ClinVar suite over 3,000 variants (D8)",
  owner: "G",
  run: () => {
    const problems: string[] = [];

    // A short pass with every fault planted: the suite must fail, and name each one.
    const planted = suite(["--limit", "300"], { SUITE_PLANT: PLANTS.map(([p]) => p).join(",") });
    const found = readFileSync(resolve(ROOT, SUITE, "out/findings.tsv"), "utf8")
      .split("\n")
      .slice(1)
      .map((l) => l.split("\t"));
    if (planted.status !== 1) problems.push(`with faults planted the suite exited ${planted.status}, not 1`);
    const missed = PLANTS.filter(([, kind, sub]) => !found.some((f) => f[0] === kind && sub.test(f[1] ?? "")));
    for (const [plant, kind] of missed)
      problems.push(`the suite missed a planted fault: ${plant} (no "${kind}" finding)`);

    const real = suite([]);
    const summary = readFileSync(resolve(ROOT, SUITE, "out/summary.txt"), "utf8");
    const head =
      /(\d+) variants, (\d+) in scope, (\d+) with a problem; (\d+) problems \((\d+) not in known\.tsv\)/.exec(summary);
    if (!head) return { ok: false, detail: `the suite gave no summary:\n${real.out.slice(-600)}` };
    const [, variants, inScope, bad, all, live] = head.map(Number);
    const [throws, facts, uncovered] = ["throws", "facts", "no line"].map((s) => count(summary, s));
    if (real.status !== 0) problems.push(`the suite exited ${real.status}`);
    if (live) problems.push(`${live} problems are not in known.tsv (see ${SUITE}/out/summary.txt)`);
    if (throws) problems.push(`${throws} throws`);
    if (facts) problems.push(`${facts} facts disagree with the independent annotator`);
    if (uncovered) problems.push(`${uncovered} parts of a room no line covers`);
    if (inScope !== IN_SCOPE) problems.push(`${inScope} variants in scope, where the spine's scope gives ${IN_SCOPE}`);
    const paths = /^P2\/P3 facts from .*$/m.exec(summary)?.[0] ?? "";
    return {
      ok: problems.length === 0,
      detail: [
        ...problems,
        `${variants} variants, ${inScope} in scope, ${throws} throws, ${facts} facts disagreeing, ${uncovered} uncovered units; ${all} problems on ${bad} variants, ${live} not in known.tsv`,
        `${PLANTS.length - missed.length} of ${PLANTS.length} planted faults caught. ${paths}`,
      ].join("\n"),
    };
  },
};
