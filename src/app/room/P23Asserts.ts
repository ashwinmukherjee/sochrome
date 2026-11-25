// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// In-page asserts for P2 and P3: the geometry the decisions fix, measured on whatever panels are mounted.

import { POLES } from "../../copy/p23/room";
import { BREAKPOINT_PHONE } from "../../contracts/constants";
import { P2, P3, ROW_TYPE, SHORT_SCREEN } from "./P23Values";

type Say = (step: string, problem: string) => void;

const near = (a: number, b: number, within = 0.5) => Math.abs(a - b) <= within;
const all = <E extends Element = HTMLElement>(root: ParentNode, selector: string) =>
  Array.from(root.querySelectorAll<E>(selector));
const px = (el: Element, property: string, pseudo?: string) =>
  parseFloat(getComputedStyle(el, pseudo).getPropertyValue(property));
const token = (name: string) => px(document.documentElement, name);

/** A computed colour as [r, g, b, alpha], channels 0 to 255. */
function rgba(color: string): [number, number, number, number] {
  const parts = color.match(/[\d.]+(?:e-?\d+)?/g)?.map(Number) ?? [];
  const [r = 0, g = 0, b = 0, a = 1] = color.startsWith("color(")
    ? parts.slice(0, 4).map((v, i) => (i < 3 ? v * 255 : v))
    : parts;
  return [r, g, b, a];
}
const alphaOf = (el: Element, pseudo?: string) => rgba(getComputedStyle(el, pseudo).backgroundColor)[3];
/** A token colour, resolved by the page. */
function ink(name: string): [number, number, number, number] {
  const probe = document.createElement("i");
  probe.style.color = `var(${name})`;
  document.body.append(probe);
  const c = rgba(getComputedStyle(probe).color);
  probe.remove();
  return c;
}
/** Where a text's baseline stands: an empty inline block's foot is on it. */
function baseline(el: Element): number {
  const probe = document.createElement("span");
  probe.style.cssText = "display:inline-block;width:0;height:0";
  el.append(probe);
  const y = probe.getBoundingClientRect().bottom;
  probe.remove();
  return y;
}

/** The scroll box a panel sits in, as its top and foot on the screen: the room's, or the window's. */
function scrollBox(el: Element): { top: number; bottom: number } {
  for (let up = el.parentElement; up; up = up.parentElement)
    if (/auto|scroll/.test(getComputedStyle(up).overflowY)) return up.getBoundingClientRect();
  return { top: 0, bottom: window.innerHeight };
}

/** In the room's pinned frame: on its stations, one claim up, nothing outside its box. */
function frame(panel: HTMLElement, say: Say) {
  const section = panel.closest("[data-station]");
  const pin = panel.parentElement;
  if (!section || !pin) return say("frame", "not inside a room's panel");
  const top = pin.getBoundingClientRect().top;
  // The frame holds from the panel's top passing the box's until the panel's end reaches the frame's foot.
  const from = scrollBox(panel).top;
  const s = section.getBoundingClientRect();
  if (s.top <= from && s.bottom >= from + pin.getBoundingClientRect().height && !near(top, from))
    say("pin", `the frame is pinned ${top - from} px from the top of its scroll box`);

  const q = pin.querySelector("h2");
  if (q && !near(baseline(q) - top, token("--station-q")))
    say("question", `baseline ${baseline(q) - top} px down, station ${token("--station-q")}`);

  const claims = panel.querySelector(".p23-claims");
  if (!claims) return say("claim", "no claim box");
  const box = claims.getBoundingClientRect();
  if (!near(box.top - top, token("--station-c"))) say("claim", `the claim box starts ${box.top - top} px down`);
  if (!near(box.height, token("--claim-zone"))) say("claim", `the claim box is ${box.height} px tall`);
  const up = all(claims, ".p23-claim[data-on]");
  if (up.length !== 1) say("claim", `${up.length} claims are up`);
  for (const c of up) {
    const r = c.getBoundingClientRect();
    if (r.height > box.height + 0.5 || r.right > box.right + 0.5) say("claim", `"${c.textContent}" leaves its box`);
  }

  const stage = panel.querySelector(".p23-stage");
  if (stage && !near(stage.getBoundingClientRect().top - top, token("--station-s")))
    say("stage", `the stage starts ${stage.getBoundingClientRect().top - top} px down`);

  if (/[{}⟨⟩]/.test(panel.textContent ?? "")) say("slots", "an unfilled slot is on the page");
  const right = pin.getBoundingClientRect().right - px(pin, "padding-right");
  for (const el of all(panel, ".p23-stage, .p23-row-text, .p23-claims, .p2-bar"))
    if (el.getBoundingClientRect().right > right + 0.5) say("overflow", `${el.className} leaves the frame sideways`);
  const beats = (panel.dataset.marks ?? "").split(" ").length;
  if (Number(panel.dataset.beat) === beats - 1 && all(panel, ".p23-row:not([data-on])").length)
    say("end", "a ledger row is still missing at the last beat");
}

