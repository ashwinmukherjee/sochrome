// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// A1: every route measured in the browser: text contrast on its real ground, the keyboard's reach, drawings' alternatives, reduced motion.

import type { Page } from "puppeteer-core";
import type { Result } from "../checks/_check";
import { openBrowser, openPage, serve } from "./browser";
import { frames, roomAtRest, rowsOf, SAMPLE, sample, sleep, tally } from "./shell";

const S = `#/sample/${SAMPLE}`;
/** Decided values under 4.5:1, listed for review and not failed. Empty since 2026-11-19 (K2): the caption
 *  and faint greys both reach 4.5:1, so any text under it fails. */
export const DECIDED = new Set<string>([]);

interface Pair {
  fg: string;
  bg: string;
  ratio: number;
  large: boolean;
  token: string;
  where: string;
  text: string;
}

/** Every visible run of text, its colour as painted (opacity and alpha blended) over the first opaque ground behind it. */
export function measure(page: Page): Promise<Pair[]> {
  return page.evaluate(() => {
    const parse = (c: string) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a = "1"] = m[1].split(/[ ,/]+/).filter(Boolean);
      return { r: +r, g: +g, b: +b, a: +a };
    };
    const lum = (c: { r: number; g: number; b: number }) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };
    const hex = (c: { r: number; g: number; b: number }) =>
      "#" +
      [c.r, c.g, c.b]
        .map((v) => Math.round(v).toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase();
    const rootStyle = getComputedStyle(document.documentElement);
    const tokens = [
      "--ink",
      "--ink-dim",
      "--ink-bar",
      "--v-lit",
      "--v-terminal",
      "--v-predicted",
      "--v-path",
      "--v-benign",
      "--v-observed",
      "--v-text",
      "--v-text-2",
    ];
    const probe = document.createElement("i");
    document.body.append(probe);
    const tokenOf = new Map<string, string>();
    for (const t of tokens) {
      probe.style.color = `var(${t})`;
      const c = getComputedStyle(probe).color;
      if (!tokenOf.has(c)) tokenOf.set(c, t);
    }
    probe.remove();
    const out: Pair[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || seen.has(el) || !n.textContent?.trim()) continue;
      seen.add(el);
      if (el.closest("[aria-hidden=true], svg, script, style, noscript")) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden") continue;
      let opacity = 1;
      let bg: { r: number; g: number; b: number; a: number } | null = null;
      for (let a: Element | null = el; a; a = a.parentElement) {
        const s = getComputedStyle(a);
        opacity *= +s.opacity;
        const b = parse(s.backgroundColor);
        if (!bg && b && b.a > 0.99) bg = b;
      }
      if (opacity < 0.95) continue; // still arriving or leaving: not text at rest
      bg ??= parse(rootStyle.backgroundColor) ?? { r: 255, g: 255, b: 255, a: 1 };
      const fg = parse(cs.color);
      if (!fg) continue;
      const a = fg.a * opacity;
      const shown = { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a) };
      const [l1, l2] = [lum(shown), lum(bg)].sort((x, y) => y - x);
      const size = parseFloat(cs.fontSize);
      const weight = parseInt(cs.fontWeight, 10);
      out.push({
        fg: hex(shown),
        bg: hex(bg),
        ratio: Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100,
        large: size >= 24 || (size >= 18.66 && weight >= 700),
        token: tokenOf.get(cs.color) ?? cs.color,
        where:
          el.className && typeof el.className === "string"
            ? `${el.tagName.toLowerCase()}.${el.className.split(" ")[0]}`
            : el.tagName.toLowerCase(),
        text: n.textContent.trim().slice(0, 40),
      });
    }
    return out;
  });
}

/** Tab through the page; every control a pointer can use must take the focus on the way. */
async function keyboard(page: Page): Promise<{ missed: string[]; reached: number }> {
  const controls = await page.evaluate(() => {
    const all = [
      ...document.querySelectorAll<HTMLElement>(
        "button, a[href], [role=button], [onclick], input:not([type=hidden]), [tabindex]",
      ),
    ];
    all.forEach((el, i) => (el.dataset.a1 = String(i)));
    return all
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return (
          r.width > 0 &&
          r.height > 0 &&
          s.visibility !== "hidden" &&
          !(el as HTMLButtonElement).disabled &&
          !el.closest("[aria-hidden=true], [inert]") &&
          el.tabIndex !== -1
        );
      })
      .map((el) => ({
        id: el.dataset.a1 ?? "",
        name: (el.getAttribute("aria-label") ?? el.textContent ?? el.tagName).trim().slice(0, 40),
      }));
  });
  const reached = new Set<string>();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < controls.length + 40; i++) {
    await page.keyboard.press("Tab");
    const id = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.a1 ?? "");
    if (id) reached.add(id);
  }
  return { missed: controls.filter((c) => !reached.has(c.id)).map((c) => c.name), reached: reached.size };
}

/** Every drawing either says what it shows (a name, a title, a caption) or is hidden as decoration beside words that do. */
function drawings(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("svg, canvas")]
      .filter((el) => !el.parentElement?.closest("svg") && el.getBoundingClientRect().width > 24)
      .map((el) => {
        const named =
          !!el.getAttribute("aria-label") ||
          !!el.getAttribute("aria-labelledby") ||
          !!el.querySelector(":scope > title") ||
          !!el.closest("figure")?.querySelector("figcaption");
        const hidden = !!el.closest("[aria-hidden=true]");
        const host = el.parentElement?.className;
        return {
          named,
          hidden,
          role: el.getAttribute("role"),
          where: typeof host === "string" ? host.split(" ")[0] : "",
        };
      }),
  );
}

