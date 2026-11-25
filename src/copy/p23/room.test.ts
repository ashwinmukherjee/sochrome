// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Finding, GenomeResult } from "../../contracts/app";
import type { Cnv } from "./cnv";
import type { Facts } from "./model";
import { context, figureFor, FIGURES } from "./model";
import { p23Copy, p3Layout } from "./room";

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, `../../../test/fixtures/${name}.result.json`), "utf8"),
  ) as GenomeResult;
const findings: Finding[] = ["hg002", "hg001", "empty", "x-one"].flatMap((n) => {
  const r = fixture(n);
  return [...r.yours, ...r.carriers];
});

describe("p23Copy", () => {
  it("fills every fixture finding with no DOM and no raw slot", () => {
    expect(findings.length).toBeGreaterThan(100);
    for (const f of findings) {
      const ctx = context(f.p23);
      const { p2, p3 } = p23Copy(f, undefined);
      const all = [p2.open, p2.verdict, p2.condition ?? "", ...Object.values(p2.bars), ...p3.lines];
      expect(all.join(" "), ctx.title).not.toMatch(/[{}]/);
      expect(p2.open && p2.verdict, ctx.title).toBeTruthy();
      for (const b of ctx.bars) expect(p2.bars[b.id], `${ctx.title} ${b.id}`).toBeTruthy();
      expect(!!p2.condition, ctx.title).toBe(ctx.tags.includes("harmful"));
      expect(p3.kind).toBe(ctx.p3);
      expect(p3.lines.length, ctx.title).toBeGreaterThan(0);
    }
  });

  it("names a condition only once reviewed, and never by ClinGen's label", () => {
    for (const f of findings) {
      const ctx = context(f.p23);
      if (!ctx.tags.includes("harmful") || !ctx.label) continue;
      const { p2 } = p23Copy(f, undefined);
      expect(p2.condition, ctx.title).toBe("It's linked to a condition caused by changes in this gene.");
    }
  });

  it("lays a figure out as four beats and three rows", () => {
    const lines = ["a", "b", "c", "d", "r1", "r2", "r3", "next"];
    expect(p3Layout({ kind: "figure", lines })).toEqual({
      claims: ["a", "b", "c", "d", "next"],
      rows: ["r1", "r2", "r3"],
    });
    expect(p3Layout({ kind: "carrier", lines: ["x", "y"] })).toEqual({ claims: ["x", "y"], rows: [] });
  });
});

describe("the accepted copy rules", () => {
  const first = (kind: string) => {
    const f = findings.find((x) => context(x.p23).p3 === kind);
    if (!f) throw new Error(`no fixture finding reads ${kind}`);
    return f;
  };

  it('says "this condition" after P3\'s first line when the name falls back', () => {
    const { p3 } = p23Copy(first("carrier"), undefined);
    expect(p3.lines[0]).toBe("You carry one copy of this variant.");
    expect(p3.lines[1]).toBe("This condition only develops with two altered copies.");
    expect(p3.lines.join(" ")).not.toContain("a condition linked to this gene");
  });
});

describe("the labs' bar", () => {
  it("counts classifications, not labs, where labs disagree", () => {
    const f = findings.find((x) => context(x.p23).tags.includes("disagree"));
    if (!f) throw new Error("no fixture finding has disagreeing labs");
    expect(p23Copy(f, undefined).p2.bars.labs).toMatch(/^Of the \S+ classifications labs have submitted, /);
  });
});

describe("P3's last beat", () => {
  const CONFIRM = "Before you act on this, a clinical lab should confirm it, since genome files can be wrong.";
  const COUNSEL = "A genetic counselor can explain what it means for you and your family.";
  const FAMILY = "If you're planning a family, a genetic counselor can explain what it means for your children.";

  it("points a settled harmful variant to a lab and a counselor, a carrier to a counselor, and no one else", () => {
    const seen = new Set<string>();
    for (const f of findings) {
      const ctx = context(f.p23);
      const said = p23Copy(f, undefined).p3.lines;
      const kind = ctx.p3.replace(/^cnv-/, "");
      seen.add(kind);
      if (kind === "not-known" || kind === "harmless") {
        expect(said.join(" "), ctx.title).not.toMatch(/counselor|clinical lab/);
      } else if (kind === "carrier") {
        expect(said.at(-1), ctx.title).toBe(FAMILY);
        expect(said, ctx.title).not.toContain(CONFIRM);
      } else {
        expect(said.slice(-2), ctx.title).toEqual([CONFIRM, COUNSEL]);
      }
    }
    expect([...seen]).toEqual(expect.arrayContaining(["not-known", "harmless", "carrier"]));
  });
});

/** A settled harmful change in a gene with a curated figure, made from a fixture finding. */
const inFigureGene = (clnsig: string): Finding => {
  const base = findings[0];
  return {
    ...base,
    p23: {
      ...base.p23,
      gene: "BRCA2",
      chrom: "13",
      zygosity: "het",
      copiesX: 2,
      mode: "AD",
      patterns: { AD: { label: "BRCA2-related cancer predisposition", validity: "Definitive" } },
      clinvar: {
        id: "0",
        clnsig,
        class: "pathogenic",
        review: "multiple",
        revstat: "criteria provided, multiple submitters, no conflicts",
        stars: 2,
        conf: null,
      },
    },
  };
};

