// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// E1: the landing, then the descent played from read events on the four fixtures, and their screenshots.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { Page } from "puppeteer-core";
import { CUTS, fmt, TALLY_WORDS, countsOf } from "../../src/app/descent/words";
import { LANDING_WORDS } from "../../src/app/landing/words";
import { BRAND } from "../../src/brand";
import { BREAKPOINT_PHONE } from "../../src/contracts/constants";
import type { GenomeResult, RefusalReason } from "../../src/contracts/app";
import { openBrowser, openPage, serve, shot, type Size } from "./browser";

const ROOT = resolve(import.meta.dirname, "../..");
const HARNESS = "/src/app/descent/dev/descent.html";
const FIXTURES = ["hg002", "x-one", "hg001", "empty"] as const;
const SIZES: Size[] = ["desktop", "laptop", "phone", "small"];
const WIDTH: Record<Size, number> = { desktop: 1440, laptop: 1024, phone: 390, small: 320 };
const GENES = 2132;
const ASKED = 145;
const REASONS: RefusalReason[] = [
  "chip",
  "raw",
  "grch37",
  "no-build",
  "wrong-build",
  "multi",
  "no-sample",
  "structural",
  "no-variants",
  "empty",
  "zip",
  "bcf",
  "unreadable",
  "broken",
  "too-large",
  "old-browser",
  "no-data",
];
const TOL = 1.5;
/** A beat may land this late on a busy machine, never early. */
const LATE = 450;

const fixture = (name: string) =>
  JSON.parse(readFileSync(resolve(ROOT, `test/fixtures/${name}.result.json`), "utf8")) as GenomeResult;

const problems: string[] = [];
let asserted = 0;
function ok(cond: boolean, what: string) {
  asserted++;
  if (!cond) problems.push(what);
}
const near = (a: number, b: number, tol = TOL) => Math.abs(a - b) <= tol;
const same = (got: unknown, want: unknown, what: string) =>
  ok(JSON.stringify(got) === JSON.stringify(want), `${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const close = (got: number, want: number, what: string, tol = TOL) =>
  ok(near(got, want, tol), `${what}: got ${Math.round(got * 100) / 100}, want ${want}`);

/** What the checks read from the page, defined there once. */
const PROBE = `window.probe = {
  rect(sel) { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom }; },
  rects(sel) { return [...document.querySelectorAll(sel)].map((e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom }; }); },
  css(sel, prop) { const e = document.querySelector(sel); return e ? getComputedStyle(e)[prop] : null; },
  ink(name) { const i = document.createElement("i"); i.style.color = "var(" + name + ")"; document.body.append(i); const c = getComputedStyle(i).color; i.remove(); return c; },
  px(name) { const i = document.createElement("i"); i.style.cssText = "position:absolute;width:var(" + name + ")"; document.body.append(i); const w = i.getBoundingClientRect().width; i.remove(); return w; },
  textBottom(sel) { const e = document.querySelector(sel); if (!e) return null; const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT); const n = w.nextNode(); const g = document.createRange(); g.selectNodeContents(n); return g.getBoundingClientRect().bottom; },
  wide() { return document.documentElement.scrollWidth - document.documentElement.clientWidth; },
  face() {
    const f = document.querySelector(".landing-face");
    if (!f) return null;
    return { kind: f.dataset.face, out: f.classList.contains("out"), says: [...f.querySelectorAll(".says p")].filter((p) => p.getClientRects().length).map((p) => p.textContent), buttons: [...f.querySelectorAll("button")].map((b) => b.textContent) };
  },
  press(label) { const b = [...document.querySelectorAll("button")].find((x) => x.textContent === label); if (!b) throw new Error("no button " + label); b.click(); return null; },
  cuts() {
    return [...document.querySelectorAll(".tally-cut")].map((li) => {
      const n = li.querySelector(".tally-n"), s = li.querySelector(".tally-says");
      const cn = getComputedStyle(n), cs = getComputedStyle(s), rn = n.getBoundingClientRect(), rs = s.getBoundingClientRect();
      return { cut: li.dataset.cut, cls: [...li.classList].join(" "), n: n.textContent, says: s.textContent, on: +cn.opacity, saysOn: +cs.opacity, color: cn.color, saysColor: cs.color, shown: getComputedStyle(li).display !== "none", nt: rn.top, nb: rn.bottom, st: rs.top, sb: rs.bottom, nl: rn.left, sl: rs.left, sr: rs.right };
    });
  },
  next() {
    const b = document.querySelector(".tally-next");
    if (!b) return null;
    const c = getComputedStyle(b), r = b.getBoundingClientRect(), a = b.querySelector(".tally-arrow"), ar = a.getBoundingClientRect(), w = b.querySelector(".tally-words").getBoundingClientRect();
    return { cls: [...b.classList].join(" "), label: b.getAttribute("aria-label"), opacity: +c.opacity, color: c.color, delay: c.transitionDelay, r: r.right, b: r.bottom, h: r.height, arrowR: ar.right, gap: ar.left - w.right, nudge: getComputedStyle(a).animationName, nudgeFor: getComputedStyle(a).animationDuration, tab: b.tabIndex,
      words: [...b.querySelectorAll(".tally-words span")].map((s) => +getComputedStyle(s).opacity) };
  },
};`;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
  b: number;
}
interface Face {
  kind: string;
  out: boolean;
  says: string[];
  buttons: string[];
}
interface CutSeen {
  cut: string;
  cls: string;
  n: string;
  says: string;
  on: number;
  saysOn: number;
  color: string;
  saysColor: string;
  shown: boolean;
  nt: number;
  nb: number;
  st: number;
  sb: number;
  nl: number;
  sl: number;
  sr: number;
}
interface NextSeen {
  cls: string;
  label: string;
  opacity: number;
  color: string;
  delay: string;
  r: number;
  b: number;
  h: number;
  arrowR: number;
  gap: number;
  nudge: string;
  nudgeFor: string;
  tab: number;
  words: number[];
}
interface ViewSeen {
  at: string;
  beat: string | null;
  name: string | null;
  counting: number;
  reference: number | null;
  refusal: string | null;
  has: boolean;
  f: number[];
  o: number[];
  done: boolean[];
}

/** Evaluate in the page. An element a view is still rendering is waited for, up to 2 s; then the error stands. */
async function read<T>(page: Page, expr: string): Promise<T> {
  const until = Date.now() + 2000;
  for (;;) {
    try {
      return (await page.evaluate(`(() => { return ${expr}; })()`)) as T;
    } catch (e) {
      if (Date.now() > until) throw e;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}
const rect = (page: Page, sel: string) => read<Rect | null>(page, `probe.rect(${JSON.stringify(sel)})`);
const css = (page: Page, sel: string, prop: string) =>
  read<string | null>(page, `probe.css(${JSON.stringify(sel)}, ${JSON.stringify(prop)})`);
const ink = (page: Page, name: string) => read<string>(page, `probe.ink(${JSON.stringify(name)})`);
const px = (page: Page, name: string) => read<number>(page, `probe.px(${JSON.stringify(name)})`);
const face = (page: Page) => read<Face | null>(page, "probe.face()");
const cuts = (page: Page) => read<CutSeen[]>(page, "probe.cuts()");
const nextSeen = (page: Page) => read<NextSeen>(page, "probe.next()");
const press = (page: Page, label: string) => read<null>(page, `probe.press(${JSON.stringify(label)})`);
const view = (page: Page) =>
  read<ViewSeen>(
    page,
    `(({ at, beat, name, counting, reference, refusal, result, fill }) => ({ at, beat, name, counting, reference, refusal, has: !!result, f: fill.f, o: fill.o, done: fill.done }))(window.descent.view())`,
  );
const calls = (page: Page) => read<string[]>(page, "window.descent.calls");
const frames = (page: Page) =>
  page.evaluate(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))))`);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const at = (page: Page, where: string, timeout = 20_000) =>
  page.waitForFunction(`window.descent.view().at === ${JSON.stringify(where)}`, { timeout, polling: 16 });
