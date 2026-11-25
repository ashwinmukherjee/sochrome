// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// P2 and P3 in Chrome: the in-page asserts at every beat's end, the arrival wave, pairing by hover and by tap, and the review screenshots.

import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "puppeteer-core";
import type { harness, HarnessPanel } from "../../src/app/room/P23Harness";
import type { Finding, GenomeResult, P23Facts } from "../../src/contracts/app";
import { BREAKPOINT_PHONE, PACING } from "../../src/contracts/constants";
import { P3, SHORT_SCREEN } from "../../src/app/room/P23Values";
import { context, figureFor } from "../../src/copy/p23/model";
import { openBrowser, openPage, serve, shot, SIZES, type Size } from "./browser";
import { roomAtRest, rowsOf, SAMPLE, sample } from "./shell";

type Harness = typeof harness;
type Panel = HarnessPanel;

const ROOT = resolve(import.meta.dirname, "../..");
const HARNESS = "/src/app/room/P23Harness.tsx";
const ASSERTS = "/src/app/room/P23Asserts.ts";
const SHOTS = "review/e";
const json = <T>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), "utf8")) as T;

/** Call one of the harness's exports in the page. */
const call = <K extends keyof Harness>(page: Page, fn: K, ...args: Parameters<Harness[K]>) =>
  page.evaluate(
    `import(${JSON.stringify(HARNESS)}).then((m) => m.harness.${fn}(...${JSON.stringify(args)}))`,
  ) as Promise<ReturnType<Harness[K]>>;
const frames = (page: Page, ms = 60) =>
  page.evaluate(
    `new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, ${ms}))))`,
  );
const beatOf = (page: Page, panel: Panel) =>
  page.$eval(`[data-panel="${panel}"]`, (el) => Number((el as HTMLElement).dataset.beat));

interface Case {
  id: string;
  facts: P23Facts;
}

/** One case per chart band and per P3 situation: a fixture finding where the fixtures have one, else a lab variant. */
function cases(): { bands: Case[]; situations: Case[]; widest: Case } {
  const lab = json<{ yours: P23Facts[]; sampled: P23Facts[] }>("src/copy/json/sources/lab-facts.json");
  const cnv = json<{ cases: P23Facts[] }>("src/copy/json/sources/cnv-cases.json").cases;
  const fixtures = ["hg002", "hg001", "x-one"].flatMap((name) => {
    const r = json<GenomeResult>(`test/fixtures/${name}.result.json`);
    return [...r.yours, ...r.carriers].map((f: Finding) => f.p23);
  });
  const pool = [...fixtures, ...lab.yours, ...lab.sampled, ...cnv];
  const first = (key: (f: P23Facts) => string) => {
    const seen = new Map<string, P23Facts>();
    for (const f of pool) if (!seen.has(key(f))) seen.set(key(f), f);
    return [...seen].map(([id, facts]) => ({ id, facts }));
  };
  const arm = (f: P23Facts) =>
    Math.max(...[-1, 1].map((d) => context(f).bars.reduce((a, b) => a + (b.dir === d ? b.pts : 0), 0)));
  return {
    bands: first((f) => context(f).chart),
    situations: first((f) => context(f).p3),
    widest: { id: "widest", facts: pool.reduce((a, b) => (arm(b) > arm(a) ? b : a)) },
  };
}

interface Opened {
  page: Page;
  errors: string[];
}
async function open(
  url: string,
  size: Size,
  o: { dark?: boolean; touch?: boolean; motion?: boolean } = {},
): Promise<Opened> {
  const { page, errors } = await openPage(await browserOnce(), size, o);
  await page.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: o.dark ? "dark" : "light" },
    { name: "prefers-reduced-motion", value: o.motion ? "no-preference" : "reduce" },
  ]);
  await page.goto(url, { waitUntil: "networkidle0" });
  return { page, errors };
}
let shared: Awaited<ReturnType<typeof openBrowser>> | null = null;
const browserOnce = async () => (shared ??= await openBrowser()).browser;

