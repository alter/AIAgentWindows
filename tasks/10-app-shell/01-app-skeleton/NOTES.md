T02: .npmrc (legacy-peer-deps=true) added to WRITE-SET because npm 10.9.4 crashes in arborist on the vitest 5.0.3 peer set; evidence in PLAN.md Assumptions.

T04 reverse control (AC2): a scratch copy of src/shared/cli-args.ts that builds the shell string as `cd ${cwd} && ${bin} ${args.join(' ')}` instead of passing `exec "$@"` with argv, run against a scratch copy of tests/unit/cli-args.test.ts: `npx vitest run` rc=1, 6 failed | 7 passed, including `keeps hostile path as one argument`. Scratch files deleted; real module green (13 passed).

## T05 reverse control
Stub CLI mutated so that Enter inside a bracketed paste submits (`char === '\r' || char === '\n'` instead of `char === '\r' && !inPaste`): `npx vitest run tests/integration/pty-stub.test.ts` -> 1 failed, 6 passed (`paste is not submitted`: expected output not to contain 'SUBMITTED'). Restored; 7 passed.

## T09 reverse control (AC8)
Scratch copies of scripts/arch_check.py with one rule disabled each, run against the unchanged tests/scripts/test_arch_check.py: renderer-electron off -> 3 failed; renderer-node off -> 4 failed; renderer-main off -> 1 failed; shared-native off -> 2 failed; site-preload off -> 2 failed. Scratch copy of src/ with `import fs from 'node:fs'` appended to src/renderer/index.ts: `python3 scripts/arch_check.py --root <copy>` rc=1 (`[renderer-node]`); with `import { ipcRenderer } from 'electron'` instead: rc=1 (`[renderer-electron]`). The repository itself: rc=0.
Limits: `preload` is matched inside the `new WebContentsView(...)` / `new BrowserWindow(...)` argument text only; a BrowserWindow counts as a site window when the same argument text carries `partition` or `persist:` (the app's own main window has a preload and no partition). Options built in a variable declared elsewhere are not seen.