const faceIs = async (page: Page, kind: string) => {
  await page.waitForFunction(
    `(() => { const f = probe.face(); return !!f && f.kind === ${JSON.stringify(kind)} && !f.out; })()`,
    { polling: 16 },
  );
  await frames(page);
};
const toLanding = async (page: Page) => {
  await page.evaluate(`window.descent.controller.go("landing"); window.descent.calls.length = 0`);
  await at(page, "landing");
  await frames(page);
};

async function open(
  browser: Awaited<ReturnType<typeof openBrowser>>["browser"],
  url: string,
  size: Size,
  o: { still?: boolean; dark?: boolean } = {},
) {
  const opened = await openPage(browser, size, { dark: o.dark });
  await opened.page.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: o.dark ? "dark" : "light" },
    { name: "prefers-reduced-motion", value: o.still ? "reduce" : "no-preference" },
  ]);
  await opened.page.evaluateOnNewDocument(PROBE);
  await opened.page.goto(`${url}${HARNESS}`, { waitUntil: "networkidle0" });
  await opened.page.waitForFunction("!!window.descent && !!window.probe");
  await opened.page.evaluate("document.fonts.ready");
  return opened;
}

/** The landing's words and places, at one width, with motion reduced so each face stands at once. */
async function landing(page: Page, size: Size, files: Record<string, string>) {
  const w = WIDTH[size];
  const narrow = w <= BREAKPOINT_PHONE;
  const t = `landing@${w}`;
  const L = LANDING_WORDS;

  // L12, L13: no tally on the landing, and the arrow keys lead nowhere; beside it (not on a phone) the ledger stands
  // empty, every row an outline.
  ok(!(await rect(page, ".tally")), `${t}: a tally on the landing`);
  ok(
    await read<boolean>(page, `!!document.querySelector(".ledger-svg.empty")`),
    `${t}: the ledger beside the landing is not the empty one`,
  );
  await page.keyboard.press("ArrowRight");
  same((await view(page)).at, "landing", `${t}: where an arrow key leaves the landing`);

  // L2: the five lines, in order.
  same(
    await read<string[]>(page, `[...document.querySelectorAll(".landing-says p")].map((p) => p.textContent)`),
    [L.does, `${L.scope.before}${L.scope.count(GENES)}${L.scope.after}`, L.known, L.notATest, L.privacy],
    `${t}: the explanation`,
  );
  // L1: on the question line, in the captions' setting, between the walls.
  const rail = await px(page, "--rail-top");
  const wall = await px(page, "--wall");
  const says = await rect(page, ".landing-says");
  const ps = await read<Rect[]>(page, `probe.rects(".landing-says p")`);
  const column = narrow ? w : await px(page, "--col-zone");
  if (says) {
    close(says.y, rail - 14, `${t}: the explanation's top`);
    close(says.x, wall, `${t}: the explanation's left wall`);
    close(says.r, column - wall, `${t}: the explanation's right wall`);
  }
  ps.slice(1).forEach((p, i) => close(p.y - ps[i].b, 16, `${t}: the gap under sentence ${i + 1}`));
  same(
    [
      await css(page, ".landing-says p", "fontSize"),
      await css(page, ".landing-says p", "lineHeight"),
      await css(page, ".landing-says p", "color"),
    ],
    ["13px", "18px", await ink(page, "--ink-dim")],
    `${t}: the explanation's setting`,
  );
  ok((await css(page, ".landing-says p", "textWrapStyle")) !== "pretty", `${t}: the explanation wraps pretty`);
  // L3: the count is the way to the genes page, told from its sentence by value alone.
  same(
    [await css(page, ".landing-link", "textDecorationLine"), await css(page, ".landing-link", "color")],
    ["none", await ink(page, "--ink")],
    `${t}: the genes link`,
  );
  await press(page, L.scope.count(GENES));
  same(await calls(page), ["genes"], `${t}: the genes link's call`);
  await page.mouse.move(w - 4, 4);

  // L4, L5: the two actions, under the explanation.
  same(
    await face(page),
    {
      kind: "actions",
      out: false,
      says: [L.does, `${L.scope.before}${L.scope.count(GENES)}${L.scope.after}`, L.known, L.notATest, L.privacy],
      buttons: [L.scope.count(GENES), L.load, L.sample],
    },
    `${t}: the actions`,
  );
  const line = await rect(page, ".landing-line");
  const buttons = await read<Rect[]>(page, `probe.rects(".landing-line button")`);
  same(
    [
      await css(page, ".landing-line", "fontSize"),
      await css(page, ".landing-line", "textTransform"),
      await css(page, ".landing-line button", "color"),
      await css(page, ".landing-or", "color"),
    ],
    ["11px", "uppercase", await ink(page, "--ink"), await ink(page, "--ink-dim")],
    `${t}: the actions' setting`,
  );
  if (line && says) {
    same(await css(page, ".landing-or", "display"), "none", `${t}: the "or"`);
    close(line.y - says.b, 32, `${t}: the actions under the explanation`);
    close(buttons[1].y - buttons[0].b, 16, `${t}: the two rows apart`);
    close(buttons[0].x, wall, `${t}: the rows' left edge`);
  }
  // L6
  same(
    await read<string>(page, `document.querySelector("input[type=file]").accept`),
    ".vcf,.vcf.gz,.gz,.txt,.csv,.zip",
    `${t}: the picker's filter`,
  );
  ok((await read<number>(page, "probe.wide()")) <= 0, `${t}: the actions scroll sideways`);

  // L7: LOAD YOUR GENOME asks first; the download may start then, and not before.
  await press(page, L.load);
  await faceIs(page, "question");
  same(await calls(page), ["genes", "load-chosen"], `${t}: LOAD YOUR GENOME's call`);
  same(
    await face(page),
    {
      kind: "question",
      out: false,
      // The download's size is said on a phone only.
      says: [...L.question(ASKED), L.next, ...(size === "phone" || size === "small" ? [L.download] : [])],
      buttons: [L.include, L.leave],
    },
    `${t}: the question`,
  );
  const ask = await rect(page, ".landing-ask");
  const lines = (await read<Rect[]>(page, `probe.rects(".landing-ask p")`)).filter((p) => p.h > 0);
  const answers = await rect(page, ".landing-line");
  ok(
    lines.every((p) => near(p.x, lines[0].x)),
    `${t}: the question's lines share a left edge`,
  );
  if (ask) close(ask.y, rail - 14, `${t}: the question in the explanation's place`);
  close(lines[1].y - lines[0].b, 16, `${t}: the gap above "you'll choose your file next"`);
  if (lines[2]) close(lines[2].y - lines[1].b, 16, `${t}: the gap above the download's line`);
  if (ask && answers) close(answers.y - ask.b, 32, `${t}: the gap above the answers`);
  ok(!!(await rect(page, ".landing-back")), `${t}: the question has no BACK`);
  ok((await read<number>(page, "probe.wide()")) <= 0, `${t}: the question scrolls sideways`);
  // L11: Esc, or closing the picker with no file, returns to the two actions.
  await page.keyboard.press("Escape");
  await faceIs(page, "actions");
  await press(page, L.load);
  await faceIs(page, "question");
  await page.evaluate(`document.querySelector("input[type=file]").dispatchEvent(new Event("cancel"))`);
  await faceIs(page, "actions");
  // Each way back stops the download, and LOAD YOUR GENOME asks for it again.
  same(
    await calls(page),
    ["genes", "load-chosen", "load-dropped", "load-chosen", "load-dropped"],
    `${t}: backing out stops the download`,
  );

  // L8, L9: each refusal, in the actions' place.
  for (const reason of REASONS) {
    await page.evaluate(`window.descent.controller.feed({ type: "error", reason: "${reason}", detail: "" })`);
    await page.waitForFunction(`window.descent.view().refusal === "${reason}"`);
    await faceIs(page, "refusal");
    const r = L.refusal(reason, BRAND.name);
    const way = r.way === "file" ? [L.another] : r.way === "again" ? [L.again] : [];
    same(
      await face(page),
      { kind: "refusal", out: false, says: r.says, buttons: [...way, L.sample] },
      `${t}: the ${reason} refusal`,
    );
    ok((await read<number>(page, "probe.wide()")) <= 0, `${t}: the ${reason} refusal scrolls sideways`);
    if (reason !== "chip") continue;
    const rows = await read<Rect[]>(page, `probe.rects(".landing-line button")`);
    close(rows[1].y - rows[0].b, 16, `${t}: a refusal's two rows apart`);
  }
  same((await view(page)).at, "landing", `${t}: a refusal stays on the landing`);
  await page.keyboard.press("Escape");
  await faceIs(page, "actions");

  // The question's answer goes with the file; a file turned away stays on the landing; another is read as answered.
  if (size !== "desktop") return;
  const choose = async (label: string, file: string) => {
    const [chooser] = await Promise.all([page.waitForFileChooser(), press(page, label)]);
    await chooser.accept([files[file]]);
  };
  await press(page, L.load);
  await faceIs(page, "question");
  await choose(L.leave, "chip");
  await page.waitForFunction(`window.descent.view().refusal === "chip"`);
  await faceIs(page, "refusal");
  same((await calls(page)).at(-1), "file chip.vcf leave-out", `${t}: the answer goes with the file`);
  await choose(L.another, "empty");
  await at(page, "all");
  same(
    (await calls(page)).slice(-1),
    ["file empty.vcf leave-out"],
    `${t}: another file is read as the question was answered`,
  );
  same((await view(page)).refusal, null, `${t}: a read clears the refusal`);
  await toLanding(page);
}

