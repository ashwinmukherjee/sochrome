// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The page's side of the reader: the one place the worker is made and spoken to.

import type { ReadEvent, ReadRequest } from "../contracts/app";
import type { WorkerRequest } from "./reader";

export interface Reader {
  /** LOAD YOUR GENOME was chosen: the reference data starts arriving. Nothing is requested before this. */
  start(): void;
  /** Read a file. Its events arrive in order and end with `done` or `error`. */
  read(file: File, leaveOut: boolean, on: (e: ReadEvent) => void): void;
  /** Stop, and let go of everything the read held. */
  close(): void;
}

export function createReader(): Reader {
  let worker: Worker | null = null;
  let listener: (e: ReadEvent) => void = () => undefined;
  const send = (m: WorkerRequest): void => {
    if (!worker) {
      worker = new Worker(new URL("./reader.ts", import.meta.url), { type: "module" });
      worker.addEventListener("message", (e: MessageEvent<ReadEvent>) => listener(e.data));
      worker.addEventListener("error", (e) => listener({ type: "error", reason: "broken", detail: e.message }));
    }
    worker.postMessage(m);
  };
  return {
    start: () => send({ type: "start" }),
    read(file, leaveOut, on) {
      listener = on;
      const request: ReadRequest = { type: "file", file, leaveOut };
      send(request);
    },
    close() {
      worker?.terminate();
      worker = null;
    },
  };
}
