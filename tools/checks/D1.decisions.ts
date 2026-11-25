// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// D1: every ledger row has an owner and a proof, in its owner's file, and every proof points at something that runs or exists.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { type Check, ROOT, sh } from "./_check";

interface Row {
  id: string;
  section: string;
  owner: string;
}
interface Proof {
  kind: "assert" | "e2e" | "unit" | "token" | "review";
  ref: string;
}
const KINDS = new Set(["assert", "e2e", "unit", "token", "review"]);
const PROOFS = resolve(ROOT, "tools/decisions/proofs");
const CHECKS = resolve(ROOT, "tools/checks");

/** Screenshots are gitignored: one may stand in this tree or in the repository's main checkout, where the lanes' shots were taken. */
const MAIN = dirname(
  spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: ROOT,
    encoding: "utf8",
  }).stdout.trim(),
);
const exists = (path: string) =>
  existsSync(resolve(ROOT, path)) || (path.startsWith("shots/") && existsSync(resolve(MAIN, path)));

/** Each check's id, whether it is built, and the browser scripts it runs. */
function registry(): Map<string, { built: boolean; runs: string[] }> {
  const out = new Map<string, { built: boolean; runs: string[] }>();
  for (const f of readdirSync(CHECKS).filter((n) => /^[A-Z]+\d+\..+\.ts$/.test(n))) {
    const src = readFileSync(resolve(CHECKS, f), "utf8");
    // A browser script a check imports, or one it runs as its own process.
    const runs = [...src.matchAll(/from "\.\.\/e2e\/([\w-]+)"|"tools\/e2e\/([\w-]+)\.ts"/g)].map(
      (m) => `tools/e2e/${m[1] ?? m[2]}.ts`,
    );
    out.set(f.split(".")[0], { built: /\brun[:,(]|\brun\s*$/m.test(src), runs });
  }
  return out;
}

/** A token proof names a file and the literal values it holds: "path: value | value". */
function tokenProblems(ref: string): string[] {
  const at = ref.indexOf(": ");
  if (at < 0) return [];
  const path = ref.slice(0, at);
  if (!existsSync(resolve(ROOT, path))) return [`names ${path}, which does not exist`];
  const text = readFileSync(resolve(ROOT, path), "utf8");
  return ref
    .slice(at + 2)
    .split(" | ")
    .map((v) => v.trim())
    .filter((v) => v && !text.includes(v))
    .map((v) => `${path} does not hold ${v}`);
}

export interface Audit {
  problems: string[];
  review: string[];
  units: string[];
}

export function audit(): Audit {
  const rows = JSON.parse(readFileSync(resolve(ROOT, "tools/decisions/ledger.json"), "utf8")) as Row[];
  const checks = registry();
  const proofs = new Map<string, { lane: string; proof: Proof }>();
  const problems: string[] = [];
  for (const f of readdirSync(PROOFS).filter((n) => n.endsWith(".json"))) {
    const lane = f.replace(/\.json$/, "");
    for (const [id, proof] of Object.entries(
      JSON.parse(readFileSync(resolve(PROOFS, f), "utf8")) as Record<string, Proof>,
    )) {
      if (proofs.has(id)) problems.push(`${id}: proven twice (${proofs.get(id)?.lane}, ${lane})`);
      proofs.set(id, { lane, proof });
    }
  }
  const ids = new Set(rows.map((r) => r.id));
  for (const id of proofs.keys()) if (!ids.has(id)) problems.push(`${id}: a proof for no ledger row`);
  const review: string[] = [];
  const units = new Set<string>();
  for (const row of rows) {
    if (!row.owner) problems.push(`${row.id}: no owner`);
    const p = proofs.get(row.id);
    if (!p) {
      problems.push(`${row.id} (${row.owner}): no proof`);
      continue;
    }
    const lane = row.owner.toLowerCase();
    if (p.lane !== lane && !(lane === "a" && p.lane.startsWith("a-")))
      problems.push(`${row.id}: owned by ${row.owner} but proven in ${p.lane}.json`);
    const { kind, ref } = p.proof;
    if (!KINDS.has(kind)) problems.push(`${row.id}: unknown proof kind ${kind}`);
    // What the reference points at: checks by id, scripts, unit tests, screenshots, token files.
    let points = 0;
    // A check is named at the head of a clause ("E7 p3 array", "C1 (…)"; "…; E1 reads them"), never mid-sentence,
    // where row and panel ids (P1, R3) share its shape.
    for (const m of ref.matchAll(/(?:^|; )([A-Z]\d{1,2})(?=[\s:(,]|$)/g)) {
      const c = checks.get(m[1]);
      if (!c || m[1] === row.id) continue;
      points++;
      if (!c.built) problems.push(`${row.id}: points at ${m[1]}, which is not built`);
    }
    for (const m of ref.matchAll(/\b((?:tools|src|shots|test)\/[\w./-]+\.(?:tsx?|png|json|css))\b/g)) {
      const path = m[1];
      points++;
      if (!exists(path)) {
        problems.push(`${row.id}: points at ${path}, which does not exist`);
        continue;
      }
      if (path.startsWith("tools/e2e/")) {
        const by = [...checks].filter(([, c]) => c.runs.includes(path)).map(([id]) => id);
        if (!by.length) problems.push(`${row.id}: points at ${path}, which no check runs`);
      }
      if (/\.test\.tsx?$/.test(path)) units.add(path);
      if (path.endsWith(".png")) review.push(`${row.id} (${row.owner}) ${path}`);
    }
    if (kind === "token") problems.push(...tokenProblems(ref).map((x) => `${row.id}: ${x}`));
    if (kind === "review" && !/\.png\b/.test(ref)) problems.push(`${row.id}: a review proof with no screenshot`);
    if (!points) problems.push(`${row.id}: the proof "${ref}" points at no check, test, screenshot or file`);
  }
  return { problems, review, units: [...units] };
}

export const check: Check = {
  id: "D1",
  title: "Every DECISIONS.md row has an owner and a proof",
  owner: "G",
  run: () => {
    const a = audit();
    if (a.units.length) {
      const u = sh("npx", ["vitest", "run", ...a.units], 12);
      if (!u.ok) a.problems.push(`the unit tests proofs point at fail:\n${u.detail}`);
    }
    return {
      ok: a.problems.length === 0,
      detail: [
        ...a.problems,
        `${a.review.length} rows proven by a screenshot, for review:`,
        ...a.review.map((r) => `  ${r}`),
      ].join("\n"),
    };
  },
};
