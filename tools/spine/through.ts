// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Records through parse, normalize, pin, annotate and join, each chromosome against its own packs. No cuts.

import type { ChromData } from "../../src/contracts/app";
import { CHROMS } from "../../src/contracts/constants";
import type { JoinedVariant, VcfRecord } from "../../src/contracts/types";
import { annotate } from "../../src/spine/annotate";
import { buildModel, type GeneModel, type RefGetter } from "../../src/spine/facts/model";
import { join } from "../../src/spine/join";
import { normalize } from "../../src/spine/normalize";
import { pin } from "../../src/spine/pin";
import { getRefBases } from "../../src/spine/tables";
import { bundleOnDisk } from "./parity";

export const chromIndex = (chrom: string): number => (CHROMS as readonly string[]).indexOf(chrom.replace(/^chr/, ""));

/** A chromosome's packs, by its name with or without "chr". */
export async function chromData(chrom: string): Promise<ChromData> {
  return (await bundleOnDisk()).chrom(chromIndex(chrom));
}

export const refGetter =
  (d: ChromData): RefGetter =>
  (pos, n) =>
    getRefBases(d.reference.bin, d.reference.index, pos, n);

/** One transcript's gene model. */
export async function modelFor(chrom: string, transcript: string): Promise<GeneModel> {
  const d = await chromData(chrom);
  const tx = d.transcripts.find((t) => t.transcript === transcript);
  if (!tx) throw new Error(`no ${transcript} on ${chrom}`);
  return buildModel(tx, refGetter(d));
}

/** Join every record, intergenic ones included. */
export async function joinRecords(records: VcfRecord[]): Promise<JoinedVariant[]> {
  const out: JoinedVariant[] = [];
  for (const chrom of new Set(records.map((r) => r.chrom))) {
    const d = await chromData(chrom);
    const { bin, index } = d.reference;
    const normalized = normalize(
      records.filter((r) => r.chrom === chrom),
      bin,
      index,
    );
    const annotated = annotate(pin(normalized, d.transcripts), d.transcripts, bin, index);
    out.push(...join(annotated, d.clinvar, d.gnomad, d.alphamissense, d.windows));
  }
  return out;
}
