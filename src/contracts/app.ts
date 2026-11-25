// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The seams between modules: what the reader hands the app, and what each view takes.

import type { ClaimCheck } from "../copy/p1/claims";
import type { Bar, Ctx as P23Ctx, Facts as P23Facts } from "../copy/p23/model";
import type { Fill } from "../ledger/dirs";
import type { CopyNumberData } from "../spine/cnv";
import type { GnomadWindow } from "../spine/join";
import type { Drawing, FoldSource, VariantFacts } from "../spine/facts/dispatch";
import type { InheritanceMode, MendelianBundle, PackedTable, ReferenceIndex, TranscriptModel } from "./types";

export type { ClaimCheck } from "../copy/p1/claims";
export type { Bar, Ctx as P23Ctx, Facts as P23Facts } from "../copy/p23/model";
export type { Fill } from "../ledger/dirs";
export type { P1Handle } from "../render/lib";
export type { CodonRecord, Drawing, FoldSource, VariantFacts } from "../spine/facts/dispatch";

// ── The privacy rule ──
// Nothing worked out from a person's file leaves the page's memory. `GenomeResult` and everything
// reachable from it stay in memory: never a URL, a title, storage, a request, or the console.

/** Index into CHROMS: 0-21 the autosomes, 22 X, 23 Y. */
export type ChromIndex = number;
export type SampleId = "hg003" | "hg002" | "hg001";
export type ListName = "yours" | "carriers";
export type SexPair = "XX" | "XY" | "X";

// ── (a) Reader worker ──

/** main → worker. A sample never reaches the worker: its result is computed at build time. */
export type ReadRequest =
  /** LOAD YOUR GENOME was chosen: the reference download may start. */
  | { type: "start" }
  | {
      type: "file";
      file: File;
      /** The opt-in before the read: true drops the opt-in genes before anything is read. */
      leaveOut: boolean;
    };

/** Why a file is turned away. The landing words each one. */
export type RefusalReason =
  | "chip"
  | "raw"
  | "grch37"
  | "no-build"
  | "wrong-build"
  | "multi"
  | "no-sample"
  /** Only copy-number or structural calls: a test's file of large changes, not its small variants. */
  | "structural"
  /** Not one record on 1 to 22, X or Y: unknown chromosome names, a header alone, the mitochondria alone. */
  | "no-variants"
  /** Nothing in it. */
  | "empty"
  /** A zip that isn't a chip company's: the VCF is inside it. */
  | "zip"
  /** A BCF, the binary form of a VCF. */
  | "bcf"
  | "unreadable"
  | "broken"
  | "too-large"
  | "old-browser"
  /** The reference data failed to arrive or failed its check: the person's file is not at fault. */
  | "no-data";

/** worker → main, in this order. The ledger is driven only by these, never by a clock. */
export type ReadEvent =
  | { type: "start"; displayName: string; bytesTotal: number }
  | { type: "reference"; fraction: number }
  | { type: "progress"; chromIndex: ChromIndex; fraction: number; records: number; bytesRead: number }
  | { type: "chrom-done"; chromIndex: ChromIndex; records: number }
  /** The person's copies of X and the pair the sex row names: told as soon as the file's X has been read. */
  | { type: "sex"; copiesX: 1 | 2 | null; pair: SexPair | null }
  | { type: "done"; result: GenomeResult }
  | { type: "error"; reason: RefusalReason; detail: string };

/** A sample as shipped: the pipeline's own result, and how long its real read took. */
export interface SampleFile {
  id: SampleId;
  result: GenomeResult;
  readMs: number;
}

// ── (c) Data bundle ──

export interface ManifestFile {
  path: string;
  bytes: number;
  sha256: string;
}
export interface Manifest {
  pack_date: string;
  /** ClinVar's release: every result names the data date it was read against. */
  clinvar_date: string;
  sources: { name: string; version: string; licence: string; link: string }[];
  /** Every file the app may fetch, in the one order it fetches them, for everyone. */
  files: ManifestFile[];
}

export interface ChromData {
  clinvar: PackedTable;
  gnomad: PackedTable;
  alphamissense: PackedTable;
  reference: { bin: ArrayBuffer; index: ReferenceIndex };
  transcripts: TranscriptModel[];
  windows: GnomadWindow[];
}

