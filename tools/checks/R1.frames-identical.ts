// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The renderer draws what the renderer it was ported from drew: every built cell and every fixture drawing, frame for frame.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { type Check, type Result, ROOT } from "./_check";

/** Samples per drawing: its whole timeline, end to end. */
const SAMPLES = 41;
const GOLDEN = resolve(import.meta.dirname, "R1.golden.json");
const PORT = resolve(ROOT, "src/render");
const ARCHIVE = ["mi", "zen-render"].join("");
/** The renderer this one was ported from: a sibling of the repo, or of the folder its worktrees sit in. */
const SOURCE = [process.env.RENDER_SOURCE, resolve(ROOT, "..", ARCHIVE, "src"), resolve(ROOT, "../..", ARCHIVE, "src")]
  .filter((p): p is string => !!p)
  .find((p) => existsSync(resolve(p, "frames.ts")));

/** Run in a child, once per renderer: each keeps its own module state. Prints one hash per sample. */
const DUMP = `
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
const [src, fixtures, samples] = process.argv.slice(2);
const { STATES } = await import(resolve(src, "states.ts"));
const { sample, timeline, isBuilt, registerVariant } = await import(resolve(src, "frames.ts"));
const sha = (x) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
const out = {};
const run = (name, entry) => {
  const { total } = timeline(entry);
  out[name] = Array.from({ length: +samples }, (_, k) => sha(sample(entry, (k / (+samples - 1)) * total)));
};
for (const e of STATES) if (isBuilt(e)) run("cell " + e.lane + "--" + e.state, e);
const seen = new Set();
for (const file of readdirSync(fixtures).filter((f) => f.endsWith(".result.json")).sort()) {
  const r = JSON.parse(readFileSync(resolve(fixtures, file), "utf8"));
  for (const f of [...r.yours, ...r.carriers]) {
    f.facts.drawings.forEach((d, k) => {
      const name = "finding " + f.key + " #" + k + " " + d.lane + "--" + d.kind;
      if (seen.has(name)) return;
      seen.add(name);
      const base = STATES.find((s) => s.lane === d.lane && s.state === d.kind);
      const entry = {
        lane: d.lane,
        state: "v:" + seen.size,
        kind: base ? (base.kind ?? base.state) : d.kind,
        specimen: { id: f.facts.id, label: f.facts.gene },
        notes: "",
        beats: d.beats ?? base.beats.slice(),
      };
      registerVariant(entry, d);
      run(name, entry);
    });
  }
}
process.stdout.write(JSON.stringify(out));
`;

type Dump = Record<string, string[]>;

function dump(src: string): Dump {
  const dir = mkdtempSync(resolve(tmpdir(), "frames-"));
  try {
    const script = resolve(dir, "dump.mts");
    writeFileSync(script, DUMP);
    const r = spawnSync("npx", ["tsx", script, src, resolve(ROOT, "test/fixtures"), String(SAMPLES)], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 1 << 28,
    });
    if (r.status !== 0) throw new Error(`the frames of ${src} could not be sampled:\n${r.stderr.slice(-2000)}`);
    return JSON.parse(r.stdout) as Dump;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const seal = (hashes: string[]) => createHash("sha256").update(hashes.join("")).digest("hex");
const sealed = (d: Dump) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, seal(v)]));

/** Names whose frames differ, with the first sample that does. */
function differing(a: Dump, b: Dump): string[] {
  const out: string[] = [];
  for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!a[name] || !b[name]) out.push(`${name}: only in ${a[name] ? "the port" : "the source"}`);
    else {
      const at = a[name].findIndex((h, k) => h !== b[name][k]);
      if (at >= 0) out.push(`${name}: differs from sample ${at} of ${SAMPLES}`);
    }
  }
  return out;
}

function run(): Result {
  const port = dump(PORT);
  const cells = Object.keys(port).filter((k) => k.startsWith("cell ")).length;
  const drawings = Object.keys(port).length - cells;
  if (process.argv.includes("--record")) {
    if (!SOURCE) return { ok: false, detail: `no source renderer to record from (${ARCHIVE}/src)` };
    writeFileSync(GOLDEN, JSON.stringify(sealed(dump(SOURCE)), null, 2) + "\n");
  }
  const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, string>;
  const mine = sealed(port);
  const bad = [...new Set([...Object.keys(golden), ...Object.keys(mine)])].filter((k) => golden[k] !== mine[k]);
  const live = SOURCE ? differing(port, dump(SOURCE)) : [];
  const problems = [...bad.map((k) => `${k}: not the recorded frames`), ...live];
  if (cells !== 26) problems.push(`${cells} built cells, not 26`);
  return {
    ok: problems.length === 0,
    detail: problems.length
      ? problems.slice(0, 40).join("\n")
      : `${cells} cells and ${drawings} fixture drawings, ${SAMPLES} samples each: identical to the recorded frames${SOURCE ? " and to the source renderer, run beside it" : " (source renderer not on this machine)"}`,
  };
}

export const check: Check = {
  id: "R1",
  title: "The renderer's 26 built cells are frame-identical",
  owner: "D",
  run,
};
