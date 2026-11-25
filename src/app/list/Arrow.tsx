// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The one drawn arrow every forward cue uses, sized to the text it follows (C17); BACK mirrors it (C18).

export function Arrow({ back = false }: { back?: boolean }) {
  return (
    <svg className={back ? "arrow arrow-back" : "arrow"} viewBox="0 0 12 10" aria-hidden="true">
      <path d="M0.5 5H11.2M7.2 1L11.2 5L7.2 9" />
    </svg>
  );
}
