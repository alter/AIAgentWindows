T02: .npmrc (legacy-peer-deps=true) added to WRITE-SET because npm 10.9.4 crashes in arborist on the vitest 5.0.3 peer set; evidence in PLAN.md Assumptions.

T04 reverse control (AC2): a scratch copy of src/shared/cli-args.ts that builds the shell string as `cd ${cwd} && ${bin} ${args.join(' ')}` instead of passing `exec "$@"` with argv, run against a scratch copy of tests/unit/cli-args.test.ts: `npx vitest run` rc=1, 6 failed | 7 passed, including `keeps hostile path as one argument`. Scratch files deleted; real module green (13 passed).

## T05 reverse control
Stub CLI mutated so that Enter inside a bracketed paste submits (`char === '\r' || char === '\n'` instead of `char === '\r' && !inPaste`): `npx vitest run tests/integration/pty-stub.test.ts` -> 1 failed, 6 passed (`paste is not submitted`: expected output not to contain 'SUBMITTED'). Restored; 7 passed.

## T09 reverse control (AC8)
Scratch copies of scripts/arch_check.py with one rule disabled each, run against the unchanged tests/scripts/test_arch_check.py: renderer-electron off -> 3 failed; renderer-node off -> 4 failed; renderer-main off -> 1 failed; shared-native off -> 2 failed; site-preload off -> 2 failed. Scratch copy of src/ with `import fs from 'node:fs'` appended to src/renderer/index.ts: `python3 scripts/arch_check.py --root <copy>` rc=1 (`[renderer-node]`); with `import { ipcRenderer } from 'electron'` instead: rc=1 (`[renderer-electron]`). The repository itself: rc=0.
Limits: `preload` is matched inside the `new WebContentsView(...)` / `new BrowserWindow(...)` argument text only; a BrowserWindow counts as a site window when the same argument text carries `partition` or `persist:` (the app's own main window has a preload and no partition). Options built in a variable declared elsewhere are not seen.

T11 for T12: sidebar width is `--sidebar-width: 260px` and the nav bar `--nav-bar-height: 36px` in src/renderer/styles.css; the content area has a `.site-area` placeholder (hidden for CLI agents) where the renderer-drawn navigation bar goes; panes exist per CLI agent, only the selected one is shown. Dropped paths are single-quoted POSIX style (Windows quoting is a per-OS task).

## T13 reverse controls
Restore: `restoreSpawn` with `resume: false` forced and `persist()` without the Codex claim step, run against the unchanged tests: tests/unit/restore.test.ts 2 failed, tests/integration/restore-controller.test.ts 3 failed. Restored; 9 + 5 passed.
AC9: scratch package.json `{"scripts":{"dist":"electron-builder --mac"}}` -> `python3 scripts/check_publish_flags.py --package <scratch>` rc=1 (`[publish-flag]`); the repository package.json rc=0. Limit: the check reads package.json scripts only (not electron-builder.yml, not CI files).

## T14 reverse controls
Smoke (tests/full/smoke.spec.ts) against mutated source: `userAgentFor` returning the default UA -> the DeepSeek test fails (`Expected substring: not "Electron/"`, received a UA with Electron/44.6.0); `saveState` replaced by a no-op in AgentController.persist -> the Claude test fails after relaunch (`.agent-item` expected 1, received 0). Both restored from copies; real source green (2 passed).
One earlier mutated run (persist off) failed with a pane showing real Codex and Claude screens in the test folder instead of the expected count error; two identical reruns gave the count error and I could not reproduce it or explain it. The smoke now also sets AIAW_CODEX_BIN to the stub. Open: the owner may want to look if a real CLI ever appears in a test pane.

## T14 stub race (flaky pty-stub test)
tests/integration/pty-stub.test.ts `typed Enter is submitted` timed out in 1 of 2 identical coverage runs under machine load (5000 ms). Root cause: stub-cli.mjs printed its banner before `setRawMode(true)`; the test writes `abc\r` right after the banner, and a write landing before raw mode goes through the tty line discipline (ICRNL turns `\r` into `\n`, which the stub does not treat as Enter). Evidence: with raw mode delayed 300 ms the same test fails deterministically with the same timeout; with raw mode set before the banner 3 consecutive full coverage runs passed 121/121.

## T14a diagnosis (coordinator) and guard
T14's worker once saw real Claude/Codex screens in a smoke pane and could not reproduce it. No trace of a real run was found: no new trust entries in `~/.claude.json` or `~/.codex/config.toml`, no new transcripts (2026-10-21 16:3x). The earlier smoke did not set `AIAW_CODEX_BIN`, so a real `codex` was the only candidate. Workers also ran `electron .` without `AIAW_USER_DATA`, which left an empty `agents.json` (`{"version":1,"agents":[]}`) in the owner's real userData (`~/Library/Application Support/ai-agent-windows`), left in place.
Guard: `buildSpawn` throws in test mode (`AIAW_USER_DATA` set) unless `AIAW_CLAUDE_BIN` / `AIAW_CODEX_BIN` names the binary for that kind; the controller catches the error from `buildSpawn` on add and restore and writes it into the agent's pane backlog instead of spawning. Tests red first: tests/unit/cli-args.test.ts (2 failed), tests/integration/agent-controller.test.ts (1 failed, pane stayed empty).

# NOTES — attack round 1 (2026-10-21)

- PLAUSIBLE (ATTACK.md, A02:2025): the main window has no `will-navigate` lock and no `setWindowOpenHandler`; a foreign document loaded as its top-level page keeps the `aiaw` bridge and can drive the pty (shown with a forced load); no attacker-reachable trigger was reproduced (OS file drop onto non-terminal areas is the suspect). By the review rules this is an observation, not a task. Coordinator's recommendation to the owner: add the navigation lock and a root-level drop guard in the next task of this phase — a few lines, closes the class.

# NOTES — attack round 2 (2026-10-21)

attack:passed on the T16a fix. Recorded for the next tasks, not fixed here (PLAUSIBLE / low):
- A multi-line paste submits when the CLI has switched bracketed-paste mode off (`ESC[?2004l`, RIS, DECSTR) or before it switched it on; then there is no ESC to strip and the raw `\r` is Enter. Suggested fix: when `terminal.modes.bracketedPasteMode` is false and the paste holds a line break, ask the user to confirm or join the lines.
- A dropped path containing a C1 character is silently turned into a different path by `sanitizePaste`; `hasControlCharacter` should reject 0x80–0x9f so such a path is refused instead.
- The 256 KB backlog could drop the CLI's `ESC[?2004h` for a pane rebuilt after long output (no reload path exists today).
- Round 1's navigation-lock finding (main window) remains open as a recommendation.