async function show(page: Page, c: Case, panel: Panel) {
  await call(page, "mount", c.facts, panel);
  await page.evaluate("document.fonts.ready");
  await frames(page);
}
/** Scroll to a beat and wait until the panel says it is there. */
async function seek(page: Page, panel: Panel, beat: number, problems: string[], at: string) {
  await call(page, "seek", panel, beat);
  for (let i = 0; i < 40 && (await beatOf(page, panel)) !== beat; i++) await frames(page, 25);
  await frames(page);
  if ((await beatOf(page, panel)) !== beat)
    problems.push(`${at}: scroll reached beat ${await beatOf(page, panel)}, not ${beat}`);
}
const asserts = async (page: Page, at: string) => (await call(page, "asserts")).map((p) => `${at}: ${p}`);
const sideways = (page: Page) =>
  page.evaluate(
    `Math.max(...[document.documentElement, document.querySelector("[data-harness-room]")].map((el) => el.scrollWidth - el.clientWidth))`,
  ) as Promise<number>;

const WIDTHS: Size[] = ["desktop", "phone", "small"];
const widthOf = (size: Size) => SIZES[size][0];

/** Every beat of every case at every width: the in-page asserts hold, and nothing scrolls sideways. */
async function geometry(url: string, shots: boolean): Promise<{ problems: string[]; states: number }> {
  const { bands, situations, widest } = cases();
  const problems: string[] = [];
  let states = 0;
  for (const size of WIDTHS) {
    const { page, errors } = await open(url, size);
    const w = widthOf(size);
    const walk = async (c: Case, panel: Panel, name: string | null, shootAt: (n: number) => Record<number, string>) => {
      await show(page, c, panel);
      const n = await call(page, "beats", panel);
      for (let beat = 0; beat < n; beat++) {
        const at = `${panel} ${c.id} ${w} beat ${beat}`;
        await seek(page, panel, beat, problems, at);
        problems.push(...(await asserts(page, at)));
        if ((await sideways(page)) > 0) problems.push(`${at}: the page scrolls sideways`);
        states++;
        const state = shots && name && size !== "small" ? shootAt(n)[beat] : undefined;
        if (state !== undefined) await shot(page, `${SHOTS}/${name}${state}-${w}`);
      }
      const ctx = context(c.facts);
      const said = await page.$eval(`[data-panel="${panel}"]`, (el) => ({ ...(el as HTMLElement).dataset }));
      if (panel === "p2" && (said.chart !== ctx.chart || Number(said.points) !== ctx.points))
        problems.push(
          `p2 ${c.id} ${w}: the panel says ${said.chart} at ${said.points}, the model ${ctx.chart} at ${ctx.points}`,
        );
      if (panel === "p3" && said.kind !== ctx.p3)
        problems.push(`p3 ${c.id} ${w}: the panel says ${said.kind}, the model ${ctx.p3}`);
    };
    // P2 at its last beat is the whole chart with its verdict; a harmful one also says what for.
    for (const c of bands)
      await walk(c, "p2", `p2-${c.id}`, (n) => ({
        ...(c.id === "pathogenic" ? { 0: "-open", [n - 2]: "-verdict" } : {}),
        [n - 1]: "",
      }));
    await walk(widest, "p2", null, () => ({}));
    // A figure is shot complete and at its close; a P3 of lines alone at its first line.
    for (const c of situations) {
      const figure = context(c.facts).p3 === "figure";
      const small = !c.id.startsWith("cnv-");
      const states = (n: number): Record<number, string> =>
        figure
          ? { 0: "-hundred", 3: "", [n - 1]: "-close" }
          : c.id === "carrier"
            ? { ...Object.fromEntries(Array.from({ length: n }, (_, b) => [b, `-beat${b}`])), 0: "", [n - 1]: "-close" }
            : { 0: "" };
      await walk(c, "p3", small ? `p3-${c.id}` : null, states);
      if (figure) {
        const fig = figureFor(c.facts);
        const counted = await page.$$eval(".p3-cell", (els) => els.map((el) => (el as HTMLElement).dataset.pair));
        const count = (g: string) => counted.filter((x) => x === g).length;
        if (!fig || count("baseline") !== fig.baseline || count("added") !== fig.added)
          problems.push(
            `p3 ${c.id} ${w}: ${count("baseline")} + ${count("added")} people, the figure says ${fig?.baseline} + ${fig?.added}`,
          );
      }
    }
    problems.push(...errors.map((e) => `${w}: ${e}`));
    await page.close();
  }
  return { problems, states };
}