/** Every cut's count and caption against the fixture, at one width, with motion reduced. */
async function counts(page: Page, size: Size, name: (typeof FIXTURES)[number]) {
  const w = WIDTH[size];
  const narrow = w <= BREAKPOINT_PHONE;
  const t = `${name}@${w}`;
  const r = fixture(name);
  const c = countsOf(r);
  ok(c.yours + c.carriers === c.rare, `${t}: yours + carriers is not rare`);
  await toLanding(page);
  await page.evaluate(`window.descent.play("${name}", { ms: 240, reference: "with" })`);
  await at(page, "all");
  await frames(page);
  same((await view(page)).counting, c.all, `${t}: the count the read lands on`);
  const last = c.rare === 0 ? "rare" : "yours";
  for (const cut of CUTS) {
    if (cut === "yours" && c.rare === 0) break;
    if (cut !== "all") {
      await page.keyboard.press("ArrowRight");
      await frames(page);
    }
    same((await view(page)).at, cut, `${t}: the state after stepping`);
    const seen = await cuts(page);
    const now = seen.find((s) => s.cut === cut);
    same(now?.n, fmt(TALLY_WORDS.count(cut, c)), `${t}: the ${cut} count`);
    same(now?.says, TALLY_WORDS.says[cut](c), `${t}: the ${cut} caption`);
    ok(!!now && now.cls.includes("now") && now.on === 1 && now.saysOn === 1, `${t}: the ${cut} cut is not showing`);
    // D7: on the laptop the cuts ahead hold their slots unseen; the phone's strip holds the one cut it is on.
    for (const s of seen) {
      const reached = CUTS.indexOf(s.cut as (typeof CUTS)[number]) <= CUTS.indexOf(cut);
      if (narrow) same(s.shown, s.cut === cut, `${t}: at ${cut}, the phone shows ${s.cut}`);
      else same(s.on, reached ? 1 : 0, `${t}: at ${cut}, the ${s.cut} count's opacity`);
    }
    const next = await nextSeen(page);
    same(next.label, cut === last ? TALLY_WORDS.explore : TALLY_WORDS.next, `${t}: the step forward at ${cut}`);
    ok(next.opacity === 1 && next.tab === 0, `${t}: the step forward is not live at ${cut}`);
    ok((await read<number>(page, "probe.wide()")) <= 0, `${t}: ${cut} scrolls sideways`);
    const svg = await read<string[]>(page, `[...document.querySelector(".ledger-svg").classList]`);
    same(
      ["coding", "protein", "rare", "yours"].filter((k) => svg.includes(k)).length,
      CUTS.indexOf(cut),
      `${t}: the ledger's cuts at ${cut}`,
    );
  }
  // D19: the left arrow steps back; D13: with nothing rare the last cut is stepped over.
  await page.keyboard.press("ArrowLeft");
  await frames(page);
  same((await view(page)).at, c.rare === 0 ? "protein" : "rare", `${t}: where the left arrow leads`);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await frames(page);
  same((await view(page)).at, "list", `${t}: where the last step leads`);
  // D20: the list opens on YOUR VARIANTS.
  await page.waitForSelector(".list-tab");
  same(
    await read<string>(
      page,
      `document.querySelector('.list-tab[aria-pressed="true"]').textContent.replace(/\\s*\\(.*/, "")`,
    ),
    "Your variants",
    `${t}: the list's standing caption`,
  );
  ok(!(await rect(page, ".tally")), `${t}: the tally still stands beside the list`);
  if (!narrow) return;
  // No step back on screen, on a phone as on desktop: the left arrow key (and the browser's back) steps back.
  await page.evaluate(`window.descent.controller.go("coding")`);
  await frames(page);
  ok(!(await rect(page, ".tally-back")), `${t}: a BACK stands in the descent`);
  await page.keyboard.press("ArrowLeft");
  await frames(page);
  same((await view(page)).at, "all", `${t}: where the left arrow key leads`);
}

