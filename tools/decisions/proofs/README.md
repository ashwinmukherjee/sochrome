One file per lane, `<lane>.json`: `{ "<row id>": { "kind": "assert" | "e2e" | "unit" | "token" | "review", "ref": "<check id and step, or the screenshot's path>" } }`.
A lane writes proofs only for the rows `ledger.json` gives it. Check D1 reads the ledger with these files.
