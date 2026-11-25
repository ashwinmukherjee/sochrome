// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// A dev page: every ink in light and dark, the type ladder, the faces in use.

import "./tokens.css";
import "./typeface.css";
import "./type.css";
import { INK, ROLE, TYPE } from "./tokens";

const el = (tag: string, style: Partial<CSSStyleDeclaration>, text = ""): HTMLElement => {
  const e = document.createElement(tag);
  Object.assign(e.style, style);
  e.textContent = text;
  return e;
};

function ground(theme: "light" | "dark"): HTMLElement {
  const g = el("section", {
    background: "var(--ground)",
    color: "var(--ink)",
    padding: "var(--sp-4)",
    display: "grid",
    gap: "var(--sp-3)",
  });
  g.dataset.theme = theme;
  g.append(el("div", {}, theme));
  g.firstElementChild?.classList.add("caption");

  const inks = el("div", { display: "grid", gridTemplateColumns: "repeat(auto-fill, 148px)", gap: "var(--sp-2)" });
  for (const name of Object.keys(INK[theme])) {
    const cell = el("div", { display: "grid", gap: "var(--s4)" });
    cell.dataset.ink = name;
    cell.append(el("div", { background: `var(--${name})`, height: "var(--sp-5)", outline: "1px solid var(--hair)" }));
    const label = el("div", {}, name);
    label.classList.add("note");
    cell.append(label);
    inks.append(cell);
  }
  g.append(inks);

  const roles = el("div", { display: "grid", gap: "var(--sp-1)" });
  for (const name of Object.keys(ROLE).filter((r) => r.startsWith("ink"))) {
    const line = el("div", { color: `var(--${name})` }, `${name}: the quick brown fox reads 4,096,123 records`);
    line.classList.add("says");
    roles.append(line);
  }
  g.append(roles);

  const ladder = el("div", { display: "grid", gap: "var(--sp-1)" });
  for (const [n, [size, line]] of Object.entries(TYPE)) {
    for (const face of ["sans", "serif", "mono"]) {
      ladder.append(
        el(
          "div",
          { fontFamily: `var(--${face})`, fontSize: `${size}px`, lineHeight: `${line}px` },
          `${face} ${n}: ${size}/${line} The BRCA1 gene spells out a protein.`,
        ),
      );
    }
  }
  g.append(ladder);
  return g;
}

// A section's own data-theme re-resolves the rungs for its subtree.
const style = document.createElement("style");
style.textContent = (["light", "dark"] as const)
  .map(
    (t) =>
      `section[data-theme="${t}"]{${Object.entries(INK[t])
        .map(([k, v]) => `--${k}:${v}`)
        .join(";")}}`,
  )
  .join("\n");
document.head.append(style);
document.getElementById("root")?.append(ground("light"), ground("dark"));
