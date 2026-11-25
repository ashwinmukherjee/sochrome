// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { closeSync, openSync, readSync } from "node:fs";
import { crc32, deflateRawSync, gzipSync } from "node:zlib";
import type { ReadEvent, RefusalReason } from "../../src/contracts/app";
import { CHR1_LENGTH } from "../../src/contracts/constants";
import { REF_MIN_RECORDS } from "../../src/spine/build";
import { getRefBases } from "../../src/spine/tables";
import { Refusal } from "../../src/worker/refusal";
import { sniff } from "../../src/worker/sniff";
import { readVcf } from "../../src/worker/stream";
import { eventsOf, fileAt, loader } from "../bundle/node-read";
import { SAMPLES, sampleVcf } from "../spine/paths";
import type { Check, Result } from "./_check";

const FORMAT = "##fileformat=VCFv4.2";
const columns = (...samples: string[]) => ["#CHROM", "POS", "ID", "REF", "ALT", "QUAL", "FILTER", "INFO", ...(samples.length ? ["FORMAT", ...samples] : [])].join("\t"); // prettier-ignore
const contig = (length: number) => `##contig=<ID=chr1,length=${length}>`;
const record = (pos: number, ref: string, alt: string) => `chr1\t${pos}\t.\t${ref}\t${alt}\t50\tPASS\t.\tGT\t0/1`;
const vcf = (...lines: string[]) => `${lines.join("\n")}\n`;
const file = (name: string, body: string | Uint8Array<ArrayBuffer>) => new File([body], name);

const OTHER: Record<string, string> = { A: "C", C: "G", G: "T", T: "A" };

/** Records on chromosome 1's shipped reference: REF as the reference has it, or deliberately another letter. */
async function records(count: number, right: boolean): Promise<string[]> {
  const l = loader();
  const windows = (await l.keepWindows)[0];
  const { reference } = await (await l.bundle).chrom(0);
  if (!windows) throw new Error("the bundle has no keep windows for chromosome 1");
  const out: string[] = [];
  for (let w = 0; w < windows.length && out.length < count; w += 2)
    for (let pos = windows[w] + 2; pos < windows[w + 1] && out.length < count; pos += 7) {
      const letter = getRefBases(reference.bin, reference.index, pos, 1);
      if (!letter || !OTHER[letter]) continue;
      out.push(right ? record(pos, letter, OTHER[letter]) : record(pos, OTHER[letter], letter));
    }
  return out;
}

/** The first bytes of a real file: enough to pass the sniff, cut inside a block. */
function headOf(path: string, bytes: number): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(bytes);
  const fd = openSync(path, "r");
  readSync(fd, buf, 0, bytes, 0);
  closeSync(fd);
  return buf;
}

/** Text as BGZF, a member per `block` bytes, ending on the standard empty member unless `end` is false (SAM specification §4.1). */
function bgzf(text: string, block: number, end = true): Uint8Array<ArrayBuffer> {
  const member = (part: Buffer): Buffer => {
    const body = deflateRawSync(part);
    const head = Buffer.from([31, 139, 8, 4, 0, 0, 0, 0, 0, 255, 6, 0, 66, 67, 2, 0, 0, 0]);
    head.writeUInt16LE(head.length + body.length + 8 - 1, 16);
    const tail = Buffer.alloc(8);
    tail.writeUInt32LE(crc32(part), 0);
    tail.writeUInt32LE(part.length, 4);
    return Buffer.concat([head, body, tail]);
  };
  const raw = Buffer.from(text);
  const members: Buffer[] = [];
  for (let at = 0; at < raw.length; at += block) members.push(member(raw.subarray(at, at + block)));
  if (end) members.push(member(Buffer.alloc(0)));
  return new Uint8Array(Buffer.concat(members));
}

const last = (events: ReadEvent[]): string => {
  const e = events.at(-1);
  return !e ? "nothing" : e.type === "error" ? e.reason : e.type;
};

