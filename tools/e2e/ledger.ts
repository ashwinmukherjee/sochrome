// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The ledger behind its handle, on the four fixtures: every state, the rows' key at four widths, and its screenshots.

import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "puppeteer-core";
import type { GenomeResult } from "../../src/contracts/app";
import { BREAKPOINT_PHONE, CHROMS } from "../../src/contracts/constants";
import { openBrowser, openPage, serve, shot, type Size } from "./browser";

const ROOT = resolve(import.meta.dirname, "../..");
const HARNESS = "/src/app/descent/dev/index.html";
const FIXTURES = ["hg002", "x-one", "hg001", "empty"] as const;
const SIZES: Size[] = ["desktop", "laptop", "phone", "small"];
const WIDTH: Record<Size, number> = { desktop: 1440, laptop: 1024, phone: 390, small: 320 };
const ROWS = 23;
const SHOTS = process.argv.includes("--shots");
/** Only the decided values, the reduced motion and the lifecycle. */
const QUICK = process.argv.includes("--quick");

const fixture = (name: string) =>
  JSON.parse(readFileSync(resolve(ROOT, `test/fixtures/${name}.result.json`), "utf8")) as GenomeResult;

const failures: string[] = [];
let asserted = 0;
function ok(cond: boolean, what: string) {
  asserted++;
  if (!cond) failures.push(what);
}

/** Runs a line against the handle and waits two frames, so classes and layout have landed. */
async function run(page: Page, code: string): Promise<void> {
  await page.evaluate(
    `(async () => { const h = window.harness.ledger; ${code}; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); })()`,
  );
}
const read = <T>(page: Page, expr: string) => page.evaluate(`(() => { ${expr} })()`) as Promise<T>;
const classes = (page: Page) => read<string[]>(page, `return [...document.querySelector(".ledger-svg").classList]`);

async function load(page: Page, name: string | null, y = 0) {
  await page.evaluate(`window.harness.events.length = 0; window.harness.load(${JSON.stringify(name)}, ${y})`);
  await page.waitForFunction(
    `!!window.harness.ledger && !!document.querySelector(".ledger-svg") && document.querySelectorAll(".ledger-svg .m").length ${name ? ">= 0" : "=== 0"}`,
  );
  await run(page, "");
}

interface Keyed {
  row: number;
  counted: boolean;
  count: number | null;
  over: boolean;
  /** The row is named in words, not by its number alone; and those words name X and Y. */
  words: boolean;
  /** The row's name as it reads, key words included. */
  name: string;
  /** Each shown text of the row that is cut by the window or a clipping ancestor, or lies on a bar or another text. */
  cut: string[];
  /** At phone width, where the key and count are parked. */
  parked: boolean;
  /** Any of the key, its words or the count is visible. */
  showing: boolean;
}

