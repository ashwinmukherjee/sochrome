// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The exits, statically: the guard catches every planted way out, and no page, stylesheet or built file names a host but this one.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ESLint } from "eslint";
import { type Check, repoFiles, ROOT } from "./_check";
import { builtFiles } from "./lib/built";
import { EXIT_CASES } from "./lib/exit-cases";
import { namedHosts, pageLoads, type Problem, strangers, styleLoads, trackerPackages, trackers } from "./lib/hosts";

/** The guard, with the repo's own config, against each planted exit and each legitimate use. */
async function guard(): Promise<string[]> {
  const eslint = new ESLint({ cwd: ROOT });
  const wrong: string[] = [];
  for (const c of EXIT_CASES) {
    const [r] = await eslint.lintText(c.code, { filePath: resolve(ROOT, c.file) });
    const exits = r.messages.filter(
      (m) => m.ruleId === "exits/no-exit" || /^no-(eval|implied-eval|new-func|script-url)$/.test(m.ruleId ?? ""),
    );
    const broken = r.messages.find((m) => m.fatal);
    if (broken) wrong.push(`the planted case "${c.what}" does not parse: ${broken.message}`);
    else if (c.caught && !exits.length) wrong.push(`the guard missed a planted exit: ${c.what} (${c.file})`);
    else if (!c.caught && exits.length) wrong.push(`the guard stops a legitimate use: ${c.what}: ${exits[0].message}`);
  }
  return wrong;
}

/** The scanners against planted faults: each must be seen, or the scan below proves nothing. */
function plants(): string[] {
  const named = namedHosts();
  const seen = (what: string, found: Problem[]) => (found.length ? [] : [`the scan missed a planted fault: ${what}`]);
  const clean = (what: string, found: Problem[]) =>
    found.length ? [`the scan flags a clean file: ${what}: ${found[0].what}`] : [];
  return [
    ...seen("a request to another host in a script", strangers("a.js", `fetch("https://collect.example.net/v1")`, named)),
    ...seen("a protocol-relative host", strangers("a.js", `x.src="//cdn.example.net/p.gif"`, named)),
    ...seen("a socket to another host", strangers("a.js", `new WebSocket("wss://live.example.net")`, named)),
    ...seen("the analytics a host injects", trackers("index.html", `<script defer src="/_vercel/insights/script.js">`)),
    ...seen("Cloudflare's injected beacon", trackers("index.html", `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"t"}'></script>`)),
    ...seen("an error reporter", trackers("a.js", `init({dsn:"https://k@o1.ingest.sentry.io/1"})`)),
    ...seen("a beacon", trackers("a.js", `navigator.sendBeacon("/c",g)`)),
    ...seen("a remote script in a page", pageLoads("index.html", `<script src="https://cdn.example.net/a.js"></script>`)),
    ...seen("a credited host loaded by a page", pageLoads("index.html", `<img src="https://www.ncbi.nlm.nih.gov/p.gif">`)),
    ...seen("a remote stylesheet", pageLoads("index.html", `<link rel="stylesheet" href="//fonts.example.net/css">`)),
    ...seen("<a ping>", pageLoads("index.html", `<a href="#/list" ping="/p">x</a>`)),
    ...seen("an inline script", pageLoads("index.html", `<script>document.title = g</script>`)),
    ...seen("a refresh", pageLoads("index.html", `<meta http-equiv="refresh" content="0;url=https://example.net">`)),
    ...seen("a remote font", styleLoads("a.css", `@font-face{src:url(https://fonts.example.net/a.woff2)}`)),
    ...seen("a remote image", styleLoads("a.css", `.a{background:url("//img.example.net/a.png")}`)),
    ...seen("a remote import", styleLoads("a.css", `@import "https://fonts.example.net/css";`)),
    ...(trackerPackages({ dependencies: { "@vercel/analytics": "1" } }).length ? [] : ["the scan missed an analytics package"]),
    ...clean("a namespace", strangers("a.js", `createElementNS("http://www.w3.org/2000/svg","g")`, named)),
    ...clean("a credit", strangers("a.js", `{link:"https://www.ncbi.nlm.nih.gov/clinvar/"}`, named)),
    ...clean("the build's own files", pageLoads("index.html", `<script type="module" src="/assets/a.js"></script>`)),
    ...clean("an outbound link", pageLoads("index.html", `<a href="https://www.ncbi.nlm.nih.gov/clinvar/" rel="noreferrer">x</a>`)),
    ...clean("the build's own font", styleLoads("a.css", `@font-face{src:url("/fonts/a.woff2")}`)),
  ]; // prettier-ignore
}

function sources(): Problem[] {
  const out: Problem[] = [];
  for (const f of repoFiles()) {
    if (!/^(src|public)\/|^[^/]+\.html$/.test(f) || f.startsWith("public/data/")) continue;
    const text = () => readFileSync(resolve(ROOT, f), "utf8");
    if (f.endsWith(".css")) out.push(...styleLoads(f, text()));
    if (f.endsWith(".html")) out.push(...pageLoads(f, text()), ...trackers(f, text()));
  }
  const index = readFileSync(resolve(ROOT, "index.html"), "utf8");
  if (!/<meta\s+name="referrer"\s+content="no-referrer"/.test(index))
    out.push({ file: "index.html", what: 'lost <meta name="referrer" content="no-referrer">' });
  const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as Parameters<typeof trackerPackages>[0];
  for (const name of trackerPackages(pkg)) out.push({ file: "package.json", what: `depends on ${name}` });
  // Pages turns on its Web Analytics in the dashboard, not in a file: only the leak test on the live site sees it.
  return out;
}

function built(): { problems: Problem[]; files: number } {
  const named = namedHosts();
  const problems: Problem[] = [];
  const files = builtFiles();
  for (const f of files) {
    if (f.text == null) continue;
    const file = `dist/${f.path}`;
    // Licence notices are credit text: they name their authors' hosts and are never run.
    if (!f.path.endsWith(".txt")) problems.push(...strangers(file, f.text, named), ...trackers(file, f.text));
    if (f.path.endsWith(".html")) problems.push(...pageLoads(file, f.text));
    if (f.path.endsWith(".css")) problems.push(...styleLoads(file, f.text));
  }
  return { problems, files: files.length };
}

export const check: Check = {
  id: "P0",
  title:
    "The exits, statically: the guard catches every planted way out; sources and the built output name no other host",
  owner: "G",
  run: async () => {
    const wrong = [...(await guard()), ...plants()];
    const b = built();
    const problems = [...sources(), ...b.problems].map((p) => `${p.file}: ${p.what}`);
    const caught = EXIT_CASES.filter((c) => c.caught).length;
    return {
      ok: !wrong.length && !problems.length,
      detail: [
        ...wrong,
        ...problems.slice(0, 40),
        `${caught} planted exits caught, ${EXIT_CASES.length - caught} legitimate uses left alone; ${b.files} built files scanned`,
      ].join("\n"),
    };
  },
};
