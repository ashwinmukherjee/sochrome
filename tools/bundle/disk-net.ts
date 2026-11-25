// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The built bundle on disk, behind the loader's own network interface: tools read exactly what the browser will.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Net } from "../../src/data/store";
import { PATHS } from "../spine/paths";

export const BUNDLE_DIR = resolve(PATHS.root, "public/data");
export const BASE = "/data/";

/** Every address asked for is written to `asked`, when given. */
export function diskNet(asked?: string[]): Net {
  return {
    fetch(url) {
      asked?.push(url);
      const file = resolve(BUNDLE_DIR, url.slice(BASE.length));
      if (!file.startsWith(BUNDLE_DIR) || !existsSync(file))
        return Promise.resolve(new Response(null, { status: 404 }));
      return Promise.resolve(new Response(readFileSync(file)));
    },
  };
}
