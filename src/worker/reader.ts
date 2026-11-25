// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The worker's entry: the bundle starts when the page says so, a file is read when one arrives.

import type { ReadEvent, ReadRequest } from "../contracts/app";
import { bundleLoader } from "../data/bundle";
import { browserNet } from "../data/store";
import { readFile } from "./read";

/** The page's messages: the contract's request, and the word that a file is about to be chosen. */
export type WorkerRequest = ReadRequest;

/** Absolute: a worker's own address is among the built scripts, not beside the data. */
const DATA_BASE = "/data/";

const post = (e: ReadEvent): void => postMessage(e);

let fraction = 0;
let reading = false;
const loader = bundleLoader(DATA_BASE, browserNet(), (f) => {
  fraction = f;
  if (reading) post({ type: "reference", fraction: f });
});

addEventListener("message", (e: MessageEvent<WorkerRequest>) => {
  loader.start();
  if (e.data.type !== "file") return;
  reading = true;
  void readFile(e.data, { loader, fraction: () => fraction }, post).finally(() => (reading = false));
});
