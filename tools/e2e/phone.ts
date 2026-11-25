// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// E4: the composed app on a phone, at 320 x 640 and 390 x 844: the strip rule on every page, no sideways scroll, tap to pair, and every room's column inside its pinned frame.

import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "puppeteer-core";
import { refUOf } from "../../src/app/room/P1pace";
import type { Finding, GenomeResult, P23Facts, SampleFile } from "../../src/contracts/app";
import { BREAKPOINT_PHONE, GENE_ROW_PITCH, PACING } from "../../src/contracts/constants";
import { context } from "../../src/copy/p23/model";
import { sample as frameAt } from "../../src/render/frames";
import { inkOf } from "../../src/render/ink";
import { setStageW, visual as V } from "../../src/render/tokens";
import { clockOf, variantEntry } from "../../src/render/variant";
import { P3_COLS, STRIP } from "../../src/styles/tokens";
import type { Result } from "../checks/_check";
import { openBrowser, openPage, serve, shot } from "./browser";
import { act, frames, hashOf, ROOT, rowsOf, SAMPLE, sample, sleep, tally, visit, waitHash } from "./shell";

const S = `#/sample/${SAMPLE}`;
const HARNESS = "/src/app/room/P23Harness.tsx";
const ASSERTS = "/src/app/room/P23Asserts.ts";
const SIZES = [
  { name: "320", w: 320, h: 640, short: true },
  { name: "390", w: 390, h: 844, short: false },
] as const;
type Size = (typeof SIZES)[number];

/** The room's stations on a phone, from its pinned frame's top: the values the phone pass settled. */
const STATIONS = {
  tall: { q: 40, c: 64, claim: 104, s: 192, r: 232, gap: 24, p1: 320, p2: 192, p3: 360, arrayTop: 16, ledgerGap: 24 },
  short: { q: 32, c: 56, claim: 104, s: 176, r: 216, gap: 16, p1: 320, p2: 192, p3: 336, arrayTop: 16, ledgerGap: 24 },
} as const;
/** P3's figure on a phone: 10 across, 10 down (its spacing is tuned by hand). */
const WALL = 20;
const CONTROLS_FOOT = 28;
/** From the ledger's last row to NEXT's words at the foot. */
const AIR_ABOVE_CONTROLS = 24;
const LABEL_UNDER_STRIP = 32;
const ROW = { list: STRIP.h, gene: GENE_ROW_PITCH } as const;
const TABS = { apart: 28, aboveRows: 24 } as const;
const AN_FADE_S = "0.32s";

const json = <T>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), "utf8")) as T;

/** How far anything on the page reaches past the screen's right edge. */
const sideways = (page: Page) =>
  page.evaluate(() =>
    Math.max(
      ...[
        document.documentElement,
        ...document.querySelectorAll(".frame, .frame-apparatus, .frame-specimen, .room"),
      ].map((el) => el.scrollWidth - el.clientWidth),
    ),
  );
const strip = (page: Page) => page.evaluate(() => document.querySelector(".frame")?.getAttribute("data-strip") ?? null);
/** A box, and where its text's baseline stands, both from the screen's top. */
const boxOf = (page: Page, selector: string) =>
  page.evaluate((s: string) => {
    const el = document.querySelector<HTMLElement>(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const probe = document.createElement("span");
    probe.style.cssText = "display:inline-block;width:0;height:0";
    el.append(probe);
    const baseline = probe.getBoundingClientRect().bottom;
    probe.remove();
    const range = document.createRange();
    range.selectNodeContents(el);
    const text = range.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      top: r.top,
      bottom: r.bottom,
      left: r.left,
      right: r.right,
      width: r.width,
      height: r.height,
      baseline,
      textTop: text.top,
      textBottom: text.bottom,
      textLeft: text.left,
      opacity: Number(cs.opacity),
      display: cs.display,
    };
  }, selector);
const tapAt = async (page: Page, x: number, y: number) => {
  await page.touchscreen.tap(x, y);
  await frames(page);
};
const tapOn = async (page: Page, selector: string): Promise<boolean> => {
  const at = await page.evaluate((s: string) => {
    const el = document.querySelector<HTMLElement>(s);
    if (!el) return null;
    el.scrollIntoView({ block: "nearest" });
    const r = el.getBoundingClientRect();
    return { x: r.left + Math.min(r.width / 2, 60), y: r.top + r.height / 2 };
  }, selector);
  if (!at) return false;
  await tapAt(page, at.x, at.y);
  return true;
};
/** The fold and the unfold take one clock; wait it out. */
const settle = (page: Page) => sleep(420).then(() => frames(page));

const near = (a: number | undefined | null, b: number, slack = 1) => typeof a === "number" && Math.abs(a - b) <= slack;