export interface GeneCondition {
  mondo: string;
  label: string;
  name: string;
  about: string;
  validity: string;
  reviewed: boolean;
}
export interface GeneInfo {
  symbol: string;
  chrom: string;
  /** Where the gene sits on its chromosome (the middle of its span): the ledger's genes layer. */
  pos: number;
  transcript: string;
  modes: InheritanceMode[];
  conditions: Partial<Record<InheritanceMode, GeneCondition>>;
  /** The gene's job line; shown only once reviewed. */
  job: string | null;
  jobReviewed: boolean;
  dosage: { hi: string | null; lofKnown: number };
  /** The group the opt-in question names for this gene, or null. */
  optIn: "cancer" | "heart" | "brain" | null;
}

export interface Rulers {
  chroms: string[];
  genomic: number[];
  coding: number[];
}

export interface DataBundle {
  manifest: Manifest;
  genes: GeneInfo[];
  rulers: Rulers;
  chrom(c: ChromIndex): Promise<ChromData>;
  fold(gene: string): Promise<FoldSource>;
  /** ClinGen dosage curations and the protein-coding gene list the copy-number reader needs. */
  copyNumber: CopyNumberData;
}

// ── What the reader hands the app ──

/** [chromIndex, pos, codingOffset, level, carrier, gene]: level 1 coding, 2 changes protein, 3 rare. */
export type Mark = [
  chromIndex: ChromIndex,
  pos: number,
  codingOffset: number,
  level: 1 | 2 | 3,
  carrier: 0 | 1,
  gene: string,
];

export interface Finding {
  /** The spine's normalized key with its gene: unique within a result. */
  key: string;
  /** The row's variant name: C61G, or the cDNA change. */
  name: string;
  bundle: MendelianBundle;
  facts: VariantFacts;
  p23: P23Facts;
  /** The file's own FILTER was not PASS: shown, flagged. */
  lowConfidence: boolean;
}

export interface GenomeResult {
  source: { kind: "sample"; id: SampleId } | { kind: "file"; name: string; bytes: number };
  /** YOUR GENOME's parentheses: "HG002", or the file's stem. */
  displayName: string;
  /** null: the file has no X. */
  copiesX: 1 | 2 | null;
  /** The sex-chromosome pair the ledger's 23rd row names: from the file's X and Y, or for a sample its donor's.
   *  null: not known (no X in a person's file). */
  sexPair: SexPair | null;
  /** Records per chromosome, 24 entries. */
  parsed: number[];
  /** The tally. yours + carriers = rare. */
  counts: { all: number; coding: number; protein: number; rare: number; yours: number; carriers: number };
  /** Every coding-cut survivor, sorted by chromosome then position. */
  marks: Mark[];
  yours: Finding[];
  carriers: Finding[];
  /** genes: how many were read; leftOut: how many the person chose to leave out. */
  checked: { genes: number; leftOut: number; coverage: "gvcf" | "vcf" };
  /** The data date the file was read against. */
  dataDate: string;
  throws: { key: string; stage: string; message: string }[];
}

// ── (d) Copy ──

export interface FilledLine {
  id: string;
  text: string;
  beat?: string | null;
  at?: "start" | "end";
  claims: ClaimCheck;
}
export interface RoomCopy {
  p1: { drawing: Drawing; lines: FilledLine[] }[];
  p2: { open: string; bars: Partial<Record<Bar["id"], string>>; verdict: string; condition?: string };
  p3: { kind: string; lines: string[] };
}

// ── (e) Descent ──

export type DescentState = "landing" | "loading" | "all" | "coding" | "protein" | "rare" | "yours";

/** The ledger is an imperative SVG island. */
export interface LedgerHandle {
  state(s: DescentState | "list" | "genes", o?: { animate: boolean }): Promise<void>;
  /** Loading: how far each bar has filled. Driven by ReadEvent progress. */
  paint(fill: Fill): void;
  /** Swaps the standing ticks, without the cuts' widening. */
  list(which: ListName): void;
  /** Linked highlighting: one mark, one group. null clears it. */
  light(keys: string[] | null): void;
  genes(mode: "off" | "overlay" | "reference"): void;
  /** keys: the mark's whole group in list order. from: a tick (scroll its row into the clear) or a chromosome's row. */
  on(ev: "enter" | "leave" | "click", cb: (keys: string[], from: "tick" | "row") => void): void;
  dispose(): void;
}
/** `result` null: the grey reference (landing → genes). */
export type MountLedger = (el: HTMLElement, result: GenomeResult | null, rulers: Rulers) => LedgerHandle;