/** Points at a row's start (on a phone, the screen's edge, where the drawing starts) and reports what the row's key shows, and whether any of it is cut. */
async function keyOf(page: Page, c: number): Promise<Keyed> {
  const at = await read<{ x: number; y: number }>(
    page,
    `const band = document.querySelector('.ledger-svg .band[data-c="${c}"]'); band.scrollIntoView({ block: "nearest" });
     const b = band.getBoundingClientRect(); return { x: Math.max(b.left + 3, 2), y: b.top + b.height / 2 };`,
  );
  await page.mouse.move(at.x, at.y);
  await run(page, "");
  return read<Keyed>(
    page,
    `const svg = document.querySelector(".ledger-svg");
     const row = svg.querySelector('.row[data-c="${c}"]');
     const has = (k) => row.classList.contains(k);
     const box = (e) => e.getBoundingClientRect();
     const shown = [];
     if (has("keyed")) shown.push(["number", row.querySelector(".chr")]);
     if (has("counted")) shown.push(["count", row.querySelector(".count")]);
     const vw = document.documentElement.clientWidth, column = box(svg.closest(".ledger"));
     const cut = [];
     const meets = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
     const bars = [row, row.previousElementSibling, row.nextElementSibling]
       .filter((g) => g && g.classList.contains("row")).map((g) => box(g.querySelector(".base")));
     for (const [name, t] of shown) {
       const r = box(t);
       if (r.width < 1) { cut.push(name + " is empty"); continue; }
       if (r.left < -0.5 || r.right > vw + 0.5) cut.push(name + " leaves the window: " + Math.round(r.left) + ".." + Math.round(r.right) + " of " + vw);
       if (r.left < column.left - 0.5 || r.right > column.right + 0.5) cut.push(name + " leaves the ledger's column");
       for (let p = svg.parentElement; p; p = p.parentElement) {
         const o = getComputedStyle(p);
         if (o.overflowX === "visible" && o.overflowY === "visible") continue;
         const q = box(p);
         if (r.left < q.left - 0.5 || r.right > q.right + 0.5 || r.top < q.top - 0.5 || r.bottom > q.bottom + 0.5) cut.push(name + " is cut by " + p.className);
       }
       if (bars.some((b) => meets(r, b))) cut.push(name + " lies on a bar");
       for (const [other, u] of shown) if (u !== t && meets(r, box(u))) cut.push(name + " lies on " + other);
     }
     const count = has("counted") ? Number(row.querySelector(".count").textContent.replace(/[^0-9]/g, "")) : null;
     const parked = matchMedia("(max-width: 800px)").matches;
     const seen = (e) => { if (!e) return false; const st = getComputedStyle(e); return st.display !== "none" && +st.opacity > 0 && +st.fillOpacity > 0 && box(e).width >= 1; };
     const showing = seen(row.querySelector(".count")) || seen(row.querySelector(".key"));
     return { row: ${c}, counted: has("counted"), count, over: !!row.querySelector(".count.over"), words: has("keyed") && !has("tight"), name: row.querySelector(".chr").textContent, cut: parked ? [] : cut, parked, showing };`,
  );
}

/** Every row's key at the state the ledger stands in: nothing cut, and the rows sum to the tally. */
async function keys(page: Page, where: string, tally: number, noX: boolean) {
  let sum = 0;
  let over = 0;
  let parked = false;
  for (let c = 0; c < ROWS; c++) {
    const k = await keyOf(page, c);
    // Parked on a phone: the row's key and count don't show at 600 px and under.
    if (k.parked) {
      ok(!k.showing, `${where}: row ${c + 1}: the key or count shows on a phone, where it is parked`);
      parked = true;
      continue;
    }
    ok(k.cut.length === 0, `${where}: row ${c + 1}: ${k.cut.join("; ")}`);
    ok(k.counted || (c === ROWS - 1 && noX), `${where}: row ${c + 1} shows no count`);
    sum += k.count ?? 0;
    over += +k.over;
    if (k.over && process.argv.includes("--where")) console.log(`  over its bar's end: ${where} row ${c + 1}`);
  }
  if (!parked) ok(sum === tally, `${where}: the rows sum to ${sum}, the tally is ${tally}`);
  await page.mouse.move(1, 1);
  await run(page, "");
  return over;
}

const STATES = ["all", "coding", "protein", "rare", "yours"] as const;

