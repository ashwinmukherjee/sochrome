// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// P1's copy for every finding in the fixtures: slots, claims, pacing on the reference screen, and fit measured in Chrome in the product's serif.

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { band, paceDrawing, track } from "../../src/app/room/P1pace";
import type { Finding, GeneInfo, GenomeResult } from "../../src/contracts/app";
import { FIT, PACING } from "../../src/contracts/constants";
import { blockers, DECLINED, p1Copy, read, scrubOf, VOICE } from "../../src/copy/p1/room";
import { uAt, words } from "../../src/copy/p1/schedule";
import { kindOf, OPENING_NO_JOB, OPENINGS } from "../../src/copy/p1/slots";
import { clockOf, variantEntry } from "../../src/render/variant";
import { openBrowser, openPage, serve } from "../e2e/browser";
import { type Check, type Result, ROOT } from "./_check";

const DIR = resolve(ROOT, "test/fixtures");
const JSON_DIR = resolve(ROOT, "src/copy/json");

/** A crossfade under scroll is at least this many px; half a hand-off at least this many. */
const CROSSFADE_MIN_PX = 20;
const HALF_HANDOFF_MIN_PX = 45;
/** A line is never fully up for less than this many breaths of scroll. */
const BREATHS_MIN = 2;
const SLACK_PX = 0.5;

interface SavedGene {
  job: string | null;
  ok?: boolean;
  edited?: boolean;
}
const json = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const saved = json<{ genes: Record<string, SavedGene | undefined> }>(resolve(JSON_DIR, "copy.json")).genes;
const built = json<Record<string, { job: string | null } | undefined>>(resolve(JSON_DIR, "sources/gene-lines.json"));

/** A gene's job line as the bundle carries it: the saved one once ticked or typed into, else the build's. */
function jobOf(symbol: string): string | null {
  const was = saved[symbol];
  if (was && (was.ok || was.edited)) return was.job;
  return built[symbol]?.job ?? was?.job ?? null;
}
const geneOf = (symbol: string, jobReviewed: boolean): GeneInfo => ({
  symbol,
  chrom: "",
  pos: 0,
  transcript: "",
  modes: [],
  conditions: {},
  job: jobOf(symbol),
  jobReviewed,
  dosage: { hi: null, lofKnown: 0 },
  optIn: null,
});

