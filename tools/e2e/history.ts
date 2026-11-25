// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// E3: the composed app walked through its history at 1440: every step a push, back and forward with no reload, Esc, deep links.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "puppeteer-core";
import { CREDITS } from "../../src/app/links";
import { CREDITS_WORDS } from "../third-party-words";
import record from "../../src/third-party.json";
import type { Result } from "../checks/_check";
import { build, openBrowser, openPage, serve, shot } from "./browser";
import { headersFor, readHeaders, serveBuilt } from "./built";
import {
  act,
  actOnceThere,
  control,
  frames,
  hashOf,
  ledgerClasses,
  NAME,
  roomAtRest,
  ROOT,
  rowsOf,
  SAMPLE,
  sample,
  sleep,
  tally,
  visit,
  waitHash,
} from "./shell";

const S = `#/sample/${SAMPLE}`;
const CUTS = ["all", "coding", "protein", "rare", "yours"] as const;
/** The ledger's cumulative cut classes at each standing. */
const DEPTH: Record<string, number> = { all: 0, coding: 1, protein: 2, rare: 3, yours: 4, list: 4 };
const CUT_CLASSES = ["coding", "protein", "rare", "yours"];

const historyLength = (page: Page) => page.evaluate(() => history.length);
const title = (page: Page) => page.title();
/** Click what a selector names, if it is there. */
async function press(page: Page, selector: string): Promise<boolean> {
  const el = await page.$(selector);
  if (!el) return false;
  await el.click();
  await frames(page);
  return true;
}
/** Back or forward one entry; false when history holds none that way. */
async function travel(page: Page, way: "back" | "forward"): Promise<boolean> {
  try {
    await (way === "back" ? page.goBack() : page.goForward());
    return true;
  } catch {
    return false;
  }
}
const has = (page: Page, selector: string) => page.evaluate((s: string) => !!document.querySelector(s), selector);

