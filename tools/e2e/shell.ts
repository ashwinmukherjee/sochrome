// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// What the shell's two walks share: the app on the dev server, the sample it is walked on, and the ways a person acts on a page.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ElementHandle, Page } from "puppeteer-core";
import { listed } from "../../src/app/list/order";
import { nameOf } from "../../src/app/state";
import { BRAND } from "../../src/brand";
import type { GenomeResult, SampleFile } from "../../src/contracts/app";

export const ROOT = resolve(import.meta.dirname, "../..");
export const NAME = BRAND.name;
/** The sample the landing offers (Shell.tsx's SAMPLE). */
export const SAMPLE = "hg003";

/** The sample as the app is served it. */
export function sample(): GenomeResult {
  const path = resolve(ROOT, `public/data/samples/${SAMPLE}.json`);
  return (JSON.parse(readFileSync(path, "utf8")) as SampleFile).result;
}
/** A list's rows as they stand, each with the name its room's address carries. */
export const rowsOf = (r: GenomeResult, which: "yours" | "carriers") =>
  listed(r, which).map((f) => ({ key: f.key, name: nameOf(f), gene: f.bundle.identity.gene, variant: f.name }));

export interface Tally {
  failures: string[];
  asserted: number;
  ok(cond: boolean, what: string): void;
}
export function tally(): Tally {
  const t: Tally = {
    failures: [],
    asserted: 0,
    ok(cond, what) {
      t.asserted++;
      if (cond) return;
      t.failures.push(what);
      if (process.env.E2E_TRACE) console.log(`  x ${what}`);
    },
  };
  return t;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Two frames: what a step set in motion has been laid out. */
export const frames = (page: Page) =>
  page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
export const hashOf = (page: Page) => page.evaluate(() => location.hash);

export async function waitHash(page: Page, hash: string, ms = 8000): Promise<boolean> {
  try {
    await page.waitForFunction((h: string) => location.hash === h, { timeout: ms }, hash);
    await frames(page);
    return true;
  } catch {
    return false;
  }
}

/** The first control a person could act on whose name matches: found by what it says, whoever built it. */
export async function control(page: Page, words: RegExp): Promise<ElementHandle<HTMLElement> | null> {
  const found = await page.evaluateHandle(
    (source: string, flags: string) => {
      const re = new RegExp(source, flags);
      return (
        [...document.querySelectorAll<HTMLElement>("button, a, [role=button]")].find((el) => {
          const name = el.getAttribute("aria-label") ?? el.textContent ?? "";
          const off = (el as HTMLButtonElement).disabled || el.getAttribute("aria-hidden") === "true";
          // A caption on the rail has no height of its own: it is there if it is laid out at all.
          return re.test(name) && el.getClientRects().length > 0 && !off;
        }) ?? null
      );
    },
    words.source,
    words.flags,
  );
  return found.asElement() as ElementHandle<HTMLElement> | null;
}

/** Click, or tap on a touch page, the control that says `words`: at its middle, or just over its baseline when it has no height. */
export async function act(page: Page, words: RegExp, touch = false): Promise<boolean> {
  const el = await control(page, words);
  if (!el) return false;
  const at = await el.evaluate((node) => {
    node.scrollIntoView({ block: "nearest" });
    const r = node.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.height >= 1 ? r.top + r.height / 2 : r.top - 4 };
  });
  if (touch) await page.touchscreen.tap(at.x, at.y);
  else await page.mouse.click(at.x, at.y);
  await frames(page);
  return true;
}

/** The same, for a control that arrives a beat after the step that brings it. */
export async function actOnceThere(page: Page, words: RegExp, touch = false, ms = 4000): Promise<boolean> {
  for (const until = Date.now() + ms; Date.now() < until; await sleep(100))
    if (await control(page, words)) return act(page, words, touch);
  return false;
}

/** The ledger's standing, as its drawing's classes say it. */
export const ledgerClasses = (page: Page) =>
  page.evaluate(() => [...(document.querySelector(".ledger-host svg")?.classList ?? [])]);

/** Open the app at an address, and wait for its faces. */
export async function visit(page: Page, url: string, hash: string): Promise<void> {
  await page.goto(`${url}/${hash}`, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);
  await frames(page);
}

/** A room at rest: arrived, said, and its first drawing up. */
export async function roomAtRest(page: Page, ms = 15_000): Promise<boolean> {
  try {
    await page.waitForFunction(
      () =>
        document.querySelector(".room")?.getAttribute("data-phase") === "rest" &&
        !!document.querySelector(".p1-host svg"),
      { timeout: ms },
    );
    await frames(page);
    return true;
  } catch {
    return false;
  }
}
