# VERIFY — 10-app-shell/01-app-skeleton

Verifier: independent verifier context (Claude subagent), 2026-10-21, commit 129744b on branch app-shell-skeleton. It did not write the code under `src/`, `scripts/`, any test under `tests/`, nor PLAN.md/NOTES.md/ATTACK.md. It ran: a fresh `git clone` of the branch into `.claude/scratch/verify-clone` + `npm install`, every fast-tier command of docs/PROJECT.md §6, the vitest files of AC2–AC6, `npm run build`, `electron . --smoke-exit` with a temporary userData, five mutation runs in a second scratch copy (`.claude/scratch/mut`), `tasks/scope_check.py`, `tasks/check.py`. It did NOT run `[full]` items (item 4 / AC7), did not spawn the real claude or codex, loaded no real chat site, did not touch the clipboard or `~/Library/Application Support/ai-agent-windows` (its `agents.json` still has mtime 16:22, before this session's first run at 17:09).

## Per-item verdict
| # | Item | Result |
|---|---|---|
| V1 | [fast] every fast-tier command of §6 exits 0 | pass (11/11, see below) |
| V2 | [fast] reverse control: interpolate path into shell string → `cli-args.test.ts::keeps hostile path as one argument` | pass (red seen, 7 failed incl. the named test) |
| V3 | [fast, heavy] `pty-stub.test.ts`: banner, bracketed paste echoed not submitted, `CLAUDE_CODE_CHILD_SESSION` absent | pass (9 passed); one weakness, see Findings 1 |
| V4 | [full] `npx playwright test --project=electron-smoke` | cannot verify here: `[full]` is not run here and the task directory has no `FULLRUN-*.md` (only `FASTRUN-2026-10-21-165446216468.md` and `FASTRUN-2026-10-21-165506597193.md`, which cover the fast tier, 11 rows). Side check only, not evidence: `electron . --smoke-exit` with a temporary userData exit 0 |
| V5 | [fast] `arch_check.py` exits 0 and goes red on renderer import of `electron` / `node:*` | pass (exit 0; red exit 1 on 10 mutations) |
| V6 | [fast] HUMAN: owner runs the app, adds the five agents, signs in, restarts, records in NOTES.md | not checked — HUMAN item, not mine; NOTES.md has no record of it |

AC map (PLAN.md): AC1 = V1 pass; AC2 pass; AC3 pass; AC4 pass (19 tests); AC5 pass (12 tests); AC6 pass (15 tests); AC7 cannot verify here (= V4); AC8 pass (= V5); AC9 pass (exit 0, red on both mutations); AC10 = V6 not checked.

## Requirement evidence
- S1: `package.json:7-12` — scripts `build` (esbuild via scripts/build.mjs), `test` (vitest), `start`, `postinstall`; no script named `release` and no electron-builder command, so `scripts/check_publish_flags.py` exit 0 holds vacuously (Finding 3); exact pins `package.json:14-31` (no `^`/`~`); `playwright.config.ts` + `tests/full/smoke.spec.ts` present; `scripts/postinstall.mjs:14-19` chmods spawn-helper — checked: `chmod 644` on `node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper`, `npm run postinstall` exit 0, mode back to `-rwxr-xr-x`; `npx tsc --noEmit` exit 0, `npx eslint .` exit 0, `python3 scripts/coverage_gate.py --run` exit 0 (`coverage gate: PASS 100.00% (floor 100.00%)`, 128 tests), `npm run build` exit 0. `tsconfig.main.json`, `tsconfig.renderer.json`, `electron-builder.yml` named in WRITE-SET do not exist; WRITE-SET is a permission, S1 does not require them (one root `tsconfig.json`, PLAN.md Assumptions).
- S2: `src/renderer/sidebar.ts:14-20` (five kinds in the "+" menu), `:20-46` (sidebar with + button), `:48-59` (list render, selected class); `src/main/agent-controller.ts:63-76` (add/select set `selectedId` and emit `agentsChanged`); `src/renderer/content.ts:24-40` switches panes by `snapshot.selectedId`. The UI itself was not run (Playwright is `[full]`).
- S3: `src/shared/cli-args.ts:58-71` — `[$SHELL||/bin/zsh,'-l','-i','-c','exec "$@"','agent-shell',bin,...args]`, cwd only as spawn option; `:41-47` claude `--session-id|--resume <id> --add-dir <shared>`; `:28-34` drops `CLAUDE_CODE_CHILD_SESSION`; `src/main/agent-controller.ts:115-116` fresh `randomUUID()` session id for claude; folder from `deps.pickFolder` (`src/main/index.ts:22-28`, `dialog.showOpenDialog` with `openDirectory`); `src/renderer/terminal-pane.ts:9-18` xterm pane; `src/shared/terminal-input.ts:12-13,23-28` (Ctrl+V -> `\x16`, Alt+V -> `\x1bv`) written raw via `src/renderer/terminal-pane.ts:89-97`; `terminal-input.ts:35-40` + `terminal-pane.ts:106-112` dropped file pasted as `'quoted path'`. Tests: `npx vitest run tests/unit/cli-args.test.ts` exit 0 (15 passed); `tests/integration/pty-stub.test.ts:108-112` exit 0.
- S4: `src/main/site-views.ts:57-60` `persist:<agentId>` partition, `webPreferences` without `preload`; `:63-72` popups in a child window, same partition, no preload; `:36-44` Back/Forward/Home/Reload; `:87-96` permission request and check handlers through `permissionAllowed`; `src/shared/site-policy.ts:5,20-25` only `media` and `persistent-storage` from the agent's own origin; `site-policy.ts:7-9` DeepSeek UA with `Electron/…` removed, others default. `npx vitest run tests/unit/site-policy.test.ts` exit 0 (15 passed). The views were not run (only `[full]` smoke covers them).
- S5: `src/shared/agents.ts:84-103` (`parseState`, empty state on anything invalid), `src/main/state-file.ts:14-19` atomic tmp+rename write in userData, `src/main/index.ts:52` loads `<userData>/agents.json`, `src/main/agent-controller.ts:98-102,104-106` restore/flush; `src/shared/restore.ts:13-25` claude `--resume <id>` only when the transcript exists, else `--session-id`, codex `resume <claimed id>`; sites reload their partition on `SiteViews.ensure` (`site-views.ts:57`). `npx vitest run tests/unit/state-store.test.ts tests/unit/restore.test.ts` exit 0 (19 passed). Relaunch through the real UI is `[full]`, not run.
- S6: `tests/fixtures/stub-cli.mjs:1-39` the stub; every pty test spawns it through `AIAW_CLAUDE_BIN`/`AIAW_CODEX_BIN` (`tests/integration/pty-stub.test.ts:34`, `agent-controller.test.ts:25`, `restore-controller.test.ts:26`); `src/shared/cli-args.ts:49-56` throws when `AIAW_USER_DATA` is set and no binary override names the kind; `tests/unit/cli-args.test.ts:110-123` covers it; unit/integration tests use `mkdtemp` directories (`state-file.test.ts:20`, `agent-controller.test.ts:49`, `restore-controller.test.ts:54`); `grep -rn "Application Support" tests src` finds only a string constant in `cli-args.test.ts:7`.
- S7: `python3 scripts/arch_check.py` exit 0 ("arch_check: 0 problems"); `scripts/arch_check.py:18-24` rules; `docs/PROJECT.md` §6 fast tier lists it; `src/main/site-views.ts:59-61` and `:67-70` show no `preload` for remote views; built renderer `dist/renderer/index.js` contains 0 matches of `node:fs`/`require("fs")`/`require("electron")` (`grep -c`). Red runs under Reverse control.
- V1: the 11 commands of §6 fast tier, each exit 0 (listed under "Reproduce"); `FASTRUN-2026-10-21-165506597193.md` rows 1-11 also pass (claim, not relied on).
- V2: scratch copy with `args: ['-l','-i','-c', \`cd ${options.cwd} && ${bin} ${args.join(' ')}\`]`: `npx vitest run tests/unit/cli-args.test.ts` exit 1, `× keeps hostile path as one argument`, `Tests 7 failed | 8 passed (15)`; unmutated exit 0.
- V3: `npx vitest run tests/integration/pty-stub.test.ts` exit 0, 9 passed (`pty-stub.test.ts:68-120`); env marker `:108-112` with a control at `:114-120`.
- V4: cannot verify here — no FULLRUN report next to the task; see per-item table.
- V5: `python3 scripts/arch_check.py` exit 0 and the red runs under Reverse control (exit 1 each).
- V6: not checked — HUMAN item (owner); `grep -n -i "signed in\|came back\|AC10\|owner ran" tasks/10-app-shell/01-app-skeleton/NOTES.md` exit 1 (no owner record exists yet).
- D1 (tasks/DECISIONS.md, DeepSeek UA without the Electron token; ChatGPT and Grok default): `src/shared/site-policy.ts:7-9`, applied at `src/main/site-views.ts:89`; `tests/unit/site-policy.test.ts` exit 0. Met.
- D2 (tasks/DECISIONS.md, TypeScript 6.0.3): `package.json:28` pins `"typescript": "6.0.3"`; `npx tsc --noEmit` exit 0. Met.
- D3 (tasks/DECISIONS.md, remote pages in `WebContentsView` without a preload, no `<webview>`): `src/main/site-views.ts:59-61` (no `preload`), `:80` `contentView.addChildView`; `grep -rn "webview" src` has no tag use (not exhaustively proven); `arch_check` site-preload rule red on a preload (Reverse control). Met.
- PLAN D1 (scope: window, sidebar, adding agents, terminals, embedded sites, restore): covered by S2-S5. Met.
- PLAN D2 (Sonnet workers, one per task, sequential): process decision, not checkable from artefacts; commit history shows per-task commits only. cannot verify here.
- PLAN D3 (existing local sessions not in this plan): the module list of `src/main/` (agent-controller, claude-transcripts, codex-rollouts, index, ipc-handlers, menu, pty-manager, site-views, state-file) holds no session picker or filter; `claude-transcripts.ts` and `codex-rollouts.ts` only look up the app's own session id/rollout for restore. Met by absence.
- PLAN D4 (DeepSeek UA, same as D1 above): met.
- Scope: `python3 tasks/scope_check.py tasks/10-app-shell/01-app-skeleton 9ba5b34` exit 0, "scope ok: 90 changed file(s) inside the write set".
- SECURITY sinks and tests: `login-shell` -> `tests/unit/cli-args.test.ts:60` `keeps hostile path as one argument` exists, exit 0, goes red (V2); `pty` -> `tests/integration/pty-stub.test.ts:75` `paste is not submitted` exists, exit 0, goes red only for an LF-submitting stub (Finding 1); `state-file` -> `tests/unit/state-store.test.ts:34` `round-trips hostile path` exists, exit 0. DATA `validated=` names exist: `state-store.test.ts:54` `rejects malformed session id`, `:39` `falls back to empty state on invalid file`, `tests/unit/ipc-validate.test.ts:15` `rejects unknown channel and bad payload`.
- ATTACK.md: round 2 verdict line "attack:passed for tasks/10-app-shell/01-app-skeleton round 2"; `labels.txt` has `attack:passed`; the fix it attacked (`sanitizePaste`, `src/shared/terminal-input.ts:46-50`) is red when mutated (Reverse control 5). The round 2 reproductions live in an untracked scratch (`.claude/scratch/attack-app`) and were not re-run here.

## Reproduce from a clean state
```
git clone --branch app-shell-skeleton /Users/user/workflow/git/AIAgentWindows .claude/scratch/verify-clone
cd .claude/scratch/verify-clone && npm install            # exit 0, "added 402 packages", postinstall ran
npx tsc --noEmit                                          # exit 0
npx eslint .                                              # exit 0
python3 scripts/coverage_gate.py --run                    # exit 0, 16 files / 128 tests, PASS 100.00% (floor 100.00%)
python3 -m unittest discover -s tests/scripts             # exit 0, Ran 40 tests OK
python3 scripts/evidence_check.py                         # exit 0, 84 rows, 0 problems
python3 scripts/arch_check.py                             # exit 0, 0 problems
python3 scripts/check_publish_flags.py                    # exit 0, 0 problems
python3 scripts/lint_changed.py --base 2393fe1 --glob '*.sh' -- shellcheck -S warning                                   # exit 0, no changed file matches
python3 scripts/lint_changed.py --base 2393fe1 --glob '.github/workflows/*.yml' --glob '.github/workflows/*.yaml' -- actionlint   # exit 0, no changed file matches
python3 scripts/lint_changed.py --base 2393fe1 --glob '*' -- sh -c 'for f do gitleaks dir --no-banner --log-level error "$f" || exit 1; done' sh   # exit 0, 198 files
gitleaks git --no-banner --log-level error --log-opts="2393fe1..HEAD"   # exit 0
npx vitest run tests/unit/cli-args.test.ts                # exit 0, 15 passed (AC2)
npx vitest run tests/integration/pty-stub.test.ts         # exit 0, 9 passed (AC3)
npx vitest run tests/unit/state-store.test.ts tests/unit/restore.test.ts   # exit 0, 19 passed (AC4)
npx vitest run tests/unit/codex-claim.test.ts             # exit 0, 12 passed (AC5)
npx vitest run tests/unit/site-policy.test.ts             # exit 0, 15 passed (AC6)
npm run build                                             # exit 0
AIAW_USER_DATA=$(mktemp -d) npx electron . --smoke-exit   # exit 0 (side check; agents.json written as {"version":1,"agents":[]})
python3 tasks/scope_check.py tasks/10-app-shell/01-app-skeleton 9ba5b34    # exit 0, scope ok: 90 files
python3 tasks/check.py                                    # exit 0, problems: 0
```
The two shellcheck/actionlint lines had no input (no `*.sh`, no workflows) and so prove nothing about those tools. Not run: `npx vitest run tests/full`, `npx playwright test --project=electron-smoke` (`[full]`).

## Reverse control
All in `.claude/scratch/mut` (a copy of the clean clone), each restored from git afterwards.
1. V2/AC2: `src/shared/cli-args.ts` shell args replaced by the interpolated string `cd ${cwd} && ${bin} ${args.join(' ')}` -> `npx vitest run tests/unit/cli-args.test.ts` exit 1, `× keeps hostile path as one argument` (`AssertionError: expected 'cd /tmp/a b"; touch /tmp/pwned; " && …' to be 'exec "$@"'`), `Tests 7 failed | 8 passed (15)`.
2. V5/AC8: unmutated `python3 scripts/arch_check.py --root .` exit 0; appended to `src/renderer/index.ts` one line at a time, each `python3 scripts/arch_check.py --root .` exit 1: `import fs from 'node:fs';` -> `[renderer-node]`; `import { app } from 'electron';` -> `[renderer-electron]`; `import { readFileSync } from 'fs';` -> `[renderer-node]`; `import { x } from '../main/agent-controller';` -> `[renderer-main]`; `require('node:fs')`, `import('node:fs')`, `export * from 'node:path'`, `import 'electron';`, `import type {X} from 'electron'` -> exit 1 each. `preload: '/x.js'` added to the site `WebContentsView` in `src/main/site-views.ts` -> `site-views.ts:59 [site-preload]` exit 1; restored -> exit 0.
3. SECURITY pty sink: stub changed to submit on `\r` or `\n` inside a bracketed paste -> `pty-stub.test.ts` exit 1, `× paste is not submitted` (`expected … not to contain 'SUBMITTED'`) and `× a hostile paste … not submitted once sanitised`. With the weaker mutation `\r` only (paste of LF stays inside) -> only the hostile-paste test went red, `paste is not submitted` stayed green (Finding 1).
4. `sanitizePaste` filter replaced by `.filter(() => true)` -> `npx vitest run tests/unit tests/integration` exit 1, `Tests 2 failed | 126 passed (128)`: the unit test `removes every escape and C1 control …` and the integration test `a hostile paste with an embedded end marker is not submitted once sanitised`.
5. AC9: scratch package.json `{"scripts":{"dist":"electron-builder --mac"}}` -> `python3 scripts/check_publish_flags.py --package <file>` exit 1 `[publish-flag]`; `{"scripts":{"release":"echo x"}}` -> exit 1 `[release-script]`.

## Findings
1. `tests/integration/pty-stub.test.ts:10` pastes `first line\nsecond line` (LF) while xterm sends pasted line breaks as CR; the test named in SECURITY (`paste is not submitted`) therefore stays green if the stub submits on `\r` inside a paste (Reverse control 3). The CR case is covered only by the hostile-paste test at `:84-92`. The test exercises the stub and `PtyManager.write`, not the renderer paste path.
2. Open residuals recorded by the work itself, not fixed: round 1 PLAUSIBLE (no navigation lock on the main window) and the three round 2 observations (multi-line paste when the CLI turns bracketed paste off; C1 characters in a dropped path silently rewritten; 256 KB backlog can drop `ESC[?2004h`) in NOTES.md.
3. S1 "every electron-builder command carries `--publish never`" holds only vacuously: no script or file invokes electron-builder (it is a devDependency, `package.json:24`), so `check_publish_flags.py` exit 0 does not exercise the positive case beyond its own unit tests (`tests/scripts/test_check_publish_flags.py`, run in the 40 above).
4. `vitest` prints a Vite `configLoader: 'native'` warning for `vitest.config.ts` (ESM syntax in a CommonJS package); exit codes unaffected.

## What was not checked
- V6 / AC10 (owner runs the app with real Claude Code, Codex and the three sites, signs in, restarts): HUMAN, outside the repository, not checked.
- V4 / AC7: `[full]` items are not run here and no `FULLRUN-*.md` exists; the Playwright smoke (agent added through the UI, stub banner in the pane, agent listed after relaunch, DeepSeek view on a local page) and `npx vitest run tests/full` are unverified by this report. The claims in PLAN.md Log (`electron-smoke 2 passed`) are unconfirmed here. The `FASTRUN-*.md` files are fast-tier reports and do not substitute.
- Real UI behaviour of S2, the visible site views of S4, drag-and-drop and Ctrl+V/Alt+V reaching a pty through the renderer, and window layout: read from code only; no renderer ran.
- The real `claude --resume`/`codex resume` argv behaviour, the Codex rollout claim against a real `~/.codex`, and real site sign-in persistence: only stub/fixture tests.
- macOS only; Windows (`platform: 'win32'` branch of `buildSpawn`) and Ubuntu untested.
- Claims in ATTACK.md about its scratch reproductions (`.claude/scratch/attack-app`) were read, not re-run.
- Plan D2 (who wrote the code) cannot be checked from artefacts.
- Test flakiness: each command was run once; `pty-stub` has a recorded earlier race (NOTES.md "T14 stub race").

## Verdict
verify:pending kept for tasks/10-app-shell/01-app-skeleton — nothing failed, but not `verify:passed`: V4 (`[full]`, no FULLRUN report) cannot be verified here and V6 (HUMAN) is the owner's; V1, V2, V3, V5 and S1-S7 with the cited decisions reproduce from a fresh clone.
