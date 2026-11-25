// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Opens the tokens page and checks every ink resolves in light and dark; saves one screenshot.

import { INK } from "../../src/styles/tokens";
import { openBrowser, openPage, serve, shot } from "./browser";

const server = await serve("dev");
const { browser, close } = await openBrowser();
try {
  const { page, errors } = await openPage(browser, "desktop");
  await page.goto(`${server.url}/tokens.html`, { waitUntil: "networkidle0" });
  const got = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("section[data-theme]")].map((s) => ({
      theme: s.dataset.theme,
      inks: [...s.querySelectorAll<HTMLElement>("[data-ink]")].map((c) => [
        c.dataset.ink,
        getComputedStyle(c.firstElementChild as Element).backgroundColor,
      ]),
      sans: getComputedStyle(s).fontFamily,
    })),
  );
  const fonts = await page.evaluate(() =>
    [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family),
  );
  const wanted = Object.keys(INK.light).length;
  const bad = got.filter((g) => g.inks.length !== wanted || g.inks.some(([, c]) => !c || c === "rgba(0, 0, 0, 0)"));
  const path = await shot(page, "tokens", true);
  console.log(
    `themes ${got.map((g) => `${g.theme}:${g.inks.length}`).join(" ")}; fonts loaded: ${[...new Set(fonts)].join(", ")}; errors ${errors.length}; ${path}`,
  );
  if (bad.length || errors.length || got.length !== 2) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  }
} finally {
  await close();
  server.stop();
}