async function fixtureAt(page: Page, size: Size, name: (typeof FIXTURES)[number]) {
  const r = fixture(name);
  const at = `${name} @${WIDTH[size]}`;
  /** A phone's ledger takes no pointer at all (2026-11-21): what the pointer does is held on wider screens. */
  const narrow = WIDTH[size] <= BREAKPOINT_PHONE;
  const noX = r.copiesX === null;
  const drawn = r.marks.filter((m) => m[0] < ROWS);
  await load(page, name);

  // Landing: every row an outline; a row answers the pointer by its name alone (L13).
  await run(page, `await h.state("landing", { animate: false })`);
  let cl = await classes(page);
  ok(
    cl.includes("live") && cl.includes("empty") && !cl.includes("coding"),
    `${at}: landing is not empty and live, or is cut`,
  );
  ok(
    (await read<number>(page, `return document.querySelectorAll(".ledger-svg .row.read").length`)) === 0,
    `${at}: landing has read rows`,
  );

  // Loading: paint() alone moves the head; no pointer targets during the read.
  await run(
    page,
    `await h.state("loading", { animate: false });
     const f = Array(24).fill(0), o = Array(24).fill(0), done = Array(24).fill(false);
     f[0] = 1; o[0] = 1; done[0] = true; f[1] = 0.5; o[1] = 1;
     h.paint({ f, o, done, noX: false })`,
  );
  cl = await classes(page);
  ok(cl.includes("filling") && !cl.includes("live"), `${at}: loading classes ${cl.join(" ")}`);
  const head = await read<{ ink: number; base: number; read0: boolean; read1: boolean; bands: string }>(
    page,
    `const row = (c) => document.querySelector('.ledger-svg .row[data-c="' + c + '"]');
     return { ink: row(1).querySelector(".ink").getBoundingClientRect().width, base: row(1).querySelector(".base").getBoundingClientRect().width,
       read0: row(0).classList.contains("read"), read1: row(1).classList.contains("read"),
       bands: getComputedStyle(document.querySelector(".ledger-svg .bands")).display };`,
  );
  ok(Math.abs(head.ink - head.base / 2) <= 1, `${at}: the head at half stands at ${head.ink} of ${head.base}`);
  ok(head.read0 && !head.read1, `${at}: loading's read rows`);
  ok(head.bands === "none", `${at}: rows answer the pointer during the read`);

  // The cuts, each with its rows' key.
  let over = 0;
  for (const [i, s] of STATES.entries()) {
    await run(page, `await h.state(${JSON.stringify(s)}, { animate: false })`);
    cl = await classes(page);
    const want = STATES.slice(1, i + 1);
    ok(
      STATES.slice(1).every((k) => cl.includes(k) === want.includes(k)) && cl.includes("live"),
      `${at}: ${s} classes ${cl.join(" ")}`,
    );
    if (s === "all") {
      const got = await read<{ read: number; noX: boolean }>(
        page,
        `const svg = document.querySelector(".ledger-svg"); return { read: svg.querySelectorAll(".row.read").length, noX: svg.classList.contains("no-x") };`,
      );
      ok(
        got.read === r.parsed.slice(0, ROWS).filter((n) => n > 0).length,
        `${at}: ${got.read} rows read after the read`,
      );
      ok(got.noX === noX, `${at}: the sex row's outline`);
    }
    over += await keys(page, `${at} ${s}`, r.counts[s], noX);
  }

  // Marks: every one drawn, coincident ones snapped, rare ones three wide, carriers back to one pixel at the last cut.
  const marks = await read<{ n: number; l3: number; close: number; standing: number[]; fallen: number[] }>(
    page,
    `const svg = document.querySelector(".ledger-svg"); let close = 0;
     for (const row of svg.querySelectorAll(".row")) for (const l of [1, 2, 3]) {
       const xs = [...new Set([...row.querySelectorAll(".m.l" + l)].map((m) => +m.getAttribute("x")))].sort((a, b) => a - b);
       for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] <= 1) close++;
     }
     const w = (sel) => [...new Set([...svg.querySelectorAll(sel)].map((m) => Math.round(m.getBoundingClientRect().width)))];
     return { n: svg.querySelectorAll(".m").length, l3: svg.querySelectorAll(".m.l3").length, close, standing: w(".m.l3:not(.c)"), fallen: w(".m.l3.c") };`,
  );
  ok(marks.n === drawn.length, `${at}: ${marks.n} marks drawn of ${drawn.length}`);
  ok(marks.l3 === r.counts.rare, `${at}: ${marks.l3} rare marks, the tally says ${r.counts.rare}`);
  ok(marks.close === 0, `${at}: ${marks.close} marks of one level stand in adjacent columns`);
  ok(
    marks.standing.every((w) => w === 3) && marks.fallen.every((w) => w === 1),
    `${at}: at the last cut standing ${marks.standing} fallen ${marks.fallen}`,
  );

  // The list: ticks are a menu, one target per group, swapped by list().
  await run(page, `await h.state("list", { animate: false })`);
  const targets = `return [...document.querySelectorAll(".ledger-svg .hits .hit")].filter((e) => e.getBoundingClientRect().width > 0).length`;
  const groupsOf = `const seen = new Set(); for (const m of document.querySelectorAll(".ledger-svg SEL")) seen.add(m.parentElement.dataset.c + ":" + m.getAttribute("x")); return seen.size`;
  cl = await classes(page);
  ok(cl.includes("menu") && !cl.includes("carriers"), `${at}: list classes ${cl.join(" ")}`);
  ok(
    (await read<number>(page, targets)) === (await read<number>(page, groupsOf.replace("SEL", ".m.l3:not(.c)"))),
    `${at}: the list's targets are not one per group`,
  );
  over += await keys(page, `${at} list`, r.counts.yours, noX);
  await run(page, `h.list("carriers")`);
  ok((await classes(page)).includes("carriers"), `${at}: list("carriers") did not swap`);
  ok(
    (await read<number>(page, targets)) === (await read<number>(page, groupsOf.replace("SEL", ".m.l3.c"))),
    `${at}: the carriers' targets are not one per group`,
  );
  over += await keys(page, `${at} carriers`, r.counts.carriers, noX);
  await run(page, `h.list("yours")`);

  // light(): one finding's tick grows, alone; null clears it.
  const first = r.yours[0]?.key;
  if (first) {
    await run(page, `h.light([${JSON.stringify(first)}])`);
    const lit = await read<{ hot: number; single: boolean; focus: number }>(
      page,
      `const svg = document.querySelector(".ledger-svg"); return { hot: svg.querySelectorAll(".m.hot").length, single: svg.classList.contains("single"), focus: svg.querySelectorAll(".row.focus").length };`,
    );
    ok(lit.hot === 1 && lit.single && lit.focus === 1, `${at}: light() ${JSON.stringify(lit)}`);
    await run(page, `h.light(null)`);
    ok(
      (await read<number>(page, `return document.querySelectorAll(".ledger-svg .m.hot").length`)) === 0,
      `${at}: light(null) left a tick lit`,
    );

    // In the list a chromosome lights its own variants, as a set: none grows.
    const chrom = first.split(":")[0];
    await keyOf(page, CHROMS.indexOf(chrom.replace(/^chr/i, "")));
    const set = await read<{ hot: number; single: boolean }>(
      page,
      `const svg = document.querySelector(".ledger-svg"); return { hot: svg.querySelectorAll(".m.hot").length, single: svg.classList.contains("single") };`,
    );
    const onRow = r.yours.filter((f) => f.key.startsWith(`${chrom}:`)).length;
    if (!narrow)
      ok(set.hot === onRow && (!set.single || onRow === 1), `${at}: a row lights ${set.hot} of its ${onRow} variants`);
    await page.mouse.move(1, 1);

    // on(): a tick's enter, click and leave carry its group's keys.
    const hit = await read<{ x: number; y: number }>(
      page,
      `const hit = [...document.querySelectorAll(".ledger-svg .hits .hit")].find((e) => e.getBoundingClientRect().width > 0); hit.scrollIntoView({ block: "nearest" });
       const e = hit.getBoundingClientRect(); return { x: e.left + e.width / 2, y: e.top + e.height / 2 };`,
    );
    await page.evaluate(`window.harness.events.length = 0`);
    await page.mouse.move(hit.x, hit.y);
    await page.mouse.click(hit.x, hit.y);
    await page.mouse.move(1, 1);
    await run(page, "");
    const events = await read<string[]>(page, `return window.harness.events.filter((e) => e.includes(" tick "))`);
    const keysOf = (e: string) => e.split(" ")[2];
    if (narrow) ok(events.length === 0, `${at}: a phone's ledger answered the pointer: ${JSON.stringify(events)}`);
    else
      ok(
        events.length === 3 &&
          events.map((e) => e.split(" ")[0]).join() === "enter,click,leave" &&
          events.every((e) => keysOf(e) === keysOf(events[0])) &&
          r.yours.some((f) => keysOf(events[0]).split(",").includes(f.key)),
        `${at}: on() saw ${JSON.stringify(events)}`,
      );
  }

  // The genes: the overlay, the page over the results, the reference.
  await run(page, `h.genes("overlay")`);
  ok((await classes(page)).includes("genes-on"), `${at}: genes("overlay")`);
  await run(page, `h.genes("off"); await h.state("genes", { animate: false })`);
  cl = await classes(page);
  // Under the genes page the rows answer the pointer, counting their genes (2026-11-21).
  ok(cl.includes("genes-page") && cl.includes("live"), `${at}: state("genes") classes ${cl.join(" ")}`);
  const row = await keyOf(page, 0);
  if (!narrow) ok(row.counted && (row.count ?? 0) > 0, `${at}: under the genes page row 1 counts ${row.count}`);
  ok((await read<number>(page, targets)) === 0, `${at}: ticks answer under the genes page`);
  await run(page, `h.genes("reference")`);
  cl = await classes(page);
  ok(cl.includes("genes-ref") && !cl.includes("coding"), `${at}: genes("reference") classes ${cl.join(" ")}`);
  await run(page, `h.genes("off"); await h.state("list", { animate: false })`);
  cl = await classes(page);
  ok(cl.includes("menu") && cl.includes("yours") && !cl.includes("genes-page"), `${at}: back from the genes page`);
  return over;
}

