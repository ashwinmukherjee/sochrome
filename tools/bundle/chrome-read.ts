// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// A file read by the worker in Chrome, on the dev page: its events, its time, and the most memory the page's process held.

import { spawnSync } from "node:child_process";
import type { ReadEvent } from "../../src/contracts/app";
import type { Harness } from "../../src/worker/dev/harness";
import { openBrowser, openPage, serve } from "../e2e/browser";

interface ChromeRead {
  events: ReadEvent[];
  longTasks: number[];
  ms: number;
  /** The largest resident size of any of the browser's renderer processes during the read, in bytes. */
  peakBytes: number;
  /** Every address under the data folder that was asked for, in order. */
  asked: string[];
}

const PAGE = "/src/worker/dev/index.html";
const READ_TIMEOUT_MS = 300_000;
const SAMPLE_EVERY_MS = 200;
const POLL_EVERY_MS = 500;

/** The largest renderer among the browser's child processes, in bytes. */
function rendererBytes(browserPid: number): number {
  const ps = spawnSync("ps", ["-axo", "ppid=,rss=,command="], { encoding: "utf8", maxBuffer: 1 << 26 });
  let most = 0;
  for (const line of ps.stdout.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (m && Number(m[1]) === browserPid && m[3].includes("--type=renderer"))
      most = Math.max(most, Number(m[2]) * 1024);
  }
  return most;
}

const runs = new Map<string, Promise<ChromeRead>>();

/** Read `path` in Chrome. One read per file per process: the checks that want its numbers share it. */
export function chromeRead(path: string): Promise<ChromeRead> {
  let run = runs.get(path);
  if (!run) {
    run = measure(path);
    runs.set(path, run);
  }
  return run;
}

async function measure(path: string): Promise<ChromeRead> {
  const server = await serve("dev");
  const { browser, close } = await openBrowser();
  try {
    const pid = browser.process()?.pid;
    if (!pid) throw new Error("the browser has no process to measure");
    const { page, errors } = await openPage(browser, "desktop");
    const asked: string[] = [];
    // The page reports its worker's requests with its own.
    page.on("request", (r) => asked.push(r.url()));
    await page.goto(server.url + PAGE, { waitUntil: "networkidle0" });
    let peakBytes = 0;
    const sampler = setInterval(() => (peakBytes = Math.max(peakBytes, rendererBytes(pid))), SAMPLE_EVERY_MS);
    try {
      const input = await page.$("#file");
      if (!input) throw new Error("the dev page has no file input");
      await (input as import("puppeteer-core").ElementHandle<HTMLInputElement>).uploadFile(path);
      const deadline = Date.now() + READ_TIMEOUT_MS;
      for (;;) {
        const seen = await page.evaluate(() => ({ finished: window.readerHarness.finished, events: window.readerHarness.events.length, last: window.readerHarness.events.at(-1)?.type })); // prettier-ignore
        if (process.env.READ_TRACE) process.stderr.write(`${JSON.stringify(seen)} ${errors.join(" | ")}\n`);
        if (seen.finished) break;
        if (Date.now() > deadline)
          throw new Error(`the read did not finish: ${seen.events} events, the last ${seen.last}`);
        await new Promise((r) => setTimeout(r, POLL_EVERY_MS));
      }
    } finally {
      clearInterval(sampler);
    }
    const harness = JSON.parse(await page.evaluate(() => JSON.stringify(window.readerHarness))) as Harness;
    if (errors.length) throw new Error(errors.join("\n"));
    const data = `${server.url}/data/`;
    return {
      events: harness.events,
      longTasks: harness.longTasks,
      ms: harness.ms,
      peakBytes,
      asked: asked.filter((u) => u.startsWith(data)).map((u) => u.slice(data.length)),
    };
  } finally {
    await close();
    server.stop();
  }
}