/** The reference data trailing the read (L17), and a read with motion reduced (D21, G22). */
async function slow(page: Page) {
  const t = "slow@1440";
  const c = countsOf(fixture("hg002"));
  await toLanding(page);
  await page.evaluate(`window.descent.play("hg002", { ms: 900, reference: 2400 })`);
  await at(page, "loading");
  // D21: no wipe. A bar is whole and unseen until its chromosome is done, then solid.
  await page.waitForFunction(`window.descent.view().fill.done[3] === true`, { polling: 16 });
  const mid = await view(page);
  ok(
    mid.f.every((f, i) => (f === 0 || f === 1) && mid.o[i] === (mid.done[i] && f ? 1 : 0)),
    `${t}: a bar is part-filled with motion reduced`,
  );
  same(await css(page, ".tally-n", "transitionDuration"), "0s", `${t}: the tally's transitions with motion reduced`);
  await page.waitForFunction(`window.descent.view().reference !== null`, { polling: 16 });
  await frames(page);
  const v = await view(page);
  same([v.at, v.counting], ["loading", c.all], `${t}: the read while the reference data arrives`);
  const text = await read<string>(page, `document.querySelector(".tally-reference").textContent`);
  ok(/^Reference data \d{1,2}%$/.test(text), `${t}: the reference line reads "${text}"`);
  same(text, TALLY_WORDS.reference(v.reference ?? 0), `${t}: the reference line's number`);
  same(
    [
      await css(page, ".tally-reference", "textTransform"),
      await css(page, ".tally-reference", "fontVariantNumeric"),
      await css(page, ".tally-reference", "fontSize"),
      await css(page, ".tally-reference", "color"),
    ],
    ["uppercase", "tabular-nums", "11px", await ink(page, "--ink-dim")],
    `${t}: the reference line's setting`,
  );
  const ref = await rect(page, ".tally-reference");
  const wall = (await px(page, "--col-zone")) - (await px(page, "--wall"));
  if (ref) close(ref.r, wall, `${t}: the reference line's right edge`);
  const first = (await cuts(page))[0];
  same([first.n, first.on, first.saysOn], [fmt(c.all), 1, 1], `${t}: the count and its caption stand`);
  const next = await nextSeen(page);
  ok(next.opacity === 0 && next.tab === -1, `${t}: NEXT shows while the reference data arrives`);
  await page.keyboard.press("ArrowRight");
  same((await view(page)).at, "loading", `${t}: an arrow key steps before the read is done`);
  await at(page, "all");
  await frames(page);
  ok(!(await rect(page, ".tally-reference")), `${t}: the reference line stays after the read`);
  same((await nextSeen(page)).opacity, 1, `${t}: NEXT takes the corner`);
}

