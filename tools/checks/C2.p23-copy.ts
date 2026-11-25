// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Every line P2 and P3 can say, over the copy lab's variants, its copy-number cases and the fixtures' findings.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Finding, GenomeResult } from "../../src/contracts/app";
import { FIT, ROW_MAX } from "../../src/contracts/constants";
import { context, type Conditions, type Ctx, type Facts } from "../../src/copy/p23/model";
import { blockers, conditionsFor, read, type Filled } from "../../src/copy/p23/room";
import { CONDITIONS } from "../../src/copy/p23/seed";
import { openBrowser, openPage, serve } from "../e2e/browser";
import { type Check, type Result, ROOT } from "./_check";

const json = <T>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), "utf8")) as T;

interface Case {
  from: string;
  facts: Facts;
}

function cases(): { all: Case[]; counts: string } {
  const lab = json<{ yours: Facts[]; sampled: Facts[] }>("src/copy/json/sources/lab-facts.json");
  const cnv = json<{ cases: Facts[] }>("src/copy/json/sources/cnv-cases.json").cases;
  const labAll = [...lab.yours, ...lab.sampled];
  const all: Case[] = [...labAll, ...cnv].map((facts) => ({ from: "lab", facts }));
  let findings = 0;
  for (const name of ["hg002", "hg001", "x-one", "empty"]) {
    const r = json<GenomeResult>(`test/fixtures/${name}.result.json`);
    const fs: Finding[] = [...r.yours, ...r.carriers];
    findings += fs.length;
    all.push(...fs.map((f) => ({ from: name, facts: f.p23 })));
  }
  const distinct = new Set([...labAll, ...cnv].map((f) => f.key)).size;
  return {
    all,
    counts: `${distinct} lab variants (${labAll.length} small, ${cnv.length} copy-number), ${findings} fixture findings`,
  };
}

/** The saved names as the product shows them, and every drafted name as it would read once ticked. */
const NAMINGS: { id: string; conds: Conditions }[] = [
  { id: "reviewed names", conds: conditionsFor(undefined) },
  {
    id: "every drafted name",
    conds: {
      ...CONDITIONS,
      ...json<{ conditions: Conditions }>("src/copy/json/copy23.json").conditions,
    },
  },
];

/** Names only an insider knows: the copy says what they mean instead. */
const INSIDER =
  /ClinVar|gnomAD|AlphaMissense|ClinGen|ACMG|Tavtigian|\b(PVS1|PM2|BA1|BS1|VUS)\b|pathogenic|benign|penetrance|haploinsufficien|allele|zygo/i;
/** What a foreclosed P3 never says: it is about the person, not about what is showing them. */
const ABOUT_THE_TOOL = /this panel|usually|normally|this (tool|app|page|site|screen)/i;
/** A subtype's number stands alone in a name ("type 2", "syndrome 1A"); a gene's or a region's does not. */
const SUBTYPE = /(^|\s)\d+[A-Za-z]?(\s|$)/;
const FIGURE_OPENS = "Picture 100 people who carry this variant.";