/** Somewhere in the room's frame that pairs nothing: its question. */
const AWAY = "[data-station] h2";
/** What the panel under the pointer says is paired. */
const pairedOf = (page: Page, panel: Panel) =>
  page.$eval(`[data-panel="${panel}"]`, (el) => (el as HTMLElement).dataset.paired ?? null);
const centre = async (page: Page, selector: string) => {
  const box = await (await page.$(selector))?.boundingBox();
  if (!box) throw new Error(`nothing matches ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** Point at something (a mouse moves there, a finger taps it) and say what should then be paired. */
async function point(
  page: Page,
  panel: Panel,
  how: "hover" | "tap",
  selector: string,
  want: string | null,
  problems: string[],
  at: string,
) {
  // On a screen shorter than the frame, the reader scrolls a row into reach before pointing at it.
  const target = selector === AWAY ? AWAY : `[data-panel="${panel}"] ${selector}`;
  await page.$eval(target, (el) => {
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: "center" });
  });
  await frames(page);
  const { x, y } = await centre(page, target);
  if (how === "hover") await page.mouse.move(x, y);
  else await page.touchscreen.tap(x, y);
  await frames(page, 200);
  const got = await pairedOf(page, panel);
  if (got !== want) problems.push(`${at}: ${how} ${selector} pairs ${got}, not ${want}`);
  problems.push(...(await asserts(page, `${at} ${how} ${selector}`)));
}

/** Whether the page's screen is one where P2's ledger holds one row. */
const oneRow = (page: Page) =>
  page.evaluate(`window.matchMedia(${JSON.stringify(SHORT_SCREEN)}).matches`) as Promise<boolean>;
/** The row standing in the ledger's place there. */
const NOW = ".p2-row[data-now]";
/** The ids among these that have a mark on P2's chart (a piece with no weight has none). */
const chartIds = async (page: Page, ids: string[]) =>
  (await page.$$eval(".p2-chart [data-pair]", (els) => els.map((el) => (el as HTMLElement).dataset.pair ?? ""))).filter(
    (id) => ids.includes(id),
  );
const rowIds = async (page: Page, panel: Panel) => [
  ...new Set(
    await page.$$eval(`[data-panel="${panel}"] .p23-row`, (els) =>
      els.map((el) => (el as HTMLElement).dataset.pair ?? ""),
    ),
  ),
];

/**
 * Pairing where P2's ledger holds one row, at its last beat: a mark in the chart brings its row into the
 * ledger's place, and the row standing there pairs as any row does. With nothing paired it is the last bar's.
 */
async function pairingOneRow(page: Page, how: "hover" | "tap", at: string): Promise<string[]> {
  const problems: string[] = [];
  const ids = await rowIds(page, "p2");
  const last = ids.at(-1) ?? "";
  for (const id of await chartIds(page, ids)) {
    await point(page, "p2", how, `.p2-chart [data-pair="${id}"]`, id, problems, at);
    // The row now standing there is this mark's: on it a finger lets go, and a mouse keeps hold.
    await point(page, "p2", how, NOW, how === "tap" ? null : id, problems, at);
    await point(page, "p2", how, AWAY, null, problems, at);
  }
  await point(page, "p2", how, NOW, last, problems, at);
  if (how === "tap") await point(page, "p2", how, NOW, null, problems, at);
  await point(page, "p2", how, AWAY, null, problems, at);
  return problems;
}

/** Pairing by key: Tab walks the ledger's rows in order, and the row holding the focus is paired. */
async function pairingByKey(page: Page, at: string): Promise<string[]> {
  const problems: string[] = [];
  const beat = await beatOf(page, "p2");
  for (const id of await rowIds(page, "p2")) {
    await page.keyboard.press("Tab");
    await frames(page, 200);
    const got = await pairedOf(page, "p2");
    if (got !== id) problems.push(`${at}: Tab pairs ${got}, not ${id}`);
    problems.push(...(await asserts(page, `${at} Tab to ${id}`)));
  }
  await page.evaluate("document.activeElement.blur()");
  await frames(page, 200);
  const left = await pairedOf(page, "p2");
  if (left !== null) problems.push(`${at}: the focus left the rows and ${left} stayed paired`);
  if ((await beatOf(page, "p2")) !== beat) problems.push(`${at}: the focus moved the panel off beat ${beat}`);
  return problems;
}

/** Pairing on whatever P2 or P3 the page shows at its last beat: each bar and row, both ways, and letting go. */
export async function pairing(page: Page, panel: Panel, how: "hover" | "tap", at: string): Promise<string[]> {
  if (panel === "p2" && (await oneRow(page))) return pairingOneRow(page, how, at);
  const problems: string[] = [];
  const ids = await rowIds(page, panel);
  const mark =
    panel === "p2" ? (id: string) => `.p2-chart [data-pair="${id}"]` : (id: string) => `.p3-cell[data-pair="${id}"]`;
  for (const id of ids) {
    if (panel === "p2" && !(await chartIds(page, [id])).length) {
      // No weight, so no mark on the chart: its row pairs alone.
      await point(page, panel, how, `.p23-row[data-pair="${id}"]`, id, problems, at);
      if (how === "tap") await point(page, panel, how, `.p23-row[data-pair="${id}"]`, null, problems, at);
      continue;
    }
    await point(page, panel, how, mark(id), id, problems, at);
    await point(page, panel, how, `.p23-row[data-pair="${id}"]`, how === "tap" ? null : id, problems, at);
    await point(page, panel, how, `.p23-row[data-pair="${id}"]`, id, problems, at);
  }
  // Away from every mark the pairing lets go; a finger also lets go by tapping the same thing again.
  await point(page, panel, how, AWAY, null, problems, at);
  if (how === "tap") {
    await point(page, panel, how, `.p23-row[data-pair="${ids[0]}"]`, ids[0], problems, at);
    await point(page, panel, how, `.p23-row[data-pair="${ids[0]}"]`, null, problems, at);
  }
  return problems;
}

/** Hover at the desktop, tap at the phone, on a P2 with a bar each way and a piece with no weight, and on the figure. */
async function pairs(url: string, shots: boolean): Promise<{ problems: string[]; steps: number }> {
  const { bands, situations } = cases();
  const problems: string[] = [];
  const p2 = bands.find(
    (c) => context(c.facts).bars.some((b) => b.dir === 0) && context(c.facts).bars.some((b) => b.dir !== 0),
  );
  const p3 = situations.find((c) => c.id === "figure");
  if (!p2 || !p3) throw new Error("no case to pair on");
  let steps = 0;
  for (const [size, how] of [
    ["desktop", "hover"],
    ["phone", "tap"],
    ["small", "tap"],
  ] as const) {
    const { page, errors } = await open(url, size, { touch: how === "tap" });
    const w = widthOf(size);
    for (const [c, panel] of [
      [p2, "p2"],
      [p3, "p3"],
    ] as const) {
      const at = `${panel} ${c.id} ${w}`;
      await show(page, c, panel);
      await seek(page, panel, (await call(page, "beats", panel)) - 1, problems, at);
      problems.push(...(await pairing(page, panel, how, at)));
      const told = await call(page, "told");
      if (!told.some((id) => id !== null) || told.at(-1) !== null)
        problems.push(`${at}: the room was told ${told.join(", ")}`);
      steps += told.length;
      if ((await sideways(page)) > 0) problems.push(`${at}: the page scrolls sideways`);
    }
    if (shots && how === "hover")
      for (const dark of [false, true]) {
        const lit = dark ? await open(url, size, { dark }) : { page, errors };
        // One pairing each for review: P2's others step back, P3's group only steps up.
        await show(lit.page, p2, "p2");
        await seek(lit.page, "p2", (await call(lit.page, "beats", "p2")) - 1, problems, "p2 shot");
        const bar = context(p2.facts).bars.find((b) => b.dir !== 0)?.id ?? "";
        await point(lit.page, "p2", "hover", `.p2-bar[data-pair="${bar}"]`, bar, problems, "p2 shot");
        if (!dark) await shot(lit.page, `${SHOTS}/p2-paired-${w}`);
        await show(lit.page, p3, "p3");
        await seek(lit.page, "p3", 3, problems, "p3 shot");
        if (dark) await shot(lit.page, `${SHOTS}/p3-figure-${w}-dark`);
        await point(lit.page, "p3", "hover", '.p3-cell[data-pair="added"]', "added", problems, "p3 shot");
        await shot(lit.page, `${SHOTS}/p3-paired-${w}${dark ? "-dark" : ""}`);
        if (dark) await lit.page.close();
      }
    problems.push(...errors.map((e) => `${w}: ${e}`));
    await page.close();
  }
  // A short screen under a mouse and a keyboard, as a small window is: the one row follows those too.
  {
    const { page, errors } = await open(url, "small");
    const at = `p2 ${p2.id} ${widthOf("small")} short`;
    await show(page, p2, "p2");
    await seek(page, "p2", (await call(page, "beats", "p2")) - 1, problems, at);
    if (!(await oneRow(page))) problems.push(`${at}: ${SIZES.small.join(" × ")} is not a short screen`);
    problems.push(...(await pairing(page, "p2", "hover", at)), ...(await pairingByKey(page, at)));
    const told = await call(page, "told");
    if (!told.some((id) => id !== null) || told.at(-1) !== null)
      problems.push(`${at}: the room was told ${told.join(", ")}`);
    steps += told.length;
    problems.push(...errors.map((e) => `${at}: ${e}`));
    await page.close();
  }
  return { problems, steps };
}

/** For review: P2 in the composed room on a short phone, where the frame is the screen less the strip. */
async function shortRoom(url: string): Promise<string[]> {
  const result = sample();
  const finding = result.yours.find((f) => context(f.p23).chart === "pathogenic");
  const row = rowsOf(result, "yours").find((r) => r.key === finding?.key);
  if (!row) throw new Error(`no settled-harmful finding in ${SAMPLE}`);
  const at = `p2 ${row.name} in the room at ${SIZES.small.join(" × ")}`;
  const { page, errors } = await open(`${url}/#/sample/${SAMPLE}/variant/${encodeURIComponent(row.name)}`, "small", {
    touch: true,
  });
  if (!(await roomAtRest(page))) return [`${at}: the room did not come to rest`];
  // The end of P2's scrub: the whole chart, the last claim, and the last bar's row.
  await page.evaluate(`(() => {
    const room = document.querySelector(".room");
    room.scrollTop = document.querySelector(".panel-p2").offsetTop + room.clientHeight * ${PACING.PACE} + 4;
  })()`);
  await frames(page, 400);
  const problems = (
    (await page.evaluate(
      `import(${JSON.stringify(ASSERTS)}).then((m) => m.p23Asserts(document.querySelector(".panel-p2")))`,
    )) as string[]
  ).map((problem) => `${at}: ${problem}`);
  await shot(page, `${SHOTS}/p2-pathogenic-${widthOf("small")}`);
  problems.push(...errors.map((e) => `${at}: ${e}`));
  await page.close();
  return problems;
}