/** The landing: the explanation and the two actions; LOAD YOUR GENOME asks its question before the picker. */
export interface LandingProps {
  genes: GeneInfo[];
  /** A file was turned away: its two sentences stand in the actions' place. */
  refusal: RefusalReason | null;
  onSample(): void;
  /** LOAD YOUR GENOME was chosen: the reference download may start now, and not before. */
  onLoadChosen(): void;
  /** Backed out before choosing a file (the question left, the picker cancelled): the download stops. What
   *  had fully arrived stays cached, so choosing LOAD YOUR GENOME again goes on from there. */
  onLoadDropped(): void;
  onFile(file: File, leaveOut: boolean): void;
  onGenes(): void;
  /** Pointing at (or focusing) the genes count lays the genes checked over the empty ledger; off on leaving. */
  onGenesPreview?(on: boolean): void;
}

/** The tally in the apparatus: one group per cut, then Next or EXPLORE. */
export interface TallyProps {
  /** null until the read is done. */
  result: GenomeResult | null;
  state: Exclude<DescentState, "landing">;
  /** Records read so far, while loading. */
  counting: number;
  /** While the reference data is still arriving after the read: its fraction; else null. */
  reference: number | null;
  /** The second cut's genes count opens the genes page, as the landing's does. */
  onGenes?: () => void;
  /** Pointing at that count lays the genes over the ledger. */
  onGenesPreview?: (on: boolean) => void;
  onNext(): void;
  onBack(): void;
}

// ── (f) List and genes page ──

export interface ListProps {
  result: GenomeResult;
  which: ListName;
  current: string | null;
  /** Also fired for the open row: the parent closes the room then (C15). */
  onOpen(key: string): void;
  /** What the pointer is on, for whoever listens (the dev harness logs it). */
  onHover?(keys: string[] | null): void;
  /** A caption was chosen: the list and the ledger's standing ticks swap. */
  onWhich(which: ListName): void;
  /** The ledger to light and to hear from: one mark, one group. */
  ledger: LedgerHandle | null;
}
export interface GenesProps {
  genes: GeneInfo[];
  leftOut: number;
  from: "landing" | "results";
  onHover(gene: string | null): void;
  onBack(): void;
}

// ── (g) Rooms ──

export interface RoomProps {
  finding: Finding;
  copy: RoomCopy;
  list: ListName;
  /** The next finding's key in the list's order, or null on the last. */
  next: string | null;
  onNext(): void;
  onClose(): void;
}
export interface P2Props {
  ctx: P23Ctx;
  copy: RoomCopy["p2"];
  onPair(bar: string | null): void;
}
export interface P3Props {
  ctx: P23Ctx;
  copy: RoomCopy["p3"];
  onPair(group: string | null): void;
}

// ── (h) Routing ──
// Hash URLs only. A loaded file's routes carry no names and no numbers (§2.0): a room's place in its list is
// kept in the page's memory, so neither the address nor the history entry tells even how long a list is.
//   #/            #/genes
//   #/read/coding #/list             #/list/carriers     #/variant         #/carrier
// A sample is no one's private data, so its routes may name things and are shareable:
//   #/sample/hg002/read/rare         #/sample/hg002/list/carriers
//   #/sample/hg002/variant/BRCA1-c.68_69del

export type Route =
  | { at: "landing" }
  | { at: "genes" }
  | { at: "descent"; sample: SampleId | null; state: Exclude<DescentState, "landing"> }
  | { at: "list"; sample: SampleId | null; which: ListName }
  | { at: "room"; sample: null; which: ListName; index: number }
  | { at: "room"; sample: SampleId; which: ListName; name: string };

export interface Router {
  /** `room`: a file's room's place in its list, from the router's memory of the entry. */
  parse(hash: string, room?: number | null): Route;
  format(r: Route): string;
  go(r: Route, o?: { replace?: boolean }): void;
  on(cb: (r: Route) => void): () => void;
}
