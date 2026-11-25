// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Dev page only: mounts the renderer's sheet. Open /src/render/system.html on the dev server.

import React from "react";
import ReactDOM from "react-dom/client";
import System from "./System";
import { visual as V } from "./tokens";

// The sheet is laid out in terms of the stage and its bleed, which are the renderer's own numbers.
document.documentElement.style.setProperty("--cell-w", `${V.stageW}px`);
document.documentElement.style.setProperty("--cell-bleed", `${V.stageBleed}px`);

const root = document.getElementById("root");
if (!root) throw new Error("no #root");
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <System />
  </React.StrictMode>,
);
