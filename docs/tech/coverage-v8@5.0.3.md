# @vitest/coverage-v8@5.0.3

Pinned 2026-10-21 (published 2026-09-30). Peer `vitest` must be exactly `5.0.3`.

- `v8` is the default provider and needs `@vitest/coverage-v8` installed; V8 coverage is AST-remapped (identical reports to Istanbul since 3.2) — https://github.com/vitest-dev/vitest/blob/v5.0.3/docs/guide/coverage.md#L7-L63
- By default only files imported during the run are reported; `coverage.include` globs (relative to the project root; a pattern without a wildcard is a directory) add uncovered files, `coverage.exclude` removes some — https://github.com/vitest-dev/vitest/blob/v5.0.3/docs/config/coverage.md#L37-L59 and https://github.com/vitest-dev/vitest/blob/v5.0.3/docs/guide/coverage.md#L172-L225
- `coverage.reporter` picks report formats and `coverage.reportsDirectory` the output directory; `coverage.clean` (default true) wipes it before a run; the `json-summary` reporter writes `coverage/coverage-summary.json`, the file `.coverage-gate.json` reads (see `vitest@5.0.3.md`) — https://github.com/vitest-dev/vitest/blob/v5.0.3/docs/config/coverage.md#L60-L98
- `coverage.thresholds.{lines,functions,branches,statements}` make Vitest exit non-zero below a number; the project uses the external ratchet (`scripts/coverage_gate.py`) instead — https://github.com/vitest-dev/vitest/blob/v5.0.3/docs/config/coverage.md#L179-L229
- Ignore hints `/* v8 ignore if */` and similar: TypeScript is transpiled with esbuild, which strips comments, so a hint only survives with a legal-comment marker (`/* v8 ignore if -- @preserve */`); any such hint is a suppression for the integrity check — https://github.com/vitest-dev/vitest/blob/v5.0.3/docs/guide/coverage.md#L376-L402
