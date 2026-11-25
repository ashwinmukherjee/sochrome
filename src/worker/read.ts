// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// One file, from the sniff to the result: every step tells the page what it did, and nothing else leaves.

import type { DataBundle, ReadEvent, ReadRequest } from "../contracts/app";
import { CHROM_X, CHROM_Y, CHROMS } from "../contracts/constants";
import type { BundleLoader } from "../data/bundle";
import { checkRefLetters, referenceVerdict, type RefTally } from "../spine/build";
import { parseLines } from "../spine/parse";
import { readGenome, sexPairOf } from "../spine/pipeline";
import { copiesOfX, tallyX } from "../spine/sex";
import { INFLATED_CAP_BYTES, KEPT_CAP_BYTES, Refusal } from "./refusal";
import { sniff } from "./sniff";
import { readVcf } from "./stream";

interface ReaderData {
  loader: BundleLoader;
  /** How much of the bundle has arrived, 0 to 1. */
  fraction(): number;
}

/** The file's name without the endings a VCF carries. */
export const stem = (name: string): string => name.replace(/(\.g)?\.vcf(\.b?gz)?$/i, "") || name;

/**
 * Whether the file is on the bundle's reference, from its own REF letters: the first chromosomes
 * with enough records decide. A header that states no build is turned away when the letters cannot say.
 */
async function checkBuild(lines: readonly string[][], data: DataBundle, stated: "GRCh38" | null): Promise<void> {
  const tally: RefTally = { checked: 0, matched: 0 };
  for (let c = 0; c < CHROMS.length && referenceVerdict(tally) === "undecided"; c++) {
    if (!lines[c].length || !data.genes.some((g) => g.chrom === CHROMS[c])) continue;
    checkRefLetters(lines[c], (await data.chrom(c)).reference, tally);
  }
  const verdict = referenceVerdict(tally);
  const detail = `${tally.matched} of ${tally.checked} REF letters match`;
  if (verdict === "differs") throw new Refusal("wrong-build", detail);
  if (verdict === "undecided" && stated === null) throw new Refusal("no-build", `no build stated; ${detail}`);
}

/** Read `req.file` and emit what happened. Never throws: a file turned away is an `error` event. */
export async function readFile(
  req: Extract<ReadRequest, { type: "file" }>,
  data: ReaderData,
  emit: (e: ReadEvent) => void,
): Promise<void> {
  try {
    if (typeof DecompressionStream === "undefined") throw new Refusal("old-browser", "no DecompressionStream");
    const { file } = req;
    const sniffed = await sniff(file);
    if (!sniffed.ok) throw new Refusal(sniffed.reason, sniffed.detail);
    const displayName = stem(file.name);
    emit({ type: "start", displayName, bytesTotal: file.size });
    emit({ type: "reference", fraction: data.fraction() });
    const [windows, bundle] = await Promise.all([data.loader.keepWindows, data.loader.bundle]);
    /** Two copies of X name the pair whatever Y holds, so the sex row settles the moment its own bar is read. */
    let toldEarly = false;
    const scan = await readVcf(file, {
      windows,
      lengths: bundle.rulers.genomic,
      inflatedCap: INFLATED_CAP_BYTES,
      keptCap: KEPT_CAP_BYTES,
      onProgress: (chromIndex, fraction, records, bytesRead) => emit({ type: "progress", chromIndex, fraction, records, bytesRead }), // prettier-ignore
      onChromDone: (chromIndex, records, kept) => {
        emit({ type: "chrom-done", chromIndex, records });
        if (chromIndex !== CHROM_X || copiesOfX(tallyX(parseLines(kept))) !== 2) return;
        emit({ type: "sex", copiesX: 2, pair: sexPairOf(2, 0) });
        toldEarly = true;
      },
    });
    // Records, but not one genotype: a list of variants, as a sites-only file is.
    if (!scan.called && scan.parsed.some((n) => n > 0)) throw new Refusal("no-sample", "no record holds a genotype");
    // Copy-number or structural calls and not one small variant: the test's other VCF is the one to read.
    if (scan.structural && !scan.small) throw new Refusal("structural", "only copy-number or structural calls");
    // Not one record on a chromosome this reads: "nothing found" would be a claim about rows never read.
    if (scan.parsed.every((n) => n === 0)) throw new Refusal("no-variants", "no record on 1 to 22, X or Y");
    // Every byte is read: say so, so the page never guesses where the file ended.
    const last = scan.parsed.reduce((at, n, i) => (n ? i : at), 0);
    emit({ type: "progress", chromIndex: last, fraction: 1, records: scan.parsed[last] ?? 0, bytesRead: file.size });
    // Otherwise the pair needs Y as well, so it is told once every byte is read, not after the reference data lands
    // (minutes on a phone). The result names the same pair, from the same lines.
    if (!toldEarly) {
      const copiesX = copiesOfX(tallyX(parseLines(scan.lines[CHROM_X] ?? [])));
      emit({ type: "sex", copiesX, pair: sexPairOf(copiesX, scan.parsed[CHROM_Y] ?? 0) });
    }
    // The stages start on the whole reference: what the page is told arrived is what the file was read against.
    await data.loader.landed;
    await checkBuild(scan.lines, bundle, sniffed.build);
    const result = await readGenome(
      {
        source: { kind: "file", name: file.name, bytes: file.size },
        displayName,
        lines: scan.lines,
        parsed: scan.parsed,
        leaveOut: req.leaveOut,
        covered: scan.covered,
      },
      bundle,
    );
    emit({ type: "done", result });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    emit({ type: "error", reason: e instanceof Refusal ? e.reason : "broken", detail });
  }
}
