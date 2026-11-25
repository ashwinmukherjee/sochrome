// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Opens the room's dev page on fixture findings: asserts its stations, scroll, cues and switch, and saves the review screenshots.

import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "puppeteer-core";
import { paceDrawing, refUOf, track } from "../../src/app/room/P1pace";
import type { Finding, GeneInfo, GenomeResult } from "../../src/contracts/app";
import { PACING } from "../../src/contracts/constants";
import { p1Copy } from "../../src/copy/p1/room";
import { HOLD_VH } from "../../src/copy/p1/schedule";
import { sample } from "../../src/render/frames";
import { inkOf } from "../../src/render/ink";
import { setStageW, visual as V } from "../../src/render/tokens";
import { clockOf, variantEntry } from "../../src/render/variant";
import { openBrowser, openPage, serve, shot } from "./browser";

const ROOT = resolve(import.meta.dirname, "../..");
const FIXTURE = "hg002";
const RESULT = JSON.parse(readFileSync(resolve(ROOT, `test/fixtures/${FIXTURE}.result.json`), "utf8")) as GenomeResult;
const FINDINGS: Finding[] = RESULT.yours;
const SHOTS = "review/d";
mkdirSync(resolve(ROOT, "shots", SHOTS), { recursive: true });

const failures: string[] = [];
let asserted = 0;
const ok = (cond: boolean, what: string) => {
  asserted++;
  if (!cond) failures.push(what);
};
const near = (a: number, b: number, slack = 0.75) => Math.abs(a - b) <= slack;

const kinds = (f: Finding) => f.facts.drawings.map((d) => `${d.lane}--${d.kind}`).join(", ");
const indexOf = (want: string): number => {
  const i = FINDINGS.findIndex((f) => kinds(f) === want);
  if (i < 0) throw new Error(`no ${want} finding in ${FIXTURE}`);
  return i;
};
const gene = (symbol: string): GeneInfo => ({
  symbol,
  chrom: "",
  pos: 0,
  transcript: "",
  modes: [],
  conditions: {},
  job: null,
  jobReviewed: false,
  dosage: { hi: null, lofKnown: 0 },
  optIn: null,
});

let serial = 0;
/** Where P1's scroll stands with line `line` of drawing `drawing` fully up, on a screen `vh` tall. */
function lineUp(f: Finding, vh: number, drawing: number, line: number): number {
  const copy = p1Copy(f, gene(f.facts.gene));
  const t = track(
    copy.map((d) =>
      paceDrawing(d.drawing, d.lines, clockOf(variantEntry({ ...d.drawing, id: `shot${serial++}` })), vh),
    ),
  );
  const s = t.segments[drawing];
  const w = s.paced.ws.find((x) => x.i === (line < 0 ? copy[drawing].lines.length + line : line));
  if (!w) throw new Error(`${f.facts.gene} ${f.name}: no such line`);
  const from = w.in ? w.in[1] : 0;
  const to = w.out ? w.out[0] : s.paced.total;
  return s.start + (from + to) / 2;
}

const frame = (page: Page) =>
  page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
const rest = (page: Page) => page.waitForSelector('.room[data-phase="rest"]', { timeout: 8000 });

async function open(page: Page, index: number): Promise<void> {
  await page.select('[data-option="fixture"]', FIXTURE);
  await page.select('[data-option="finding"]', String(index));
  await page.waitForFunction(
    (i: string) => document.querySelector<HTMLSelectElement>('[data-option="finding"]')?.value === i,
    {},
    String(index),
  );
  // A switch clears first: wait for it to begin (or to have been immediate), then for the room to rest.
  await new Promise((r) => setTimeout(r, 120));
  await rest(page);
  await page.waitForSelector(".p1-host svg");
  await frame(page);
}
async function scrollTo(page: Page, y: number): Promise<void> {
  await page.evaluate((top: number) => {
    const room = document.querySelector<HTMLElement>(".room");
    if (room) room.scrollTop = top;
  }, y);
  await frame(page);
}
const viewH = (page: Page) => page.evaluate(() => document.querySelector<HTMLElement>(".room")?.clientHeight ?? 0);
const overflow = (page: Page) =>
  page.evaluate(() => document.querySelector<HTMLElement>(".stage-p1")?.dataset.overflow ?? "");

