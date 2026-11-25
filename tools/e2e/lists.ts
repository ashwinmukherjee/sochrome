// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// E2: the lists and the genes page beside the real ledger, on the four fixtures, and their screenshots.

import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "puppeteer-core";
import { order } from "../../src/app/list/order";
import { LIST_WORDS } from "../../src/app/list/words";
import type { GenomeResult } from "../../src/contracts/app";
import { GENE_ROW_PITCH, LIST_PITCH } from "../../src/contracts/constants";
import { openBrowser, openPage, serve, shot, type Size } from "./browser";

const ROOT = resolve(import.meta.dirname, "../..");
const HARNESS = "/src/app/list/dev/index.html";
const FIXTURES = ["hg002", "x-one", "hg001", "empty"] as const;
const SIZES: Size[] = ["desktop", "phone", "small"];
const WIDTH: Record<Size, number> = { desktop: 1440, laptop: 1024, phone: 390, small: 320 };
/** Caption baseline to the first row's baseline (C5), the clear gap above the sentence (C9), the foot (C10). */
const CAPTION_OFFSET = 56;
const CLEAR = 24;
const FOOT = 48;
const CUE_WAIT = 2100;
const TOL = 1.5;
/** tsx names the functions it hands the page; the page needs the helper that does it. */
const KEEP_NAMES = "globalThis.__name = (f) => f;";

const fixture = (name: string) =>
  JSON.parse(readFileSync(resolve(ROOT, `test/fixtures/${name}.result.json`), "utf8")) as GenomeResult;

const problems: string[] = [];
let asserted = 0;
function ok(cond: boolean, what: string) {
  asserted++;
  if (!cond) problems.push(what);
}
const near = (a: number, b: number) => Math.abs(a - b) <= TOL;

const frames = (page: Page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
const settle = async (page: Page, ms = 450) => {
  await new Promise((r) => setTimeout(r, ms));
  await frames(page);
};

async function load(page: Page, name: string | null) {
  await page.evaluate((n) => window.lists?.load(n), name);
  await page.waitForFunction(
    (n) =>
      !!window.lists?.ledger &&
      !!document.querySelector(".ledger-svg") &&
      !!document.querySelector(n ? ".list" : ".genes-page"),
    {},
    name,
  );
  await settle(page);
}

interface ListGeom {
  captions: string[];
  pressed: string[];
  keys: string[];
  shown: number;
  firstShown: number;
  more: string | null;
  sentence: string;
  pitches: number[];
  captionToRow: number;
  scrollbar: number;
  clearAbove: number;
  footGap: number;
  sentenceTopToFirstLine: number;
  overflowX: number;
}

/** Every number the list's rows assert, read from the page. */
const geom = (page: Page) =>
  page.evaluate((): ListGeom => {
    const q = <T extends Element>(s: string) => document.querySelector<T>(s);
    const base = (el: Element) => {
      const probe = document.createElement("span");
      probe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
      el.appendChild(probe);
      const y = probe.getBoundingClientRect().top;
      probe.remove();
      return y;
    };
    const rowsEl = q<HTMLElement>(".list-rows");
    const rows = [...document.querySelectorAll<HTMLElement>(".list-row")];
    const sr = rowsEl?.getBoundingClientRect();
    const inClear = rows.filter((r) => {
      const b = r.getBoundingClientRect();
      return sr && b.top >= sr.top - 0.5 && b.bottom <= sr.bottom + 0.5;
    });
    const more = q<HTMLElement>(".list-more");
    const sentence = q<HTMLElement>(".list-sentence");
    const sb = sentence?.getBoundingClientRect();
    const above = more ?? inClear.at(-1);
    const caption = q(".list-captions");
    const first = rows[0]?.querySelector(".list-variant");
    const firstLine = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--first-line"));
    return {
      captions: [...document.querySelectorAll(".list-tab")].map((b) => b.textContent ?? ""),
      pressed: [...document.querySelectorAll(".list-tab[aria-pressed=true]")].map((b) => b.textContent ?? ""),
      keys: rows.map((r) => r.dataset.key ?? ""),
      shown: inClear.length,
      firstShown: inClear[0] ? rows.indexOf(inClear[0]) : -1,
      more: more?.textContent ?? null,
      sentence: sentence?.textContent ?? "",
      pitches: inClear
        .slice(1)
        .map((r, i) => r.getBoundingClientRect().top - (inClear[i]?.getBoundingClientRect().top ?? 0)),
      captionToRow: caption && first ? base(first) - base(caption) : Number.NaN,
      scrollbar: rowsEl ? rowsEl.offsetWidth - rowsEl.clientWidth : 0,
      clearAbove: sb && above ? sb.top - above.getBoundingClientRect().bottom : Number.NaN,
      footGap: sb ? innerHeight - sb.bottom : Number.NaN,
      sentenceTopToFirstLine:
        sb && sentence ? sb.top + Number.parseFloat(getComputedStyle(sentence).lineHeight) / 2 - firstLine : Number.NaN,
      overflowX: document.documentElement.scrollWidth - innerWidth,
    };
  });

/** Click a caption: it stands on a zero-height strut, so click just above its baseline. */
async function clickCaption(page: Page, selector: string) {
  const at = await page.evaluate((s) => {
    const r = document.querySelector(s)?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top - 5 } : null;
  }, selector);
  if (!at) return ok(false, `no ${selector} to click`);
  await page.mouse.click(at.x, at.y);
}

