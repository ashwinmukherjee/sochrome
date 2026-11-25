// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Finds every host a file names, and every address a page or stylesheet would load: the static half of the privacy rule.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BRAND } from "../../../src/brand";
import credits from "../../../src/third-party.json";
import { ROOT } from "../_check";

const ABSOLUTE = /\b(?:https?|wss?|ftp):\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)[^\s"'`)<>\\]*/gi;
const RELATIVE = /(?<=["'`(=\s]|^)\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)[^\s"'`)<>\\]*/gi;
const REMOTE = /^\s*(?:(?:https?|wss?|ftp):)?\/\/[a-z0-9-]/i;
/** XML namespaces are names: nothing requests them. */
const NAMESPACE = /^http:\/\/www\.w3\.org\/(?:1998|1999|2000|XML\/1998)\//;

/** What visitor analytics and error reporting look like in a build, including the same-origin ones a host injects. */
const TRACKERS: [RegExp, string][] = [
  [/\/_vercel\/(?:insights|speed-insights)/i, "Vercel Web Analytics or Speed Insights"],
  [/@vercel\/(?:analytics|speed-insights)|vercel-scripts\.com|vercel-insights\.com/i, "Vercel analytics"],
  [/cloudflareinsights\.com|\/cdn-cgi\/rum\b|data-cf-beacon/i, "Cloudflare Web Analytics"],
  [/googletagmanager|google-analytics|\bgtag\s*\(/i, "Google Analytics"],
  [/plausible\.io|posthog|mixpanel|amplitude\.com|segment\.(?:com|io)|hotjar|clarity\.ms|fullstory|logrocket/i, "visitor analytics"], // prettier-ignore
  [/sentry\.io|sentry-cdn|@sentry\/|bugsnag|\brollbar|datadoghq|nr-data\.net|newrelic/i, "error reporting"],
  [/\bsendBeacon\b/, "a beacon"],
];
const TRACKER_PACKAGES =
  /^(@vercel\/(analytics|speed-insights)|@sentry\/|@bugsnag\/|@datadog\/|@segment\/|@amplitude\/|posthog|mixpanel|rollbar|logrocket|plausible|web-vitals$|react-ga)/;

function hostsOf(text: string): string[] {
  return [...text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase());
}

/** Hosts the build may name, each for a stated reason. Naming is not loading: a page or stylesheet may load none of them. */
export function namedHosts(): Map<string, string> {
  const named = new Map<string, string>();
  for (const h of hostsOf(JSON.stringify(credits))) named.set(h, "a credit in src/third-party.json");
  for (const f of ["LICENSE", "LICENSE-CONTENT"])
    for (const h of hostsOf(readFileSync(resolve(ROOT, f), "utf8"))) if (!named.has(h)) named.set(h, `named in ${f}`);
  if (!BRAND.domain.includes("{{")) named.set(BRAND.domain.toLowerCase(), "the product's own domain");
  named.set("reactjs.org", "the text of React's own error messages");
  named.set("react.dev", "the text of React's own error messages");
  return named;
}

export interface Problem {
  file: string;
  what: string;
}

/** Every host a text names that is not on the list. */
export function strangers(file: string, text: string, named: Map<string, string>): Problem[] {
  const out: Problem[] = [];
  for (const re of [ABSOLUTE, RELATIVE])
    for (const m of text.matchAll(re)) {
      const host = m[1].toLowerCase();
      if (NAMESPACE.test(m[0]) || named.has(host)) continue;
      out.push({ file, what: `names the host ${host} (${m[0].slice(0, 80)})` });
    }
  return out;
}

export function trackers(file: string, text: string): Problem[] {
  return TRACKERS.filter(([re]) => re.test(text)).map(([, what]) => ({ file, what: `carries ${what}` }));
}

const LOADS = new Set(["src", "href", "srcset", "action", "formaction", "poster", "data", "background", "manifest"]);

/** What a page would load or send: nothing remote, nothing from an inline script, no ping, no refresh. */
export function pageLoads(file: string, html: string): Problem[] {
  const out: Problem[] = [];
  const body = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const tag of body.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)) {
    const name = tag[1].toLowerCase();
    const attrs = new Map<string, string>();
    for (const a of tag[2].matchAll(/([\w:-]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g))
      attrs.set(a[1].toLowerCase(), (a[2] ?? "").replace(/^["']|["']$/g, ""));
    if (name === "base") out.push({ file, what: "has a <base>" });
    if (attrs.has("ping")) out.push({ file, what: `<${name} ping>` });
    if (name === "meta" && /refresh/i.test(attrs.get("http-equiv") ?? ""))
      out.push({ file, what: "has a <meta http-equiv=refresh>" });
    if (name === "a") continue;
    for (const [k, v] of attrs)
      if (LOADS.has(k) && v.split(",").some((part) => REMOTE.test(part)))
        out.push({ file, what: `<${name} ${k}> loads from another host (${v.slice(0, 80)})` });
  }
  for (const s of body.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))
    if (s[2].trim()) out.push({ file, what: "has an inline script, which the lint cannot read: move it into src/" });
  return out;
}

/** What a stylesheet would load: fonts and images of this build only. */
export function styleLoads(file: string, css: string): Problem[] {
  const out: Problem[] = [];
  const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const u of body.matchAll(/url\(\s*(["']?)([^"')]*)\1\s*\)/gi))
    if (REMOTE.test(u[2])) out.push({ file, what: `url() loads from another host (${u[2].slice(0, 80)})` });
  for (const i of body.matchAll(/@import\s+(?:url\(\s*)?["']?([^"');\s]+)/gi))
    if (REMOTE.test(i[1])) out.push({ file, what: `@import loads from another host (${i[1].slice(0, 80)})` });
  return out;
}

/** Packages whose job is to watch visitors or report errors. */
export function trackerPackages(pkg: { dependencies?: object; devDependencies?: object }): string[] {
  return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((n) => TRACKER_PACKAGES.test(n));
}
