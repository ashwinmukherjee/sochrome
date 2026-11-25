// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The controller in React: its view, and the ledger following it.

import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { LedgerHandle } from "../../contracts/app";
import type { Descent, DescentView } from "./controller";

export function useDescent(descent: Descent): DescentView {
  return useSyncExternalStore(descent.subscribe, descent.get);
}

/** The ledger stands where the descent stands. A ledger drawn anew takes its state at once; a step is animated. */
export function useDescentLedger(ledger: LedgerHandle | null, view: DescentView): void {
  const drawn = useRef<LedgerHandle | null>(null);
  const { at, fill } = view;
  useLayoutEffect(() => {
    const fresh = drawn.current !== ledger;
    drawn.current = ledger;
    void ledger?.state(at, { animate: !fresh });
  }, [ledger, at]);
  useLayoutEffect(() => {
    if (at === "loading") ledger?.paint(fill);
  }, [ledger, at, fill]);
}