async function hoverCentre(page: Page, selector: string) {
  const box = await page.evaluate((s) => {
    const r = document.querySelector(s)?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  }, selector);
  if (!box) return false;
  await page.mouse.move(box.x, box.y);
  await frames(page);
  return true;
}

async function listChecks(page: Page, name: string, r: GenomeResult, size: Size, shots: boolean) {
  const at = `${name} at ${WIDTH[size]}`;
  const tag = (s: string) => `${s}-${WIDTH[size]}`;
  await load(page, name);
  let g = await geom(page);
  const nothing = r.counts.rare === 0;
  const yours = LIST_WORDS.caption.yours + LIST_WORDS.count(r.counts.yours);
  const carriers = LIST_WORDS.caption.carriers + LIST_WORDS.count(r.counts.carriers);
  ok(g.captions[0] === yours, `${at}: first caption "${g.captions[0]}", wanted "${yours}"`);
  ok(
    nothing || r.counts.carriers === 0 ? g.captions.length === 1 : g.captions[1] === carriers,
    `${at}: CARRIERS caption ${JSON.stringify(g.captions)}`,
  );
  ok(g.pressed[0] === yours, `${at}: YOUR VARIANTS is not the chosen caption`);
  ok(g.overflowX <= 0, `${at}: the page scrolls sideways by ${g.overflowX}px`);

  if (nothing) {
    ok(g.keys.length === 0, `${at}: rows on a genome with nothing found`);
    ok(g.sentence === LIST_WORDS.nothing(r.checked.genes), `${at}: nothing-found sentence "${g.sentence}"`);
    ok(g.sentence.includes(r.checked.genes.toLocaleString("en-US")), `${at}: the gene count is not the result's`);
    ok(
      Math.abs(g.sentenceTopToFirstLine) <= 2,
      `${at}: the sentence is ${g.sentenceTopToFirstLine}px off the first line`,
    );
    ok(g.more === null, `${at}: "+N more" with nothing listed`);
    if (shots) await shot(page, `review/c/${tag("nothing")}`);
    return;
  }

  const want = order(r.yours).map((f) => f.key);
  ok(JSON.stringify(g.keys) === JSON.stringify(want), `${at}: rows are not in evidence order`);
  ok(g.sentence === LIST_WORDS.sentence.yours, `${at}: YOUR VARIANTS sentence "${g.sentence}"`);
  ok(
    g.pitches.every((p) => near(p, LIST_PITCH)),
    `${at}: row pitch ${[...new Set(g.pitches.map((p) => p.toFixed(1)))].join("/")}`,
  );
  // On the phone the tokens raise the rail but not the first line: the phone pass.
  ok(
    size !== "desktop" || near(g.captionToRow, CAPTION_OFFSET),
    `${at}: caption to first row ${g.captionToRow.toFixed(1)}px`,
  );
  ok(g.scrollbar === 0, `${at}: a scrollbar ${g.scrollbar}px wide`);
  // The column's paging and its foot on a phone are the shell's (the screen tall): E4 holds them there. This dev
  // page has no shell, so here they are held on desktop.
  const desk = size === "desktop";
  ok(!desk || g.clearAbove >= CLEAR - TOL, `${at}: ${g.clearAbove.toFixed(1)}px above the sentence`);
  ok(!desk || near(g.footGap, FOOT), `${at}: the sentence stands ${g.footGap.toFixed(1)}px off the foot`);
  const hidden = want.length - g.shown;
  ok(
    !desk || (hidden > 0 ? g.more === LIST_WORDS.more(hidden) : g.more === null),
    `${at}: "+N more" reads "${g.more}" with ${hidden} rows below`,
  );
  if (shots) await shot(page, `review/c/${tag("list-yours")}`);

  // The first variant's cue: the first row at ink with its arrow nudging; its tick stays still.
  await settle(page, CUE_WAIT);
  const cue = await page.evaluate(() => ({
    row: document.querySelector(".list-row.is-cue")?.getAttribute("data-key") ?? null,
    arrow: !!document.querySelector(".list-row.is-cue .cue-arr svg.arrow"),
    tick: document.querySelectorAll(".ledger-svg .cue").length,
    nudge: document
      .getAnimations()
      .some(
        (a) =>
          (a as CSSAnimation).animationName === "cue-nudge" &&
          (a.effect as KeyframeEffect | null)?.target instanceof Element &&
          ((a.effect as KeyframeEffect).target as Element).closest(".cue-arr") !== null,
      ),
  }));
  ok(cue.row === want[0] && cue.arrow, `${at}: the first variant's cue is on ${cue.row}`);
  ok(cue.nudge, `${at}: the first variant's arrow does not nudge`);
  ok(cue.tick === 0, `${at}: the first variant's tick is marked as a cue`);
  if (shots) await shot(page, `review/c/${tag("list-cue")}`);

  // "+N more" pages down keeping the last row seen as the first; at the end it reads "Back to top".
  if (desk && hidden > 0) {
    const before = g.shown;
    let pages = 0;
    while ((await geom(page)).more?.startsWith("+") && pages < 20) {
      const was = (await geom(page)).firstShown;
      await page.click(".list-more");
      await settle(page, 700);
      const now = await geom(page);
      const last = want.length - before;
      ok(now.firstShown === Math.min(was + before - 1, last), `${at}: a page down starts at row ${now.firstShown}`);
      pages++;
    }
    g = await geom(page);
    ok(g.more === LIST_WORDS.top, `${at}: at the end "+N more" reads "${g.more}"`);
    if (shots) await shot(page, `review/c/${tag("list-paged")}`);
    await page.click(".list-more");
    await settle(page, 900);
    ok((await geom(page)).firstShown === 0, `${at}: "Back to top" does not return to the top`);
  }

  // Linked highlighting: a row lights its mark; a tick lights its rows and scrolls the first into the clear.
  if (size === "desktop") {
    await hoverCentre(page, ".list-row:nth-child(3)");
    const lit = await page.evaluate(() => ({
      svg: document.querySelector(".ledger-svg")?.classList.contains("linking") ?? false,
      hot: document.querySelectorAll(".ledger-svg .hot").length,
      rows: document.querySelector(".list-rows")?.classList.contains("linking") ?? false,
    }));
    ok(lit.svg && lit.hot > 0 && lit.rows, `${at}: a row's hover does not light its mark ${JSON.stringify(lit)}`);
    if (shots) await shot(page, `review/c/${tag("list-linked")}`);
    await page.mouse.move(1, 1);
    await frames(page);
    const hit = await page.evaluate(() => {
      const hits = [...document.querySelectorAll<SVGElement>(".ledger-svg .hits > *")].filter(
        (h) => h.dataset.list === "yours",
      );
      const r = hits.at(-1)?.getBoundingClientRect();
      return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    });
    if (hit) {
      await page.mouse.move(hit.x, hit.y);
      await settle(page, 700);
      const after = await page.evaluate(() => {
        const sr = document.querySelector(".list-rows")?.getBoundingClientRect();
        const hot = [...document.querySelectorAll<HTMLElement>(".list-row.is-hot")];
        const clear = hot.some((h) => {
          const b = h.getBoundingClientRect();
          return !!sr && b.top >= sr.top - 0.5 && b.bottom <= sr.bottom + 0.5;
        });
        return { hot: hot.map((h) => h.dataset.key), clear };
      });
      ok(after.hot.length > 0, `${at}: a tick's hover lights no row`);
      ok(after.clear, `${at}: a tick's hover leaves its row out of the clear (${after.hot.join(",")})`);
      await page.mouse.move(1, 1);
      await settle(page);
    } else ok(false, `${at}: no tick hit area for YOUR VARIANTS`);
  }

  // A click opens; the open room's own row closes it; the open row is the mono's Bold (C3, 2026-11-21) and nothing
  // shifts.
  const x0 = await page.evaluate(() => document.querySelector(".list-gene")?.getBoundingClientRect().left ?? 0);
  await page.click(".list-row");
  await frames(page);
  const sel = await page.evaluate(() => {
    const cur = document.querySelector(".list-row.is-current");
    return {
      key: cur?.getAttribute("data-key") ?? null,
      weight: cur ? getComputedStyle(cur).fontWeight : "",
      x: document.querySelector(".list-gene")?.getBoundingClientRect().left ?? 0,
      cue: !!document.querySelector(".list-row.is-cue"),
    };
  });
  ok(sel.key === want[0], `${at}: clicking the first row made ${sel.key} current`);
  ok(sel.weight === "700", `${at}: the current row's weight is ${sel.weight}, not Bold`);
  ok(near(sel.x, x0), `${at}: the row's text moved ${sel.x - x0}px on select`);
  ok(!sel.cue, `${at}: the cue outlives the first room`);
  await page.click(".list-row");
  await frames(page);
  ok(!(await page.$(".list-row.is-current")), `${at}: the open room's own row does not close it`);

  // The swap: CARRIERS lists the carriers and the ledger's standing ticks follow.
  if (r.counts.carriers > 0) {
    await clickCaption(page, ".list-tab-carriers");
    await settle(page);
    g = await geom(page);
    const wantC = order(r.carriers).map((f) => f.key);
    ok(JSON.stringify(g.keys) === JSON.stringify(wantC), `${at}: CARRIERS rows are not the carriers by evidence`);
    ok(g.pressed[0] === carriers, `${at}: CARRIERS is not chosen after the swap`);
    ok(g.sentence === LIST_WORDS.sentence.carriers, `${at}: CARRIERS sentence "${g.sentence}"`);
    ok(
      size !== "desktop" || g.clearAbove >= CLEAR - TOL,
      `${at} carriers: ${g.clearAbove.toFixed(1)}px above the sentence`,
    );
    if (shots) await shot(page, `review/c/${tag("list-carriers")}`);
    await clickCaption(page, ".list-tab-yours");
    await settle(page);
  }
}