/** Every fixture drawing taller than P1's stage leaves under the ink's station, at a stage this wide. */
function spills(stageW: number, under: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const before = V.stageW;
  let serial = 0;
  setStageW(stageW);
  try {
    for (const file of readdirSync(resolve(ROOT, "test/fixtures")).filter((f) => f.endsWith(".result.json"))) {
      const r = json<GenomeResult>(`test/fixtures/${file}`);
      for (const f of [...r.yours, ...r.carriers]) {
        if (seen.has(f.key)) continue;
        seen.add(f.key);
        for (const d of f.facts.drawings) {
          const entry = variantEntry({ ...d, id: `fit${serial++}` });
          const clock = clockOf(entry);
          const top = inkOf(frameAt(entry, refUOf(`${d.lane}--${d.kind}`, clock) * clock.duration))?.top ?? 0;
          let low = 0;
          for (let k = 0; k <= 20; k++)
            low = Math.max(low, inkOf(frameAt(entry, (k / 20) * clock.duration))?.bottom ?? 0);
          if (low - top > under + 0.5)
            out.push(`${f.facts.gene} ${f.name} [${d.lane}--${d.kind}] by ${Math.round(low - top - under)} px`);
        }
      }
    }
  } finally {
    setStageW(before);
  }
  return out;
}

/** The P2 and P3 pool of cases: every fixture finding, the lab's variants, the copy-number cases. */
function pool(): P23Facts[] {
  const lab = json<{ yours: P23Facts[]; sampled: P23Facts[] }>("src/copy/json/sources/lab-facts.json");
  const cnv = json<{ cases: P23Facts[] }>("src/copy/json/sources/cnv-cases.json").cases;
  const fixtures = ["hg002", "hg001", "x-one"].flatMap((name) => {
    const r = json<GenomeResult>(`test/fixtures/${name}.result.json`);
    return [...r.yours, ...r.carriers].map((f: Finding) => f.p23);
  });
  return [...fixtures, ...lab.yours, ...lab.sampled, ...cnv];
}