/** One genome with motion: the arrival's beats, the read, each step, and the decided places. */
async function motion(page: Page, shots: boolean) {
  const t = "hg002@1440";
  const r = fixture("hg002");
  const c = countsOf(r);
  const snap = async (name: string) => {
    if (shots) await shot(page, `review/b/${name}-1440`);
  };
  await toLanding(page);
  await snap("landing");

  // L10: one face out, then the next in, on the swap's clock.
  same(await css(page, ".landing-face", "transitionDuration"), "0.3s", `${t}: the swap's fade`);
  same(await css(page, ".landing-line button", "transitionDuration"), "0.12s", `${t}: an action's hover`);
  const swap0 = Date.now();
  await press(page, LANDING_WORDS.load);
  await frames(page);
  const leaving = await face(page);
  ok(!!leaving && leaving.kind === "actions" && leaving.out, `${t}: the actions do not fade out before the question`);
  await faceIs(page, "question");
  const swapped = Date.now() - swap0;
  ok(swapped >= 280 && swapped < 300 + LATE, `${t}: the question arrived after ${swapped} ms`);
  await wait(350);
  await snap("question");
  await page.keyboard.press("Escape");
  await faceIs(page, "actions");

  // L14: release, ground, then the read.
  same(await css(page, ".landing", "transitionDuration"), "0.4s", `${t}: the release's fade`);
  await press(page, LANDING_WORDS.sample);
  await page.waitForFunction(`window.descent.view().beat === "release"`, { polling: 16 });
  const t0 = Date.now();
  same(
    [(await view(page)).beat, await read<string>(page, "document.documentElement.dataset.beat")],
    ["release", "release"],
    `${t}: the release`,
  );
  await page.waitForFunction(`window.descent.view().beat === "ground"`, { polling: 16 });
  const grounded = Date.now() - t0;
  ok(grounded >= 330 && grounded < 400 + LATE, `${t}: the ground came after ${grounded} ms`);
  await frames(page);
  ok(!(await rect(page, ".landing")), `${t}: the landing stands through the ground`);
  const ground = (await cuts(page))[0];
  same(
    [ground.n, ground.color, ground.saysOn],
    ["0", await ink(page, "--ink-dim"), 0],
    `${t}: the grey 0 on the ground`,
  );
  same(
    [await css(page, ".tally", "animationDuration"), await css(page, ".ledger", "animationDuration")],
    ["1.2s", "1.2s"],
    `${t}: the ground's fade`,
  );
  // L15: the genome's name in YOUR GENOME's parentheses.
  same(
    [
      await read<string>(page, `document.querySelector(".ledger-caption").textContent`),
      await css(page, ".ledger-caption", "textTransform"),
      await css(page, ".ledger-name", "transitionDuration"),
    ],
    [`Your genome\u00a0(${r.displayName})`, "uppercase", "0.6s"],
    `${t}: YOUR GENOME's parentheses`,
  );
  const v0 = await view(page);
  ok(v0.at === "loading" && v0.counting === 0 && v0.f.every((f) => f === 0), `${t}: the read began before the ground`);
  await wait(900);
  await snap("arrival-ground");
  await page.waitForFunction(`window.descent.view().beat === null`, { polling: 16 });
  const reading = Date.now() - t0;
  ok(reading >= 1530 && reading < 1600 + LATE, `${t}: the read began after ${reading} ms`);

  // The read: the count runs with the events, its caption waits, nothing steps.
  let before = -1;
  let shotTaken = false;
  for (;;) {
    const v = await view(page);
    if (v.at !== "loading") break;
    const first = (await cuts(page))[0];
    const shown = Number(first.n.replaceAll(",", ""));
    ok(shown >= before && shown <= c.all, `${t}: the count ran from ${before} to ${shown}`);
    before = shown;
    ok(first.saysOn < 0.05, `${t}: the first caption shows (${first.saysOn}) while the count runs`);
    // D22: the bars fill in file order.
    const done = v.done.slice(0, 23).filter((_, i) => r.parsed[i] > 0);
    ok(done.lastIndexOf(true) < (done.indexOf(false) < 0 ? 99 : done.indexOf(false)), `${t}: bars done out of order`);
    // I3: nothing on the ledger answers the pointer during the read.
    const drawing = await read<string[]>(page, `[...document.querySelector(".ledger-svg").classList]`);
    ok(
      drawing.includes("filling") && !drawing.includes("live") && !drawing.includes("menu"),
      `${t}: reading, the ledger is ${drawing.join(" ")}`,
    );
    if (!shotTaken && v.done[12]) {
      shotTaken = true;
      await snap("descent-reading");
      same(
        [first.color, (await nextSeen(page)).opacity],
        [await ink(page, "--ink"), 0],
        `${t}: the running count's ink, and NEXT`,
      );
      await page.keyboard.press("ArrowRight");
    }
    await wait(60);
  }
  ok(before > 0 && shotTaken, `${t}: the count was never seen running`);
  const svgLoading = await view(page);
  same([svgLoading.at, svgLoading.counting], ["all", c.all], `${t}: the read rests on all`);

  // D5, D6, D16, D17: the caption a beat after its number; NEXT after the caption, at full ink, its arrow nudging.
  const landed = Date.now();
  await frames(page);
  same(await css(page, ".tally-cut.seen .tally-says", "transitionDelay"), "0.6s, 0s", `${t}: the caption's beat`);
  same(await css(page, ".tally-cut.seen .tally-says", "transitionDuration"), "1.2s, 1.2s", `${t}: the caption's fade`);
  const early = await nextSeen(page);
  same(early.delay, "1.8s, 0s", `${t}: NEXT's wait`);
  ok(early.opacity < 0.05, `${t}: NEXT arrives with the count (${early.opacity})`);
  await wait(Math.max(0, 1700 - (Date.now() - landed)));
  ok((await nextSeen(page)).opacity < 0.05, `${t}: NEXT arrives before the caption is in`);
  ok((await cuts(page))[0].saysOn > 0.8, `${t}: the first caption is not in after 1.7 s`);
  await wait(1500);
  const fresh = await nextSeen(page);
  same(
    [fresh.opacity, fresh.color, fresh.nudge, fresh.nudgeFor, fresh.label],
    [1, await ink(page, "--ink"), "cue-nudge", "1.7s", TALLY_WORDS.next],
    `${t}: NEXT on first sight`,
  );
  await snap("descent-all");
  const allTop = (await cuts(page))[0].nt;

  // Each step, by the button then the keys; I8: the first step retires the cue.
  await page.click(".tally-next");
  await page.mouse.move(700, 400);
  await wait(1400);
  same((await view(page)).at, "coding", `${t}: NEXT's first step`);
  const used = await nextSeen(page);
  same([used.color, used.nudge], [await ink(page, "--ink-dim"), "none"], `${t}: NEXT once used`);
  // D4 (amended 2026-11-21): the cut the descent is on, its count at ink and its line at axis; behind, both dim.
  const two = await cuts(page);
  same(
    [two[1].color, two[1].saysColor, two[0].color, two[0].saysColor],
    [
      await ink(page, "--ink"),
      await ink(page, "--ink-dim"),
      await ink(page, "--ink-dim"),
      await ink(page, "--ink-dim"),
    ],
    `${t}: the two cuts' values`,
  );
  await snap("descent-coding");
  await page.keyboard.press("ArrowRight");
  await wait(1400);
  await snap("descent-protein");
  await page.keyboard.press("ArrowRight");
  await wait(2800);
  same((await view(page)).at, "rare", `${t}: two arrow keys on`);
  await snap("descent-rare");
  await page.click(".tally-next");
  await wait(1600);
  same((await view(page)).at, "yours", `${t}: the last cut`);
  const last = await nextSeen(page);
  same([last.label, last.words], [TALLY_WORDS.explore, [0, 1]], `${t}: EXPLORE on the last cut`);
  await snap("descent-yours");

  const standing = await read<string[]>(page, `[...document.querySelector(".ledger-svg").classList]`);
  ok(
    standing.includes("live") && !standing.includes("menu"),
    `${t}: at the last cut, the ledger is ${standing.join(" ")}`,
  );

  // The decided places, with every cut standing.
  const all = await cuts(page);
  const wall = await px(page, "--wall");
  const zone = await px(page, "--col-zone");
  close(all[0].nt, allTop, `${t}: the first count moved as the cuts arrived`);
  close(
    (all[0].nt + all[0].nb) / 2,
    await px(page, "--first-line"),
    `${t}: the first count's centre on the first line`,
  );
  same(
    [
      await css(page, ".tally-n", "fontSize"),
      await css(page, ".tally-n", "lineHeight"),
      await css(page, ".tally-n", "letterSpacing"),
      await css(page, ".tally-n", "fontVariantNumeric"),
      await css(page, ".tally-says", "fontSize"),
      await css(page, ".tally-says", "lineHeight"),
    ],
    ["13px", "17px", "0.26px", "tabular-nums", "13px", "18px"],
    `${t}: the count's and the caption's setting`,
  );
  ok(
    (await css(page, ".tally-n", "fontFamily")) !== (await css(page, ".tally-says", "fontFamily")),
    `${t}: the count is not in the mono`,
  );
  ok((await css(page, ".tally-says", "textWrapStyle")) !== "pretty", `${t}: a caption wraps pretty`);
  all.forEach((s, i) => {
    close(s.st - s.nb, 8, `${t}: the ${s.cut} caption under its count`);
    if (i) close(s.nt - all[i - 1].sb, 32, `${t}: the air above the ${s.cut} count`);
    close(s.nl, wall, `${t}: the ${s.cut} count on the text edge`);
    ok(s.sr <= zone - wall + TOL, `${t}: the ${s.cut} caption passes the right wall (${s.sr})`);
  });
  ok(
    all.some((s) => s.sr > zone - wall - 40),
    `${t}: no caption reaches toward the right wall`,
  );
  const height = await read<number>(page, "innerHeight");
  close(last.b, height - (await px(page, "--sp-5")), `${t}: NEXT's box above the foot`);
  close(last.h, await px(page, "--lane-label-box"), `${t}: NEXT's box`);
  close(last.arrowR, zone - wall, `${t}: the arrow's right edge on the wall`);
  close(last.gap, 0.4 * 11, `${t}: the arrow's gap`, 0.6);
  ok(all[4].sb + 16 <= last.b - last.h, `${t}: the last caption runs into NEXT`);
  // The captions' baselines: the tally's is the list's (they hand over in place).
  const capTally = await read<number>(page, `probe.textBottom(".tally-caption")`);
  await page.click(".tally-next");
  await at(page, "list");
  await page.waitForSelector(".list-captions");
  await frames(page);
  close(
    await read<number>(page, `probe.textBottom(".list-captions")`),
    capTally,
    `${t}: the caption moves at the list`,
  );
  const capLedger = await read<number>(page, `probe.textBottom(".ledger-caption")`);
  await wait(1300);
  await snap("descent-list");

  // L16: a file that breaks stops where it broke, holds, and returns to the landing with nothing kept.
  await toLanding(page);
  await page.evaluate(`window.descent.play("hg002", { ms: 1500, breakAt: 0.45 })`);
  await page.waitForFunction(`window.descent.view().counting > 0`, { polling: 16 });
  let held = await view(page);
  let since = Date.now();
  for (;;) {
    await wait(50);
    const v = await view(page);
    if (v.at !== "loading") break;
    if (v.counting !== held.counting) since = Date.now();
    else if (Date.now() - since > 600 && shots) await snap("descent-broken");
    held = v;
  }
  const hold = Date.now() - since;
  ok(hold >= 1300 && hold < 1400 + LATE, `${t}: the broken read held ${hold} ms`);
  ok(held.counting > 0 && held.counting < c.all && held.done.some(Boolean), `${t}: the fill did not stop partway`);
  const back = await view(page);
  same([back.at, back.refusal, back.has, back.counting], ["landing", "broken", false, 0], `${t}: after a broken read`);
  await faceIs(page, "refusal");
  same((await face(page))?.says, LANDING_WORDS.refusal("broken", BRAND.name).says, `${t}: the broken refusal`);
  await wait(350);
  await snap("refusal-broken");
  return { capTally, capLedger };
}