const MADE_UP_Y = 4321;

/** A made-up genome with records on Y: the sex row names both and counts both, and still nothing is cut. */
async function withY(page: Page, size: Size) {
  const r = fixture("x-one");
  const at = `x-one with Y @${WIDTH[size]}`;
  await load(page, "x-one", MADE_UP_Y);
  await run(page, `await h.state("all", { animate: false })`);
  await keys(page, `${at} all`, r.counts.all + MADE_UP_Y, false);
  const sex = await keyOf(page, ROWS - 1);
  if (WIDTH[size] > BREAKPOINT_PHONE) ok(sex.count === r.parsed[ROWS - 1] + MADE_UP_Y, `${at}: the sex row counts ${sex.count}`); // prettier-ignore
  ok(sex.cut.length === 0, `${at}: the sex row: ${sex.cut.join("; ")}`);
  if (size === "desktop") ok(sex.words && sex.name.startsWith("Chromosomes"), `${at}: the sex row reads "${sex.name}"`);
  const one = await keyOf(page, 9);
  if (size === "desktop" || size === "laptop") ok(one.words, `${at}: row 10 is not named in words`);
  await page.mouse.move(1, 1);
  return `${WIDTH[size]}:${sex.words ? "words" : "label alone"}/${one.words ? "words" : "number alone"}`;
}