async function genesChecks(page: Page, name: string | null, r: GenomeResult | null, size: Size, shots: boolean) {
  const at = `genes from ${name ?? "the landing"} at ${WIDTH[size]}`;
  if (name) {
    await load(page, name);
    await page.evaluate(() => window.lists?.view("genes"));
  } else await load(page, null);
  await settle(page, 700);
  const g = await page.evaluate(() => {
    const rowsEl = document.querySelector<HTMLElement>(".genes-rows");
    const rows = [...document.querySelectorAll<HTMLElement>(".genes-row")];
    const sr = rowsEl?.getBoundingClientRect();
    const shown = rows.filter((x) => {
      const b = x.getBoundingClientRect();
      return sr && b.top >= sr.top - 0.5 && b.bottom <= sr.bottom + 0.5;
    });
    const back = document.querySelector(".genes-back")?.getBoundingClientRect();
    const more = document.querySelector(".genes-more");
    return {
      caption: document.querySelector(".genes-caption")?.textContent ?? "",
      count: rows.length,
      sorted: rows
        .map((x) => x.textContent ?? "")
        .every((s, i, a) => i === 0 || (a[i - 1] ?? "").localeCompare(s, "en") <= 0),
      shown: shown.length,
      pitch:
        shown.length > 1
          ? (shown[1]?.getBoundingClientRect().top ?? 0) - (shown[0]?.getBoundingClientRect().top ?? 0)
          : 0,
      whole: !!sr && Math.abs(sr.height - shown.length * (shown[0]?.offsetHeight ?? 0) - 8) < 1.5,
      more: more?.textContent ?? null,
      backFoot: back ? innerHeight - back.bottom : Number.NaN,
      airAbove: back && more ? back.top - more.getBoundingClientRect().bottom : Number.NaN,
      overflowX: document.documentElement.scrollWidth - innerWidth,
    };
  });
  ok(g.caption === LIST_WORDS.genes + LIST_WORDS.count(g.count), `${at}: caption "${g.caption}"`);
  ok(!r || g.count === r.checked.genes, `${at}: ${g.count} genes listed, the result checked ${r?.checked.genes}`);
  ok(g.sorted, `${at}: genes not A-Z`);
  // On a phone the page stands the screen tall in the shell, which this harness doesn't draw: its paging is E4's.
  const folded = size !== "desktop";
  ok(folded || near(g.pitch, GENE_ROW_PITCH), `${at}: gene pitch ${g.pitch}`);
  ok(folded || g.whole, `${at}: the genes' scrollport is not whole rows`);
  ok(
    folded || g.more === LIST_WORDS.more(g.count - g.shown),
    `${at}: "+N more" reads "${g.more}" with ${g.shown} of ${g.count} shown`,
  );
  ok(folded || near(g.backFoot, FOOT), `${at}: BACK stands ${g.backFoot}px off the foot`);
  ok(folded || g.airAbove >= GENE_ROW_PITCH - TOL, `${at}: ${g.airAbove}px between "+N more" and BACK`);
  ok(g.overflowX <= 0, `${at}: the page scrolls sideways by ${g.overflowX}px`);
  if (size === "desktop") {
    await hoverCentre(page, ".genes-row");
    const hot = await page.evaluate(() => document.querySelectorAll(".ledger-svg .hot").length);
    ok(hot > 0, `${at}: a gene's hover lights no tick`);
  }
  if (shots) await shot(page, `review/c/genes-${name ? "results" : "reference"}-${WIDTH[size]}`);
  if (folded) {
    if (name) {
      await page.keyboard.press("Escape");
      await settle(page);
      ok(!!(await page.$(".list")), `${at}: Esc does not close the genes page`);
    }
    return;
  }
  await page.click(".genes-more");
  await settle(page, 700);
  const paged = await page.evaluate(() => {
    const sr = document.querySelector(".genes-rows")?.getBoundingClientRect();
    const rows = [...document.querySelectorAll<HTMLElement>(".genes-row")];
    return rows.findIndex((x) => !!sr && x.getBoundingClientRect().top >= sr.top - 0.5);
  });
  ok(paged === g.shown - 1, `${at}: a page down starts at gene ${paged}, wanted ${g.shown - 1}`);
  if (name) {
    await page.keyboard.press("Escape");
    await settle(page);
    ok(!!(await page.$(".list")), `${at}: Esc does not close the genes page`);
  }
}