/** The gene line a reviewed gene opens on. */
function opening(symbol: string, job: string | null): string {
  const text = (job === null ? OPENING_NO_JOB : (OPENINGS[VOICE.opening] ?? OPENINGS[0]))
    .replace("{gene}", symbol)
    .replace("{job}", job ?? "");
  if (/[{⟨]/.test(text)) throw new Error(`the opening has a slot this check does not fill: ${text}`);
  return text;
}

/** A claim's height in lines at each box of FIT, set in the page's own claim role. */
async function claimLines(texts: string[]): Promise<{ desktop: number[]; phone: number[] }> {
  const server = await serve("dev");
  const { browser, close } = await openBrowser();
  try {
    const measure = async (size: "desktop" | "phone") => {
      const box = FIT[size];
      const { page, errors } = await openPage(browser, size);
      await page.goto(server.url, { waitUntil: "networkidle0" });
      const out = await page.evaluate(
        async (lines: string[], width: number) => {
          const el = document.createElement("p");
          el.className = "claim";
          el.style.cssText = `width:${width}px;margin:0;visibility:hidden`;
          document.body.append(el);
          el.textContent = lines[0] ?? "";
          const cs = getComputedStyle(el);
          await document.fonts.load(`${cs.fontSize} ${cs.fontFamily}`, lines.join(" "));
          await document.fonts.ready;
          const face = document.fonts.check(`${cs.fontSize} ${cs.fontFamily.split(",")[0]}`);
          const lh = parseFloat(cs.lineHeight);
          const size = parseFloat(cs.fontSize);
          const heights = lines.map((t) => {
            el.textContent = t;
            return Math.round(el.getBoundingClientRect().height / lh);
          });
          el.remove();
          return { heights, size, lh, face };
        },
        texts,
        box.width,
      );
      await page.close();
      if (errors.length) throw new Error(errors.join("\n"));
      if (!out.face) throw new Error("the claim's typeface did not load");
      if (out.size !== box.size || out.lh !== box.line)
        throw new Error(`the ${size} claim is set ${out.size}/${out.lh}, FIT says ${box.size}/${box.line}`);
      return out.heights;
    };
    return { desktop: await measure("desktop"), phone: await measure("phone") };
  } finally {
    await close();
    server.stop();
  }
}

async function run(): Promise<Result> {
  const problems = new Set<string>();
  /** Every distinct text a room can show, with where it was first seen. */
  const shown = new Map<string, string>([[DECLINED, "the declined line"]]);
  const say = (text: string, where: string) => {
    if (!shown.has(text)) shown.set(text, where);
  };

  const findings = new Map<string, Finding>();
  let listed = 0;
  const fixtures = readdirSync(DIR)
    .filter((f) => f.endsWith(".result.json"))
    .sort();
  for (const file of fixtures) {
    const r = json<GenomeResult>(resolve(DIR, file));
    for (const f of [...r.yours, ...r.carriers]) {
      listed++;
      if (!findings.has(f.key)) findings.set(f.key, f);
    }
  }

  const med = band().read;
  let drawings = 0;
  let lines = 0;
  let mounted = 0;
  let slowest = 0;
  let quickest = Infinity;
  for (const f of findings.values()) {
    const tag = `${f.facts.gene} ${f.name}`;
    if (!f.facts.drawings.length) continue;
    // Claims and slots do not depend on the gene line; the opening and the pacing do, so both forms are run.
    for (const reviewed of [false, true]) {
      const gene = geneOf(f.facts.gene, reviewed);
      for (const r of read(f.facts, gene)) {
        for (const b of blockers(r)) problems.add(`${tag}: ${b}`);
        for (const x of r.rows) {
          const where = `${tag} [${r.kind}/${x.line.id}]`;
          if (x.noBeat) problems.add(`${where}: the drawing has no beat "${x.line.beat}", so the line never shows`);
          if (x.claims.unbacked.length) problems.add(`${where}: unbacked: ${x.claims.unbacked.join(", ")}`);
          if (x.claims.unknown.length) problems.add(`${where}: no such claim: ${x.claims.unknown.join(", ")}`);
          if (x.claims.unaudited) problems.add(`${where}: claims not declared`);
        }
      }
      let copy;
      try {
        copy = p1Copy(f, gene);
      } catch (e) {
        problems.add(`p1Copy throws: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      const paced = copy.map((d, i) => {
        const clock = clockOf(variantEntry({ ...d.drawing, id: `c1-${mounted++}`, label: f.facts.gene }));
        const p = paceDrawing(d.drawing, d.lines, clock, PACING.MEASURE_VH);
        const where = `${tag} [${kindOf(d.drawing)}]${reviewed ? " (reviewed gene line)" : ""}`;
        const reading = scrubOf(kindOf(d.drawing));
        d.lines.forEach((l, k) => {
          say(l.text, `${tag} [${kindOf(d.drawing)}/${l.id}]`);
          const w = p.ws.find((x) => x.i === k);
          if (!w) {
            problems.add(`${where}: "${l.text}" is never on screen`);
            return;
          }
          const n = Math.max(1, words(l.text));
          const floor = Math.max(BREATHS_MIN * PACING.BREATH_PX, n * med) * reading;
          if (w.upPx < floor - SLACK_PX)
            problems.add(`${where}: rushed: "${l.text}" is up ${w.upPx.toFixed(0)} px, needs ${floor.toFixed(0)}`);
          for (const half of [w.in, w.out])
            if (half && half[1] - half[0] < Math.max(CROSSFADE_MIN_PX, HALF_HANDOFF_MIN_PX) - SLACK_PX)
              problems.add(`${where}: a hand-off of ${(half[1] - half[0]).toFixed(0)} px under "${l.text}"`);
          slowest = Math.max(slowest, w.upPx / n);
          quickest = Math.min(quickest, w.upPx / n);
        });
        for (let k = 1; k < p.knots.length; k++)
          if (p.knots[k][0] < p.knots[k - 1][0] || p.knots[k][1] < p.knots[k - 1][1] - 1e-9)
            problems.add(`${where}: the scroll map runs backwards at knot ${k}`);
        if (uAt(p.knots, p.total) < 1 - 1e-9) problems.add(`${where}: the drawing never finishes`);
        if (!reviewed) {
          drawings++;
          lines += d.lines.length;
        }
        if (i > 0 && d.lines[0]?.beat == null) problems.add(`${where}: a second drawing opens on the gene line`);
        return p;
      });
      if (!(track(paced).total > 0)) problems.add(`${tag}: P1 has no scroll`);
    }
  }

  // A reviewed gene line is shown as written, so each must fit; an unreviewed one is not shown.
  const reviewedLines = new Set<string>();
  let unreviewed = 0;
  for (const [symbol, g] of Object.entries(saved)) {
    const text = opening(symbol, jobOf(symbol));
    if (g?.ok) reviewedLines.add(text);
    else unreviewed++;
    say(text, `${symbol}'s gene line${g?.ok ? "" : " (not reviewed)"}`);
  }

  const texts = [...shown.keys()];
  const fit = await claimLines(texts);
  let unreviewedLong = 0;
  for (const size of ["desktop", "phone"] as const)
    texts.forEach((t, i) => {
      if (fit[size][i] <= FIT[size].lines) return;
      const where = shown.get(t) ?? "";
      if (where.endsWith("(not reviewed)") && !reviewedLines.has(t)) unreviewedLong++;
      else problems.add(`${where}: ${fit[size][i]} lines at ${FIT[size].width} px (max ${FIT[size].lines}): "${t}"`);
    });

  const tallest = (size: "desktop" | "phone") => Math.max(0, ...fit[size]);
  const list = [...problems];
  return {
    ok: list.length === 0,
    detail: list.length
      ? `${list.length} problems:\n${list.slice(0, 40).join("\n")}`
      : [
          `${listed} findings in ${fixtures.length} fixtures (${findings.size} distinct): ${drawings} drawings, ${lines} lines, each with the plain and the reviewed gene line`,
          `no missing slot, no untrue, unbacked or undeclared claim, every line on screen`,
          `pacing at ${PACING.MEASURE_VH} px: ${quickest.toFixed(1)} to ${slowest.toFixed(1)} px per word (the tuned rooms' median ${med.toFixed(1)}), no line under ${BREATHS_MIN} breaths, every hand-off half at least ${HALF_HANDOFF_MIN_PX} px`,
          `${texts.length} distinct texts measured in Chrome (${reviewedLines.size} reviewed gene lines among them): tallest ${tallest("desktop")} lines at ${FIT.desktop.width} px (max ${FIT.desktop.lines}), ${tallest("phone")} at ${FIT.phone.width} px (max ${FIT.phone.lines})`,
          `${unreviewedLong} of ${unreviewed} unreviewed gene lines would not fit; none is shown until reviewed`,
        ].join("\n"),
  };
}

export const check: Check = {
  id: "C1",
  title: "P1 copy: no missing slot, no untrue or unbacked claim, every line fits, no rushed line",
  owner: "D",
  run,
};