interface State {
  name: string;
  finding: number;
  /** Where to scroll: P1's line, or a place the page works out. */
  at: { drawing: number; line: number } | "open" | "p2" | "end";
  dark: boolean;
}
const FOLD = indexOf("portrait--substitution-contacts");
const STATES: State[] = [
  { name: "p1-fold-open", finding: FOLD, at: "open", dark: true },
  { name: "p1-fold", finding: FOLD, at: { drawing: 0, line: 2 }, dark: true },
  { name: "p1-chain", finding: indexOf("chain--local-failure"), at: { drawing: 0, line: 2 }, dark: true },
  { name: "p1-codon", finding: indexOf("codon--nonsense"), at: { drawing: 0, line: -1 }, dark: true },
  {
    name: "p1-transcript",
    finding: indexOf("transcript--foreclosed-junction"),
    at: { drawing: 0, line: 2 },
    dark: true,
  },
  {
    name: "p1-second",
    finding: indexOf("codon--in-frame-del, chain--local-failure"),
    at: { drawing: 1, line: 1 },
    dark: true,
  },
  { name: "p2-frame", finding: FOLD, at: "p2", dark: false },
  { name: "p3-next", finding: FOLD, at: "end", dark: false },
];

async function place(page: Page, s: State): Promise<void> {
  await open(page, s.finding);
  if (s.at === "open") {
    // The cue comes up once the room is at rest.
    await new Promise((r) => setTimeout(r, 500));
    return;
  }
  if (s.at === "p2" || s.at === "end") {
    const y = await page.evaluate((where: string) => {
      const room = document.querySelector<HTMLElement>(".room");
      const p2 = document.querySelector<HTMLElement>(".panel-p2");
      if (!room || !p2) return 0;
      return where === "p2" ? p2.offsetTop + room.clientHeight / 2 : room.scrollHeight;
    }, s.at);
    await scrollTo(page, y);
    return;
  }
  await scrollTo(page, lineUp(FINDINGS[s.finding], await viewH(page), s.at.drawing, s.at.line));
}

async function shots(page: Page, suffix: string, dark: boolean): Promise<void> {
  for (const s of STATES) {
    if (dark && !s.dark) continue;
    await place(page, s);
    ok(
      (await overflow(page)) === "",
      `${s.name}${suffix}: a drawing spills out of the stage (${await overflow(page)})`,
    );
    if (typeof s.at === "object") {
      const up = await page.evaluate(
        () =>
          [...document.querySelectorAll<HTMLElement>(".claim-line")].filter((l) => Number(l.style.opacity) > 0.99)
            .length,
      );
      ok(up === 1, `${s.name}${suffix}: ${up} lines are fully up, not one`);
    }
    await shot(page, `${SHOTS}/${s.name}${suffix}`);
  }
}

