// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// L1: every route at 1440, 1024, 390 and 320, in Suisse: no sideways scroll, nothing past the edge, no text clipped or overlapping.

import type { Page } from "puppeteer-core";
import type { Result } from "../checks/_check";
import { openBrowser, openPage, serve, SIZES, type Size } from "./browser";
import { roomAtRest, rowsOf, SAMPLE, sample, sleep, tally } from "./shell";

const S = `#/sample/${SAMPLE}`;

export function asserts(page: Page) {
  return page.evaluate(() => {
    const problems: string[] = [];
    const name = (el: Element) =>
      `${el.tagName.toLowerCase()}${typeof el.className === "string" && el.className ? "." + el.className.split(" ")[0] : ""}`;
    const de = document.documentElement;
    if (de.scrollWidth > de.clientWidth + 1)
      problems.push(`the page scrolls sideways by ${de.scrollWidth - de.clientWidth} px`);
    if (!document.fonts.check('13px "Suisse Intl"')) problems.push("Suisse Intl is not loaded");
    const boxes: { el: Element; r: { left: number; right: number; top: number; bottom: number } }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || seen.has(el) || !n.textContent?.trim() || el.closest("svg, [aria-hidden=true]")) continue;
      seen.add(el);
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || +s.opacity === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      // Inside a sideways scroller, reaching past the edge is the scroller's business.
      let scroller = false;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const o = getComputedStyle(a).overflowX;
        if (o === "auto" || o === "scroll") scroller = true;
      }
      if (!scroller && (r.right > innerWidth + 1 || r.left < -1))
        problems.push(
          `${name(el)} "${n.textContent.trim().slice(0, 30)}" runs past the edge (${Math.round(r.left)}..${Math.round(r.right)})`,
        );
      if (
        (s.overflowX === "hidden" || s.overflowX === "clip" || s.textOverflow === "ellipsis") &&
        el.scrollWidth > el.clientWidth + 1
      )
        problems.push(
          `${name(el)} "${n.textContent.trim().slice(0, 30)}" is clipped by ${el.scrollWidth - el.clientWidth} px`,
        );
      // What is seen of it: cut by every clipping ancestor, and only if no ancestor has faded it out.
      const v = { left: r.left, right: r.right, top: r.top, bottom: Math.min(r.bottom, innerHeight) };
      let alpha = 1;
      for (let a: Element | null = el; a && a !== document.documentElement; a = a.parentElement) {
        const as = getComputedStyle(a);
        alpha *= +as.opacity;
        if (as.visibility === "hidden") alpha = 0;
        if (a !== el && as.overflow !== "visible") {
          const c = a.getBoundingClientRect();
          v.left = Math.max(v.left, c.left);
          v.right = Math.min(v.right, c.right);
          v.top = Math.max(v.top, c.top);
          v.bottom = Math.min(v.bottom, c.bottom);
        }
      }
      if (alpha > 0.05 && v.right - v.left > 1 && v.bottom - v.top > 1) boxes.push({ el, r: v });
    }
    // Two runs of text drawn over each other, neither inside the other; up to 4 px is line-box leading, not ink.
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i], boxes[j]];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w > 4 && h > 4)
          problems.push(
            `${name(a.el)} "${a.el.textContent?.trim().slice(0, 20)}" overlaps ${name(b.el)} "${b.el.textContent?.trim().slice(0, 20)}" by ${Math.round(w)}x${Math.round(h)}`,
          );
      }
    return [...new Set(problems)];
  });
}

export async function run(): Promise<Result> {
  const t = tally();
  const server = await serve("dev");
  const { browser, close } = await openBrowser();
  const room = rowsOf(sample(), "yours")[0];
  const routes = [
    "#/",
    `${S}/read/all`,
    `${S}/read/yours`,
    `${S}/list`,
    `${S}/list/carriers`,
    `${S}/variant/${room.name}`,
    "#/genes",
  ];
  try {
    for (const size of ["desktop", "laptop", "phone", "small"] as Size[]) {
      for (const hash of routes) {
        const { page, errors } = await openPage(browser, size, { touch: SIZES[size][0] < 600 });
        // tsx names inner functions with a helper the page lacks.
        await page.evaluateOnNewDocument("globalThis.__name = (f) => f");
        await page.goto(`${server.url}/${hash}`, { waitUntil: "networkidle0" });
        await page.evaluate(() => document.fonts.ready);
        const isRoom = hash.includes("/variant/");
        if (isRoom) t.ok(await roomAtRest(page), `${size} ${hash}: the room never came to rest`);
        await sleep(isRoom ? 400 : 2500);
        for (const at of isRoom ? [0, 0.5, 1] : [0]) {
          if (isRoom) {
            await page.evaluate((f: number) => {
              const r = document.querySelector(".room");
              r?.scrollTo({ top: (r.scrollHeight - r.clientHeight) * f });
            }, at);
            await sleep(1500);
          }
          for (const p of await asserts(page)) t.ok(false, `${SIZES[size][0]} ${hash}${isRoom ? ` @${at}` : ""}: ${p}`);
          t.ok(true, "measured");
        }
        t.ok(errors.length === 0, `${size} ${hash}: page errors ${errors.slice(0, 2).join(" | ")}`);
        await page.close();
      }
    }
  } finally {
    await close();
    server.stop();
  }
  return {
    ok: t.failures.length === 0,
    detail: [...t.failures, `${t.asserted} asserts, ${t.failures.length} failed`].join("\n"),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await run();
  console.log(r.detail);
  process.exitCode = r.ok ? 0 : 1;
}
