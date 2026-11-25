// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The sniff: the first bytes of a chosen file decide whether it can be read, before anything is read.

import type { RefusalReason } from "../contracts/app";
import { CHR1_LENGTH, HEADER_CAP_BYTES, SNIFF_BYTES } from "../contracts/constants";
import { BGZF_HEADER, bgzfBlockLength, chromIndex, inflateMember } from "./stream";

/* A gzip/BGZF file is inflated only as far as its header: a truncated stream is expected. chr1's
   ##contig length is decisive for the build; ##reference is the second signal, and the two must agree. */

type SniffResult =
  | {
      ok: true;
      sample: string;
      /** null: the header does not say, or says two things. The file's own REF letters then decide. */
      build: "GRCh38" | null;
      chrPrefix: boolean;
      compressed: "bgzf" | "gzip" | "none";
    }
  | { ok: false; reason: RefusalReason; detail: string };

/** A plain file a slice at a time, the first already read. */
async function* slices(file: Blob, first: Uint8Array): AsyncGenerator<Uint8Array> {
  yield first;
  for (let at = first.length; at < file.size; at += SNIFF_BYTES)
    yield new Uint8Array(await file.slice(at, at + SNIFF_BYTES).arrayBuffer());
}

/** A BGZF file inflated member by member: a native stream stops after the first, which holds at most 64 KB. */
async function* bgzfText(file: Blob): AsyncGenerator<Uint8Array> {
  let off = 0;
  let buf = new Uint8Array(0);
  for (;;) {
    const length = buf.length >= BGZF_HEADER ? bgzfBlockLength(buf, 0) : 0;
    if (length < 0) return;
    if (length === 0 || buf.length < length) {
      if (off >= file.size) return;
      const s = new Uint8Array(await file.slice(off, off + SNIFF_BYTES).arrayBuffer());
      off += s.length;
      const joined = new Uint8Array(buf.length + s.length);
      joined.set(buf);
      joined.set(s, buf.length);
      buf = joined;
      continue;
    }
    try {
      yield await inflateMember(buf.subarray(0, length));
    } catch {
      return; // a damaged member: the read reports it, the sniff judges what came before
    }
    buf = buf.subarray(length);
  }
}