/** The stations and the type, measured on the open room at desktop width. */
async function stations(page: Page): Promise<void> {
  // R15 on a fresh page, in its opening room: the first opened, the one room the scroll cue stands in.
  await page.reload({ waitUntil: "networkidle0" });
  await rest(page);
  await frame(page);
  // The cue comes up once the room is at rest.
  await new Promise((r) => setTimeout(r, 500));
  const cue = await page.evaluate(() => {
    const at = (sel: string) => document.querySelector(sel) as Element;
    return {
      text: at(".room-cue").textContent,
      opacity: getComputedStyle(at(".room-cue")).opacity,
      anim: getComputedStyle(at(".room-cue .arr")).animationName,
      dur: getComputedStyle(at(".room-cue .arr")).animationDuration,
    };
  });
  ok(
    cue.text === "Scroll" && cue.opacity === "1" && cue.anim === "cue-nudge" && cue.dur === "1.7s",
    `R15: the scroll cue is ${JSON.stringify(cue)}`,
  );
  // R15: the cue stays through the first 24 px and goes past them.
  await scrollTo(page, 24);
  ok(
    (await page.evaluate(() => document.querySelector<HTMLElement>(".room")?.dataset.scrolled ?? "")) === "",
    "R15: the cue is dismissed at 24 px",
  );
  await scrollTo(page, 25);
  await new Promise((r) => setTimeout(r, 500));
  const gone = await page.evaluate(() => ({
    on: document.querySelector<HTMLElement>(".room")?.dataset.scrolled,
    o: getComputedStyle(document.querySelector(".room-cue") as Element).opacity,
  }));
  ok(gone.on === "on" && gone.o === "0", `R15: past 24 px the cue is ${JSON.stringify(gone)}`);

  // From another finding, so the room under test has just opened.
  await open(page, FOLD + 1);
  await open(page, FOLD);
  await new Promise((r) => setTimeout(r, 500));
  const m = await page.evaluate(() => {
    const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel) as T;
    const room = q(".room");
    const inner = q(".panel-p1 .panel-inner");
    const top = inner.getBoundingClientRect().top;
    const rect = (el: Element) => el.getBoundingClientRect();
    const probe = (parent: Element, cls: string, html = "") => {
      const el = document.createElement("div");
      el.className = cls;
      el.innerHTML = html;
      parent.append(el);
      return el;
    };
    // The baseline: an empty inline-block sits on it.
    const mark = document.createElement("span");
    mark.style.cssText = "display:inline-block;width:0;height:0";
    q(".panel-p1 .q-text").append(mark);
    const baseline = rect(mark).bottom - top;
    mark.remove();
    const stage = q(".stage-p1");
    const host = q(".p1-host");
    const p2 = q(".panel-p2 .panel-inner");
    const stack2 = probe(p2, "claim-stack");
    const stage2 = probe(p2, "stage stage-p2");
    const stage3 = probe(q(".panel-p3 .panel-inner"), "stage stage-p3");
    const two = probe(
      q(".panel-p1 .claim-stack"),
      "claim claim-line",
      '<span class="claim-sent">One.</span><span class="claim-sent">Two.</span>',
    );
    const ink = probe(inner, "", "");
    ink.style.color = "var(--ink-dim)";
    const text = probe(inner, "", "");
    text.style.color = "var(--v-text)";
    const qs = getComputedStyle(q(".panel-p1 .q-text"));
    const line = q(".panel-p1 .claim-line[data-d]");
    const ls = getComputedStyle(line);
    const before = room.scrollTop;
    room.scrollBy(0, -200);
    const out = {
      scrollTop: before,
      questions: [...document.querySelectorAll<HTMLElement>(".q-text")].map((h) => h.textContent).join(" / "),
      scrollUp: room.scrollTop,
      baseline,
      claimTop: rect(q(".panel-p1 .claim-stack")).top - top,
      claimH: rect(q(".panel-p1 .claim-stack")).height,
      claimW: rect(q(".panel-p1 .claim-stack")).width,
      claimW2: rect(stack2).width,
      stageTop: rect(stage).top - top,
      stageW: rect(stage).width,
      stageH: rect(stage).height,
      stageH2: rect(stage2).height,
      stageH3: rect(stage3).height,
      stageGap: getComputedStyle(stage).marginBottom,
      inkTop: rect(host).top + parseFloat(host.style.getPropertyValue("--ink-top")) - top,
      align: [stage, stage2, stage3].map((s) => getComputedStyle(s).alignContent),
      q: { size: qs.fontSize, lh: qs.lineHeight, opacity: qs.opacity, color: qs.color, family: qs.fontFamily },
      uncertain: getComputedStyle(ink).color,
      line: {
        size: ls.fontSize,
        lh: ls.lineHeight,
        track: ls.letterSpacing,
        color: ls.color,
        wrap: ls.getPropertyValue("text-wrap") || ls.getPropertyValue("text-wrap-style"),
        family: ls.fontFamily,
      },
      text: getComputedStyle(text).color,
      sentGap: getComputedStyle(two.lastElementChild as Element).marginTop,
      firstUp: line.style.opacity,
      othersUp: [...document.querySelectorAll<HTMLElement>(".panel-p1 .claim-line[data-d]")]
        .slice(1)
        .map((l) => l.style.opacity),
      bezel: [...document.querySelectorAll<HTMLElement>(".bz-item")].map(
        (b) => `${b.getAttribute("aria-label")}:${b.dataset.state}`,
      ),
      bezelShown: getComputedStyle(q(".bezel-anchor")).display,
      caption: [...document.querySelectorAll<HTMLElement>(".p1-caption span")].map((s) => s.textContent),
    };
    for (const el of [stack2, stage2, stage3, two, ink, text]) el.remove();
    return out;
  });
  ok(
    m.scrollTop === 0 && m.scrollUp === 0,
    `R10: the room opens at scroll ${m.scrollTop} and scrolls up to ${m.scrollUp}`,
  );
  ok(
    Number(m.firstUp) === 1 && m.othersUp.every((o) => Number(o) === 0),
    `R10: at rest the first line alone is up (${m.firstUp}; ${m.othersUp.join(" ")})`,
  );
  ok(
    m.questions === "What does this variant do? / How sure are we? / What does it mean for you?",
    `R1: the panels ask "${m.questions}"`,
  );
  ok(near(m.baseline, 80), `R2: the question's baseline is at ${m.baseline}, not 80`);
  ok(
    near(m.claimTop, 112) && near(m.claimH, 120),
    `R2: the claim zone is at ${m.claimTop}, ${m.claimH} tall, not 112 and 120`,
  );
  ok(near(m.stageTop, 272), `R2: the stage's top is at ${m.stageTop}, not 272`);
  ok(m.stageGap === "48px", `R2: the gap below the stage is ${m.stageGap}, not 48px`);
  ok(near(m.inkTop, 352), `R2: the ink's top is at ${m.inkTop}, not 352`);
  ok(near(m.stageW, 768) && near(m.stageH, 384), `R3: P1's stage is ${m.stageW} x ${m.stageH}, not 768 x 384`);
  ok(
    near(m.stageH2, 192) && near(m.stageH3, 424),
    `R3: the other stages are ${m.stageH2} and ${m.stageH3} tall, not 192 and 424`,
  );
  ok(
    near(m.claimW, 540) && near(m.claimW2, 620),
    `R4: the claim spines are ${m.claimW} and ${m.claimW2} wide, not 540 and 620`,
  );
  ok(
    m.q.size === "24px" &&
      m.q.lh === "32px" &&
      m.q.opacity === "1" &&
      m.q.color === m.uncertain &&
      /Works/.test(m.q.family),
    `R5: the question is set ${JSON.stringify(m.q)}`,
  );
  ok(
    m.line.size === "24px" &&
      m.line.lh === "32px" &&
      m.line.track === "-0.24px" &&
      m.line.color === m.text &&
      /pretty/.test(m.line.wrap) &&
      /Works/.test(m.line.family),
    `R6: the claim is set ${JSON.stringify(m.line)}`,
  );
  ok(m.sentGap === "19.2px", `R6: two sentences stand ${m.sentGap} apart, not 0.8em`);
  ok(m.align.join() === "start,center,start", `R8: the stages align ${m.align.join()}`);
  ok(
    m.bezel.join() === "Effect:active,Evidence:ahead,Odds:ahead" && m.bezelShown !== "none",
    `R17: the bezel reads ${m.bezel.join()} (${m.bezelShown})`,
  );
  ok(m.caption.length === 2 && m.caption.every((c) => !!c), `the stage has no caption (${m.caption.join(" / ")})`);

  ok(
    !(await page.evaluate(() => !!document.querySelector(".room-cue"))),
    "R15: the scroll cue stands in a second room",
  );

  // R9: a panel is one screen, its scrub and its hold; its frame pins; P3's scrub scales with what it says.
  const vh = await viewH(page);
  const p = await page.evaluate(() => {
    const room = document.querySelector<HTMLElement>(".room") as HTMLElement;
    const p2 = document.querySelector<HTMLElement>(".panel-p2") as HTMLElement;
    const p3 = document.querySelector<HTMLElement>(".panel-p3") as HTMLElement;
    return {
      h2: p2.offsetHeight,
      h3: p3.offsetHeight,
      top2: p2.offsetTop,
      top3: p3.offsetTop,
      roomTop: room.getBoundingClientRect().top,
      lines3: p3.querySelectorAll("[data-panel] *").length,
    };
  });
  ok(
    near(p.h2, vh * (1 + PACING.PACE + HOLD_VH), 1),
    `R9: P2 is ${p.h2} px, not a screen, ${PACING.PACE} screens of scrub and ${HOLD_VH} of hold`,
  );
  await scrollTo(page, p.top2 + 500);
  const pinned = await page.evaluate(() => ({
    top:
      (document.querySelector(".panel-p2 .panel-inner") as Element).getBoundingClientRect().top -
      (document.querySelector(".room") as Element).getBoundingClientRect().top,
    p: (document.querySelector(".panel-p2") as HTMLElement).style.getPropertyValue("--p"),
    bezel: [...document.querySelectorAll<HTMLElement>(".bz-item")].map((b) => b.dataset.state).join(),
  }));
  ok(near(pinned.top, 0), `R9: P2's frame is ${pinned.top} px off its pin`);
  ok(near(Number(pinned.p), 500 / (vh * PACING.PACE), 0.001), `R9: P2's place in its scrub reads ${pinned.p}`);
  ok(pinned.bezel === "done,active,ahead", `R17: in P2 the bezel reads ${pinned.bezel}`);
  const scale = (p.h3 / vh - 1 - HOLD_VH) / PACING.PACE;
  ok(scale > 0.33 && scale <= 1.001, `R9: P3's scrub is ${scale.toFixed(2)} of the full one`);

  // R12, R13: the way on arrives last, on the stage's right edge, and cues once.
  await scrollTo(page, p.top3 + vh * PACING.PACE * scale - 10);
  const early = await page.evaluate(() => {
    const b = document.querySelector<HTMLButtonElement>(".room-next") as HTMLButtonElement;
    return { o: b.style.opacity, disabled: b.disabled };
  });
  ok(Number(early.o) === 0 && early.disabled, `R12: before the hold the way on is ${JSON.stringify(early)}`);
  await scrollTo(page, 1e7);
  const landed = await page.evaluate(() => {
    const b = document.querySelector<HTMLButtonElement>(".room-next") as HTMLButtonElement;
    const arr = getComputedStyle(b.querySelector(".arr") as Element);
    const cs = getComputedStyle(b);
    return {
      o: b.style.opacity,
      disabled: b.disabled,
      cue: b.classList.contains("cue"),
      text: b.textContent,
      right:
        b.getBoundingClientRect().right -
        (document.querySelector(".stage-p1") as Element).getBoundingClientRect().right,
      anim: `${arr.animationName} ${arr.animationDuration}`,
      type: `${cs.fontSize} ${cs.textTransform} ${cs.letterSpacing}`,
      foot:
        (document.querySelector(".room") as Element).getBoundingClientRect().bottom - b.getBoundingClientRect().bottom,
    };
  });
  ok(
    Number(landed.o) === 1 && !landed.disabled && landed.text === "Next variant",
    `R12: at the end the way on is ${JSON.stringify(landed)}`,
  );
  ok(near(landed.right, 0), `R12: the way on ends ${landed.right} px from the stage's right edge`);
  ok(
    landed.type === "11px uppercase 1.76px" && near(landed.foot, 48),
    `R12: the way on is set ${landed.type}, ${landed.foot} px from the foot`,
  );
  ok(landed.cue && landed.anim === "cue-nudge 1.7s", `R13: landed, the way on cues ${landed.cue} with ${landed.anim}`);

  // R11, R14: the switch runs its four beats and lands on the list's next finding, fresh.
  await page.evaluate(() => {
    const room = document.querySelector(".room") as HTMLElement;
    const log: [string, number][] = [];
    (window as unknown as { phases: [string, number][] }).phases = log;
    new MutationObserver(() => log.push([room.dataset.phase ?? "", performance.now()])).observe(room, {
      attributes: true,
      attributeFilter: ["data-phase"],
    });
  });
  await page.click(".room-next");
  await new Promise((r) => setTimeout(r, 200));
  await rest(page);
  await frame(page);
  const sw = await page.evaluate(() => {
    const room = document.querySelector(".room") as HTMLElement;
    return {
      phases: (window as unknown as { phases: [string, number][] }).phases,
      finding: (document.querySelector('[data-option="finding"]') as HTMLSelectElement).value,
      scrollTop: room.scrollTop,
      scrolled: room.dataset.scrolled ?? "",
      cue: !!document.querySelector(".room-cue"),
    };
  });
  const names = sw.phases.map(([n]) => n).join(" ");
  const gaps = sw.phases.slice(1).map(([, t], i) => Math.round(t - sw.phases[i][1]));
  ok(names === "clearing empty arriving saying rest", `R11: the switch ran "${names}"`);
  ok(
    gaps.every((g) => g >= 300 && g <= 600),
    `R11: the beats took ${gaps.join(", ")} ms, not 320 each`,
  );
  ok(
    sw.finding === String(FOLD + 1),
    `R14: the way on led to finding ${sw.finding}, not the list's next (${FOLD + 1})`,
  );
  ok(sw.scrollTop === 0 && sw.scrolled === "", `R10: the next room opens at scroll ${sw.scrollTop} (${sw.scrolled})`);
  // The scroll cue stands in the first room only: the room before was scrolled, so the reader knows the way.
  ok(!sw.cue, "R15: the scroll cue stands in a room after the first");
  await scrollTo(page, 1e7);
  ok(
    !(await page.evaluate(() => (document.querySelector(".room-next") as Element).classList.contains("cue"))),
    "R13: the cue shows again after its first use",
  );

  // R12: on the list's last finding the way on goes back to the list, after the room has cleared.
  await open(page, FINDINGS.length - 1);
  await scrollTo(page, 1e7);
  ok(
    (await page.evaluate(() => (document.querySelector(".room-next") as Element).textContent)) ===
      "Back to your variants",
    "R12: the last finding's way on does not go back to the list",
  );
  await page.click(".room-next");
  await page
    .waitForSelector("[data-closed]", { timeout: 3000 })
    .catch(() => ok(false, "R11: going back to the list never closed the room"));

  // R11: with reduced motion the switch is immediate.
  await page.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: "light" },
    { name: "prefers-reduced-motion", value: "reduce" },
  ]);
  await page.select('[data-option="finding"]', String(FOLD));
  await page.waitForSelector(".room");
  await frame(page);
  await page.select('[data-option="finding"]', String(FOLD + 2));
  await frame(page);
  ok(
    (await page.evaluate(() => (document.querySelector(".room") as HTMLElement).dataset.phase)) === "rest",
    "R11: with reduced motion the switch is not immediate",
  );
}