export async function run(opts: { shots: boolean }): Promise<Result> {
  if (opts.shots) mkdirSync(resolve(ROOT, "shots/review/f"), { recursive: true });
  const t = tally();
  const notes: string[] = [];
  const result = sample();
  const yours = rowsOf(result, "yours");
  const server = await serve("dev");
  const { browser, close } = await openBrowser();
  const errors: string[] = [];
  const snap = async (page: Page, name: string, size: Size) => {
    // The narrowest screen is asserted, never shot.
    if (opts.shots && !size.short) await shot(page, `review/f/${name}-${size.name}`);
  };
  const open = async (size: Size, hash: string, still = false) => {
    const o = await openPage(browser, [size.w, size.h], { touch: true });
    await o.page.emulateMediaFeatures([
      { name: "prefers-color-scheme", value: "light" },
      { name: "prefers-reduced-motion", value: still ? "reduce" : "no-preference" },
    ]);
    // The script runner names inner functions through a helper the page does not have.
    await o.page.evaluateOnNewDocument("globalThis.__name = (f) => f");
    await visit(o.page, server.url, hash);
    return o;
  };
  const flat = async (page: Page, size: Size, where: string) => {
    const over = await sideways(page);
    t.ok(over <= 0.5, `${size.name} ${where}: the page reaches ${over} px past the screen's edge`);
  };

  try {
    for (const size of SIZES) {
      const at = size.name;
      const want = size.short ? STATIONS.short : STATIONS.tall;

      // ── The descent: the strip holds the cut it is on; the ledger is the specimen under it ──
      {
        const { page, errors: seen } = await open(size, "#/");
        await flat(page, size, "landing");
        await snap(page, "landing", size);
        t.ok(await act(page, /view a sample/i, true), `${at}: the landing offers no sample`);
        t.ok(await waitHash(page, `${S}/read/all`, 40_000), `${at}: the read ended at ${await hashOf(page)}`);
        await sleep(2200);
        await flat(page, size, "the first count");
        // The band (2026-11-21): no fold. YOUR VARIANTS, the cut's count and its line, sized to every cut's
        // longest line, so neither it nor the ledger moves as the descent steps; NEXT alone at the screen's foot.
        t.ok((await strip(page)) === "band", `${at} M1: the descent's strip is ${await strip(page)}, not the band`);
        const shown = () =>
          page.evaluate(
            () =>
              [...document.querySelectorAll<HTMLElement>(".tally-cut")].filter(
                (li) => getComputedStyle(li).visibility === "visible" && li.getBoundingClientRect().height > 1,
              ).length,
          );
        t.ok((await shown()) === 1, `${at} M1: the band shows ${await shown()} cuts`);
        const band = await boxOf(page, ".frame-apparatus");
        t.ok(near(band?.top, 0) && near(band?.width, size.w), `${at} M1: the band is not across the top`);
        t.ok(!(await boxOf(page, ".strip-chev"))?.width, `${at} M8: a chevron shows over the descent`);
        t.ok(!(await boxOf(page, ".tally-back")), `${at}: a BACK stands in the descent`);

        // One left edge: YOUR VARIANTS, its count, YOUR GENOME and the tracks on the wall; no row numbers, no footnote.
        const caption = await boxOf(page, ".tally-caption");
        const count = await boxOf(page, ".tally-cut.now .tally-n");
        const label = await boxOf(page, ".ledger-caption");
        const drawn = await page.evaluate(() => {
          const svg = document.querySelector(".ledger-host svg");
          const bars = [...(svg?.querySelectorAll<SVGGraphicsElement>(".row .base") ?? [])]
            .map((b) => b.getBoundingClientRect())
            .filter((r) => r.height > 0);
          const numbers = [...(svg?.querySelectorAll(".chr") ?? [])].filter(
            (n) => getComputedStyle(n).display !== "none",
          );
          return bars.length
            ? {
                left: bars[0].left,
                first: (bars[0].top + bars[0].bottom) / 2,
                last: Math.max(...bars.map((r) => r.bottom)),
                numbers: numbers.length,
              }
            : null;
        });
        for (const [what, x] of [
          ["YOUR VARIANTS", caption?.textLeft],
          ["the count", count?.textLeft],
          ["YOUR GENOME", label?.textLeft],
          ["the tracks", drawn?.left],
        ] as const)
          t.ok(near(x, WALL, 1.5), `${at}: ${what} starts at ${x}, not on the wall`);
        t.ok(drawn?.numbers === 0, `${at}: ${drawn?.numbers} row numbers show on a phone`);
        // YOUR VARIANTS over its count as YOUR GENOME over row 1, centre to centre.
        const middle = ((count?.textTop ?? 0) + (count?.textBottom ?? 0)) / 2;
        const pairs = [middle - (caption?.textTop ?? 0), (drawn?.first ?? 0) - (label?.textTop ?? 0)];
        t.ok(near(pairs[0], pairs[1], 3), `${at}: YOUR VARIANTS stands ${pairs[0]} over its count, YOUR GENOME ${pairs[1]} over row 1`); // prettier-ignore

        // M10: the label 32 under the band; NEXT at the foot; the ledger clear of it.
        t.ok(
          near((label?.textTop ?? 0) - (band?.bottom ?? 0), LABEL_UNDER_STRIP, 2),
          `${at} M10: the specimen's label is ${(label?.textTop ?? 0) - (band?.bottom ?? 0)} px under the band`,
        );
        const next = await boxOf(page, ".tally-next .tally-words");
        t.ok(
          near(next?.bottom, size.h - CONTROLS_FOOT, 1.5) && near(next?.right, size.w - WALL - 16, 16),
          `${at} M10: NEXT ends at ${next?.right}, ${next?.bottom}`,
        );
        const air = (next?.top ?? 0) - (drawn?.last ?? 0);
        t.ok(air >= AIR_ABOVE_CONTROLS - 0.5, `${at} M10: the ledger ends ${air} px above NEXT`);
        const grounds = await page.evaluate(() => {
          const probe = document.createElement("i");
          probe.style.background = "var(--v-rail)";
          document.body.append(probe);
          const rail = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return {
            rail,
            band: getComputedStyle(document.querySelector(".frame-apparatus") as Element).backgroundColor,
          };
        });
        t.ok(grounds.band === grounds.rail, `${at} K13: the band's ground is ${grounds.band}`);
        await snap(page, "descent", size);

        // A step moves nothing: the band and the ledger stand where they stood.
        t.ok(await act(page, /^\s*next/i, true), `${at}: no NEXT at the foot`);
        t.ok(await waitHash(page, `${S}/read/coding`), `${at}: NEXT led to ${await hashOf(page)}`);
        await sleep(1400);
        const stepped = await boxOf(page, ".frame-apparatus");
        const label2 = await boxOf(page, ".ledger-caption");
        t.ok(
          near(stepped?.height, band?.height ?? 0, 0.5) && near(label2?.textTop, label?.textTop ?? 0, 0.5),
          `${at}: a step moved the band (${band?.height} to ${stepped?.height}) or the ledger`,
        );
        t.ok((await shown()) === 1, `${at} M1: after a step the band shows ${await shown()} cuts`);
        // The second cut's genes count is the way to the genes page, where the footnote would be.
        t.ok(await tapOn(page, ".tally-cut.now .tally-genes"), `${at}: the second cut's genes count is not a link`);
        t.ok(await waitHash(page, "#/genes"), `${at}: the genes count led to ${await hashOf(page)}`);
        await page.goBack();
        t.ok(await waitHash(page, `${S}/read/coding`), `${at}: back from the genes page led to ${await hashOf(page)}`);
        errors.push(...seen);
        await page.close();
      }

      // ── The list: nothing chosen, so the apparatus is the whole screen; a row tap folds it onto the row ──
      {
        const { page, errors: seen } = await open(size, `${S}/list`);
        await page.waitForSelector(".list-row");
        await sleep(600);
        t.ok(
          (await strip(page)) === "whole",
          `${at} M1: the list on arrival is ${await strip(page)}, not the whole screen`,
        );
        const band = await boxOf(page, ".frame-apparatus");
        t.ok(
          near(band?.height, size.h),
          `${at} M1: the unfolded apparatus is ${band?.height} px tall on a ${size.h} px screen`,
        );
        t.ok(
          (await boxOf(page, ".strip-chev"))?.display === "none",
          `${at} M8: a chevron shows with nothing to fold to`,
        );
        // Read on the first caption itself: the two may take two lines on the narrowest screen.
        const captions = await boxOf(page, ".list-tab");
        t.ok(
          near((captions?.baseline ?? 0) - (band?.top ?? 0), STRIP.base),
          `${at} M4: the caption's baseline is ${(captions?.baseline ?? 0) - (band?.top ?? 0)} px down`,
        );
        const list = await page.evaluate(() => {
          const rows = [...document.querySelectorAll<HTMLElement>(".list-row")].slice(0, 6).map((r) => {
            const box = r.getBoundingClientRect();
            const probe = document.createElement("span");
            probe.style.cssText = "display:inline-block;width:0;height:0";
            r.querySelector(".list-gene")?.append(probe);
            const baseline = probe.getBoundingClientRect().bottom - box.top;
            probe.remove();
            return { top: box.top, height: box.height, baseline };
          });
          const tabs = [...document.querySelectorAll<HTMLElement>(".list-tab")].map((b) => {
            const range = document.createRange();
            range.selectNodeContents(b);
            const r = range.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
          });
          return { rows, tabs, sentence: !!document.querySelector(".list-sentence")?.getClientRects().length };
        });
        t.ok(
          list.rows.every((r) => near(r.height, ROW.list, 0.5)),
          `${at} M11: list rows are ${list.rows.map((r) => r.height).join(", ")} px tall`,
        );
        t.ok(
          list.rows.every((r) => near(r.baseline, STRIP.base)),
          `${at} M4: rows' baselines are ${list.rows.map((r) => r.baseline).join(", ")} px down`,
        );
        const [a, b] = list.tabs;
        if (a && b && near(a.top, b.top, 2))
          t.ok(near(b.left - a.right, TABS.apart, 2.5), `${at} M11: the captions are ${b.left - a.right} px apart`);
        else notes.push(`${at}: the two captions take two lines at this width`);
        const tabsBottom = Math.max(...list.tabs.map((x) => x.bottom));
        t.ok(
          near((list.rows[0]?.top ?? 0) - tabsBottom, TABS.aboveRows, 2.5),
          `${at} M11: the captions end ${(list.rows[0]?.top ?? 0) - tabsBottom} px above the rows`,
        );
        t.ok(list.sentence, `${at}: the list's sentence is missing from the whole-screen list`);

        // The desktop's column, the screen tall (2026-11-21): the rows page between the captions and the sentence.
        const paged = () =>
          page.evaluate(() => {
            const rows = document.querySelector<HTMLElement>(".list-rows");
            const port = rows?.getBoundingClientRect();
            const whole = [...document.querySelectorAll<HTMLElement>(".list-row")].filter((r) => {
              const b = r.getBoundingClientRect();
              return port && b.top >= port.top - 0.5 && b.bottom <= port.bottom + 0.5;
            });
            return {
              shown: whole.length,
              more: document.querySelector(".list-more")?.textContent ?? null,
              captions: document.querySelector(".list-captions")?.getBoundingClientRect().top ?? -1,
              sentence: document.querySelector(".list-sentence")?.getBoundingClientRect().bottom ?? -1,
              tall: document.querySelector(".frame-apparatus")?.scrollHeight ?? 0,
            };
          });
        const top = await paged();
        t.ok(top.tall <= size.h + 1, `${at}: the list is ${top.tall} px tall on a ${size.h} px screen`);
        t.ok(top.sentence <= size.h, `${at}: the list's sentence ends at ${top.sentence}, below the screen`);
        t.ok(
          top.more === `+${yours.length - top.shown} more`,
          `${at} C8: "+N more" reads "${top.more}" with ${top.shown} of ${yours.length} rows shown`,
        );
        await tapOn(page, ".list-more");
        await sleep(800);
        const down = await paged();
        // A page keeps the last row seen as the first: the count below drops by a page less one.
        const below = yours.length - top.shown - (top.shown - 1);
        t.ok(
          down.more === (below > 0 ? `+${below} more` : "Back to top"),
          `${at} C8: after a page down "+N more" reads "${down.more}"`,
        );
        t.ok(
          near(down.captions, top.captions, 0.5) && near(down.sentence, top.sentence, 0.5),
          `${at}: the captions or the sentence moved as the rows paged`,
        );
        await page.evaluate(() => document.querySelector(".list-rows")?.scrollTo({ top: 0 }));
        await sleep(400);
        await flat(page, size, "the list");
        await snap(page, "list", size);

        // M5: nothing slides. The band, its captions and rows take their size at once; the list fades in on the
        // arrival's clock as the strip stands whole.
        const sizes = await page.evaluate(() =>
          [".frame-apparatus", ".list-row", ".list-captions"]
            .map((s) => `${s} ${getComputedStyle(document.querySelector(s) as Element).transitionProperty}`)
            .filter((c) => /size|height|margin/.test(c)),
        );
        t.ok(sizes.length === 0, `${at} M5: a size still moves on a clock: ${sizes.join("; ")}`);
        const fade = await page.evaluate(() => {
          const body = getComputedStyle(document.querySelector(".list-body") as Element);
          return `${body.animationName} ${body.animationDuration}`;
        });
        t.ok(
          fade === `list-arrive ${AN_FADE_S}`,
          `${at} M5: the unfolded list arrives as ${fade}, not a ${AN_FADE_S} fade`,
        );

        // M6: one motion onto the tapped row.
        const target = yours[2];
        const roomHash = `${S}/variant/${encodeURIComponent(target.name)}`;
        t.ok(await tapOn(page, `.list-row[data-key="${target.key}"]`), `${at}: no row to tap`);
        t.ok(await waitHash(page, roomHash), `${at} M6: the tap led to ${await hashOf(page)}`);
        await settle(page);
        t.ok((await strip(page)) === "closed", `${at} M6: the strip is ${await strip(page)} after a row tap`);
        const folded = await page.evaluate((key: string) => {
          const band = document.querySelector(".frame-apparatus")?.getBoundingClientRect();
          const rows = [...document.querySelectorAll<HTMLElement>(".list-row")];
          const row = rows.find((r) => r.dataset.key === key);
          const probe = document.createElement("span");
          probe.style.cssText = "display:inline-block;width:0;height:0";
          row?.querySelector(".list-gene")?.append(probe);
          const baseline = probe.getBoundingClientRect().bottom;
          probe.remove();
          return {
            band: band?.height,
            rowTop: row?.getBoundingClientRect().top,
            baseline,
            others: rows.filter((r) => r !== row && r.getBoundingClientRect().height > 0.5).length,
            captions: document.querySelector(".list-captions")?.getBoundingClientRect().height,
          };
        }, target.key);
        t.ok(near(folded.band, STRIP.h), `${at} M4: the folded strip is ${folded.band} px tall`);
        t.ok(
          near(folded.rowTop, 0) && near(folded.baseline, STRIP.base),
          `${at} M4, M6: the folded row stands at ${folded.rowTop}, its baseline ${folded.baseline} px down, not where the caption sat`,
        );
        t.ok(
          folded.others === 0 && near(folded.captions, 0),
          `${at} M6: ${folded.others} other rows and ${folded.captions} px of caption still stand`,
        );

        // The room under the strip: the full width, no bezel, its frame the screen less the strip.
        await page.waitForFunction(() => document.querySelector(".room")?.getAttribute("data-phase") === "rest", {
          timeout: 15_000,
        });
        const room = await page.evaluate(() => {
          const el = document.querySelector<HTMLElement>(".room");
          const cs = getComputedStyle(document.documentElement);
          const px = (n: string) => parseFloat(cs.getPropertyValue(n));
          return {
            h: el?.clientHeight,
            top: el?.getBoundingClientRect().top,
            stage: document.querySelector(".stage-p1")?.getBoundingClientRect().width,
            bezel: getComputedStyle(document.querySelector(".bezel-anchor") as Element).display,
            tokens: {
              q: px("--station-q"),
              c: px("--station-c"),
              claim: px("--claim-zone"),
              s: px("--station-s"),
              r: px("--station-r"),
              gap: px("--gap-below"),
              p1: px("--stage-h-p1"),
              p2: px("--stage-h-p2"),
              p3: px("--stage-h-p3"),
              arrayTop: px("--p3-array-top"),
              ledgerGap: px("--p3-ledger-gap"),
            },
            cols: px("--p3-cols"),
            wall: px("--wall"),
          };
        });
        t.ok(
          near(room.h, size.h - STRIP.h) && near(room.top, STRIP.h),
          `${at}: the room's frame is ${room.h} px from ${room.top}, not the screen under the strip`,
        );
        t.ok(
          near(room.stage, size.w - 2 * WALL) && room.wall === WALL,
          `${at} M3: the stage is ${room.stage} px wide, the wall ${room.wall}`,
        );
        t.ok(room.bezel === "none", `${at} M9: the bezel shows on a phone`);
        t.ok(
          JSON.stringify(room.tokens) === JSON.stringify(want) && room.cols === P3_COLS.phone,
          `${at} M3: the stations are ${JSON.stringify(room.tokens)}, ${room.cols} columns`,
        );
        await flat(page, size, "a room");
        await sleep(500);
        await snap(page, "room", size);

        // I7 (2026-11-21): over a room, the folded row leads to the list itself, the screen tall as from the descent;
        // another row there folds onto its room.
        const inRoom = await hashOf(page);
        await tapAt(page, 60, STRIP.base);
        t.ok(await waitHash(page, `${S}/list`), `${at} I7: the folded row led to ${await hashOf(page)}, not the list`);
        await settle(page);
        t.ok((await strip(page)) === "whole", `${at} I7: the list from a room is ${await strip(page)}, not whole`);
        const listed = await boxOf(page, ".frame-apparatus");
        t.ok(near(listed?.height, size.h), `${at} I7: the list from a room is ${listed?.height} px tall`);
        t.ok(!!(await boxOf(page, ".list-more")), `${at} I7: the list from a room does not page`);
        await snap(page, "room-to-list", size);
        await page.goBack();
        t.ok(await waitHash(page, inRoom), `${at} I7: Back from that list led to ${await hashOf(page)}`);
        await settle(page);
        await tapOn(page, ".strip-chev");
        t.ok(await waitHash(page, `${S}/list`), `${at} M8: the chevron over a room led to ${await hashOf(page)}`);
        await settle(page);
        const other = yours[0];
        t.ok(await tapOn(page, `.list-row[data-key="${other.key}"]`), `${at}: no other row to tap`);
        t.ok(
          await waitHash(page, `${S}/variant/${encodeURIComponent(other.name)}`),
          `${at} I7: another row led to ${await hashOf(page)}`,
        );
        await settle(page);
        t.ok(
          (await strip(page)) === "closed",
          `${at} I7: the strip is ${await strip(page)} after choosing another row`,
        );
        await page.waitForFunction(() => document.querySelector(".room")?.getAttribute("data-phase") === "rest", {
          timeout: 15_000,
        });

        // Tap to pair: a tap on a P2 ledger row pairs it with its bar; a tap elsewhere lets go. The row is the
        // one for the bar the reader is on, which is the only row a short screen shows.
        const paired = await page.evaluate(async (pace: number) => {
          const two = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
          const room = document.querySelector<HTMLElement>(".room");
          const p2 = document.querySelector<HTMLElement>(".panel-p2");
          if (!room || !p2) return null;
          room.scrollTop = p2.offsetTop + room.clientHeight * pace + 4;
          await two();
          await new Promise((r) => setTimeout(r, 700));
          const row = p2.querySelector<HTMLElement>(".p2-row[data-now]");
          const r = row?.getBoundingClientRect();
          return row && r
            ? {
                id: row.dataset.pair,
                x: r.left + 40,
                y: r.top + r.height / 2,
                visible: r.bottom <= room.getBoundingClientRect().bottom,
              }
            : null;
        }, PACING.PACE);
        t.ok(!!paired, `${at}: P2 has no ledger row to tap`);
        if (paired) {
          await tapAt(page, paired.x, paired.y);
          await sleep(200);
          const got = await page.evaluate(
            () => document.querySelector<HTMLElement>('[data-panel="p2"]')?.dataset.paired ?? null,
          );
          t.ok(got === paired.id, `${at} tap to pair: tapping ${paired.id}'s row paired ${got}`);
          const lit = await page.evaluate(
            (id: string) => !!document.querySelector(`.p2-chart [data-pair="${id}"][data-lit]`),
            paired.id ?? "",
          );
          t.ok(lit, `${at} tap to pair: ${paired.id}'s mark in the chart is not lit`);
          await snap(page, "p2-paired", size);
          const q = await boxOf(page, ".panel-p2 .q-text");
          await tapAt(page, (q?.left ?? 20) + 10, ((q?.top ?? 0) + (q?.bottom ?? 0)) / 2);
          await sleep(200);
          const after = await page.evaluate(
            () => document.querySelector<HTMLElement>('[data-panel="p2"]')?.dataset.paired ?? null,
          );
          t.ok(after === null, `${at} tap to pair: a tap elsewhere left ${after} paired`);
        }
        await flat(page, size, "P2");
        errors.push(...seen);
        await page.close();
      }

      // ── The genes page: standing whole as the list does, its rows paging under the caption, the sentence and
      //    BACK at the foot ──
      {
        const { page, errors: seen } = await open(size, "#/genes");
        await page.waitForSelector(".genes-row");
        await sleep(500);
        t.ok((await strip(page)) === "whole", `${at} M1: the genes page's strip is ${await strip(page)}`);
        const band = await boxOf(page, ".frame-apparatus");
        t.ok(near(band?.height, size.h), `${at}: the genes page stands ${band?.height} px tall, not the screen`);
        const genes = await page.evaluate(() => {
          const rows = [...document.querySelectorAll<HTMLElement>(".genes-row")];
          const p = document.querySelector<HTMLElement>(".genes-rows")?.getBoundingClientRect();
          const shown = rows.filter((r) => {
            if (!p) return false;
            const b = r.getBoundingClientRect();
            return b.top >= p.top - 0.5 && b.bottom <= p.bottom + 0.5;
          });
          return {
            heights: [...new Set(rows.slice(0, 12).map((r) => Math.round(r.getBoundingClientRect().height * 10) / 10))],
            rows: rows.length,
            shown: shown.length,
            first: shown[0]?.dataset.gene ?? "",
          };
        });
        t.ok(
          genes.heights.length === 1 && genes.heights[0] === ROW.gene,
          `${at} M11: gene rows are ${genes.heights.join(", ")} px tall`,
        );
        t.ok(
          genes.shown > 4 && genes.shown < genes.rows,
          `${at}: the gene list shows ${genes.shown} of ${genes.rows} rows, not a page of them`,
        );
        const more = await boxOf(page, ".genes-more");
        const sentence = await boxOf(page, ".genes-sentence");
        const back = await boxOf(page, ".genes-back");
        t.ok(!!more?.height, `${at}: no "+N more" under the genes`);
        t.ok(
          !!more && !!sentence && !!back && sentence.top > more.bottom && back.top > sentence.bottom,
          `${at}: the sentence and BACK are not at the foot, under the rows`,
        );
        t.ok(!!back && back.bottom <= size.h, `${at}: BACK stands below the screen (${back?.bottom})`);
        await flat(page, size, "the genes page");
        await snap(page, "genes", size);
        t.ok(await tapOn(page, ".genes-more"), `${at}: no "+N more" to tap`);
        await settle(page);
        const paged = await page.evaluate(() => {
          const top = document.querySelector<HTMLElement>(".genes-rows")?.getBoundingClientRect().top ?? 0;
          return [...document.querySelectorAll<HTMLElement>(".genes-row")].find(
            (r) => r.getBoundingClientRect().top >= top - 0.5,
          )?.dataset.gene;
        });
        t.ok(!!paged && paged !== genes.first, `${at}: "+N more" left the first gene at ${paged}`);
        t.ok(await act(page, /^\s*back\s*$/i, true), `${at}: the genes page has no BACK to tap`);
        t.ok(await waitHash(page, "#/"), `${at}: BACK on the genes page led to ${await hashOf(page)}`);
        errors.push(...seen);
        await page.close();
      }

      // ── The phone pass: every sample room's column inside its pinned frame ──
      {
        const { page, errors: seen } = await open(size, `${S}/list`, true);
        let rooms = 0;
        const over: string[] = [];
        for (const id of [SAMPLE, "hg001"]) {
          const r = json<SampleFile>(`public/data/samples/${id}.json`).result;
          for (const which of ["yours", "carriers"] as const) {
            for (const row of rowsOf(r, which)) {
              const hash = `#/sample/${id}/${which === "yours" ? "variant" : "carrier"}/${encodeURIComponent(row.name)}`;
              await page.evaluate((h: string) => {
                location.hash = h;
              }, hash);
              await page.waitForFunction(
                (key: string) =>
                  document.querySelector(".list-row.is-current")?.getAttribute("data-key") === key &&
                  document.querySelector(".room")?.getAttribute("data-phase") === "rest" &&
                  !!document.querySelector(".p1-host svg"),
                { timeout: 15_000 },
                row.key,
              );
              await frames(page);
              const m = await page.evaluate(
                async (pace: number, assertsAt: string) => {
                  const two = () =>
                    new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
                  const { p23Asserts } = (await import(assertsAt)) as { p23Asserts(root: ParentNode): string[] };
                  const room = document.querySelector<HTMLElement>(".room") as HTMLElement;
                  const foot = room.getBoundingClientRect().bottom;
                  const H = room.clientHeight;
                  const spill = document.querySelector<HTMLElement>(".stage-p1")?.dataset.overflow ?? "";
                  const stage = document.querySelector(".stage-p1")?.getBoundingClientRect().bottom ?? 0;
                  const cue = document.querySelector(".room-cue")?.getBoundingClientRect().bottom ?? 0;
                  const p2 = document.querySelector<HTMLElement>(".panel-p2") as HTMLElement;
                  room.scrollTop = p2.offsetTop + H * pace + 4;
                  await two();
                  const rows = [...p2.querySelectorAll<HTMLElement>(".p2-row")];
                  const p2Bottom = Math.max(0, ...rows.map((r) => r.getBoundingClientRect().bottom));
                  const problems = p23Asserts(p2);
                  const p3 = document.querySelector<HTMLElement>(".panel-p3") as HTMLElement;
                  room.scrollTop = room.scrollHeight;
                  await two();
                  problems.push(...p23Asserts(p3));
                  const next = p3.querySelector(".room-next")?.getBoundingClientRect().bottom ?? 0;
                  const p3Rows = Math.max(
                    0,
                    ...[...p3.querySelectorAll(".p3-row")].map((r) => r.getBoundingClientRect().bottom),
                  );
                  room.scrollTop = 0;
                  return {
                    spill,
                    stage: stage - foot,
                    cue: cue - foot,
                    p2On: rows.every((r) => r.hasAttribute("data-on")),
                    p2: p2Bottom - foot,
                    p3: p3Rows ? p3Rows - foot : 0,
                    next: next - foot,
                    problems,
                  };
                },
                PACING.PACE,
                ASSERTS,
              );
              rooms++;
              t.ok(m.spill === "", `${at} ${row.name}: P1's drawing spills out of its stage (${m.spill})`);
              t.ok(
                m.stage <= 0.5 && m.cue <= 0.5,
                `${at} ${row.name}: P1's stage ends ${m.stage} px and its cue ${m.cue} px below the frame`,
              );
              t.ok(m.p2On, `${at} ${row.name}: a P2 ledger row is missing at the end of its scrub`);
              t.ok(m.next <= 0.5, `${at} ${row.name}: the way on ends ${m.next} px below the frame`);
              t.ok(m.p3 <= 0.5, `${at} ${row.name}: P3's rows end ${m.p3} px below the frame`);
              t.ok(m.problems.length === 0, `${at} ${row.name}: ${m.problems.slice(0, 3).join("; ")}`);
              if (m.p2 > 0.5) over.push(`${row.name} by ${Math.round(m.p2)}`);
            }
          }
        }
        t.ok(
          over.length === 0,
          `${at}: P2's ledger runs below the frame in ${over.length} of ${rooms} sample rooms: ${over.slice(0, 5).join(", ")}`,
        );
        notes.push(`${at}: ${rooms} sample rooms walked`);
        errors.push(...seen);
        await page.close();
      }

      // ── The same for the whole P2 and P3 pool, P3's figure with it: its harness under the shell's styles, at the room's size ──
      {
        const o = await openPage(browser, [size.w, size.h - STRIP.h], { touch: true });
        await o.page.emulateMediaFeatures([
          { name: "prefers-color-scheme", value: "light" },
          { name: "prefers-reduced-motion", value: "reduce" },
        ]);
        await o.page.evaluateOnNewDocument("globalThis.__name = (f) => f");
        // The harness's room is the whole screen, so the screen is the room's size under the strip. The landing
        // loads the shell's styles and draws nothing the harness would have to clear.
        await visit(o.page, server.url, "#/");
        const facts = pool();
        const stats = {
          p2: 0,
          p2Over: 0,
          p3Over: 0,
          p2Worst: -Infinity,
          figures: 0,
          p3Worst: -Infinity,
          problems: [] as string[],
        };
        for (const [i, f] of facts.entries()) {
          for (const panel of ["p2", "p3"] as const) {
            const figure = context(f).p3 === "figure";
            if (panel === "p3" && !figure) continue;
            const m = await o.page.evaluate(
              async (harnessAt: string, f2: P23Facts, panel2: "p2" | "p3") => {
                const two = () =>
                  new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 20))));
                const { harness } = (await import(harnessAt)) as typeof import("../../src/app/room/P23Harness");
                harness.mount(f2, panel2);
                await two();
                harness.seek(panel2, harness.beats(panel2) - 1);
                await two();
                await two();
                const el = document.querySelector<HTMLElement>(`[data-panel="${panel2}"]`) as HTMLElement;
                const foot = (el.closest("[data-harness-room]") as HTMLElement).getBoundingClientRect().bottom;
                const rows = [...el.querySelectorAll<HTMLElement>(".p23-row")];
                return {
                  on: rows.every((r) => r.hasAttribute("data-on")),
                  bottom: Math.max(0, ...rows.map((r) => r.getBoundingClientRect().bottom)) - foot,
                  problems: harness.asserts(),
                };
              },
              HARNESS,
              f,
              panel,
            );
            if (m.problems.length) stats.problems.push(`${panel} case ${i}: ${m.problems[0]}`);
            t.ok(m.on, `${at} ${panel} case ${i}: a ledger row is missing at the last beat`);
            if (panel === "p2") {
              stats.p2++;
              stats.p2Worst = Math.max(stats.p2Worst, m.bottom);
              if (m.bottom > 0.5) stats.p2Over++;
            } else {
              stats.figures++;
              stats.p3Worst = Math.max(stats.p3Worst, m.bottom);
              // The 10 x 10 figure's rows are noted, not failed, on a phone: that spacing is tuned by hand.
              if (m.bottom > 0.5) stats.p3Over++;
            }
          }
        }
        t.ok(stats.problems.length === 0, `${at}: the pool's own asserts: ${stats.problems.slice(0, 4).join(" | ")}`);
        t.ok(stats.figures > 0, `${at}: the pool holds no P3 figure`);
        t.ok(
          stats.p2Over === 0,
          `${at}: over the pool P2's ledger runs below the frame in ${stats.p2Over} of ${stats.p2} cases, by up to ${stats.p2Worst} px`,
        );
        notes.push(
          `${at}: over the pool's ${stats.p2} cases P2's ledger fits in all (${Math.round(-stats.p2Worst)} px to spare); P3's figure runs below the frame in ${stats.p3Over} of ${stats.figures} (by up to ${Math.round(stats.p3Worst)} px), awaiting a spacing pass by hand`,
        );
        errors.push(...o.errors);
        await o.page.close();
      }

      // P1's tallest drawing fits its stage, at this screen's stage width.
      const spilt = spills(size.w - 2 * WALL, want.p1 - (want.r - want.s));
      t.ok(
        spilt.length === 0,
        `${at}: ${spilt.length} fixture drawings are taller than P1's stage leaves them: ${spilt.slice(0, 5).join(", ")}`,
      );
    }

    // M2: one breakpoint. At 600 the apparatus is the strip; at 601 it is the column beside the specimen.
    for (const [w, strips] of [
      [BREAKPOINT_PHONE, true],
      [BREAKPOINT_PHONE + 1, false],
    ] as const) {
      const o = await openPage(browser, [w, 800]);
      await visit(o.page, server.url, "#/genes");
      await o.page.waitForSelector(".frame-apparatus");
      const band = await boxOf(o.page, ".frame-apparatus");
      t.ok(
        strips ? near(band?.width, w) : (band?.width ?? w) < w / 2 + 100,
        `M2: at ${w} px the apparatus is ${band?.width} px wide`,
      );
      t.ok(((await strip(o.page)) !== null) === strips, `M2: at ${w} px the strip state is ${await strip(o.page)}`);
      errors.push(...o.errors);
      await o.page.close();
    }
    t.ok(errors.length === 0, `the page logged errors:\n${[...new Set(errors)].slice(0, 6).join("\n")}`);
  } finally {
    await close();
    server.stop();
  }
  return {
    ok: t.failures.length === 0,
    detail: [...t.failures, ...notes, `${t.asserted} asserts, ${t.failures.length} failed`].join("\n"),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await run({ shots: process.argv.includes("--shots") });
  console.log(r.detail);
  process.exitCode = r.ok ? 0 : 1;
}