/** A group can be paired only once its squares are coloured, and scrolling back above it lets go. */
async function liveness(url: string): Promise<string[]> {
  const problems: string[] = [];
  const figure = cases().situations.find((c) => c.id === "figure");
  if (!figure) throw new Error("no figure to test");
  const { page, errors } = await open(url, "desktop");
  await show(page, figure, "p3");
  const at = "p3 figure 1440";
  const cell = (g: string) => `.p3-cell[data-pair="${g}"]`;
  const expect = async (beat: number, wants: Record<string, string | null>) => {
    await seek(page, "p3", beat, problems, at);
    for (const [g, want] of Object.entries(wants)) {
      await point(page, "p3", "hover", AWAY, null, problems, `${at} beat ${beat}`);
      await point(page, "p3", "hover", cell(g), want, problems, `${at} beat ${beat}`);
    }
  };
  await expect(0, { baseline: null, added: null, none: null });
  await expect(1, { baseline: "baseline", added: null, none: null });
  await expect(2, { baseline: "baseline", none: "none", added: "added" });
  // The pointer rests on the variant's share; scrolling back above its beat clears it, and it stays cleared.
  await seek(page, "p3", 1, problems, at);
  if ((await pairedOf(page, "p3")) !== null) problems.push(`${at}: scrolling back above a group kept it paired`);
  await seek(page, "p3", 2, problems, at);
  if ((await pairedOf(page, "p3")) !== null) problems.push(`${at}: a cleared pairing came back by itself`);
  problems.push(...errors);
  await page.close();
  return problems;
}