/** How many frames of a drawing are sampled to find its lowest ink. */
const INK_SAMPLES = 21;

/** R7: nothing is compressed to fit, so a drawing taller than what the stage leaves under the ink's station spills. Every fixture drawing, at this page's stage. */
async function spills(page: Page): Promise<string[]> {
  const stage = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const px = (name: string) => parseFloat(cs.getPropertyValue(name));
    return {
      under: px("--stage-h-p1") - (px("--station-r") - px("--station-s")),
      w: document.querySelector<HTMLElement>(".stage-p1")?.clientWidth ?? 0,
    };
  });
  const out: string[] = [];
  const seen = new Set<string>();
  const before = V.stageW;
  setStageW(stage.w);
  try {
    for (const file of readdirSync(resolve(ROOT, "test/fixtures")).filter((f) => f.endsWith(".result.json"))) {
      const r = JSON.parse(readFileSync(resolve(ROOT, "test/fixtures", file), "utf8")) as GenomeResult;
      for (const f of [...r.yours, ...r.carriers]) {
        if (seen.has(f.key)) continue;
        seen.add(f.key);
        for (const d of f.facts.drawings) {
          const entry = variantEntry({ ...d, id: `spill${serial++}` });
          const clock = clockOf(entry);
          const top = inkOf(sample(entry, refUOf(`${d.lane}--${d.kind}`, clock) * clock.duration))?.top ?? 0;
          let low = 0;
          for (let k = 0; k < INK_SAMPLES; k++)
            low = Math.max(low, inkOf(sample(entry, (k / (INK_SAMPLES - 1)) * clock.duration))?.bottom ?? 0);
          if (low - top > stage.under + 0.5)
            out.push(`${f.facts.gene} ${f.name} [${d.lane}--${d.kind}] by ${Math.round(low - top - stage.under)} px`);
        }
      }
    }
  } finally {
    setStageW(before);
  }
  return out;
}