/** The decided values, measured on the drawing: each line is one row of the decisions ledger. */
async function decided(page: Page) {
  await load(page, "hg002");
  await run(page, `await h.state("all", { animate: false })`);
  const genomic = (JSON.parse(readFileSync(resolve(ROOT, "src/ledger/rulers.json"), "utf8")) as { genomic: number[] })
    .genomic;
  const first = fixture("hg002").yours[0].key;
  const got = await page.evaluate(
    `(async () => {
      const h = window.harness.ledger, svg = document.querySelector(".ledger-svg"), genomic = ${JSON.stringify(genomic)};
      const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const num = (e, k) => +e.getAttribute(k), css = (e) => getComputedStyle(e);
      const row = (c) => svg.querySelector('.row[data-c="' + c + '"]');
      const out = {};
      const p = Math.max(23, Math.min(36, Math.floor(parseFloat(css(document.querySelector(".ledger-pitch")).height))));
      const bar = Math.max(6, Math.min(11, Math.round(0.3 * p))), grow = Math.max(2, Math.round(bar * 0.25));
      const w = num(svg, "width"), k = (w - 96) / genomic[0];
      const base = (c) => row(c).querySelector(".base");
      out.G1 = p === Math.max(23, Math.min(36, Math.floor((innerHeight - 264) / 22))) && num(base(1), "y") - num(base(0), "y") === p;
      out.G2 = num(base(0), "height") === bar && num(base(0), "x") === 96 && num(row(0).querySelector(".chr"), "x") === 80 &&
        num(base(0), "y") === 16 + Math.round((p - bar) / 2) && svg.style.getPropertyValue("--e") === grow + "px";
      out.G3 = genomic.slice(0, 23).every((g, c) => num(base(c), "width") === Math.round(g * k)) &&
        [...svg.querySelectorAll(".m")].every((m) => num(m, "width") === 1 && num(m, "x") >= 96 && num(m, "x") < 96 + num(base(+m.parentElement.dataset.c), "width"));
      out.G4 = [...svg.querySelectorAll(".row")].every((g) => { const l = [...g.querySelectorAll(".m")].map((m) => +m.classList[1][1]); return l.every((v, i) => !i || v >= l[i - 1]); });
      await h.state("landing", { animate: false }); await frames();
      out.G5 = css(base(0)).fill === css(row(0).querySelector(".solid")).fill && css(row(0).querySelector(".ink")).opacity === "0";
      const grey = css(base(0)).fill;
      const t = css(svg);
      out.G6 = t.getPropertyValue("--ease").replace(/ /g, "") === "cubic-bezier(0.45,0,0.15,1)" && t.getPropertyValue("--t-fade") === "1200ms" &&
        t.getPropertyValue("--t-move") === "1400ms" && t.getPropertyValue("--t-beat") === "600ms" && css(base(0)).transitionDuration.startsWith("1.2s");
      await h.state("coding", { animate: false }); await frames();
      out.G7 = css(base(0)).fill !== grey && css(row(0).querySelector(".ink")).opacity === "0" && css(row(0).querySelector(".solid")).opacity === "0";
      await h.state("rare", { animate: false }); await frames();
      out.G8 = css(svg.querySelector(".m.l3")).transitionDelay.split(", ").pop() === "1.2s" && svg.style.getPropertyValue("--e") === grow + "px";
      await h.state("list", { animate: false }); await frames();
      h.list("carriers"); const instant = svg.classList.contains("instant"); await frames(); await frames();
      out.G10 = instant && !svg.classList.contains("instant") && svg.classList.contains("carriers");
      h.list("yours"); await frames(); await frames();
      out.G13 = css(svg.querySelector(".m.l3")).transitionDuration.split(", ").every((d) => d === "0.15s");
      h.light([${JSON.stringify(first)}]); await wait(400);
      const hot = svg.querySelector(".m.hot"), lit = hot.parentElement;
      out.G11 = [...svg.querySelectorAll(".row")].every((g) => css(g).opacity === (g === lit ? "1" : "0.4"));
      out.G12 = svg.style.getPropertyValue("--e2") === Math.round(grow * 2.5) + "px" &&
        Math.abs(hot.getBoundingClientRect().height - (bar + 2 * Math.round(grow * 2.5))) < 0.6 && svg.querySelectorAll(".m.hot").length === 1;
      out.G15 = lit.classList.contains("keyed") && !lit.classList.contains("counted");
      h.light(null); await frames();
      const band = svg.querySelector('.band[data-c="0"]'), hit = svg.querySelector(".hit");
      out.G16 = num(band, "x") === 60 && num(band, "width") === 96 + num(base(0), "width") + 48 - 60 && num(band, "height") === p;
      out.G17 = num(hit, "width") === 13 && num(hit, "height") === 3 * bar && css(hit).cursor === "pointer";
      const cap = document.querySelector(".ledger-caption");
      const left = svg.getBoundingClientRect().left + 96, capAt = document.createRange();
      capAt.selectNodeContents(cap);
      h.genes("overlay"); await wait(300);
      const layer = svg.querySelector(".genes");
      out.G25 = css(layer).opacity === "1" && css(layer).transitionDuration === "0.15s" && css(layer.querySelector("rect")).opacity === "0.45";
      h.genes("off"); await frames();
      out.G25 = out.G25 && css(layer).transitionDuration === "0.15s";
      // The 23rd row names the pair (HG002's donor: XY); with no X in the file, an outline and no standing note.
      out.G26 = svg.classList.contains("no-x") && !row(22).querySelector(".absent text") &&
        row(22).querySelector(".chr").textContent === "Chromosomes\u00a0XY" &&
        css(row(22).querySelector(".absent rect")).strokeWidth === "1px" && num(base(22), "width") === Math.round(genomic[22] * k);
      out.G27 = cap.textContent === "Your genome\u00a0(HG002)" && css(cap).textTransform === "uppercase" && Math.abs(capAt.getBoundingClientRect().left - left) < 0.6;
      return out;
    })()`,
  );
  for (const [id, pass] of Object.entries(got as Record<string, boolean>))
    ok(pass, `${id}: the decided value is not what the drawing shows`);
  const keyed = await keyOf(page, 9);
  const words = await read<{ number: string; count: string }>(
    page,
    `const r = document.querySelector('.ledger-svg .row[data-c="9"]'); return { number: r.querySelector(".chr").textContent, count: r.querySelector(".count").textContent };`,
  );
  ok(
    keyed.counted && words.number === "Chromosome\u00a010" && /^[0-9,]+ variants?$/.test(words.count),
    `G14: the key reads ${JSON.stringify(words)}`,
  );
  // G26: the 23rd row with no X read says so on hover, where its count would stand; never as a standing note.
  const sex = await keyOf(page, ROWS - 1);
  const said = await read<string>(
    page,
    `return document.querySelector('.ledger-svg .row[data-c="22"] .count').textContent`,
  );
  ok(
    sex.name === "Chromosomes\u00a0XY" && said === "not in this file",
    `G26: the sex row hovers as "${sex.name}" / "${said}"`,
  );
  await page.mouse.move(1, 1);
}

