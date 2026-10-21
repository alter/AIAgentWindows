# playwright@1.63.0

- `--list` collects tests without running them; `--reporter` on the command line replaces the configured reporters — https://github.com/microsoft/playwright/blob/v1.63.0/docs/src/test-cli-js.md
- With `--reporter=junit`, `PLAYWRIGHT_JUNIT_OUTPUT_FILE` sets the full path; `PLAYWRIGHT_JUNIT_OUTPUT_NAME` resolves against the output dir, which defaults to the config dir — https://github.com/microsoft/playwright/blob/v1.63.0/packages/playwright/src/reporters/base.ts#L671-L675
- Electron automation is experimental — https://github.com/microsoft/playwright/blob/v1.63.0/docs/src/electron-api/class-electron.md
