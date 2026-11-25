// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Serves a built site as its host would, with Cloudflare Pages' _headers: what the policy allows is what the page gets.

import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import { freePort } from "./browser";

/** The host's header rules, in file order: each a path pattern and the headers it sets. */
export interface HostConfig {
  rules: { pattern: RegExp; headers: [string, string][] }[];
}

/** Reads a Pages _headers file: a path line, then its indented `Name: value` lines; `#` starts a comment.
 *  A `*` matches anything (the splat), a `:name` one path segment. */
export function readHeaders(text: string): HostConfig {
  const rules: HostConfig["rules"] = [];
  for (const line of text.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      const source = line
        .trim()
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/:\w+/g, "[^/]+");
      rules.push({ pattern: new RegExp(`^${source}$`), headers: [] });
      continue;
    }
    const rule = rules.at(-1);
    const at = line.indexOf(":");
    if (!rule || at < 0) throw new Error(`_headers: a header outside a rule, or without a colon: ${line}`);
    rule.headers.push([line.slice(0, at).trim().toLowerCase(), line.slice(at + 1).trim()]);
  }
  return { rules };
}

/** What a static host says a file is, before any rule of the config's. */
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

/** Every header the rules give a path. As on Pages, every matching rule applies, and a header two rules set
 *  is joined with a comma. */
export function headersFor(config: HostConfig, path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rule of config.rules)
    if (rule.pattern.test(path))
      for (const [key, value] of rule.headers) out[key] = out[key] ? `${out[key]}, ${value}` : value;
  return out;
}

export async function serveBuilt(dir: string, config: HostConfig): Promise<{ url: string; stop(): void }> {
  const port = await freePort();
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
    const file = resolve(dir, `.${path === "/" ? "/index.html" : path}`);
    if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404);
      return void res.end();
    }
    res.setHeader("content-type", TYPES[extname(file)] ?? "application/octet-stream");
    for (const [key, value] of Object.entries(headersFor(config, path))) res.setHeader(key, value);
    res.end(readFileSync(file));
  });
  await new Promise<void>((done) => server.listen(port, done));
  return { url: `http://localhost:${port}`, stop: () => void server.close() };
}
