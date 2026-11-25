// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The shell's own words. Labels are written in sentence case; the caption role sets them uppercase.

const fmt = (n: number) => n.toLocaleString("en-US");

export const SHELL_WORDS = {
  /** The chevron's name, by what a tap on it does. */
  unfold: "Show all",
  leftOut: (n: number) => `${fmt(n)} left out, as you chose.`,
} as const;
