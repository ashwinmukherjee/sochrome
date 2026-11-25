// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Finding, GenomeResult } from "../../src/contracts/app";
import { CHROMS } from "../../src/contracts/constants";
import { context as p1Context } from "../../src/copy/p1/slots";
import { context as p23Context } from "../../src/copy/p23/model";
import { type Check, ROOT } from "./_check";

const DIR = resolve(ROOT, "test/fixtures");

/** What every view may rely on, checked on the JSON itself. */
function problems(name: string, r: GenomeResult): string[] {
  const out: string[] = [];
  const say = (ok: boolean, what: string) => {
    if (!ok) out.push(`${name}: ${what}`);
  };
  say(r.parsed.length === CHROMS.length, "parsed is not 24 entries");
  say(r.parsed.reduce((a, b) => a + b, 0) === r.counts.all, "parsed does not sum to counts.all");
  say(r.counts.yours + r.counts.carriers === r.counts.rare, "yours + carriers is not rare");
  say(
    r.yours.length === r.counts.yours && r.carriers.length === r.counts.carriers,
    "the lists do not match their counts",
  );
  say(r.marks.length === r.counts.coding, "marks are not the coding cut's survivors");
  say(
    r.marks.filter((m) => m[3] >= 2).length === r.counts.protein,
    "level-2 marks are not the protein cut's survivors",
  );
  say(r.marks.filter((m) => m[3] === 3).length === r.counts.rare, "level-3 marks are not the rare cut's survivors");
  say(r.marks.filter((m) => m[4] === 1).length === r.counts.carriers, "carrier marks do not match the carriers");
  const keys = new Set<string>();
  for (const f of [...r.yours, ...r.carriers] as Finding[]) {
    say(!keys.has(f.key), `${f.key} appears twice`);
    keys.add(f.key);
    say(
      !!f.name && f.bundle?.object_type === "mendelian" && Array.isArray(f.facts?.drawings) && !!f.p23?.key,
      `${f.key} is not a whole finding`,
    );
    try {
      p23Context(f.p23);
      // The P1 copy still reads its own looser shape of the facts; reading the contract's is the P1 copy's own change to make.
      const facts = f.facts as unknown as Parameters<typeof p1Context>[0];
      f.facts.drawings.forEach((_, i) => p1Context(facts, i));
    } catch (e) {
      out.push(`${name}: ${f.key}: the copy models throw: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}

export const check: Check = {
  id: "T2",
  title: "Every fixture parses as a GenomeResult the views and copy models can read",
  owner: "lead",
  run: () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".result.json"));
    const bad = files.flatMap((f) => problems(f, JSON.parse(readFileSync(resolve(DIR, f), "utf8")) as GenomeResult));
    return {
      ok: files.length >= 4 && bad.length === 0,
      detail: bad.length ? bad.slice(0, 30).join("\n") : `${files.length} fixtures`,
    };
  },
};
