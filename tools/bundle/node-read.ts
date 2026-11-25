// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The worker's read run in Node over the built bundle, and the harness's own reader beside it to compare with.

import { openAsBlob } from "node:fs";
import { basename } from "node:path";
import type { GenomeResult, ReadEvent } from "../../src/contracts/app";
import { bundleLoader, type BundleLoader } from "../../src/data/bundle";
import { readGenome } from "../../src/spine/pipeline";
import { readFile, stem } from "../../src/worker/read";
import { readKept } from "../spine/read";
import { BASE, diskNet } from "./disk-net";

let shared: BundleLoader | null = null;
/** One loader for the process, started on first use. */
export function loader(): BundleLoader {
  shared ??= bundleLoader(BASE, diskNet());
  shared.start();
  return shared;
}

export const fileAt = async (path: string): Promise<File> => new File([await openAsBlob(path)], basename(path));

/** Every event the worker's read emits for `file`. */
export async function eventsOf(file: File, leaveOut = false): Promise<ReadEvent[]> {
  const events: ReadEvent[] = [];
  await readFile({ type: "file", file, leaveOut }, { loader: loader(), fraction: () => 1 }, (e) => events.push(e));
  return events;
}

/** The same file through the harness's reader: a second way to the same result. */
export async function referenceResult(path: string, bytes: number): Promise<GenomeResult> {
  const l = loader();
  const kept = await readKept(path, await l.keepWindows);
  const name = basename(path);
  return readGenome(
    {
      source: { kind: "file", name, bytes },
      displayName: stem(name),
      lines: kept.lines,
      parsed: kept.parsed,
      leaveOut: false,
      covered: kept.covered,
    },
    await l.bundle,
  );
}
