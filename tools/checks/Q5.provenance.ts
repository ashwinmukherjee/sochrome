// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import lock from "../../licenses.lock.json";
import { type Check, repoFiles, ROOT, sh } from "./_check";

const OWNER = "Copyright 2026 Ashwin Mukherjee";
const SPDX = "SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0";
/** Each kind of source file, and how its two header lines are written. */
const HEADERS: [RegExp, (s: string) => string][] = [
  [/\.(ts|tsx|js|mjs|cjs)$/, (s) => `// ${s}`],
  [/\.css$/, (s) => `/* ${s} */`],
  [/\.html$/, (s) => `<!-- ${s} -->`],
  [/\.(sh|py)$/, (s) => `# ${s}`],
];
const SECRET =
  /(\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}|\bsk-(ant-|proj-)?[A-Za-z0-9_]{32,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bxox[baprs]-[A-Za-z0-9-]{10,})/;

const FONT = /\.(woff2?|ttf|otf|eot)$/i;

/** Every line any commit on any branch ever added, with the commit and file it came in. */
export function historySecrets(log: string): string[] {
  const hits: string[] = [];
  let commit = "";
  let file = "";
  for (const line of log.split("\n")) {
    if (line.startsWith("commit ")) commit = line.slice(7);
    else if (line.startsWith("+++ ")) file = line.slice(6);
    else if (line.startsWith("+") && SECRET.test(line)) hits.push(`history ${commit} ${file}: looks like a secret`);
  }
  return hits;
}

const git = (args: string[]) => spawnSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 30 }).stdout;

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

export const check: Check = {
  id: "Q5",
  title: "Provenance: licences byte-equal to their sources, headers on every source file, credits fresh, no secrets",
  owner: "G",
  run: () => {
    const problems: string[] = [];
    for (const [file, l] of Object.entries(lock)) {
      const lines = readFileSync(resolve(ROOT, file), "utf8").split("\n");
      if (sha(lines.slice(l.prefixLines).join("\n")) !== l.sha256) problems.push(`${file} differs from ${l.source}`);
    }
    const files = repoFiles();
    for (const f of files) {
      const kind = HEADERS.find(([re]) => re.test(f));
      if (!kind || f.startsWith("public/data/")) continue;
      const lines = readFileSync(resolve(ROOT, f), "utf8").split("\n");
      const at = lines[0]?.startsWith("#!") ? 1 : 0;
      if (lines[at] !== kind[1](OWNER) || lines[at + 1] !== kind[1](SPDX)) problems.push(`${f}: no licence header`);
    }
    for (const f of files) {
      // A linked-in folder (a worktree's public/data) is listed as one path: it is not a file to read.
      if (/\.(woff2?|png|jpg|gz|bin)$/.test(f) || f === "package-lock.json" || !statSync(resolve(ROOT, f)).isFile())
        continue;
      if (/(^|\/)\.env($|\.)/.test(f) && !f.endsWith(".env.example")) problems.push(`${f}: an env file is not ignored`);
      if (SECRET.test(readFileSync(resolve(ROOT, f), "utf8"))) problems.push(`${f}: looks like a secret`);
    }
    for (const f of files)
      if (FONT.test(f)) problems.push(`${f}: a font file is tracked (fonts/ ships from outside git)`);
    for (const f of git(["log", "--all", "--diff-filter=A", "--name-only", "--format="]).split("\n"))
      if (FONT.test(f)) problems.push(`history: ${f} was once committed`);
    problems.push(
      ...historySecrets(
        git([
          "log",
          "--all",
          "-p",
          "-U0",
          "--no-color",
          "--no-ext-diff",
          "--format=commit %h",
          "--",
          ".",
          ":!package-lock.json",
        ]),
      ),
    );
    const before = sha(readFileSync(resolve(ROOT, "THIRD_PARTY.md")));
    const gen = sh("npx", ["tsx", "tools/third-party.ts"]);
    if (!gen.ok) problems.push(gen.detail);
    else if (sha(readFileSync(resolve(ROOT, "THIRD_PARTY.md"))) !== before)
      problems.push("THIRD_PARTY.md was stale (regenerated: commit it)");
    return { ok: problems.length === 0, detail: problems.slice(0, 40).join("\n") };
  },
};