/** Motion reduced: every state is its end state at once. */
async function reduced(page: Page) {
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await load(page, "hg002");
  const got = await page.evaluate(
    `(async () => { const h = window.harness.ledger, t0 = performance.now(); await h.state("rare");
       const m = document.querySelector(".ledger-svg .m.l3");
       return { ms: performance.now() - t0, moving: getComputedStyle(m).transitionDuration, wide: Math.round(m.getBoundingClientRect().width) }; })()`,
  );
  const g = got as { ms: number; moving: string; wide: number };
  ok(g.ms < 200 && /^0s(, 0s)*$/.test(g.moving) && g.wide === 3, `G22: reduced motion ${JSON.stringify(g)}`);
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);
}

/** A resize redraws in the state it stood in; dispose leaves nothing behind. */
async function lifecycle(page: Page) {
  await load(page, "hg002");
  await run(page, `await h.state("rare", { animate: false })`);
  await page.setViewport({ width: 1200, height: 800, deviceScaleFactor: 2 });
  await new Promise((r) => setTimeout(r, 400));
  const after = await read<{ w: number; host: number; cl: string[] }>(
    page,
    `const svg = document.querySelector(".ledger-svg"); return { w: +svg.getAttribute("width"), host: (() => { const e = document.querySelector(".ledger-host"), c = getComputedStyle(e); return e.clientWidth - parseFloat(c.paddingLeft) - parseFloat(c.paddingRight); })(), cl: [...svg.classList] };`,
  );
  ok(after.w === after.host, `resize: the drawing is ${after.w} wide in a host of ${after.host}`);
  ok(after.cl.includes("rare") && !after.cl.includes("yours"), `resize: classes ${after.cl.join(" ")}`);
  await run(page, `h.dispose()`);
  const left = await read<number>(
    page,
    `return document.querySelectorAll(".ledger-host svg, .ledger-host .ledger-pitch").length`,
  );
  ok(left === 0, `dispose: ${left} nodes left in the host`);
}

