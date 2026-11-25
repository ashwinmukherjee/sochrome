// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Build config: brand tokens in HTML, the typeface token, the copyright banner.

import { cpSync, createReadStream, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { BRAND } from "./src/brand";
import { TYPEFACE, type Typeface } from "./src/typeface";

const ROOT = import.meta.dirname;
const FONTS = resolve(ROOT, "fonts");

/** A build ships the committed token. Only the dev server may be switched, by VITE_TYPEFACE. */
function typefaceFor(command: "build" | "serve", env: Record<string, string>): Typeface {
  if (command === "build") return TYPEFACE;
  return env.VITE_TYPEFACE === "standin" || env.VITE_TYPEFACE === "suisse" ? env.VITE_TYPEFACE : TYPEFACE;
}

function brandHtml(typeface: Typeface): Plugin {
  const tokens: Record<string, string> = {
    "%BRAND_NAME%": BRAND.name,
    "%BRAND_TITLE%": `${BRAND.name}: ${BRAND.tagline}`,
    "%BRAND_DESCRIPTION%": BRAND.description,
    "%BRAND_DOMAIN%": BRAND.domain,
    "%BRAND_OWNER%": BRAND.owner,
    "%BRAND_YEAR%": String(BRAND.year),
    "%TYPEFACE%": typeface,
  };
  return {
    name: "brand-html",
    transformIndexHtml: (html) => ({
      html: Object.entries(tokens).reduce((h, [k, v]) => h.replaceAll(k, v), html),
      tags:
        typeface === "suisse"
          ? [{ tag: "link", attrs: { rel: "stylesheet", href: "/typeface-suisse.css" }, injectTo: "head" }]
          : [],
    }),
  };
}

/** A face the page may load: a .woff2 directly in fonts/. Anything else there (the licence, say) is never served or shipped. */
const isFace = (file: string): boolean => dirname(file) === FONTS && file.endsWith(".woff2");

/** The commercial fonts live in a gitignored folder: served in dev, copied into a build when the token names them. */
function localFonts(typeface: Typeface): Plugin {
  /** The build's output folder, as resolved (dist/ unless --outDir says otherwise). */
  let out = resolve(ROOT, "dist");
  return {
    name: "local-fonts",
    configureServer(server) {
      server.middlewares.use("/fonts", (req, res, next) => {
        const file = resolve(FONTS, decodeURIComponent((req.url ?? "").split("?")[0].replace(/^\/+/, "")));
        if (!isFace(file) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader("content-type", "font/woff2");
        createReadStream(file).pipe(res);
      });
    },
    buildStart() {
      if (typeface === "suisse" && !existsSync(FONTS))
        this.error('The typeface token is "suisse" but fonts/ is missing (README: Typefaces).');
    },
    configResolved(config) {
      out = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      // The site's one notice is index.html's; the stylesheet ships without its source header.
      const sheet = resolve(out, "typeface-suisse.css");
      if (existsSync(sheet)) writeFileSync(sheet, readFileSync(sheet, "utf8").replace(/^(\/\*.*\*\/\n)+\n?/, ""));
      if (typeface === "suisse")
        cpSync(FONTS, resolve(out, "fonts"), { recursive: true, filter: (src) => src === FONTS || isFace(src) });
    },
  };
}

/** The app again as 404.html: with it, Pages answers an unknown path 404 (the app opens on its landing, as every
 *  route is a hash) instead of serving index.html as a 200 for every path, which search engines would index. */
function notFoundPage(): Plugin {
  let out = resolve(ROOT, "dist");
  return {
    name: "not-found-page",
    apply: "build",
    configResolved(config) {
      out = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const page = resolve(out, "index.html");
      if (existsSync(page)) cpSync(page, resolve(out, "404.html"));
    },
  };
}

/** The free faces are built in only when the token names them. */
function standinFaces(typeface: Typeface): Plugin {
  return {
    name: "standin-faces",
    enforce: "pre",
    transform(_code, id) {
      if (typeface === "suisse" && id.split("?")[0].endsWith("/src/styles/typeface.css"))
        return { code: "", map: null };
      return null;
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const typeface = typefaceFor(command, loadEnv(mode, ROOT, "VITE_"));
  return {
    plugins: [react(), brandHtml(typeface), localFonts(typeface), standinFaces(typeface), notFoundPage()],
    esbuild: { legalComments: "inline" },
    build: {
      target: "es2022",
      rollupOptions: {
        // tokens.html is a dev page (npm run dev): never built.
        input: { main: resolve(ROOT, "index.html") },
      },
    },
    worker: { format: "es" },
    server: { port: 5200, strictPort: false },
    preview: { port: 5290 },
    test: { include: ["src/**/*.test.{ts,tsx}", "tools/**/*.test.ts"], environment: "node" },
  };
});
