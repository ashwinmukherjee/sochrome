// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Every word the landing says. Actions are written in sentence case; CSS sets them uppercase.

import type { GeneInfo, RefusalReason } from "../../contracts/app";

const fmt = (n: number) => n.toLocaleString("en-US");

/** What the reference data weighs, as the line before the picker says it: the manifest's files to the
 *  nearest 10 MB (decimal, as a phone's data plan counts). Q3 holds it to the built manifest. */
export const REFERENCE_MB = 90;

/** The opt-in question's three groups, as it names them. */
const GROUPS: Record<NonNullable<GeneInfo["optIn"]>, string> = {
  cancer: "cancer",
  heart: "serious heart conditions",
  brain: "brain diseases like Parkinson's and ALS",
};

/** The way on a refusal offers beside the sample: another file, the same file again, or none. */
type WayOn = "file" | "again" | "none";

/** What the file is, then what the product reads instead. `name` is the product's. */
const REFUSALS: Record<RefusalReason, { way: WayOn; says(name: string): [string, string] }> = {
  chip: {
    way: "file",
    says: (name) => [
      "This is raw data from a chip-based test, like 23andMe's.",
      `A chip reads a few hundred thousand set places, not a whole genome, so ${name} can't read it.`,
    ],
  },
  raw: {
    way: "file",
    says: (name) => [
      "This file holds sequencing reads, before the variants in them have been found.",
      `${name} reads the VCF file made from them. Most providers offer one to download.`,
    ],
  },
  grch37: {
    way: "file",
    says: (name) => [
      "This file is mapped to an older version of the reference genome, GRCh37.",
      `${name} reads files mapped to the current one, GRCh38. Some providers offer both.`,
    ],
  },
  "no-build": {
    way: "file",
    says: (name) => [
      "This file doesn't say which version of the reference genome it's mapped to.",
      `${name} reads files mapped to GRCh38, and can't check this one.`,
    ],
  },
  "wrong-build": {
    way: "file",
    says: (name) => [
      "This file is mapped to a version of the reference genome other than GRCh38.",
      `${name} reads files mapped to GRCh38. Some providers offer one.`,
    ],
  },
  multi: {
    way: "file",
    says: (name) => [
      "This file holds more than one person's genome.",
      `${name} reads one person at a time. A file with only yours will work.`,
    ],
  },
  "no-sample": {
    way: "file",
    says: (name) => [
      "This file lists variants, but not anyone's genome.",
      `${name} needs a VCF file of one person's genome.`,
    ],
  },
  structural: {
    way: "file",
    says: (name) => [
      "This file holds only copy-number and structural calls, where long stretches of DNA are lost, gained or moved.",
      `${name} reads the small variants. Most providers put them in a separate VCF file.`,
    ],
  },
  "no-variants": {
    way: "file",
    says: (name) => [
      `None of this file's rows are on a chromosome ${name} reads.`,
      `${name} reads chromosomes 1 to 22, X and Y. A whole-genome VCF has millions of rows on them.`,
    ],
  },
  empty: {
    way: "file",
    says: () => ["This file is empty.", "Downloading it again usually fixes this."],
  },
  zip: {
    way: "file",
    says: (name) => [
      "This file is a zip archive.",
      `${name} reads the VCF inside it. Unzip it first, then choose the .vcf or .vcf.gz file.`,
    ],
  },
  bcf: {
    way: "file",
    says: (name) => [
      "This file is a BCF, a compressed binary form of a VCF.",
      `${name} reads the text form, ending in .vcf or .vcf.gz. Most providers offer one.`,
    ],
  },
  unreadable: {
    way: "file",
    says: (name) => [
      `${name} can't read this file.`,
      "It reads VCF files from whole-genome sequencing, ending in .vcf or .vcf.gz.",
    ],
  },
  broken: {
    way: "file",
    says: (name) => [
      `${name} stopped partway through this file, which looks damaged or cut short.`,
      "Nothing from it was kept. Downloading it again usually fixes this.",
    ],
  },
  "too-large": {
    way: "file",
    says: (name) => [
      `This file is larger than ${name} can read on this device.`,
      "Nothing from it was kept. A file of one person's variants is usually much smaller.",
    ],
  },
  "old-browser": {
    way: "none",
    says: (name) => [
      `This browser is missing a part ${name} needs to read a file.`,
      "A current version of Chrome, Edge, Firefox or Safari has it.",
    ],
  },
  "no-data": {
    way: "again",
    says: (name) => [
      `The reference data ${name} reads a genome against didn't arrive.`,
      "Your file is fine, and nothing from it was kept. Check the connection, then try again.",
    ],
  },
};

export const LANDING_WORDS = {
  does: "This tool reads your genome and finds the few variants that could affect you.",
  /** The scope line; its count is the way to the genes page. */
  scope: {
    before: "It checks ",
    count: (genes: number) => `${fmt(genes)} genes`,
    after: " known to be linked to a condition.",
  },
  known: "For each one, it shows what is known about it, and what is not.",
  notATest: "It isn't a medical test, and nothing it shows is a diagnosis.",
  privacy: "Your genome is read on this device, and nothing about it is sent anywhere.",
  load: "Load your genome",
  sample: "View a sample",
  or: "or",
  question: (n: number): [string] => [
    `${fmt(n)} of the genes are linked to ${GROUPS.cancer}, ${GROUPS.heart}, or ${GROUPS.brain}.`,
  ],
  include: "Include them",
  leave: "Leave them out",
  /** Under the question: either answer leads to the picker. */
  next: "You'll choose your file next.",
  /** On a phone only, where a data plan makes the size matter. */
  download: `The first time, this downloads ${REFERENCE_MB} MB of reference data, which can take a few minutes on mobile data.`,
  another: "Choose another file",
  /** From the question back to the explanation, at the column's foot. */
  back: "Back",
  /** The column's foot otherwise: the credits, licences and contact, a plain file. */
  credits: "Credits",
  again: "Try again",
  refusal: (reason: RefusalReason, name: string) => ({ way: REFUSALS[reason].way, says: REFUSALS[reason].says(name) }),
} as const;