/** The states the checks above do not stop on, for the eye. */
async function stills(page: Page, size: Size, dark: boolean) {
  const tag = `${WIDTH[size]}${dark ? "-dark" : ""}`;
  const snap = (name: string) => shot(page, `review/b/${name}-${tag}`);
  const refuse = async (reason: RefusalReason) => {
    await page.evaluate(`window.descent.controller.feed({ type: "error", reason: "${reason}", detail: "" })`);
    await page.waitForFunction(`window.descent.view().refusal === "${reason}"`);
    await faceIs(page, "refusal");
    await snap(`refusal-${reason}`);
  };
  if (!dark) {
    if (size !== "desktop") {
      await snap("landing");
      await press(page, LANDING_WORDS.load);
      await faceIs(page, "question");
      await snap("question");
      await page.keyboard.press("Escape");
      await faceIs(page, "actions");
    }
    for (const reason of ["chip", "no-data", "old-browser"] as const) await refuse(reason);
    await page.evaluate(`window.descent.play("hg002", { ms: 600, reference: 60000 })`);
    await page.waitForFunction(`window.descent.view().reference !== null`, { polling: 16 });
    await frames(page);
    await snap("descent-reference");
    await toLanding(page);
    await page.evaluate(`window.descent.play("empty", { ms: 100 })`);
    await at(page, "all");
    await page.evaluate(`window.descent.controller.go("rare")`);
    await frames(page);
    await snap("descent-nothing-rare");
  }
  if (size === "desktop" && !dark) return;
  await toLanding(page);
  await page.evaluate(`window.descent.play("hg002", { ms: 100 })`);
  await at(page, "all");
  // Stepped as a person steps, so NEXT's first-sight cue is spent where it would be.
  for (const cut of CUTS) {
    if (cut !== "all") await page.keyboard.press("ArrowRight");
    await frames(page);
    if (!dark || cut === "coding" || cut === "yours") await snap(`descent-${cut}`);
  }
}

