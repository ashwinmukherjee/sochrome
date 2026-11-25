// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// One way to open the app in the Chrome on this machine: every browser check and screenshot goes through here.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { resolve } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer-core";

const ROOT = resolve(import.meta.dirname, "../..");
const CHROME = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((p) => p && existsSync(p));

export const SIZES = { desktop: [1440, 900], laptop: [1024, 768], phone: [390, 844], small: [320, 640] } as const;
export type Size = keyof typeof SIZES;

export function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const s = createServer();
    s.once("error", fail);
    s.listen(0, () => {
      const { port } = s.address() as { port: number };
      s.close(() => done(port));
    });
  });
}

/** Chrome's new headless mode hangs on this machine; the old one, with a profile under the home folder, works. */
export async function openBrowser(extra: string[] = []): Promise<{ browser: Browser; close: () => Promise<void> }> {
  if (!CHROME) throw new Error("no Chrome found: set CHROME_PATH");
  const base = resolve(homedir(), ".cache/app-checks");
  mkdirSync(base, { recursive: true });
  const profile = mkdtempSync(resolve(base, "profile-"));
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    userDataDir: profile,
    args: [
      "--headless=old",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      ...extra,
    ],
    defaultViewport: null,
  });
  return {
    browser,
    close: async () => {
      await browser.close();
      rmSync(profile, { recursive: true, force: true });
    },
  };
}

/** A fresh page at a size, with page errors and console errors collected. */
export async function openPage(
  browser: Browser,
  size: Size | readonly [number, number],
  opts: { dark?: boolean; touch?: boolean } = {},
) {
  const [width, height] = typeof size === "string" ? SIZES[size] : size;
  const page: Page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2, hasTouch: !!opts.touch, isMobile: !!opts.touch });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: opts.dark ? "dark" : "light" }]);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`page error: ${String(e)}`));
  page.on("console", (m) => {
    if (m.type() === "error")
      errors.push(
        `console error: ${m.text()} @ ${page.url().replace(/^https?:\/\/[^/]+/, "")} ${page.viewport()?.width}x${page.viewport()?.height}`,
      );
  });
  return { page, errors };
}

export interface ServeOptions {
  /** The built site's folder, when it is not dist/. Checks that build for themselves keep their own under shots/. */
  outDir?: string;
  /** Extra environment for the server: VITE_TYPEFACE=suisse shows the design's faces in dev. */
  env?: Record<string, string>;
  /** Another copy of the app to serve (the leak test's planted copy). */
  cwd?: string;
}

/** Build the site into a folder (dist/ by default). Only the bundling: typecheck and tokens are other checks' work. */
export function build(outDir = "dist"): void {
  const r = spawnSync("npx", ["vite", "build", "--outDir", outDir, "--emptyOutDir", "--logLevel", "warn"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`vite build failed:\n${r.stdout}${r.stderr}`);
}

/** Serve the built site (vite preview) or the dev server on a free port. */
export async function serve(
  mode: "dev" | "preview" = "preview",
  opts: ServeOptions = {},
): Promise<{ url: string; stop: () => void }> {
  const port = await freePort();
  const args =
    mode === "dev"
      ? ["vite", "--port", String(port), "--strictPort"]
      : ["vite", "preview", "--port", String(port), "--strictPort", ...(opts.outDir ? ["--outDir", opts.outDir] : [])];
  const child: ChildProcess = spawn("npx", args, {
    cwd: opts.cwd ?? ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...opts.env },
  });
  const url = `http://localhost:${port}`;
  await new Promise<void>((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`${mode} server did not start`)), 30_000);
    const seen = (d: Buffer) => {
      if (String(d).includes(String(port))) {
        clearTimeout(timer);
        done();
      }
    };
    child.stdout?.on("data", seen);
    child.stderr?.on("data", seen);
    child.once("exit", (code) => fail(new Error(`${mode} server exited ${code}`)));
  });
  return { url, stop: () => void child.kill() };
}

/** Save a screenshot under shots/ (gitignored) and return its path. */
export async function shot(page: Page, name: string, fullPage = false): Promise<string> {
  const dir = resolve(ROOT, "shots");
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, `${name}.png`) as `${string}.png`;
  await page.screenshot({ path, fullPage });
  return path;
}