/** The voice rules a machine can hold a line to (V3, V5, V8, V11, R28). */
function rules(ctx: Ctx, lines: Filled[]): string[] {
  const out: string[] = [];
  const p2 = lines.filter((l) => l.panel === "P2");
  const p3 = lines.filter((l) => l.panel === "P3");
  for (const l of p2) if (/[;:]/.test(l.text)) out.push(`${l.kind}/${l.unit}: a semicolon or colon in "${l.text}"`);
  for (const l of lines) {
    const name = INSIDER.exec(l.text);
    if (name) out.push(`${l.kind}/${l.unit}: the insider's word "${name[0]}" in "${l.text}"`);
  }
  const condition = p2.some((l) => l.unit === "condition");
  if (condition !== ctx.tags.includes("harmful")) out.push(`p2-frame/condition: ${condition ? "said" : "missing"}`);
  const said = p2.filter((l) => l.box === "claim").map((l) => l.unit);
  if (said.join() !== ["open", "verdict", ...(condition ? ["condition"] : [])].join())
    out.push(`p2-frame: the claims run ${said.join(", ")}`);
  const verdict = p2.find((l) => l.unit === "verdict")?.text ?? "";
  if (ctx.chart === "likely-pathogenic" && !verdict.includes("very likely harmful"))
    out.push(`p2-frame/verdict: "${verdict}" for a likely harmful chart`);
  const carriers = p2.find((l) => l.unit === "bar:rarity" && /carry it/.test(l.text))?.text;
  if (carriers && !/^About 1 in [\d,]+ people carry it\b/.test(carriers)) out.push(`p2-rarity: "${carriers}"`);
  const first = p3[0]?.text ?? "";
  if (/^(That|So)\b/.test(first)) out.push(`P3 opens by pointing back: "${first}"`);
  if (ctx.p3 === "figure" && first !== FIGURE_OPENS) out.push(`P3's figure opens "${first}"`);
  if (ctx.p3 !== "figure")
    for (const l of p3) if (ABOUT_THE_TOOL.test(l.text)) out.push(`${l.kind}/${l.unit}: about the tool: "${l.text}"`);
  if (ctx.p3.endsWith("harmless") && p3.length !== 1) out.push(`a harmless P3 says ${p3.length} lines`);
  return out;
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
  const { all, counts } = cases();
  const problems: string[] = [];
  const claims = new Map<string, string>();
  const longest = { P2: 0, P3: 0 };
  let lines = 0;
  for (const naming of NAMINGS) {
    for (const c of all) {
      const ctx = context(c.facts);
      const r = read(ctx, naming.conds);
      const at = `${c.from} ${ctx.title} (${naming.id})`;
      for (const b of blockers(r)) problems.push(`${at}: ${b}`);
      for (const l of r.lines) {
        lines++;
        const where = `${at}: ${l.kind}/${l.unit}`;
        if (l.competing > 1) problems.push(`${where}: ${l.competing} lines compete`);
        if (l.missing.length) continue;
        if (l.box === "claim") {
          claims.set(l.text, where);
          continue;
        }
        longest[l.panel] = Math.max(longest[l.panel], l.text.length);
        if (l.text.length > ROW_MAX[l.panel])
          problems.push(`${where}: ${l.text.length} characters (max ${ROW_MAX[l.panel]})`);
      }
      const p3 = r.lines.filter((l: Filled) => l.panel === "P3");
      if (!p3.length) problems.push(`${at}: P3 says nothing for ${ctx.p3}`);
      for (const broken of rules(ctx, r.lines)) problems.push(`${at}: ${broken}`);
    }
  }
  for (const naming of NAMINGS)
    for (const [label, c] of Object.entries(naming.conds))
      if (SUBTYPE.test(c.name)) problems.push(`condition "${label}" (${naming.id}): a subtype number in "${c.name}"`);
  const texts = [...claims.keys()];
  const fit = await claimLines(texts);
  texts.forEach((t, i) => {
    for (const size of ["desktop", "phone"] as const)
      if (fit[size][i] > FIT[size].lines)
        problems.push(
          `${claims.get(t)}: ${fit[size][i]} lines at ${FIT[size].width} px (max ${FIT[size].lines}): "${t}"`,
        );
  });
  const tallest = (size: "desktop" | "phone") => Math.max(0, ...fit[size]);
  const summary = [
    `${counts}; ${lines} lines read under ${NAMINGS.length} namings`,
    `longest row ${longest.P2} characters in P2 (max ${ROW_MAX.P2}), ${longest.P3} in P3 (max ${ROW_MAX.P3})`,
    `${texts.length} distinct claims measured: tallest ${tallest("desktop")} lines at ${FIT.desktop.width} px (max ${FIT.desktop.lines}), ${tallest("phone")} at ${FIT.phone.width} px (max ${FIT.phone.lines})`,
    `${problems.length} problems`,
  ].join("; ");
  return {
    ok: problems.length === 0,
    detail: [summary, ...problems.slice(0, process.env.C2_ALL ? undefined : 40)].join("\n"),
  };
}

export const check: Check = {
  id: "C2",
  title: "P2 and P3 copy: no missing slot, every line fits, every unit covered, no competing lines",
  owner: "E",
  run,
};