export async function run(o: { shots: boolean }): Promise<{ ok: boolean; detail: string }> {
  if (o.shots) mkdirSync(resolve(ROOT, "shots/review/b"), { recursive: true });
  // Made-up files: the dev page reads only their names.
  const dir = mkdtempSync(resolve(tmpdir(), "descent-check-"));
  const files: Record<string, string> = {};
  for (const stem of ["chip", "empty"]) {
    files[stem] = resolve(dir, `${stem}.vcf`);
    writeFileSync(files[stem], "##fileformat=VCFv4.2\n");
  }
  const server = await serve("dev");
  const { browser, close: shut } = await openBrowser();
  const errors: string[] = [];
  let caps = { capTally: 0, capLedger: 0 };
  try {
    for (const size of SIZES) {
      const { page, errors: e } = await open(browser, server.url, size, { still: true });
      await landing(page, size, files);
      for (const name of size === "desktop" ? FIXTURES : (["hg002", "empty"] as const)) await counts(page, size, name);
      if (size === "desktop") await slow(page);
      if (o.shots && (size === "desktop" || size === "phone")) {
        await toLanding(page);
        await stills(page, size, false);
      }
      errors.push(...e.map((x) => `${WIDTH[size]}: ${x}`));
      await page.close();
    }
    const moving = await open(browser, server.url, "desktop");
    caps = await motion(moving.page, o.shots);
    errors.push(...moving.errors.map((x) => `1440, moving: ${x}`));
    await moving.page.close();
    if (o.shots) {
      const { page } = await open(browser, server.url, "desktop", { still: true, dark: true });
      await stills(page, "desktop", true);
      await page.close();
    }
  } finally {
    await shut();
    server.stop();
    rmSync(dir, { recursive: true, force: true });
  }
  for (const e of errors) ok(false, e);
  const note = `the captions' text boxes end at (1440): tally ${caps.capTally.toFixed(1)}, ledger ${caps.capLedger.toFixed(1)}`;
  return {
    ok: problems.length === 0,
    detail: problems.length
      ? `${problems.length} of ${asserted} failed:\n${problems.slice(0, 30).join("\n")}\n${note}`
      : `${asserted} asserts pass on ${FIXTURES.length} fixtures at ${SIZES.map((s) => WIDTH[s]).join(", ")} px; ${note}`,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await run({ shots: process.argv.includes("--shots") });
  process.stdout.write(`${r.detail}\n`);
  process.exit(r.ok ? 0 : 1);
}