describe("an X the file leaves undecided", () => {
  // A settled harmful X-linked finding, read with no count of X.
  const onX = (zygosity: string): Finding => {
    const base = findings[0];
    return {
      ...base,
      p23: {
        ...base.p23,
        gene: "OTC",
        chrom: "X",
        zygosity,
        copiesX: null,
        mode: "XL",
        patterns: { XL: { label: "ornithine carbamoyltransferase deficiency", validity: "Definitive" } },
        clinvar: {
          id: "0",
          clnsig: "Pathogenic",
          class: "pathogenic",
          review: "multiple",
          revstat: "",
          stars: 2,
          conf: null,
        },
      },
    };
  };
  it("gives both readings for one altered copy, and assumes neither", () => {
    const f = onX("het");
    expect(context(f.p23).p3).toBe("x-unclear");
    const lines = p23Copy(f, undefined).p3.lines.join(" ");
    expect(lines).toMatch(/doesn't show how many copies of X/);
    expect(lines).toMatch(/With one copy of X.*With two/);
    expect(lines).not.toMatch(/You have two copies of X|Since you have one copy/);
  });
  it("reads every copy altered as true either way, never as both of two copies", () => {
    const f = onX("hom");
    expect(context(f.p23).p3).toBe("x-all");
    const lines = p23Copy(f, undefined).p3.lines.join(" ");
    expect(lines).toMatch(/every copy of it you have/);
    expect(lines).not.toMatch(/Both of your copies/);
  });
  it("draws only a figure that pools both copies of X", () => {
    expect(figureFor({ gene: "BRCA2", copiesX: null })).toBeUndefined();
    expect(figureFor({ gene: "MSH2", copiesX: null })).toBeDefined();
  });
});

describe("a carrier in a cross gene", () => {
  it('names the recessive condition where other carriers read "it"', () => {
    const carrier = findings.find((x) => context(x.p23).p3 === "carrier");
    if (!carrier) throw new Error("no fixture finding reads carrier");
    const plain = p23Copy(carrier, undefined).p3.lines.join(" ");
    const crossed = p23Copy({ ...carrier, p23: { ...carrier.p23, cross: true } }, undefined).p3.lines;
    expect(plain).toMatch(/won't develop it,/);
    expect(crossed.join(" ")).toMatch(/won't develop this condition,/);
    const after = crossed.findIndex((l) => /won't develop this condition,/.test(l)) + 1;
    expect(crossed[after]).toMatch(/^This gene is also linked to another condition, .* isn't known to cause it\.$/);
    expect(plain).not.toMatch(/another condition/);
  });
});

describe("a harmful class labs qualify as low penetrance", () => {
  it("reads as harmful, takes no figure, and P3 mentions it", () => {
    expect(context(inFigureGene("Pathogenic").p23).p3).toBe("figure");
    const flagged = inFigureGene("Pathogenic,_low_penetrance");
    const ctx = context(flagged.p23);
    expect(ctx.tags).toContain("harmful");
    expect(ctx.tags).toContain("penetrance:low");
    expect(ctx.p3).toBe("harmful");
    const { p2, p3 } = p23Copy(flagged, undefined);
    expect(p2.bars.labs).toBe("Several labs reviewed it independently, and all call it harmful.");
    expect(p3.lines[1]).toBe(
      "Labs note that it leads to the condition less often than most harmful variants in this gene do.",
    );
    expect(p3.lines.join(" ")).not.toMatch(/Picture 100 people/);
  });
});

describe("P3's figures", () => {
  it("keeps the pooled heart figures out of the product", () => {
    for (const gene of ["MYBPC3", "MYH7", "LMNA"]) expect(FIGURES[gene], gene).toBeUndefined();
  });
  it("draws the checked figures, and gives ATM and PTEN sentences", () => {
    expect(figureFor({ gene: "BRCA1", copiesX: 2 })).toMatchObject({ baseline: 13, added: 45, families: false });
    expect(figureFor({ gene: "BRCA2", copiesX: 2 })).toMatchObject({ baseline: 13, added: 40 });
    expect(figureFor({ gene: "BRCA2", copiesX: 1 })?.outcome).toBe("prostate cancer by age 80");
    expect(figureFor({ gene: "TP53", copiesX: 1 })).toMatchObject({ baseline: 22, added: 70, families: true });
    expect(figureFor({ gene: "TP53", copiesX: 2 })).toMatchObject({ baseline: 21, added: 77 });
    expect(FIGURES.ATM).toBeUndefined();
    expect(FIGURES.PTEN).toBeUndefined();
  });
  const at = (gene: string, hgvs_p: string | null, consequence = "missense_variant") =>
    figureFor({ gene, copiesX: 2, consequence, p1: hgvs_p ? ({ consequence, hgvs_p } as Facts["p1"]) : null });
  it("tells RET's risk tiers apart by codon, reads any other missense as moderate, and draws none for a change that isn't missense", () => {
    expect(at("RET", "p.Met918Thr")).toMatchObject({ outcome: "medullary thyroid cancer by age 45", added: 84 });
    expect(at("RET", "p.(Cys634Arg)")).toMatchObject({ added: 71 });
    expect(at("RET", "p.Val804Met")).toMatchObject({ outcome: "medullary thyroid cancer by age 75", added: 2 });
    expect(at("RET", "p.Arg77Ter", "stop_gained")).toBeUndefined();
    expect(at("RET", null)?.added).toBe(2);
  });
  it("draws APC's attenuated regions apart from classic FAP", () => {
    expect(at("APC", "p.Arg1450Ter", "stop_gained")).toMatchObject({ baseline: 0, added: 90 });
    expect(at("APC", "p.Arg93Ter", "stop_gained")).toMatchObject({ outcome: "colorectal cancer by age 80", added: 66 });
    expect(at("APC", null, "stop_gained")?.added).toBe(90);
  });
});

describe("MEN1", () => {
  it("draws its figure under the outcome as worded", () => {
    expect(figureFor({ gene: "MEN1", copiesX: 2 })).toMatchObject({
      outcome: "parathyroid tumors over a lifetime",
      baseline: 1,
      added: 89,
      families: true,
    });
  });
});

/** A copy-number change, made from a fixture finding. */
const cnvFinding = (cnv: Partial<Cnv>, more: Partial<Finding["p23"]> = {}): Finding => {
  const base = findings[0];
  return {
    ...base,
    p23: {
      ...base.p23,
      gene: "FANCA",
      chrom: "16",
      consequence: null,
      am: null,
      gnomad: null,
      p1: null,
      zygosity: "het",
      copiesX: 2,
      mode: "AR",
      patterns: { AR: { label: "Fanconi anemia complementation group A", validity: "Definitive" } },
      dosage: { hi: null, lofKnown: 546 },
      clinvar: {
        id: "0",
        clnsig: "Pathogenic",
        class: "pathogenic",
        review: "single",
        revstat: "criteria provided, single submitter",
        stars: 1,
        conf: null,
      },
      cnv: {
        dir: "loss",
        type: "Deletion",
        name: "",
        chrom: "16",
        start: 1,
        end: 2,
        size: 1,
        copies: 1,
        copiesStated: false,
        transcript: "",
        where: "inside",
        whole: false,
        exons: { first: 4, last: 7, of: 43 },
        fullExons: 4,
        share: 0.08,
        inFrame: false,
        plen: 1455,
        genes: 1,
        others: [],
        rating: { hi: null, ts: null, hiDisease: null, tsDisease: null },
        region: null,
        overlaps: { harmful: 0, uncertain: 0, harmless: 0 },
        rarity: { measured: false, source: "" },
        condition: null,
        ...cnv,
      },
      ...more,
    },
  };
};

describe("copy-number changes", () => {
  it("lets a lab-called loss that takes the gene out settle in an unrated gene with enough known cut-short variants", () => {
    expect(context(cnvFinding({}).p23).p3).toBe("cnv-carrier");
    expect(context(cnvFinding({}, { dosage: { hi: null, lofKnown: 4 } }).p23).p3).toBe("cnv-not-known");
    expect(context(cnvFinding({ inFrame: true }).p23).p3).toBe("cnv-not-known");
    expect(context(cnvFinding({ dir: "gain" }).p23).p3).toBe("cnv-not-known");
  });
});

describe("the copy-number rarity bar", () => {
  it("is hidden while no population set is in the bundle", () => {
    const f = cnvFinding({});
    expect(context(f.p23).bars.map((b) => b.id)).toEqual(["labs", "deletion", "overlap"]);
    expect(Object.keys(p23Copy(f, undefined).p2.bars)).toEqual(["labs", "deletion", "overlap"]);
  });
});

describe("a copy-number change spanning many genes", () => {
  const whole = { where: "whole", whole: true, exons: null, inFrame: null } as const;
  const rated = { rating: { hi: "3", ts: null, hiDisease: null, tsDisease: null } };

  it("settles when it spans few", () => {
    expect(context(cnvFinding({ ...whole, ...rated, genes: 3 }).p23).p3).not.toBe("cnv-not-known");
  });
  it("declines in P3 and says so in P2, by the set's count or the bundle's gene list", () => {
    for (const span of [{ genes: 26 }, { genes: 2, codingGenes: 40 }]) {
      const f = cnvFinding({ ...whole, ...rated, ...span });
      const ctx = context(f.p23);
      expect(ctx.p3).toBe("cnv-not-known");
      expect(ctx.tags).toContain("decline:many-genes");
      const { p2, p3 } = p23Copy(f, undefined);
      expect(p2.bars.deletion).toContain("many other genes");
      expect(p2.condition).toBeUndefined();
      expect(p3.lines).toEqual([
        "This deletion covers many genes, so what it means for you can't be read from FANCA alone.",
      ]);
    }
  });
});
