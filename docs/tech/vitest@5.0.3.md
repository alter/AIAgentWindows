# vitest@5.0.3

- `vitest list <filters>` prints the matching tests without running them — https://github.com/vitest-dev/vitest/blob/v5.0.3/docs/guide/cli-generated.md
- `--sequence.shuffle` runs tests in random order — https://github.com/vitest-dev/vitest/blob/v5.0.3/docs/guide/cli-generated.md
- `test.poolOptions` was removed in Vitest 4; the worker limit is `--maxWorkers` — https://github.com/vitest-dev/vitest/blob/v5.0.3/packages/vitest/src/node/config/resolveConfig.ts#L266-L268
- `--reporter=junit --outputFile=<file>` writes JUnit; `--coverage.reporter=json-summary` writes `coverage/coverage-summary.json` — https://github.com/vitest-dev/vitest/blob/v5.0.3/packages/vitest/src/node/cli/completions.ts#L36