/** A ledger row's type and padding, the same in both panels, but for P2's strength word: a value off the chart, set
 *  as the chart's poles are. */
function rowType(row: HTMLElement, say: Say) {
  const cs = getComputedStyle(row);
  if (cs.paddingTop !== `${P2.row.padY}px` || cs.paddingLeft !== `${P2.row.padX}px`)
    say("row", `padding ${cs.paddingTop} ${cs.paddingLeft}`);
  const root = getComputedStyle(document.documentElement);
  const face = (list: string) => list.replace(/["'\s]/g, "");
  for (const line of all(row, ".p23-row-name, .p23-row-says")) {
    const type = getComputedStyle(line);
    const key = row.classList.contains("p2-row") && line.classList.contains("p23-row-name");
    const size = key ? px(row, "--p2-pole-size") : ROW_TYPE.size;
    if (type.fontSize !== `${size}px` || type.lineHeight !== `${ROW_TYPE.line}px`)
      say("row", `set ${type.fontSize}/${type.lineHeight}`);
    if (face(type.fontFamily) !== face(root.getPropertyValue(key ? "--mono" : "--sans")))
      say("row", `set in ${type.fontFamily}`);
  }
}

function p2(panel: HTMLElement, say: Say) {
  const chart = panel.querySelector(".p2-chart");
  if (!chart) return say("chart", "no chart");
  const c = chart.getBoundingClientRect();
  const cx = c.left + c.width / 2;
  const unit = c.width / P2.pointsAcross;
  const paired = panel.dataset.paired;

  let net = 0;
  for (const dir of [-1, 1]) {
    // Walked outward from the centre: each bar starts where the one before it, and its gap, ended.
    let edge = P2.seam / 2;
    for (const bar of all(chart, `.p2-arm[data-dir="${dir}"] .p2-bar[data-on]`)) {
      const r = bar.getBoundingClientRect();
      const pts = Number(bar.style.getPropertyValue("--pts"));
      const from = dir > 0 ? r.left - cx : cx - r.right;
      if (!near(from, edge, 0.1)) say("arms", `${bar.dataset.pair} starts ${from} px from the centre, not ${edge}`);
      if (!near(r.width, pts * unit, 0.1)) say("length", `${bar.dataset.pair} is ${r.width} px for ${pts} points`);
      if (!near(r.top - c.top, P2.barsTop) || !near(r.height, P2.barsHeight))
        say("bars", `${bar.dataset.pair} stands ${r.top - c.top} px down, ${r.height} px tall`);
      if (r.left < c.left - 0.5 || r.right > c.right + 0.5) say("bars", `${bar.dataset.pair} leaves the stage`);
      const want = paired === bar.dataset.pair ? P2.lit : P2.fill;
      if (!near(alphaOf(bar), want, 0.005)) say("fill", `${bar.dataset.pair} is filled ${alphaOf(bar)}, not ${want}`);
      edge = from + r.width + P2.gap;
      net += dir * pts;
    }
  }
  if (Number(panel.dataset.beat) >= all(panel, ".p2-row").length && !near(net, Number(panel.dataset.points), 0.01))
    say("points", `the bars add up to ${net}, the chart says ${panel.dataset.points}`);

  // A piece that carries no weight draws nothing on the chart.
  for (const bar of all<HTMLElement>(panel, '.p23-row[data-dir="0"]'))
    if (chart.querySelector(`[data-pair="${bar.dataset.pair}"]`))
      say("no weight", `${bar.dataset.pair} has a mark on the chart`);

  const rule = chart.querySelector(".p2-rule")?.getBoundingClientRect();
  if (!rule || !near(rule.top - c.top, P2.rule) || !near(rule.width, c.width))
    say("rule", `the rule is ${rule ? rule.top - c.top : "missing"} px down`);
  const tick = chart.querySelector(".p2-tick")?.getBoundingClientRect();
  if (!tick || !near((tick.left + tick.right) / 2, cx) || !near((tick.top + tick.bottom) / 2 - c.top, P2.rule, 1))
    say("rule", "the centre tick is off the rule's middle");

  const poles = all(chart, ".p2-pole");
  const names = poles.map((p) => p.textContent);
  if (names.join() !== [POLES.harmless, POLES.open, POLES.harmful].join()) say("poles", `named ${names.join(", ")}`);
  for (const p of poles) {
    const cs = getComputedStyle(p);
    const track = P2.pole.size * P2.pole.track;
    if (
      cs.textTransform !== "uppercase" ||
      px(p, "font-size") !== P2.pole.size ||
      !near(px(p, "letter-spacing"), track, 0.01)
    )
      say("poles", `${p.textContent} is set ${cs.fontSize}, ${cs.textTransform}, tracked ${cs.letterSpacing}`);
    if (!near(baseline(p) - c.top, P2.rule + P2.poles))
      say("poles", `${p.textContent} stands ${baseline(p) - c.top} px down`);
  }

  const rows = all(panel, ".p2-row");
  const ledger = panel.querySelector(".p2-ledger")?.getBoundingClientRect();
  if (ledger && !near(ledger.top - c.bottom, token("--gap-below")))
    say("ledger", `${ledger.top - c.bottom} px under the stage`);
  // On a short screen the ledger holds one row: the paired bar's once it has landed, else the last to land.
  const oneRow = window.matchMedia(SHORT_SCREEN).matches;
  const landed = rows.filter((row) => row.hasAttribute("data-on"));
  const now = landed.find((row) => row.dataset.pair === paired) ?? landed.at(-1);
  if (oneRow && ledger) {
    const marked = all(panel, ".p2-row[data-now]");
    if (marked.length !== (now ? 1 : 0) || marked[0] !== now)
      say(
        "one row",
        `the ledger shows ${marked.map((row) => row.dataset.pair).join(", ") || "no row"}, not ${now?.dataset.pair ?? "none"}`,
      );
    for (const row of rows) {
      const r = row.getBoundingClientRect();
      if (!near(r.top, ledger.top) || r.bottom > ledger.bottom + 0.5)
        say("one row", `${row.dataset.pair}'s row is not in the ledger's place`);
      const reach = getComputedStyle(row).pointerEvents !== "none";
      if (reach !== (row === now))
        say("one row", `${row.dataset.pair}'s row ${reach ? "takes" : "misses"} the pointer`);
    }
    // Every row takes its turn in that place, so the tallest has to end inside the frame.
    const room = scrollBox(panel);
    const top = panel.parentElement?.getBoundingClientRect().top ?? room.top;
    const under = ledger.bottom - top - (room.bottom - room.top);
    if (under > 0.5) say("one row", `the ledger ends ${under} px below the frame`);
  }
  for (const row of rows) {
    const id = row.dataset.pair;
    const name = row.querySelector(".p23-row-name")?.textContent ?? "";
    if (!/^[A-Z][a-z -]+$/.test(name)) say("row", `"${name}" is not sentence case`);
    if (!row.querySelector(".p23-row-says")?.textContent) say("row", `${id} has no sentence`);
    rowType(row, say);
    const mark = row.querySelector(".p2-square")?.getBoundingClientRect();
    const w = P2.row.square;
    if (!mark || !near(mark.width, w, 0.1) || !near(mark.height, w, 0.1))
      say("row", `${id}'s mark is ${mark?.width} × ${mark?.height}`);
    if (!row.hasAttribute("data-on")) continue;
    const lit = paired === id;
    const stepped = paired && !lit ? P2.dim : 1;
    if (!near(Number(getComputedStyle(row).opacity), oneRow && row !== now ? 0 : stepped, 0.005))
      say("pair", `${id}'s row is at ${getComputedStyle(row).opacity}`);
    if (!near(alphaOf(row), lit ? P2.tint : 0, 0.005)) say("pair", `${id}'s row is tinted ${alphaOf(row)}`);
    const square = row.querySelector(".p2-square");
    if (square && !near(alphaOf(square), lit ? P2.lit : P2.fill, 0.005))
      say("pair", `${id}'s square is filled ${alphaOf(square)}`);
    // A row's square is its bar's ink.
    const bar = chart.querySelector(`.p2-bar[data-pair="${id}"]`);
    if (square && bar && getComputedStyle(square).backgroundColor !== getComputedStyle(bar).backgroundColor)
      say("pair", `${id}'s square and bar differ`);
  }
  if (paired)
    for (const el of all(chart, "[data-pair][data-on]"))
      if (!near(Number(getComputedStyle(el).opacity), el.dataset.pair === paired ? 1 : P2.dim, 0.005))
        say("pair", `${el.dataset.pair} is at ${getComputedStyle(el).opacity} while ${paired} is paired`);
}

function p3(panel: HTMLElement, say: Say) {
  const stage = panel.querySelector<HTMLElement>(".p3-figure");
  if (!stage) {
    if (all(panel, ".p3-cell, .p3-row").length) say("lines", "a P3 with no figure draws part of one");
    return;
  }
  const s = stage.getBoundingClientRect();
  const cells = all(stage, ".p3-cell");
  if (cells.length !== P3.people) return say("array", `${cells.length} people`);
  const tiles = cells.map((cell) => cell.getBoundingClientRect());
  const side = px(cells[0], "width", "::before");
  const pitch = tiles[0].width;
  const cols = tiles.filter((t) => near(t.top, tiles[0].top, 0.1)).length;
  const square = (i: number) => ({ left: tiles[i].left + (pitch - side) / 2, top: tiles[i].top + (pitch - side) / 2 });

  if (cols !== token("--p3-cols")) say("array", `${cols} columns, the token says ${token("--p3-cols")}`);
  const phone = window.matchMedia(`(max-width: ${BREAKPOINT_PHONE}px)`).matches;
  const cell = phone ? P3.cellPhone : P3.cell;
  if (!near(pitch / side, P3.pitch / cell, 0.01)) say("array", `pitch ${pitch} to cell ${side}`);
  // R22: wider apart than wide on desktop; on a phone, the gap half a square (B5).
  if (!phone && pitch - side <= side) say("array", "the gap is not wider than the cell");
  if (phone && !near(pitch - side, side / 2, 0.5))
    say("array", `the gap is ${pitch - side}, not half the square ${side}`);
  if (!near(square(0).left, s.left))
    say("array", `the first square is ${square(0).left - s.left} px off the stage's edge`);
  if (!near(square(cols - 1).left + side, s.right)) say("array", "the array does not span the stage");
  if (!near(square(0).top - s.top, token("--p3-array-top")))
    say("spacing", `the array is ${square(0).top - s.top} px down`);
  tiles.forEach((t, i) => {
    const next = tiles[i + 1];
    if (!next) return;
    const wraps = (i + 1) % cols === 0;
    if (wraps ? !near(next.top, t.bottom, 0.1) : !near(next.left, t.right, 0.1))
      say("array", `tile ${i + 1} does not abut`);
  });

  // Three runs in reading order, each in its own ink once it has arrived.
  const order = ["baseline", "added", "none"];
  const groups = cells.map((cell) => order.indexOf(cell.dataset.pair ?? ""));
  if (groups.some((g, i) => g < 0 || g < (groups[i - 1] ?? 0))) say("runs", "the groups interleave");
  const paired = panel.dataset.paired;
  const unknown = ink("--v-unknown");
  const ground = ink("--ground");
  const expect = {
    baseline: (lit: boolean) => [...ink("--v-observed").slice(0, 3), P3.ink.baseline[lit ? 1 : 0]],
    added: (lit: boolean) => [...ink("--v-terminal").slice(0, 3), P3.ink.added[lit ? 1 : 0]],
    none: (lit: boolean) => {
      const k = P3.ink.none[lit ? 1 : 0];
      return [...unknown.slice(0, 3).map((v, i) => v * k + ground[i] * (1 - k)), 1];
    },
  };
  const inkOf = (el: Element, pseudo?: string) => rgba(getComputedStyle(el, pseudo).backgroundColor);
  const same = (a: number[], b: number[]) => a.every((v, i) => near(v, b[i], i < 3 ? 1.5 : 0.005));
  for (const g of order as (keyof typeof expect)[]) {
    const on = cells.filter((cell) => cell.dataset.pair === g && (g === "none" || cell.hasAttribute("data-on")));
    const want = expect[g](paired === g);
    for (const cell of on.slice(0, 1))
      if (!same(inkOf(cell, "::before"), want))
        say("inks", `${g} is ${inkOf(cell, "::before").join(" ")}, not ${want.join(" ")}`);
    const key = stage.querySelector(`.p3-key[data-pair="${g}"]`);
    if (!key) say("ledger", `no key for ${g}`);
    else if (!same(inkOf(key), want)) say("inks", `${g}'s key is not its squares' ink`);
  }
  // A person not yet reached is still the light grey.
  const waiting = cells.find((cell) => cell.dataset.pair !== "none" && !cell.hasAttribute("data-on"));
  if (waiting && !same(inkOf(waiting, "::before"), expect.none(paired === "none")))
    say("inks", "a person not yet reached is coloured");

  const kids = Array.from(stage.children).map((el) => el.className);
  if (kids.length !== 2) say("spacing", `the stage holds ${kids.join(", ")}`);
  const rows = all(stage, ".p3-row");
  if (rows.length !== order.length) return say("ledger", `${rows.length} rows`);
  const lastSquareBottom = square(P3.people - 1).top + side;
  const line = ROW_TYPE.line;
  rows.forEach((row, k) => {
    const r = row.getBoundingClientRect();
    const key = row.querySelector(".p3-key")?.getBoundingClientRect();
    rowType(row, say);
    if (!key || !near(key.width, P3.row.key, 0.1) || !near(key.height, P3.row.key, 0.1))
      say("ledger", "a key is not 12 px");
    if (key && !near(key.left, s.left)) say("ledger", `a key is ${key.left - s.left} px off the stage's edge`);
    if (k === 0 && !near(r.top + P3.row.padY - lastSquareBottom, token("--p3-ledger-gap")))
      say("spacing", `the ledger is ${r.top + P3.row.padY - lastSquareBottom} px under the array`);
    const name = row.querySelector(".p23-row-name")?.getBoundingClientRect();
    if (!name || !near(name.height, line)) say("ledger", "a row's first line wraps");
    const says = row.querySelector(".p23-row-says")?.getBoundingClientRect();
    const next = rows[k + 1]?.getBoundingClientRect();
    if (says && next && near(says.height, line) && !near(next.top - r.top, 2 * line + P3.row.between))
      say("spacing", `rows ${next.top - r.top} px apart`);
    if (!row.hasAttribute("data-on")) return;
    // Nothing fades in P3; the paired row takes a light tint of its squares' colour.
    if (!near(Number(getComputedStyle(row).opacity), 1, 0.005)) say("pair", "a row steps back");
    const tint = paired === order[k] ? P3.tint[order[k] as keyof typeof P3.tint] : 0;
    if (!near(alphaOf(row), tint, 0.005)) say("pair", `${order[k]}'s row is tinted ${alphaOf(row)}, not ${tint}`);
  });
}

/** Every problem on the P2 and P3 panels under `root`, as "panel step: problem". */
export function p23Asserts(root: ParentNode): string[] {
  const problems: string[] = [];
  for (const panel of all(root, '[data-panel="p2"], [data-panel="p3"]')) {
    const say: Say = (step, problem) => problems.push(`${panel.dataset.panel} ${step}: ${problem}`);
    frame(panel, say);
    if (panel.dataset.panel === "p2") p2(panel, say);
    else p3(panel, say);
  }
  return problems;
}