async function run(): Promise<Result> {
  const failed: string[] = [];
  let cases = 0;
  const expect = async (name: string, want: RefusalReason | "done", f: File): Promise<ReadEvent[]> => {
    cases++;
    const events = await eventsOf(f);
    if (last(events) !== want) failed.push(`${name}: wanted ${want}, got ${last(events)}`);
    return events;
  };

  const good = await records(REF_MIN_RECORDS * 2, true);
  const wrong = await records(REF_MIN_RECORDS * 2, false);
  const stated = [FORMAT, contig(CHR1_LENGTH.GRCh38), columns("S1")];

  await expect("chip, tab-separated", "chip", file("genome.txt", "# rsid\tchromosome\tposition\tgenotype\nrs1\t1\t100\tAA\n")); // prettier-ignore
  await expect("chip, comma-separated", "chip", file("dna.csv", "RSID,CHROMOSOME,POSITION,RESULT\nrs1,1,100,AA\n"));
  await expect("raw, FASTQ", "raw", file("reads.fastq", "@r1\nACGT\n+\nIIII\n"));
  await expect("raw, BAM", "raw", file("reads.bam", gzipSync(Buffer.from("BAM\u0001rest")) as Uint8Array<ArrayBuffer>));
  await expect("raw, CRAM", "raw", file("reads.cram", "CRAM\u0003\u0000rest"));
  await expect("grch37, by contig length", "grch37", file("a.vcf", vcf(FORMAT, contig(CHR1_LENGTH.GRCh37), columns("S1"), ...good))); // prettier-ignore
  await expect("grch37, by reference line", "grch37", file("a.vcf", vcf(FORMAT, "##reference=file:///ref/hg19.fa", columns("S1"), ...good))); // prettier-ignore
  await expect("multi", "multi", file("a.vcf", vcf(FORMAT, contig(CHR1_LENGTH.GRCh38), columns("S1", "S2"))));
  await expect("no-sample", "no-sample", file("a.vcf", vcf(FORMAT, contig(CHR1_LENGTH.GRCh38), columns())));
  const genotype = (gt: string) => good.map((r) => r.replace(/\tGT\t0\/1$/, gt));
  await expect("no-sample, no GT", "no-sample", file("a.vcf", vcf(...stated, ...genotype("\tDP\t30"))));
  await expect(
    "no-sample, every GT missing",
    "no-sample",
    file("a.vcf", vcf(...stated, ...genotype("\tGT:DP\t./.:30"))),
  );
  await expect("unreadable, not a VCF", "unreadable", file("notes.txt", "hello\nworld\n"));
  await expect("empty", "empty", file("a.vcf", ""));
  await expect("zip, not a chip file", "zip", file("a.zip", "PK\u0003\u0004rest"));
  await expect("chip, comment header stripped", "chip", file("genome.txt", "rs1\t1\t100\tAA\nrs2\t1\t200\tAG\n"));
  await expect("bcf", "bcf", file("a.bcf", gzipSync(Buffer.from("BCF\u0002\u0002rest")) as Uint8Array<ArrayBuffer>)); // prettier-ignore
  // Nothing on a chromosome this reads: a header alone, the mitochondria alone, names it doesn't know.
  await expect("no-variants, a header alone", "no-variants", file("a.vcf", vcf(...stated)));
  const moved = (name: string) => good.map((r) => r.replace(/^chr1\t/, `${name}\t`));
  await expect("no-variants, the mitochondria alone", "no-variants", file("a.vcf", vcf(...stated, ...moved("chrM"))));
  await expect("no-variants, unknown names", "no-variants", file("a.vcf", vcf(...stated, ...moved("scaffold_1"))));
  await expect("unreadable, no column line", "unreadable", file("a.vcf", vcf(FORMAT, contig(CHR1_LENGTH.GRCh38))));
  await expect("no-build, too few records to tell", "no-build", file("a.vcf", vcf(FORMAT, columns("S1"), ...good.slice(0, 3)))); // prettier-ignore
  await expect("wrong-build, no build stated", "wrong-build", file("a.vcf", vcf(FORMAT, columns("S1"), ...wrong)));
  await expect("wrong-build, stated but the letters differ", "wrong-build", file("a.vcf", vcf(...stated, ...wrong)));
  await expect("broken, BGZF cut inside a block", "broken", file("a.vcf.gz", headOf(sampleVcf("hg002"), 200_000)));
  const blocks = vcf(...stated, ...good);
  await expect("broken, BGZF cut between blocks", "broken", file("a.vcf.gz", bgzf(blocks, 4096, false)));
  const whole = gzipSync(Buffer.from(vcf(...stated, ...good)));
  await expect("broken, gzip cut short", "broken", file("a.vcf.gz", whole.subarray(0, whole.length - 20) as Uint8Array<ArrayBuffer>)); // prettier-ignore

  // Accepted: plain, no build stated but the letters agree, and gzip in two members (every record must be counted).
  const counted = (events: ReadEvent[]) => events.flatMap((e) => (e.type === "done" ? [e.result.counts.all] : []))[0];
  const tally = async (name: string, f: File) => {
    const all = counted(await expect(name, "done", f));
    if (all !== undefined && all !== good.length)
      failed.push(`${name}: ${all} records counted, ${good.length} written`);
  };
  await tally("accepted, plain", file("a.vcf", vcf(...stated, ...good)));
  // Every row written twice: read once, so every count is as for the file written once.
  const counts = (events: ReadEvent[]) => events.flatMap((e) => (e.type === "done" ? [e.result.counts] : []))[0];
  const single = counts(await eventsOf(file("a.vcf", vcf(...stated, ...good))));
  const twice = counts(await expect("accepted, every row twice", "done", file("a.vcf", vcf(...stated, ...good.flatMap((r) => [r, r]))))); // prettier-ignore
  if (!single?.coding || single.coding !== twice?.coding || single.protein !== twice.protein)
    failed.push(`every row twice: ${twice?.coding} coding where once gives ${single?.coding}`);
  if (single?.all !== twice?.all)
    failed.push(`every row twice: ${twice?.all} variants where once gives ${single?.all}`);
  await tally("accepted, a tab after the sample's name", file("a.vcf", vcf(FORMAT, contig(CHR1_LENGTH.GRCh38), `${columns("S1")}\t`, ...good))); // prettier-ignore
  // Other spellings of chromosome 1: its case, and RefSeq's accession.
  const named = (name: string) => good.map((r) => r.replace(/^chr1\t/, `${name}\t`));
  const chr1As = (name: string, length: number) => `##contig=<ID=${name},length=${length}>`;
  await tally("accepted, Chr1", file("a.vcf", vcf(FORMAT, chr1As("Chr1", CHR1_LENGTH.GRCh38), columns("S1"), ...named("Chr1")))); // prettier-ignore
  await tally("accepted, NC_000001.11", file("a.vcf", vcf(FORMAT, columns("S1"), ...named("NC_000001.11"))));
  await expect("grch37, by a Chr1 contig's length", "grch37", file("a.vcf", vcf(FORMAT, chr1As("Chr1", CHR1_LENGTH.GRCh37), columns("S1"), ...named("Chr1")))); // prettier-ignore
  await tally("accepted, no build stated", file("a.vcf", vcf(FORMAT, columns("S1"), ...good)));
  await tally("accepted, BGZF", file("a.vcf.gz", bgzf(blocks, 4096)));
  // A header past the first slice and the first BGZF member, as hg38 with its alt, HLA and decoy contigs writes.
  const decoys = Array.from({ length: 8000 }, (_, i) => `##contig=<ID=chrUn_decoy${i},length=1000>`);
  const long = vcf(FORMAT, contig(CHR1_LENGTH.GRCh38), ...decoys, columns("S1"), ...good);
  await tally("accepted, a header longer than the first slice", file("a.vcf", long));
  await tally("accepted, BGZF with a header longer than a block", file("a.vcf.gz", bgzf(long, 65280)));
  const half = good.length >> 1;
  const members = Buffer.concat([gzipSync(Buffer.from(vcf(...stated, ...good.slice(0, half)))), gzipSync(Buffer.from(vcf(...good.slice(half))))]); // prettier-ignore
  await tally("accepted, gzip in two members", file("a.vcf.gz", members as Uint8Array<ArrayBuffer>));

  // too-large: the same read with a cap the file is over.
  cases++;
  const l = loader();
  const options = { windows: await l.keepWindows, lengths: (await l.bundle).rulers.genomic, onProgress: () => undefined, onChromDone: () => undefined }; // prettier-ignore
  for (const caps of [
    { inflatedCap: 1000, keptCap: Infinity },
    { inflatedCap: Infinity, keptCap: 1000 },
  ]) {
    // prettier-ignore
    const reason = await readVcf(file("a.vcf", vcf(...stated, ...good)), { ...options, ...caps }).then(() => "done", (e: unknown) => (e instanceof Refusal ? e.reason : "threw")); // prettier-ignore
    if (reason !== "too-large") failed.push(`too-large (${Object.keys(caps).find((k) => caps[k as keyof typeof caps] === 1000)}): got ${reason}`); // prettier-ignore
  }

  // old-browser: the same accepted file where the browser cannot inflate.
  const native = globalThis.DecompressionStream;
  try {
    Reflect.deleteProperty(globalThis, "DecompressionStream");
    await expect("old-browser", "old-browser", file("a.vcf", vcf(...stated, ...good)));
  } finally {
    globalThis.DecompressionStream = native;
  }

  // The real headers: both benchmark files pass the sniff as single-sample GRCh38 BGZF.
  for (const id of SAMPLES) {
    cases++;
    const s = await sniff(await fileAt(sampleVcf(id)));
    if (!s.ok || s.build !== "GRCh38" || s.compressed !== "bgzf") failed.push(`${id}: ${JSON.stringify(s)}`);
  }

  return { ok: failed.length === 0, detail: failed.length ? failed.join("\n") : `${cases} cases: every refusal reason, and the files that should be read` }; // prettier-ignore
}

export const check: Check = {
  id: "E6",
  title: "The sniff: every refusal on real and made-up headers",
  owner: "A-reader",
  run,
};
