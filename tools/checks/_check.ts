// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// What a check is. One file per check in this folder; tools/verify.ts finds and runs them.

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "../..");

export interface Result {
  ok: boolean;
  detail: string;
}

export interface Check {
  /** Its id, as the checks are numbered. */
  id: string;
  title: string;
  /** The lane that owns it. */
  owner: string;
  /** Gates the release tag only: a failure counts toward the exit code under `verify --release`. */
  release?: true;
  /** Absent: registered, not built yet. `verify --strict` fails on these. */
  run?: () => Promise<Result> | Result;
}

/** Run a command from the repo root; the detail is its last lines. */
export function sh(cmd: string, args: string[], keep = 6): Result {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n");
  return { ok: r.status === 0, detail: r.status === 0 ? (out.at(-1) ?? "") : out.slice(-keep).join("\n") };
}

/** Every tracked or untracked file git would keep, relative to the root. */
export function repoFiles(): string[] {
  const r = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  return r.stdout.split("\n").filter(Boolean);
}
