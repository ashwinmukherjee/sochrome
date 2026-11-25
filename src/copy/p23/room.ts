// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// P2's and P3's half of a room's copy: the saved lines over the drafts, filled for one finding. No DOM.

import type { Finding, GeneInfo, RoomCopy } from "../../contracts/app";
import SAVED from "../json/copy23.json";
import {
  context,
  fill,
  KINDS,
  shows,
  slotsOf,
  type Bar,
  type Conditions,
  type Ctx,
  type Facts,
  type Kind,
  type Line,
} from "./model";
import { DECISIONS, SEED } from "./seed";

type SavedCopy = {
  decisions: Record<string, { pick: number | null }>;
  kinds: Record<string, { lines: Line[]; status: string }>;
  conditions: Record<string, { name: string; about: string; ok: boolean }>;
};
const saved = SAVED as unknown as SavedCopy;

/** The decisions block is read live; an unpicked decision takes its recommended option. */
const pick = (id: string): number => {
  const d = DECISIONS.find((x) => x.id === id);
  if (!d) throw new Error(`no decision ${id}`);
  return saved.decisions[id]?.pick ?? d.options.findIndex((o) => o.rec);
};
export const decisions = () => ({ verdict: pick("verdict"), condition: pick("condition"), carriers: pick("carriers") });

/** A kind's lines: the saved ones once edited or ticked, else the draft. A saved entry is never reworded here. */
export const linesOf = (k: Kind): Line[] => {
  const s = saved.kinds[k.id];
  return s && s.status !== "seed" ? s.lines : (SEED[k.id] ?? []);
};

/** A condition shows its name only once reviewed: ticked in the saved copy, or marked so in the gene's own record. */
export function conditionsFor(gene: GeneInfo | undefined): Conditions {
  const out: Conditions = {};
  for (const c of Object.values(gene?.conditions ?? {}))
    if (c?.reviewed && c.name.trim()) out[c.label] = { name: c.name, about: c.about, ok: true };
  for (const [label, c] of Object.entries(saved.conditions)) if (c.ok && c.name.trim()) out[label] = c;
  return out;
}

export interface Filled {
  kind: string;
  panel: "P2" | "P3";
  unit: string;
  box: "claim" | "row";
  template: string;
  text: string;
  missing: string[];
  /** How many lines showed for this unit; more than one is a problem (the first is used). */
  competing: number;
}
export interface Reading {
  ctx: Ctx;
  lines: Filled[];
  /** Required units no line covers, as "kind/unit"; a P3 situation with no kind at all is "p3/<situation>". */
  uncovered: string[];
}

/** Every line the panels show for one variant, in panel order, with what a check needs to judge it. */
export function read(ctx: Ctx, conds: Conditions): Reading {
  const slots = slotsOf(ctx, decisions(), conds);
  const lines: Filled[] = [];
  const uncovered: string[] = [];
  // P3's lines after its first refer back to the condition instead of restating the fallback.
  const again = { ...slots, condition: slots.conditionagain };
  let p3Said = 0;
  for (const k of KINDS) {
    if (!k.member(ctx)) continue;
    for (const u of k.units) {
      const hit = linesOf(k).filter((l) => l.unit === u.id && shows(l, ctx));
      if (!hit.length) {
        if (u.required(ctx)) uncovered.push(`${k.id}/${u.id}`);
        continue;
      }
      const spine = k.panel === "P3" && u.box === "claim";
      const f = fill(hit[0].t, spine && p3Said > 0 ? again : slots);
      if (spine) p3Said++;
      lines.push({
        kind: k.id,
        panel: k.panel,
        unit: u.id,
        box: u.box,
        template: hit[0].t,
        text: f.text,
        missing: f.missing,
        competing: hit.length,
      });
    }
  }
  if (!KINDS.some((k) => k.panel === "P3" && k.member(ctx))) uncovered.push(`p3/${ctx.p3}`);
  return { ctx, lines, uncovered };
}

/** What stops a room's copy from being shown as written. */
export const blockers = (r: Reading): string[] => [
  ...r.uncovered.map((u) => `${u}: no line covers this`),
  ...r.lines.filter((l) => l.missing.length).map((l) => `${l.kind}/${l.unit}: no ${l.missing.join(", ")}`),
];

/** Said in a panel's claim spine when its copy can't be filled: only in production, never a raw slot. */
export const DECLINED = {
  p2: "We can't show the evidence on this variant.",
  p3: "We can't say what this variant means for you.",
} as const;

const PROD = (import.meta as { env?: { PROD?: boolean } }).env?.PROD === true;

/** P2's and P3's copy for one finding. A missing slot throws in dev and declines visibly in production. */
export const p23Copy = (f: Finding, gene: GeneInfo | undefined): Pick<RoomCopy, "p2" | "p3"> => p23CopyOf(f.p23, gene);

/** The same, from the facts alone. */
export function p23CopyOf(facts: Facts, gene: GeneInfo | undefined): Pick<RoomCopy, "p2" | "p3"> {
  const ctx = context(facts);
  const r = read(ctx, conditionsFor(gene));
  const bad = blockers(r);
  if (bad.length) {
    if (!PROD) throw new Error(`${ctx.title}: ${bad.join("; ")}`);
    return { p2: { open: DECLINED.p2, bars: {}, verdict: "" }, p3: { kind: "declined", lines: [DECLINED.p3] } };
  }
  const p2 = r.lines.filter((l) => l.panel === "P2");
  const unit = (id: string) => p2.find((l) => l.unit === id)?.text;
  const bars: Partial<Record<Bar["id"], string>> = {};
  for (const b of ctx.bars) {
    const t = unit(`bar:${b.id}`);
    if (t) bars[b.id] = t;
  }
  const condition = unit("condition");
  return {
    p2: { open: unit("open") ?? "", bars, verdict: unit("verdict") ?? "", ...(condition ? { condition } : {}) },
    p3: { kind: ctx.p3, lines: r.lines.filter((l) => l.panel === "P3").map((l) => l.text) },
  };
}

/** How P3's lines lay out: the claim spine's sentences in order, and the figure's three ledger rows. */
export function p3Layout(p3: RoomCopy["p3"]): { claims: string[]; rows: string[] } {
  if (p3.kind !== "figure") return { claims: p3.lines, rows: [] };
  // The figure's template is four beats, then three rows; anything after them is said in the spine.
  return { claims: [...p3.lines.slice(0, 4), ...p3.lines.slice(7)], rows: p3.lines.slice(4, 7) };
}

/** The ends of P2's rule and its centre. Set uppercase by CSS. */
export const POLES = { harmless: "Benign", open: "Uncertain", harmful: "Pathogenic" } as const;

/** A bar's strength as its ledger row's first line: sentence case. */
export const tierWord = (tier: string): string => tier.charAt(0).toUpperCase() + tier.slice(1);

/** The figure's three groups in the array's order, each with the line above its row's sentence. */
export const P3_GROUPS = [
  { id: "baseline", label: "Get it anyway" },
  { id: "added", label: "Get it because of this variant" },
  { id: "none", label: "Don't get it" },
] as const;
export type P3Group = (typeof P3_GROUPS)[number]["id"];
