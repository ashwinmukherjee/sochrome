// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// A file turned away, with the reason the landing words.

import type { RefusalReason } from "../contracts/app";

export class Refusal extends Error {
  constructor(
    readonly reason: RefusalReason,
    detail: string,
  ) {
    super(detail);
  }
}

export { INFLATED_CAP_BYTES, KEPT_CAP_BYTES } from "../contracts/constants";