/** The variant's share arriving, sampled every frame with motion on. */
async function wave(url: string): Promise<{ problems: string[]; detail: string }> {
  const problems: string[] = [];
  const figure = cases().situations.find((c) => c.id === "figure");
  const fig = figure && figureFor(figure.facts);
  if (!figure || !fig) throw new Error("no figure to test");
  const { page, errors } = await open(url, "desktop", { motion: true });
  await show(page, figure, "p3");
  await seek(page, "p3", 1, problems, "wave");
  await frames(page, 600);
  const samples = (await page.evaluate(`import(${JSON.stringify(HARNESS)}).then(({ harness: h }) => {
    const cells = [...document.querySelectorAll('.p3-cell[data-pair="added"]')];
    const out = [];
    h.seek("p3", 2);
    const t0 = performance.now();
    return new Promise((done) => {
      const tick = (t) => {
        const on = cells.map((c) => c.hasAttribute("data-on"));
        const n = on.filter(Boolean).length;
        const gap = on.indexOf(false);
        const ink = n ? getComputedStyle(cells[n - 1], "::before").backgroundColor : "";
        out.push({ t: t - t0, n, prefix: gap === -1 || gap === n, ink });
        if (t - t0 < 1600) requestAnimationFrame(tick);
        else done(out);
      };
      requestAnimationFrame(tick);
    });
  })`)) as { t: number; n: number; prefix: boolean; ink: string }[];
  const first = samples.find((s) => s.n > 0);
  const full = samples.find((s) => s.n === fig.added);
  if (!first || !full) problems.push(`wave: ${samples.at(-1)?.n} of ${fig.added} people arrived`);
  else {
    const took = full.t - first.t;
    const due = (fig.added - 1) * P3.waveMs;
    // A frame is 16.7 ms at best, so the count is read up to a frame late at each end.
    if (Math.abs(took - due) > 50)
      problems.push(`wave: ${fig.added} people took ${took.toFixed(0)} ms, ${due} ms at ${P3.waveMs} ms each`);
    let worst = 0;
    samples.forEach((s, i) => {
      const before = samples[i - 1];
      if (!before) return;
      if (s.n < before.n) problems.push(`wave: the count fell from ${before.n} to ${s.n}`);
      if (!s.prefix) problems.push(`wave: people arrived out of reading order at ${s.t.toFixed(0)} ms`);
      if (s.n - before.n > (s.t - before.t) / P3.waveMs + 1.5)
        problems.push(`wave: ${s.n - before.n} people in ${(s.t - before.t).toFixed(0)} ms`);
      if (s.n > 0 && s.n < fig.added) worst = Math.max(worst, Math.abs(s.n - 1 - (s.t - first.t) / P3.waveMs));
      if (s.n > 0 && !s.ink.includes(`/ ${P3.ink.added[0]})`)) problems.push(`wave: a person landed at ${s.ink}`);
    });
    if (worst > 3) problems.push(`wave: the count strays ${worst.toFixed(1)} people from a straight line`);
    problems.push(...errors);
    await page.close();
    return {
      problems: [...new Set(problems)],
      detail: `${fig.added} people in ${took.toFixed(0)} ms (${due} ms due), within ${worst.toFixed(1)} of linear, over ${samples.length} frames`,
    };
  }
  await page.close();
  return { problems, detail: "the wave did not finish" };
}