async function shots(page: Page, size: Size, dark: boolean) {
  const file = (state: string) => `review/b/${state}-${WIDTH[size]}${dark ? "-dark" : ""}`;
  // The phone's ledger runs past the fold: its screenshots take the whole page.
  const snap = (state: string) => shot(page, file(state), size === "phone");
  await load(page, null);
  await snap("unread");
  await load(page, "hg002");
  await run(
    page,
    `await h.state("loading", { animate: false });
     const f = Array(24).fill(0), o = Array(24).fill(0), done = Array(24).fill(false);
     for (let c = 0; c < 6; c++) { f[c] = 1; o[c] = 1; done[c] = true; } f[6] = 0.6; o[6] = 1;
     h.paint({ f, o, done, noX: false })`,
  );
  await snap("loading");
  for (const s of STATES) {
    await run(page, `await h.state(${JSON.stringify(s)}, { animate: false })`);
    await snap(s);
  }
  await keyOf(page, 0);
  await new Promise((r) => setTimeout(r, 300));
  await snap("key");
  await page.mouse.move(1, 1);
  await run(page, `await h.state("list", { animate: false })`);
  await snap("list");
  await run(page, `h.list("carriers")`);
  await snap("carriers");
  await run(page, `h.list("yours"); h.light([${JSON.stringify(fixture("hg002").yours[0].key)}])`);
  await new Promise((r) => setTimeout(r, 300));
  await snap("lit");
  await run(page, `h.light(null); h.genes("overlay")`);
  await new Promise((r) => setTimeout(r, 300));
  await snap("genes");
  await load(page, "x-one", MADE_UP_Y);
  await run(page, `await h.state("all", { animate: false })`);
  await keyOf(page, ROWS - 1);
  await new Promise((r) => setTimeout(r, 1500));
  await snap("sex-row");
  await page.mouse.move(1, 1);
}

