// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { cnvCases } from "../spine/cnv-cases";
import { flagships } from "../spine/flagships";
import { mechanismCases } from "../spine/mechanism-cases";
import { proofs } from "../spine/proofs";
import { regress } from "../spine/regress";
import { specimens } from "../spine/specimens";
import type { Check } from "./_check";

export const check: Check = {
  id: "S2",
  title: "The spine's flagship check and regression: all pass, 0 differs",
  owner: "A-spine",
  run: async () => {
    const f = await flagships();
    const r = await regress();
    const s = await specimens();
    const p = await proofs();
    const c = await cnvCases();
    if (c.found + c.held !== c.cases) p.problems.push(`${c.cases - c.found - c.held} copy-number cases were not read`);
    const m = await mechanismCases();
    const problems = [...m.problems, ...f.problems, ...r.differs, ...s.problems, ...p.problems, ...c.problems];
    if (r.match === 0) problems.push("the regression compared no field");
    return {
      ok: problems.length === 0,
      detail: problems.length
        ? problems.slice(0, 40).join("\n")
        : `flagships ${f.passed}/${f.total}, stage counts equal; regression over ${r.records} records: ${r.match} fields match, 0 differ (${r.juneOnly} set aside, ${r.contractOnly} only in the bundle); ${s.ok} facts agree with the renderer's specimens; ${p.passed}/${p.total} behaviours proven on made-up records; ${c.found}/${c.cases} copy-number cases read and ${c.held} held back by the dosage cut, ${c.equal} fields equal to the test set; ${m.agree}/${m.examples} of the mechanism review's variants name the condition it proposed (${m.tieBreaks} more the most-named one, ${m.crossCarriers} the recessive one as cross-gene carriers, ${m.notRead} are not coding changes)`,
    };
  },
};
