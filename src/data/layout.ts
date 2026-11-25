// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The bundle's file names and the one order they are fetched in: shared by the tool that builds it and the loader.

import type { ChromIndex, SampleId } from "../contracts/app";
import { CHROM_Y, CHROMS } from "../contracts/constants";

export const MANIFEST = "manifest.json";
/**
 * Bundle files are gzip, inflated by the loader. They do not end in .gz: a server that sees that
 * ending may declare the encoding, the browser would then inflate in transit, and the bytes would
 * no longer be the ones the manifest lists.
 */
const PACKED_ENDING = ".pack";
export const KEEP_WINDOWS = `keep-windows${PACKED_ENDING}`;
export const GENES = `genes${PACKED_ENDING}`;
export const RULERS = `rulers${PACKED_ENDING}`;
export const COPY_NUMBER = `copy-number${PACKED_ENDING}`;

/** The chromosomes the packs cover: 1 to 22 and X. */
export const PACKED: readonly ChromIndex[] = CHROMS.map((_, c) => c).filter((c) => c !== CHROM_Y);
export const chromFile = (c: ChromIndex): string => `chr${CHROMS[c]}${PACKED_ENDING}`;

/** A chromosome file's sections. A gene's fold and sites sit beside them under `foldSection`. */
export const SECTION = {
  clinvar: "clinvar",
  gnomad: "gnomad",
  alphamissense: "alphamissense",
  reference: "reference",
  referenceIndex: "reference-index",
  transcripts: "transcripts",
  windows: "windows",
} as const;
export const foldSection = (gene: string): string => `fold/${gene}`;

/** Every bundle file, in the order everyone fetches them: the keep windows first, so a read can start. */
export const fetchOrder = (): string[] => [KEEP_WINDOWS, GENES, RULERS, COPY_NUMBER, ...PACKED.map(chromFile)];

/** A sample is fetched only when it is chosen; it is not part of a file's read. */
export const sampleFile = (id: SampleId): string => `samples/${id}.json`;