const server = await serve("dev");
const { browser, close } = await openBrowser();
const errors: string[] = [];
const lifted: string[] = [];
const named: string[] = [];
try {
  for (const size of SIZES) {
    const opened = await openPage(browser, size);
    await opened.page.goto(`${server.url}${HARNESS}`, { waitUntil: "networkidle0" });
    await opened.page.evaluate(`document.fonts.ready`);
    for (const name of QUICK ? [] : size === "desktop" ? FIXTURES : FIXTURES.slice(0, 2))
      lifted.push(`${name}@${WIDTH[size]}:${await fixtureAt(opened.page, size, name)}`);
    named.push(await withY(opened.page, size));
    const wide = await read<number>(
      opened.page,
      `return document.documentElement.scrollWidth - document.documentElement.clientWidth`,
    );
    ok(wide <= 0, `@${WIDTH[size]}: the page scrolls sideways by ${wide}`);
    if (size === "desktop") {
      await decided(opened.page);
      await reduced(opened.page);
      await lifecycle(opened.page);
    }
    errors.push(...opened.errors.map((e) => `@${WIDTH[size]}: ${e}`));
    await opened.page.close();
  }
  if (SHOTS) mkdirSync(resolve(ROOT, "shots/review/b"), { recursive: true });
  if (SHOTS)
    for (const [size, dark] of [
      ["desktop", false],
      ["desktop", true],
      ["phone", false],
    ] as const) {
      const opened = await openPage(browser, size, { dark });
      await opened.page.goto(`${server.url}${HARNESS}`, { waitUntil: "networkidle0" });
      await opened.page.evaluate(`document.fonts.ready`);
      await shots(opened.page, size, dark);
      await opened.page.close();
    }
} finally {
  await close();
  server.stop();
}

for (const e of errors) ok(false, e);
console.log(`counts stood over their bar's end (fixture@width:rows): ${lifted.join(" ")}`);
console.log(`the sex row with Y / row 10, named by (width:how): ${named.join(" ")}`);
console.log(`ledger: ${asserted - failures.length} of ${asserted} asserts pass`);
for (const f of failures.slice(0, 40)) console.log(`  FAIL ${f}`);
process.exit(failures.length ? 1 : 0);