const server = await serve("dev");
const { browser, close } = await openBrowser();
try {
  const url = `${server.url}/src/app/room/RoomDev.html`;
  const errors: string[] = [];
  for (const [size, suffix, dark] of [
    ["desktop", "-1440", false],
    ["phone", "-390", false],
    ["desktop", "-1440-dark", true],
  ] as const) {
    const { page, errors: seen } = await openPage(browser, size, { dark, touch: size === "phone" });
    // The script runner names inner functions through a helper the page does not have.
    await page.evaluateOnNewDocument("globalThis.__name = (f) => f");
    await page.goto(url, { waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);
    await rest(page);
    await shots(page, suffix, dark);
    if (!dark) {
      const spilt = await spills(page);
      if (size === "desktop")
        ok(spilt.length === 0, `R7: at desktop width drawings spill out of P1's stage:\n${spilt.join("\n")}`);
      else
        console.log(
          `R7, reported: at ${size} width ${spilt.length} fixture drawings are taller than P1's stage leaves them${spilt.length ? `:\n  ${spilt.join("\n  ")}` : ""}`,
        );
    }
    if (size === "desktop" && !dark) await stations(page);
    if (size === "phone")
      ok(
        (await page.evaluate(() => getComputedStyle(document.querySelector(".bezel-anchor") as Element).display)) ===
          "none",
        "R17: the bezel shows at phone width",
      );
    errors.push(...seen);
    await page.close();
  }
  ok(errors.length === 0, `the page logged errors:\n${errors.join("\n")}`);
  console.log(`${asserted} asserts, ${failures.length} failed; screenshots in shots/${SHOTS}`);
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  }
} finally {
  await close();
  server.stop();
}
