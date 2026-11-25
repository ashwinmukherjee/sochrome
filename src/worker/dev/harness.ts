// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// A dev page's script: reads the chosen file through the worker and holds what came back for a check to collect.

import type { ReadEvent } from "../../contracts/app";
import { createReader } from "../client";

/** What a check reads off the page once `finished` is true. */
export interface Harness {
  events: ReadEvent[];
  /** Main-thread tasks over the browser's long-task threshold, in ms, during the read. */
  longTasks: number[];
  ms: number;
  finished: boolean;
}

declare global {
  interface Window {
    readerHarness: Harness;
  }
}

const state: Harness = { events: [], longTasks: [], ms: 0, finished: false };
window.readerHarness = state;

const input = document.querySelector<HTMLInputElement>("#file");
const output = document.querySelector<HTMLOutputElement>("#state");
if (!input || !output) throw new Error("the dev page is missing its input or its output");

new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) state.longTasks.push(entry.duration);
}).observe({ type: "longtask" });

const reader = createReader();
input.addEventListener("change", () => {
  const file = input.files?.[0];
  if (!file) return;
  const began = performance.now();
  output.value = "reading";
  reader.start();
  reader.read(file, false, (e) => {
    state.events.push(e);
    if (e.type !== "done" && e.type !== "error") return;
    state.ms = performance.now() - began;
    state.finished = true;
    output.value = e.type;
  });
});