export async function run(opts: { shots: boolean }): Promise<Result> {
  if (opts.shots) mkdirSync(resolve(ROOT, "shots/review/f"), { recursive: true });
  const t = tally();
  const result = sample();
  const yours = rowsOf(result, "yours");
  const carriers = rowsOf(result, "carriers");
  const server = await serve("dev");
  const { browser, close } = await openBrowser();
  const errors: string[] = [];
  const snap = async (page: Page, name: string) => {
    if (opts.shots) await shot(page, `review/f/${name}`);
  };
  try {
    // ── The walk: landing, the sample, each cut by Next, the list, carriers, a room ──
    const { page, errors: seen } = await openPage(browser, "desktop");
    await visit(page, server.url, "#/");
    await page.evaluate(() => Object.assign(globalThis, { walked: true }));
    t.ok((await hashOf(page)) === "#/", `the landing's address is ${await hashOf(page)}`);
    t.ok((await title(page)) === NAME, `the landing's tab reads "${await title(page)}"`);
    t.ok(await has(page, ".ledger-svg.empty"), "L13: the empty ledger does not stand beside the landing");
    await snap(page, "landing-1440");
    t.ok(await has(page, `.landing-credits[href="${CREDITS}"]`), "the landing has no link to the credits");
    const arrived = await historyLength(page);

    /** Each step's address, in the order walked, with what must stand there. */
    const trail: { hash: string; at: string }[] = [{ hash: "#/", at: "landing" }];
    const standsAt = async (at: string, why: string) => {
      if (at === "landing")
        return t.ok(await has(page, ".ledger-svg.empty"), `${why}: the empty ledger does not stand on the landing`);
      if (at === "room") {
        t.ok(await roomAtRest(page), `${why}: no room came to rest`);
        t.ok(!(await has(page, ".ledger")), `${why}: R16, the ledger stands beside a room`);
        return;
      }
      const cls = await ledgerClasses(page);
      const depth = DEPTH[at.replace(/^list.*/, "list")] ?? 0;
      const cuts = CUT_CLASSES.filter((c) => cls.includes(c)).length;
      t.ok(cuts === depth, `${why}: the ledger stands ${cuts} cuts deep at ${at}, not ${depth}`);
      t.ok(cls.includes("menu") === at.startsWith("list"), `${why}: the ledger's list standing is wrong at ${at}`);
      t.ok(cls.includes("carriers") === (at === "list-carriers"), `${why}: the wrong list's ticks stand at ${at}`);
      t.ok(
        (await has(page, ".list")) === at.startsWith("list"),
        `${why}: the list is ${at.startsWith("list") ? "missing" : "showing"} at ${at}`,
      );
    };
    /** Entries ahead of the current one, which the next push replaces instead of adding to the length. */
    let ahead = 0;
    /** One step a person takes: it must push exactly one entry and land on `hash`. */
    const step = async (take: () => Promise<boolean>, hash: string, at: string, why: string) => {
      const before = await historyLength(page);
      t.ok(await take(), `${why}: nothing on the page to take the step with`);
      t.ok(await waitHash(page, hash), `${why}: the address is ${await hashOf(page)}, not ${hash}`);
      t.ok((await historyLength(page)) === before + 1 - ahead, `I6: ${why} did not push one entry`);
      ahead = 0;
      trail.push({ hash, at });
      await standsAt(at, why);
    };

    t.ok(await act(page, /view a sample/i), "the landing offers no sample");
    // Loading is one entry, replaced by the first count when the read ends: nothing to go back to mid-read.
    t.ok(await waitHash(page, `${S}/read/loading`, 5000), `the read's address is ${await hashOf(page)}`);
    t.ok((await historyLength(page)) === arrived + 1, "I6: starting the read did not push one entry");
    const filling = await page
      .waitForFunction(() => document.querySelector(".ledger-host svg")?.classList.contains("filling"), {
        timeout: 6000,
      })
      .then(
        () => true,
        () => false,
      );
    t.ok(filling, "the ledger is not filling during the read");
    await sleep(1500);
    await snap(page, "loading-1440");
    t.ok(await waitHash(page, `${S}/read/all`, 30_000), `the read ended at ${await hashOf(page)}`);
    t.ok(
      (await historyLength(page)) === arrived + 1,
      "I6: the read's end pushed an entry instead of replacing its own",
    );
    trail.push({ hash: `${S}/read/all`, at: "all" });
    await standsAt("all", "the first count");

    for (const cut of CUTS.slice(1)) {
      await step(() => act(page, /^\s*next/i), `${S}/read/${cut}`, cut, `Next to ${cut}`);
      if (cut !== "coding") continue;
      await snap(page, "descent-1440");
      // P7: the genes page, from the count the second cut's line names (the landing's way in, and the only one).
      await sleep(400);
      t.ok(await press(page, ".tally-genes"), "the second cut's line has no genes count to press");
      t.ok(await waitHash(page, "#/genes"), `P7: the genes count led to ${await hashOf(page)}`);
      t.ok((await ledgerClasses(page)).includes("genes-page"), "the ledger is not under the genes page");
      t.ok(!(await ledgerClasses(page)).includes("genes-ref"), "a genome's genes page shows the reference");
      t.ok((await title(page)) === NAME, `C21: the genes page's tab reads "${await title(page)}"`);
      await sleep(700);
      await snap(page, "genes-1440");
      await page.keyboard.press("Escape");
      t.ok(
        await waitHash(page, `${S}/read/coding`),
        `I5: Esc on the genes page left the address at ${await hashOf(page)}`,
      );
      t.ok(!(await ledgerClasses(page)).includes("genes-page"), "the ledger is still under the genes page");
      // P7: BACK goes back through history when the page pushed the entry, so forward returns to it.
      await travel(page, "forward");
      t.ok(await waitHash(page, "#/genes"), "P7: Esc did not go back through history");
      t.ok(await act(page, /^\s*back\s*$/i), "the genes page has no BACK");
      t.ok(await waitHash(page, `${S}/read/coding`), `P7: BACK led to ${await hashOf(page)}`);
      await travel(page, "forward");
      t.ok(await waitHash(page, "#/genes"), "P7: BACK did not go back through history");
      await travel(page, "back");
      await waitHash(page, `${S}/read/coding`);
      // The genes page stays ahead in history: the next step's push replaces it.
      ahead = 1;
    }
    await step(() => act(page, /^\s*explore/i), `${S}/list`, "list", "EXPLORE");
    await page.waitForSelector(".list-row");
    await sleep(1400);
    await snap(page, "list-1440");

    await step(() => act(page, /^\s*carriers/i), `${S}/list/carriers`, "list-carriers", "CARRIERS");

    const first = carriers[0];
    const roomHash = `${S}/carrier/${encodeURIComponent(first.name)}`;
    await step(() => press(page, `.list-row[data-key="${first.key}"]`), roomHash, "room", "opening a carrier's room");
    t.ok((await title(page)) === NAME, `C21: a sample's room is titled "${await title(page)}"`);
    // R16: in a room the tally, Next, YOUR GENOME and the rows' key are gone.
    for (const [gone, what] of [
      [".ledger-caption", "YOUR GENOME"],
      [".ledger-host", "the ledger and its rows' key"],
    ])
      t.ok(!(await has(page, gone)), `R16: ${what} still stands in a room`);
    t.ok(!(await control(page, /^\s*(next|explore)\s*$/i)), "R16: Next still stands in a room");
    t.ok(await has(page, `.list-row.is-current[data-key="${first.key}"]`), "the open row is not marked in the list");
    await snap(page, "room-1440");

    // ── Back to the landing, one prior state at a time; forward replays; never a reload ──
    for (let i = trail.length - 2; i >= 0; i--) {
      await travel(page, "back");
      t.ok(
        await waitHash(page, trail[i].hash),
        `back ${trail.length - 1 - i}: at ${await hashOf(page)}, not ${trail[i].hash}`,
      );
      await standsAt(trail[i].at, `back to ${trail[i].hash}`);
      t.ok((await title(page)) === NAME, `C21: the tab reads "${await title(page)}" at ${trail[i].hash}`);
    }
    for (let i = 1; i < trail.length; i++) {
      await travel(page, "forward");
      t.ok(await waitHash(page, trail[i].hash), `forward ${i}: at ${await hashOf(page)}, not ${trail[i].hash}`);
      await standsAt(trail[i].at, `forward to ${trail[i].hash}`);
    }
    t.ok(
      await page.evaluate(() => (globalThis as { walked?: boolean }).walked === true),
      "R29: the walk reloaded the page",
    );

    // ── Esc closes the side trips ──
    await page.keyboard.press("Escape");
    t.ok(await waitHash(page, `${S}/list/carriers`), `I5: Esc in a room left the address at ${await hashOf(page)}`);
    await standsAt("list-carriers", "Esc from a room");
    // The room's own way on, and the list's row again (C15), both close it too.
    t.ok(await press(page, `.list-row[data-key="${first.key}"]`), `no row for ${first.name} to press`);
    t.ok(await waitHash(page, roomHash), "the room did not reopen");
    t.ok(await press(page, `.list-row[data-key="${first.key}"]`), `no row for ${first.name} to press`);
    t.ok(
      await waitHash(page, `${S}/list/carriers`),
      `C15: the open row did not close its room (${await hashOf(page)})`,
    );

    // ── The credits: a plain file, its one link on the landing, every shipped source credited ──
    const credits = await page.evaluate(async (href: string) => {
      const r = await fetch(href);
      return { status: r.status, type: r.headers.get("content-type") ?? "", text: await r.text() };
    }, CREDITS);
    t.ok(
      credits.status === 200 && /^text\/plain/.test(credits.type),
      `${CREDITS} answers ${credits.status} ${credits.type}`,
    );
    const readme = readFileSync(resolve(ROOT, "README.md"), "utf8").replace(/\s+/g, " ");
    for (const [what, words] of Object.entries(CREDITS_WORDS)) {
      t.ok(credits.text.includes(words), `the credits lost the ${what}`);
      t.ok(readme.includes(words), `the credits' ${what} is not the README's, word for word`);
    }
    const shipped = [...record.data, ...record.fonts, ...record.models].filter((e) => e.shipped);
    const missing = shipped.filter((e) => !credits.text.includes(e.credit || e.name)).map((e) => e.name);
    t.ok(missing.length === 0, `the credits leave out ${missing.join(", ")}`);
    t.ok(
      credits.text.includes("PolyForm Noncommercial") && credits.text.includes("CC BY-NC-ND"),
      "the credits name no licence",
    );
    t.ok(!credits.text.includes("{{"), "the credits show a placeholder");

    // ── Page chrome, and the apparatus's own ground ──
    const chrome = await page.evaluate(() => {
      const html = getComputedStyle(document.documentElement);
      const probe = document.createElement("i");
      probe.style.background = "var(--v-rail)";
      document.body.append(probe);
      const rail = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return {
        body: getComputedStyle(document.body).transition,
        overscroll: html.overscrollBehaviorY,
        scroll: html.scrollBehavior,
        apparatus: getComputedStyle(document.querySelector(".frame-apparatus") as Element).backgroundColor,
        rail,
        theme: document.documentElement.dataset.theme ?? null,
      };
    });
    t.ok(
      /background-color 0\.18s/.test(chrome.body) && /color 0\.18s/.test(chrome.body),
      `K12: the body's transition is ${chrome.body}`,
    );
    t.ok(
      chrome.overscroll === "none" && chrome.scroll === "smooth",
      `K12: overscroll ${chrome.overscroll}, scroll ${chrome.scroll}`,
    );
    t.ok(
      chrome.apparatus === chrome.rail,
      `K13: the apparatus ground is ${chrome.apparatus}, the rail is ${chrome.rail}`,
    );
    t.ok(chrome.theme === null, "K11: a theme attribute is set with nothing asking for one");

    // ── Nothing stored: the walk leaves only reference data in the cache ──
    const kept = await page.evaluate(async () => {
      const cached: string[] = [];
      for (const name of await caches.keys())
        for (const req of await (await caches.open(name)).keys()) cached.push(new URL(req.url).pathname);
      return {
        local: localStorage.length,
        session: sessionStorage.length,
        cookie: document.cookie,
        dbs: (await indexedDB.databases()).length,
        cached,
      };
    });
    t.ok(
      kept.local === 0 && kept.session === 0 && kept.cookie === "" && kept.dbs === 0,
      `K11: something was stored (${JSON.stringify(kept)})`,
    );
    t.ok(
      kept.cached.every((p) => p.startsWith("/data/") && !p.includes("/samples/")),
      `the cache holds more than reference data: ${kept.cached.join(", ")}`,
    );
    errors.push(...seen);
    await page.close();

    // ── Deep links: each on a page of its own ──
    const fresh = async (hash: string, opts2: { dark?: boolean; query?: string } = {}) => {
      const opened = await openPage(browser, "desktop", { dark: opts2.dark });
      await opened.page.goto(`${server.url}/${opts2.query ?? ""}${hash}`, { waitUntil: "networkidle0" });
      await opened.page.evaluate(() => document.fonts.ready);
      await frames(opened.page);
      return opened;
    };
    {
      // A sample's room by name: the sample is read again and the room opens, the list beside it.
      const target = yours[2];
      const hash = `${S}/variant/${encodeURIComponent(target.name)}`;
      const o = await fresh(hash);
      const before = await historyLength(o.page);
      t.ok(await roomAtRest(o.page), "a deep link to a sample's room opened no room");
      t.ok((await hashOf(o.page)) === hash, `the deep link's address became ${await hashOf(o.page)}`);
      t.ok((await historyLength(o.page)) === before, "I6: arriving pushed an entry");
      t.ok(
        await has(o.page, `.list-row.is-current[data-key="${target.key}"]`),
        "the deep link's row is not the open one",
      );
      t.ok((await title(o.page)) === NAME, `C21: the deep link's tab reads "${await title(o.page)}"`);
      // The room's own way on leads to the next finding in the list's order, as a push.
      await o.page.evaluate(() => {
        const room = document.querySelector<HTMLElement>(".room");
        if (room) room.scrollTop = room.scrollHeight;
      });
      await sleep(500);
      t.ok(await act(o.page, /next variant/i), "the room's last panel offers no next variant");
      const next = `${S}/variant/${encodeURIComponent(yours[3].name)}`;
      t.ok(await waitHash(o.page, next), `NEXT VARIANT led to ${await hashOf(o.page)}, not ${next}`);
      t.ok((await historyLength(o.page)) === before + 1, "I6: NEXT VARIANT did not push one entry");
      errors.push(...o.errors);
      await o.page.close();
    }
    for (const [hash, lands, why] of [
      [`${S}/variant/NOPE-x1`, `${S}/list`, "R29: an unknown variant lands on the list"],
      [`${S}/carrier/NOPE-x1`, `${S}/list/carriers`, "R29: an unknown carrier lands on its list"],
      [`${S}/read/rare`, `${S}/read/rare`, "a sample's cut is a deep link"],
      [`${S}/list/carriers`, `${S}/list/carriers`, "a sample's list is a deep link"],
      ["#/list", "#/", "a file's list with no file lands on the landing"],
      ["#/variant/3", "#/", "a file's room with no file lands on the landing"],
      ["#/read/coding", "#/", "a file's cut with no file lands on the landing"],
      ["#/nowhere/at/all", "#/", "an unknown address lands on the landing"],
      ["#/sample/hg009/list", "#/", "an unknown sample lands on the landing"],
    ] as const) {
      const o = await fresh(hash);
      const before = await historyLength(o.page);
      t.ok(await waitHash(o.page, lands), `${why}: ${hash} is at ${await hashOf(o.page)}`);
      t.ok((await historyLength(o.page)) === before, `I6: ${hash} pushed an entry on arriving`);
      t.ok((await title(o.page)) === NAME, `C21: ${hash} is titled "${await title(o.page)}"`);
      if (lands === "#/") {
        // The address is not enough: the shell must stand on the landing too, its way in offered.
        const face = await o.page
          .waitForFunction(
            () =>
              document.querySelector(".shell")?.getAttribute("data-at") === "landing" &&
              !!document.querySelector(".landing-line button"),
            { timeout: 5000 },
          )
          .then(
            () => true,
            () => false,
          );
        t.ok(
          face,
          `${hash}: the address says landing but the page shows ${await o.page.evaluate(() => document.querySelector(".shell")?.getAttribute("data-at"))}`,
        );
      }
      if (lands.endsWith("/read/rare")) {
        const cls = await ledgerClasses(o.page);
        t.ok(cls.includes("rare") && !cls.includes("yours"), `${hash}: the ledger stands at ${cls.join(" ")}`);
      }
      errors.push(...o.errors);
      await o.page.close();
    }
    {
      // The genes page from the landing: the reference in a genome's place, and BACK with no entry of ours under it.
      const o = await fresh("#/genes");
      await o.page.waitForSelector(".ledger-host svg");
      await sleep(300);
      const cls = await ledgerClasses(o.page);
      t.ok(
        cls.includes("genes-page") && cls.includes("genes-ref"),
        `the landing's genes page stands at ${cls.join(" ")}`,
      );
      const caption = await o.page.evaluate(() => document.querySelector(".ledger-caption")?.textContent ?? "");
      t.ok(/reference genome/i.test(caption), `the landing's genes page is captioned "${caption}"`);
      t.ok(await act(o.page, /^\s*back\s*$/i), "the genes page has no BACK");
      t.ok(await waitHash(o.page, "#/"), `BACK from a deep-linked genes page led to ${await hashOf(o.page)}`);
      errors.push(...o.errors);
      await o.page.close();
    }
    {
      // A file that is not a genome: turned away on the landing, the address and the tab never the file's.
      const o = await fresh("#/");
      const beforeFile = await historyLength(o.page);
      // LOAD YOUR GENOME asks its question first; the answer opens the picker.
      const path = resolve(ROOT, "shots/not-a-genome.txt");
      writeFileSync(path, "rsid\tchromosome\tposition\tgenotype\nrs1\t1\t1000\tAA\n".repeat(50));
      t.ok(await act(o.page, /load your genome/i), "the landing offers no way to load a genome");
      const chooser = o.page.waitForFileChooser({ timeout: 8000 }).catch(() => null);
      t.ok(await actOnceThere(o.page, /include them/i), "the landing's question has no answer to give");
      const picker = await chooser;
      t.ok(!!picker, "answering the question opened no file picker");
      if (picker) {
        await picker.accept([path]);
        const refused = await o.page.waitForSelector('[data-face="refusal"]', { timeout: 20_000 }).then(
          () => true,
          () => false,
        );
        t.ok(refused, "a file that is not a genome was not turned away");
        t.ok((await hashOf(o.page)) === "#/", `a refused file left the address at ${await hashOf(o.page)}`);
        t.ok((await title(o.page)) === NAME, `C21: a refused file left the tab reading "${await title(o.page)}"`);
        t.ok((await historyLength(o.page)) === beforeFile, "a refused file left an entry in the history");
      }
      errors.push(...o.errors);
      await o.page.close();
    }
    {
      // K11: the ground follows the OS, and only a check's address pins it.
      const ground = (p: Page) => p.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
      const light = await fresh("#/");
      const dark = await fresh("#/", { dark: true });
      const pinned = await fresh("#/", { query: "?theme=dark" });
      const [l, d, p] = [await ground(light.page), await ground(dark.page), await ground(pinned.page)];
      t.ok(l !== d, `K11: the ground is ${l} whatever the OS prefers`);
      t.ok(p === d, `K11: ?theme=dark gives ${p}, the OS's dark gives ${d}`);
      t.ok(
        (await pinned.page.evaluate(() => document.documentElement.dataset.theme)) === "dark",
        "K11: ?theme=dark set no attribute",
      );
      t.ok(!(await has(pinned.page, "[data-theme-toggle], .theme-toggle")), "K11: a theme toggle is on the page");
      for (const o of [light, dark, pinned]) {
        errors.push(...o.errors);
        await o.page.close();
      }
    }
    if (opts.shots) {
      // The one view of the shell's that carries colour by itself: the list beside the ledger, on the dark ground.
      const o = await fresh(`${S}/list`, { dark: true });
      await o.page.waitForSelector(".list-row");
      await sleep(1600);
      await shot(o.page, "review/f/list-1440-dark");
      errors.push(...o.errors);
      await o.page.close();
    }

    // ── The built site, served with public/_headers: the policy holds and nothing it needs is refused ──
    {
      build();
      const config = readHeaders(readFileSync(resolve(ROOT, "public/_headers"), "utf8"));
      const host = await serveBuilt(resolve(ROOT, "dist"), config);
      try {
        const root = headersFor(config, "/");
        const policy = root["content-security-policy"] ?? "";
        for (const part of [
          "default-src 'self'",
          "font-src 'self'",
          "worker-src 'self'",
          "connect-src 'self'",
          "frame-ancestors 'none'",
        ])
          t.ok(policy.includes(part), `_headers: the policy lacks ${part}`);
        t.ok(!/https?:|\*/.test(policy), `_headers: the policy names another origin (${policy})`);
        t.ok(
          root["referrer-policy"] === "no-referrer",
          "_headers: pages are not sent with Referrer-Policy: no-referrer",
        );
        t.ok(
          /max-age=31536000/.test(root["strict-transport-security"] ?? ""),
          "_headers: pages are not sent with Strict-Transport-Security",
        );
        const immutable = /max-age=31536000, immutable/;
        t.ok(
          immutable.test(headersFor(config, "/fonts/SuisseIntl-Regular.woff2")["cache-control"] ?? ""),
          "_headers: fonts are not cached for good",
        );
        t.ok(
          headersFor(config, "/fonts/SuisseIntl-Regular.woff2")["content-type"] === "font/woff2",
          "_headers: fonts are not sent as font/woff2",
        );
        t.ok(
          immutable.test(headersFor(config, "/assets/main-abc123.js")["cache-control"] ?? ""),
          "_headers: hashed assets are not cached for good",
        );
        const pack = headersFor(config, "/data/chr1.pack");
        t.ok(
          pack["cache-control"] === "no-cache, no-transform" &&
            pack["content-type"] === "application/octet-stream" &&
            !pack["content-encoding"],
          `_headers: a pack is sent as ${JSON.stringify(pack)}`,
        );
        t.ok(
          headersFor(config, "/data/samples/hg002.json")["content-type"] === "application/json",
          "_headers: a sample is not sent as JSON",
        );

        const o = await openPage(browser, "phone", { touch: true });
        await o.page.evaluateOnNewDocument(
          'globalThis.refused = []; document.addEventListener("securitypolicyviolation", (e) => globalThis.refused.push(e.violatedDirective + " " + e.blockedURI));',
        );
        await visit(o.page, host.url, `${S}/list`);
        await o.page.waitForSelector(".list-row", { timeout: 15_000 }).catch(() => undefined);
        const built = await o.page.evaluate(() => ({
          rows: document.querySelectorAll(".list-row").length,
          face: document.fonts.check('13px "Suisse Intl"') && [...document.fonts].some((f) => f.status === "loaded"),
          q: getComputedStyle(document.documentElement).getPropertyValue("--station-q").trim(),
          strip: document.querySelector(".frame")?.getAttribute("data-strip"),
        }));
        t.ok(built.rows === yours.length, `the built site lists ${built.rows} variants, not ${yours.length}`);
        t.ok(built.face, "the built site's faces did not load under the policy");
        t.ok(
          built.q === "40px" && built.strip === "whole",
          `the built site's phone styles are out of order (station-q ${built.q}, strip ${built.strip})`,
        );
        await o.page.touchscreen.tap(60, 110);
        t.ok(await roomAtRest(o.page), "the built site opened no room");
        // LOAD YOUR GENOME starts the reader's worker: the policy must let it run.
        await visit(o.page, host.url, "#/");
        await o.page.reload({ waitUntil: "networkidle0" });
        t.ok(await actOnceThere(o.page, /load your genome/i, true), "the built landing offers no way to load a genome");
        await sleep(1500);
        const served = await o.page.evaluate(async (href: string) => (await fetch(href)).status, CREDITS);
        t.ok(served === 200, `the built site answers ${served} for ${CREDITS}`);
        const refused = await o.page.evaluate(() => (globalThis as { refused?: string[] }).refused ?? []);
        const blocked = o.errors.filter((e) => /Content Security Policy|Refused to/i.test(e));
        t.ok(
          refused.length === 0 && blocked.length === 0,
          `the policy refused something the page needs: ${[...refused, ...blocked].slice(0, 4).join(" | ")}`,
        );
        await o.page.close();
      } finally {
        host.stop();
      }
    }
    t.ok(errors.length === 0, `the page logged errors:\n${[...new Set(errors)].join("\n")}`);
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
  const r = await run({ shots: process.argv.includes("--shots") });
  console.log(r.detail);
  process.exitCode = r.ok ? 0 : 1;
}