export async function run(o: { shots: boolean }): Promise<{ ok: boolean; detail: string }> {
  if (o.shots) mkdirSync(resolve(ROOT, "shots/review/c"), { recursive: true });
  const server = await serve("dev");
  const { browser, close } = await openBrowser();
  const errors: string[] = [];
  try {
    for (const size of SIZES) {
      const shots = o.shots && size !== "small";
      const { page, errors: e } = await openPage(browser, size);
      await page.evaluateOnNewDocument(KEEP_NAMES);
      await page.goto(`${server.url}${HARNESS}`, { waitUntil: "networkidle0" });
      await page.waitForFunction(() => !!window.lists);
      for (const name of FIXTURES)
        await listChecks(page, name, fixture(name), size, shots && name !== "x-one" && name !== "hg001");
      await genesChecks(page, "hg002", fixture("hg002"), size, shots);
      await genesChecks(page, null, null, size, shots);
      errors.push(...e.map((x) => `${WIDTH[size]}: ${x}`));
      await page.close();
    }
    if (o.shots) {
      const { page } = await openPage(browser, "desktop", { dark: true });
      await page.evaluateOnNewDocument(KEEP_NAMES);
      await page.evaluateOnNewDocument(KEEP_NAMES);
      await page.goto(`${server.url}${HARNESS}`, { waitUntil: "networkidle0" });
      await page.waitForFunction(() => !!window.lists);
      await load(page, "hg002");
      await shot(page, "review/c/list-yours-1440-dark");
      await page.evaluate(() => window.lists?.view("genes"));
      await settle(page, 700);
      await shot(page, "review/c/genes-results-1440-dark");
      await load(page, null);
      await shot(page, "review/c/genes-reference-1440-dark");
      await page.close();
    }
  } finally {
    await close();
    server.stop();
  }
  for (const e of errors) ok(false, e);
  const fails = problems.filter(Boolean);
  return {
    ok: fails.length === 0,
    detail: fails.length
      ? `${fails.length} of ${asserted} failed:\n${fails.slice(0, 20).join("\n")}`
      : `${asserted} asserts pass on ${FIXTURES.length} fixtures at ${SIZES.map((s) => WIDTH[s]).join(", ")} px`,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await run({ shots: process.argv.includes("--shots") });
  process.stdout.write(`${r.detail}\n`);
  process.exit(r.ok ? 0 : 1);
}
