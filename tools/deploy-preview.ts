// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Builds and deploys the current branch to its own Cloudflare Pages preview address,
// https://<branch>.<project>.pages.dev, which Cloudflare Access keeps to the owner's login.
// The real host and headers, for checks on a real phone; never sochro.me: production is main, deployed only
// after `npm run verify` and the leak test.

import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { BRAND } from "../src/brand";

const ROOT = resolve(import.meta.dirname, "..");
const PROJECT = BRAND.pagesProject;
/** Pinned, as every tool here is. */
const WRANGLER = "wrangler@4.165.0";

const git = (...args: string[]) => execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8" }).trim();
const branch = git("branch", "--show-current");
if (!branch || branch === "main") {
  process.stderr.write(
    `On ${branch || "a detached HEAD"}: a preview deploys a branch other than main (main is sochro.me).\n` +
      "Make one first, e.g. git switch -c tune\n",
  );
  process.exit(1);
}

execFileSync("npm", ["run", "build"], { cwd: ROOT, stdio: "inherit" });

// Run from outside the repo: Wrangler reads the repo's .env, whose token is for Access and DNS, not Pages.
// The deploy uses the Wrangler login instead.
const env = { ...process.env };
delete env.CLOUDFLARE_API_TOKEN;
execFileSync(
  "npx",
  [
    "-y",
    WRANGLER,
    "pages",
    "deploy",
    resolve(ROOT, "dist"),
    "--project-name",
    PROJECT,
    "--branch",
    branch,
    "--commit-hash",
    git("rev-parse", "HEAD"),
    "--commit-message",
    git("log", "-1", "--format=%s"),
    "--commit-dirty=true",
  ],
  { cwd: tmpdir(), env, stdio: "inherit" },
);

// Pages names a branch's alias by lowercasing it and turning anything else into a hyphen.
const alias = branch
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");
process.stdout.write(`\nPreview: https://${alias}.${PROJECT}.pages.dev (your Cloudflare Access login)\n`);
