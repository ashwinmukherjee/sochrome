// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Every shared number, once. Restating one anywhere else fails check C4.

/** AlphaFold is confident at a residue at this pLDDT or more. */
export const PLDDT_SOLID = 70;
/** A stop more than this many letters before the last join destroys the message. */
export const NMD_LETTERS = 50;
/** Residues in the fold's portrait. */
export const FOLD_WINDOW = 40;
/** Two residues touch within this distance, when this far apart on the chain. */
export const CONTACT_MAX_A = 8;
export const CONTACT_MIN_SEP = 4;
/** The fold's flat view holds at this share of its shape or more. */
export const PLANE_MIN = 0.55;
/** A residue is buried with this many neighbours inside this radius. */
export const BURIED_CN = 18;
export const BURIED_RADIUS_A = 10;
/** The cut signal: the exon's last letters and the intron's first (donor), the intron's last (acceptor). */
export const SIGNAL = { donor: { exon: 3, intron: 6 }, acceptor: { intron: 3 } } as const;
/** Coding letters this close to an internal join can also weaken the cut. */
export const EXON_EDGE = 3;
/** Letters either side of the coding sequence that the coding cut, gnomAD's scope and the splice region share. */
export const CDS_PADDING = 8;

/** The rare cut: an allele frequency under this is carried by fewer than 1 in 500 people. */
export const RARE_AF = 0.001;
/** Rarity evidence, general thresholds (BS1 and PM2 are unsourced placeholders; panels override per gene). */
export const RARITY = { BA1: 0.05, BS1: 0.01, PM2: 0.00001 } as const;
/** AlphaMissense's calibrated bands, strongest first. */
export const AM_BANDS = { harmful: [0.99, 0.972, 0.906, 0.792], harmless: [0.169, 0.099, 0.07] } as const;
/** PVS1: a cut-short change counts in full when it removes more than this share of the protein. */
export const PVS1_SHARE = 0.1;
/** Tavtigian's point bands: at or above on the harmful side, at or below on the harmless side; between them, uncertain. */
export const TAVTIGIAN = { harmful: 10, likelyHarmful: 6, likelyHarmless: -1, harmless: -7 } as const;
/** People in gnomAD v4.1 exomes. */
export const GNOMAD_PEOPLE = 730_947;
/** A copy-number change spanning more protein-coding genes than this is read as many genes. */
export const CNV_MANY_GENES = 25;
/** A lab-called deletion settles P3 in an unrated gene only with this many known harmful cut-short variants. */
export const CNV_LOF_KNOWN_MIN = 5;

/** Copy leads, the drawing follows: the room's pacing. */
/** A sample's read plays in this long, whatever it took to read: long enough to watch the genome fill, short enough
 *  that a first look isn't spent waiting. */
export const SAMPLE_READ_MS = 3000;

export const PACING = {
  HANDOFF_PX: 188,
  BREATH_PX: 94,
  AN_READ: 1200,
  AN_SAY: 1120,
  PACE: 2.6,
  ANIM_VH: 0.3,
  ANIM_SCALE: 0.5,
  /** Pacing is measured on a screen this tall, never the window's. */
  MEASURE_VH: 900,
  /** A line is read at this quantile of the tuned rooms' px per word: their median sits low, pulled down by
   *  lines the old schedule handed off almost at once. */
  READ_AT: 0.75,
} as const;

/** The claim box a line must fit: width in px, lines, type size / line height. */
export const FIT = {
  desktop: { width: 540, lines: 3, size: 24, line: 32 },
  phone: { width: 320, lines: 4, size: 20, line: 26 },
} as const;
/** A P2 or P3 ledger row's length in characters. */
export const ROW_MAX = { P2: 178, P3: 89 } as const;

/** The ledger's pitch: the frame's height over this many row gaps, clamped. On a phone the descent's ledger
 *  takes the height under the band, so all 23 rows stand whole down to `phoneMin`. */
export const LEDGER_PITCH = { min: 23, max: 36, phoneMin: 12 } as const;
/** At phone width the ledger's numbers stand in the margin: a column this wide, this far short of the tracks,
 *  which start on the wall with every other word on the page. The two sum to the
 *  phone's wall; tokens.ts holds them to it. */
export const LEDGER_PHONE = { col: 16, gut: 4 } as const;
export const LEDGER_ROWS_SPANNED = 22;
/** Rows on the ledger: chromosomes 1 to 22 and one sex row. */
export const LEDGER_ROWS = 23;
export const LIST_PITCH = 42;
export const GENE_ROW_PITCH = 28;
/** At or under this width the apparatus folds to a strip. */
export const BREAKPOINT_PHONE = 800;
/** A phone screen at or under this height takes the short stations. */
export const BREAKPOINT_SHORT = 700;

/** Origami's grid in its snappy mode; XL starts at a 1800 window, not 1220. */
export const ORIGAMI = {
  S: { from: 490, layout: 490, gutter: 10, col: 30 },
  M: { from: 740, layout: 740, gutter: 20, col: 40 },
  L: { from: 980, layout: 980, gutter: 20, col: 60 },
  XL: { from: 1800, layout: 1220, gutter: 20, col: 80 },
} as const;

/** The protein lanes draw at one size on every screen. */
export const PROTEIN_SCALE = 1.33;
export const PORTRAIT_STAGE_H = 266;

/** Chromosomes in ledger order; index 22 is X, 23 is Y (counted, never drawn). */
export const CHROMS = [...Array.from({ length: 22 }, (_, i) => String(i + 1)), "X", "Y"] as const;
export const CHROM_X = 22;
export const CHROM_Y = 23;

/** The sniff reads this much of a chosen file before anything else. */
export const SNIFF_BYTES = 256 * 1024;
/** The most header text the sniff reads looking for the #CHROM line: hg38 headers listing the alt, HLA and decoy contigs run to several hundred KB. */
export const HEADER_CAP_BYTES = 4 * 1024 * 1024;
/** chr1's length tells the build. */
export const CHR1_LENGTH = { GRCh38: 248_956_422, GRCh37: 249_250_621 } as const;
/** The worker's whole memory budget for a read. */
export const MEMORY_BUDGET_BYTES = 1.5 * 1024 ** 3;

/** A file whose inflated size passes this is refused (a gzip bomb, or more than the device can read). */
export const INFLATED_CAP_BYTES = 64 * 1024 ** 3;
/** The kept lines of a read may use at most this much of the memory budget. */
export const KEPT_CAP_BYTES = MEMORY_BUDGET_BYTES / 3;
/** The app shell's scripts, gzipped, before the renderer. */
export const SHELL_JS_BUDGET_BYTES = 150 * 1024;
