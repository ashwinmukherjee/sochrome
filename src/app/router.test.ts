// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { describe, expect, it } from "vitest";
import type { Route } from "../contracts/app";
import { format, parse } from "./router";

const ROUTES: [string, Route][] = [
  ["#/", { at: "landing" }],
  ["#/genes", { at: "genes" }],
  ["#/read/coding", { at: "descent", sample: null, state: "coding" }],
  ["#/list", { at: "list", sample: null, which: "yours" }],
  ["#/list/carriers", { at: "list", sample: null, which: "carriers" }],
  ["#/sample/hg002/read/rare", { at: "descent", sample: "hg002", state: "rare" }],
  ["#/sample/hg002/list/carriers", { at: "list", sample: "hg002", which: "carriers" }],
  [
    "#/sample/hg002/variant/BRCA1-c.68_69del",
    { at: "room", sample: "hg002", which: "yours", name: "BRCA1-c.68_69del" },
  ],
  ["#/sample/hg001/carrier/CFTR-F508del", { at: "room", sample: "hg001", which: "carriers", name: "CFTR-F508del" }],
];

describe("routes", () => {
  it.each(ROUTES)("%s parses and formats back", (hash, route) => {
    expect(parse(hash)).toEqual(route);
    expect(format(route)).toBe(hash);
  });

  it("a file's room keeps its place out of the address", () => {
    const room: Route = { at: "room", sample: null, which: "carriers", index: 15 };
    expect(format(room)).toBe("#/carrier");
    expect(parse("#/carrier", 15)).toEqual(room);
    expect(format({ ...room, which: "yours" })).toBe("#/variant");
  });

  it("a file's room with no place in the entry (a typed address) is its list", () => {
    expect(parse("#/variant")).toEqual({ at: "list", sample: null, which: "yours" });
    expect(parse("#/carrier")).toEqual({ at: "list", sample: null, which: "carriers" });
  });

  it("a name with reserved characters survives the address", () => {
    const route: Route = { at: "room", sample: "hg002", which: "yours", name: "MSH6-c.4082del (p.Ter1361?)/x" };
    expect(parse(format(route))).toEqual(route);
  });

  it.each([
    "",
    "#",
    "#/nowhere",
    "#/read/landing",
    "#/variant/0",
    "#/variant/3",
    "#/variant/BRCA1",
    "#/sample/hg009/list",
    "#/list/x",
  ])("%s is the landing", (hash) => expect(parse(hash)).toEqual({ at: "landing" }));
});
