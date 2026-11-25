// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The app's entry: the ground, the router, and the shell that composes every view.

import { createRoot } from "react-dom/client";
import "../styles/tokens.css";
import "../styles/typeface.css";
import "../styles/type.css";
import "../styles/grid.css";
import { createRouter, startOverWhenRestored, themeOverride } from "./router";
import { Shell } from "./shell/Shell";

// The ground follows the OS. Nothing is stored, so only a check's address can pin it.
const theme = themeOverride();
if (theme) document.documentElement.dataset.theme = theme;

const root = document.getElementById("root");
if (!root) throw new Error("no #root");
startOverWhenRestored(root);
createRoot(root).render(<Shell router={createRouter()} />);