export async function run(): Promise<Result> {
  const t = tally();
  const notes: string[] = [];
  const server = await serve("dev");
  const { browser, close } = await openBrowser();
  const low = new Map<string, { pair: Pair; routes: Set<string> }>();
  const room = rowsOf(sample(), "yours")[0];
  const carrier = rowsOf(sample(), "carriers")[0];
  const routes = [
    "#/",
    `${S}/read/all`,
    `${S}/read/yours`,
    `${S}/list`,
    `${S}/list/carriers`,
    `${S}/variant/${room.name}`,
    `${S}/carrier/${carrier.name}`,
    "#/genes",
  ];
  try {
    for (const dark of [false, true]) {
      for (const hash of routes) {
        const { page, errors } = await openPage(browser, "desktop", { dark });
        // tsx names inner functions with a helper the page lacks.
        await page.evaluateOnNewDocument("globalThis.__name = (f) => f");
        await page.goto(`${server.url}/${hash}`, { waitUntil: "networkidle0" });
        await page.evaluate(() => document.fonts.ready);
        const isRoom = /\/(variant|carrier)\//.test(hash);
        if (isRoom) t.ok(await roomAtRest(page), `${hash}: the room never came to rest`);
        await sleep(isRoom ? 400 : 2500);
        // A room's words arrive as it is scrolled: measured at its top, its middle and its end.
        const stops = isRoom ? [0, 0.5, 1] : [0];
        for (const at of stops) {
          if (isRoom) {
            await page.evaluate((f: number) => {
              const r = document.querySelector(".room");
              r?.scrollTo({ top: (r.scrollHeight - r.clientHeight) * f });
            }, at);
            await sleep(1500);
          }
          for (const p of await measure(page)) {
            if (p.ratio >= 4.5) continue;
            const k = `${p.token} ${p.fg} on ${p.bg}`;
            const e = low.get(k) ?? { pair: p, routes: new Set<string>() };
            e.routes.add(`${hash}${dark ? " dark" : ""}`);
            low.set(k, e);
          }
        }
        if (!dark) {
          await page.evaluate(() => document.querySelector(".room")?.scrollTo({ top: 0 }));
          await sleep(500);
          const k = await keyboard(page);
          t.ok(k.missed.length === 0, `${hash}: the keyboard never reaches ${k.missed.join(" | ")}`);
          const d = await drawings(page);
          const bare = d.filter((x) => !x.named && !x.hidden);
          t.ok(
            bare.length === 0,
            `${hash}: ${bare.length} drawings have no text alternative and are not hidden: ${[...new Set(bare.map((b) => b.where))].join(", ")}`,
          );
          notes.push(
            `${hash}: ${k.reached} controls reached by Tab; drawings ${d.filter((x) => x.named).length} named, ${d.filter((x) => x.hidden).length} hidden, ${bare.length} bare`,
          );
        }
        t.ok(errors.length === 0, `${hash}: page errors ${errors.slice(0, 2).join(" | ")}`);
        await page.close();
      }
    }
    // Reduced motion: once arrived, nothing moves, and no cue nudges.
    for (const hash of [`${S}/list`, `${S}/variant/${room.name}`, `${S}/read/yours`]) {
      const { page } = await openPage(browser, "desktop");
      await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
      // tsx names inner functions with a helper the page lacks.
      await page.evaluateOnNewDocument("globalThis.__name = (f) => f");
      await page.goto(`${server.url}/${hash}`, { waitUntil: "networkidle0" });
      await sleep(3000);
      await frames(page);
      const moving = await page.evaluate(() =>
        document
          .getAnimations()
          .filter((a) => a.playState === "running")
          .map((a) => {
            const target = (a.effect as KeyframeEffect | null)?.target;
            const name = (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? "script";
            return `${name} on ${target instanceof Element ? target.className || target.tagName : "?"}`;
          }),
      );
      t.ok(moving.length === 0, `${hash}: under reduced motion still moving: ${moving.slice(0, 6).join(", ")}`);
      await page.close();
    }
  } finally {
    await close();
    server.stop();
  }
  const listed = [...low.values()].sort((a, b) => a.pair.ratio - b.pair.ratio);
  const undecided = listed.filter((e) => !DECIDED.has(e.pair.token));
  for (const e of undecided)
    t.ok(
      false,
      `contrast ${e.pair.ratio}:1 ${e.pair.token} ${e.pair.fg} on ${e.pair.bg}${e.pair.large ? " (large)" : ""}, ${e.pair.where} "${e.pair.text}" at ${[...e.routes].slice(0, 3).join(", ")}`,
    );
  notes.push(
    "text under 4.5:1 on decided values (for review, not failed):",
    ...listed
      .filter((e) => DECIDED.has(e.pair.token))
      .map(
        (e) =>
          `  ${e.pair.ratio}:1 ${e.pair.token} ${e.pair.fg} on ${e.pair.bg}, ${e.pair.where} "${e.pair.text}" at ${[...e.routes].slice(0, 3).join(", ")}`,
      ),
  );
  return {
    ok: t.failures.length === 0,
    detail: [...t.failures, ...notes, `${t.asserted} asserts, ${t.failures.length} failed`].join("\n"),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await run();
  console.log(r.detail);
  process.exitCode = r.ok ? 0 : 1;
}