/** A plain gzip file through one native stream. A truncated stream errors at its end: what came before is kept. */
async function* gzipText(file: Blob): AsyncGenerator<Uint8Array> {
  const reader = file.stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      yield value;
    }
  } catch {
    /* truncated: expected */
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

/**
 * The file's text from the start until the header's #CHROM line has arrived whole: at least the first
 * SNIFF_BYTES, more only while the text is a VCF header, and never past HEADER_CAP_BYTES.
 */
async function headText(chunks: AsyncIterable<Uint8Array>): Promise<string> {
  const dec = new TextDecoder();
  let text = "";
  let from = 0;
  for await (const chunk of chunks) {
    text += dec.decode(chunk, { stream: true });
    if (text.length > HEADER_CAP_BYTES) break;
    // Looked for from just before the new text, so a line split between chunks is found.
    const chrom = text.startsWith("#CHROM") ? 0 : text.indexOf("\n#CHROM", Math.max(0, from - 8));
    from = text.length;
    if (chrom >= 0 && text.indexOf("\n", chrom + 1) >= 0) break;
    if (text.length >= SNIFF_BYTES && !/^\s*##fileformat=VCF/.test(text)) break;
  }
  return text;
}

/** A chip file's data row, its comment header stripped: an rsID (or 23andMe's own "i" IDs), then the next column. */
const CHIP_ROW = /^"?(rs|i)\d+"?[\t,]/;

export async function sniff(file: File): Promise<SniffResult> {
  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  const name = file.name.toLowerCase();
  if (!head.length) return { ok: false, reason: "empty", detail: "no bytes" };
  if (head.length >= 4 && String.fromCharCode(...head.slice(0, 4)) === "CRAM")
    return { ok: false, reason: "raw", detail: "CRAM" };
  if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b) {
    // Chip companies ship their raw data as a zip of one .txt or .csv: the first entry's name, from the
    // local file header (name length at byte 26, the name from byte 30), says which.
    const entry = head.length >= 30 ? String.fromCharCode(...head.slice(30, 30 + (head[26] | (head[27] << 8)))) : "";
    if (/\.(txt|csv)$/i.test(entry)) return { ok: false, reason: "chip", detail: "chip raw data, zipped" };
    return { ok: false, reason: "zip", detail: `zip archive of ${entry || "an unnamed entry"}` };
  }
  const gz = head[0] === 0x1f && head[1] === 0x8b;
  // BGZF: gzip with FEXTRA and the "BC" subfield (SAM/BGZF spec §4.1)
  const bgzf = gz && (head[3] & 4) !== 0 && head[12] === 66 && head[13] === 67;
  const text = await headText(bgzf ? bgzfText(file) : gz ? gzipText(file) : slices(file, head));
  if (gz && text.startsWith("BAM\u0001")) return { ok: false, reason: "raw", detail: "BAM" };
  if (text.startsWith("BCF\u0002")) return { ok: false, reason: "bcf", detail: "BCF" };
  const lines = text.split(/\r?\n/);
  const first = lines.find((l) => l.trim()) ?? "";
  if (first.startsWith("@") && lines[2]?.startsWith("+")) return { ok: false, reason: "raw", detail: "FASTQ" };
  if (
    /23andme|ancestrydna|myheritage|familytreedna/i.test(text.slice(0, 4000)) ||
    /^#?\s*rsid[\t,]/im.test(text.slice(0, 20000)) ||
    /^"?RSID"?,/m.test(text.slice(0, 20000)) ||
    CHIP_ROW.test(first)
  )
    return { ok: false, reason: "chip", detail: "chip raw data" };
  if (!first.startsWith("##fileformat=VCF"))
    return {
      ok: false,
      reason: "unreadable",
      detail: name.endsWith(".vcf") || name.endsWith(".vcf.gz") ? "VCF without a fileformat line" : "not a VCF",
    };

  let chr1: number | null = null,
    ref = "",
    chrom: string | null = null,
    prefix = false;
  for (const l of lines) {
    if (l.startsWith("##contig=")) {
      const id = /ID=([^,>]+)/.exec(l)?.[1],
        len = /length=(\d+)/.exec(l)?.[1];
      if (id && chromIndex(id) === 0) {
        prefix = /^chr/i.test(id);
        if (len) chr1 = +len;
      }
    } else if (l.startsWith("##reference=")) ref = l.slice(12);
    else if (l.startsWith("#CHROM")) {
      chrom = l;
      break;
    }
  }
  const byContig = chr1 === CHR1_LENGTH.GRCh38 ? "GRCh38" : chr1 === CHR1_LENGTH.GRCh37 ? "GRCh37" : null;
  const byRef = /grch38|hg38|hs38|GCA_000001405\.15/i.test(ref)
    ? "GRCh38"
    : /grch37|hg19|b37|hs37|human_g1k_v37/i.test(ref)
      ? "GRCh37"
      : null;
  const build = byContig && byRef && byContig !== byRef ? null : (byContig ?? byRef);
  if (build === "GRCh37")
    return {
      ok: false,
      reason: "grch37",
      detail: byContig ? `chr1 length ${CHR1_LENGTH.GRCh37}` : `##reference=${ref}`,
    };
  if (!chrom)
    return { ok: false, reason: "unreadable", detail: `no #CHROM line in the first ${text.length} characters` };
  const cols = chrom.split("\t");
  // A trailing tab leaves an empty column, which names no one.
  const samples = cols.slice(9).filter((s) => s.trim());
  if (samples.length === 0) return { ok: false, reason: "no-sample", detail: "sites only" };
  if (samples.length > 1) return { ok: false, reason: "multi", detail: `${samples.length} samples` };
  return {
    ok: true,
    sample: samples[0],
    build,
    chrPrefix: prefix,
    compressed: bgzf ? "bgzf" : gz ? "gzip" : "none",
  };
}