export async function run(o: { shots: boolean; all?: boolean }): Promise<{ ok: boolean; detail: string }> {
  mkdirSync(resolve(ROOT, "shots", SHOTS), { recursive: true });
  const server = await serve("dev");
  try {
    const g = await geometry(server.url, o.shots);
    const p = await pairs(server.url, o.shots);
    const l = await liveness(server.url);
    const w = await wave(server.url);
    const r = o.shots ? await shortRoom(server.url) : [];
    const problems = [...g.problems, ...p.problems, ...l, ...w.problems, ...r];
    const summary = [
      `${g.states} panel states asserted at ${WIDTHS.map(widthOf).join(", ")} px (phone at ${BREAKPOINT_PHONE} and under)`,
      `pairing by hover at ${widthOf("desktop")} and by tap at ${widthOf("phone")} and ${widthOf("small")}, and on the short screen (${SIZES.small.join(" × ")}, one P2 row at a time) by tap, hover and key: the room was told ${p.steps} times`,
      `the wave: ${w.detail}`,
      `${problems.length} problems`,
    ].join("; ");
    return { ok: problems.length === 0, detail: [summary, ...problems.slice(0, o.all ? undefined : 60)].join("\n") };
  } finally {
    await shared?.close();
    shared = null;
    server.stop();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const r = await run({ shots: process.argv.includes("--shots"), all: process.argv.includes("--all") });
  console.log(r.detail);
  process.exit(r.ok ? 0 : 1);
}
