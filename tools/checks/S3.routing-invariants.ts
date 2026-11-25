// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { clinvarSample } from "../spine/clinvar-sample";
import { everyFacts, invariants } from "../spine/invariants";
import type { Check } from "./_check";

export const check: Check = {
  id: "S3",
  title: "Routing invariants over every facts record",
  owner: "A-spine",
  run: async () => {
    const problems: string[] = [];
    const lines: string[] = [];
    let checked = 0;
    for (const { from, facts } of await everyFacts()) {
      const r = invariants(facts);
      checked += r.checked;
      problems.push(...r.problems.map((p) => `${from}: ${p}`));
      lines.push(`${from}: ${facts.length} records, ${r.checked} routed`);
    }
    const cv = await clinvarSample();
    problems.push(...cv.problems);
    lines.push(
      `ClinVar selection: ${cv.joined} of ${cv.variants} found in the packed tables, classification, review status and lab split equal to ClinVar's file; 0 threw`,
    );
    if (checked === 0) problems.push("no routed record was checked");
    return {
      ok: problems.length === 0,
      detail: problems.length
        ? problems.slice(0, 40).join("\n")
        : `${checked} routed records hold\n${lines.join("\n")}`,
    };
  },
};
