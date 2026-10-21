# EVIDENCE

Every claim that `docs/PROJECT.md` makes about how the product works, with what proves it. Kinds: `run` (an artefact under `tasks/05-feasibility/01-evidence-table/spikes/`), `doc` (documentation or source of the pinned version, see `docs/tech/`), `assumption` (open, names where it is checked). `python3 scripts/evidence_check.py` fails on a row without evidence. Built 2026-10-21 by `tasks/05-feasibility/01-evidence-table`.

## Claude Code windows

| ID | Claim | Kind | Evidence | Status |
|---|---|---|---|---|
| CC1 | node-pty 1.1.0 spawns a process inside Electron 44.6.0 without a rebuild (macOS) | run | `tasks/05-feasibility/01-evidence-table/spikes/claude-run.out` | confirmed |
| CC2 | A login shell (`zsh -l -i -c claude`) finds `claude` when the GUI process has only `/usr/bin:/bin:/usr/sbin:/sbin` on PATH | run | `tasks/05-feasibility/01-evidence-table/spikes/claude-run.out`, `tasks/05-feasibility/01-evidence-table/spikes/claude-04-after-ctrl-v-image.screen.txt` | confirmed |
| CC3 | The login shell runs the user's rc files with their side effects (here `ssh-add` printed "Identity added") | run | `tasks/05-feasibility/01-evidence-table/spikes/claude-01-start.screen.txt` | confirmed |
| CC4 | `--session-id <uuid>` and `--add-dir <dir>` start a session with that id and access to the shared directory | doc | https://code.claude.com/docs/en/cli-reference | confirmed |
| CC5 | Reads in an `--add-dir` directory need no permission prompt | doc | https://code.claude.com/docs/en/permissions | confirmed |
| CC6 | The transcript is found by globbing `projects/*/<session-id>.jsonl`; the directory name comes from the resolved path (`/tmp/x` → `-private-tmp-x`), so it is not recomputed from the cwd string | run | `tasks/05-feasibility/01-evidence-table/spikes/transcripts-last-reply.txt` | confirmed |
| CC7 | `CLAUDE_CONFIG_DIR` relocates `~/.claude` | doc | https://code.claude.com/docs/en/claude-directory | confirmed |
| CC8 | The last reply is the text blocks of `type: assistant` records after the last user prompt; one reply spans several records (thinking, then text) | run | `tasks/05-feasibility/01-evidence-table/spikes/transcripts-last-reply.txt`, `tasks/05-feasibility/01-evidence-table/spikes/last_reply.py` | confirmed |
| CC9 | Subagent turns live in the session file and must be filtered by `isSidechain` | run | `tasks/05-feasibility/01-evidence-table/spikes/claude-subagent-files.txt` | refuted |
| CC10 | The docs describe the transcript only as "Full conversation transcript", with no fields | doc | https://code.claude.com/docs/en/claude-directory | confirmed |
| CC11 | Bracketed paste puts multi-line text into the prompt without submitting it | run | `tasks/05-feasibility/01-evidence-table/spikes/claude-03-after-bracketed-paste.screen.txt` | confirmed |
| CC12 | `--resume <id>` reopens a session | doc | https://code.claude.com/docs/en/cli-reference | confirmed |
| CC13 | A new directory shows a trust dialog whose default choice is "No, exit"; Enter alone quits | run | `tasks/05-feasibility/01-evidence-table/spikes/claude-01-start.screen.txt`, `tasks/05-feasibility/01-evidence-table/spikes/claude-trust-enter/run.out` | confirmed |
| CC14 | Running the unmodified `claude` binary with the user's own subscription inside another product is allowed | doc | https://code.claude.com/docs/en/legal-and-compliance | confirmed |
| CC15 | `--dangerously-skip-permissions` equals `--permission-mode bypassPermissions` | doc | https://code.claude.com/docs/en/permission-modes | confirmed |
| CC17 | A `claude` started with the `CLAUDE_CODE_CHILD_SESSION` marker inherited from a Claude Code session does not save its transcript, so the app must drop that variable when it spawns a window | run | `tasks/05-feasibility/01-evidence-table/spikes/claude-resume-inherited-env.txt` | confirmed |
| CC16 | On Windows `claude` is resolved from the user's environment at spawn time | assumption | HUMAN: Windows 11 smoke | open |

## Codex windows

| ID | Claim | Kind | Evidence | Status |
|---|---|---|---|---|
| CX1 | `codex` runs in node-pty inside Electron under the user's ChatGPT sign-in | run | `tasks/05-feasibility/01-evidence-table/spikes/codex-02-dialog-1.screen.txt` | confirmed |
| CX2 | Startup may show an update dialog whose default choice runs `curl … \| sh`, and a folder-trust dialog, before the prompt | run | `tasks/05-feasibility/01-evidence-table/spikes/codex-update-dialog.screen.txt`, `tasks/05-feasibility/01-evidence-table/spikes/codex-02-dialog-0.screen.txt`, `tasks/05-feasibility/01-evidence-table/spikes/codex-run.out` | confirmed |
| CX3 | No option of `codex` or `codex resume` sets the session id of a new session | run | `tasks/05-feasibility/01-evidence-table/spikes/codex-help.txt` | confirmed |
| CX4 | Transcripts are `sessions/YYYY/MM/DD/rollout-*-<uuid>.jsonl` under `CODEX_HOME` or `~/.codex` | doc | https://github.com/openai/codex/blob/rust-v0.159.2/codex-rs/rollout/src/recorder.rs#L1727-L1735 | confirmed |
| CX5 | The last reply is the last `response_item` / `message` / `assistant`; `session_meta` carries the cwd | run | `tasks/05-feasibility/01-evidence-table/spikes/transcripts-last-reply.txt` | confirmed |
| CX6 | A window claims the rollout that appeared after its spawn, matches its cwd and is unclaimed | assumption | T00 stub-CLI integration test | open |
| CX7 | `codex resume <id>` reopens a session | doc | https://github.com/openai/codex/blob/rust-v0.159.2/codex-rs/cli/src/main.rs#L350-L354 | confirmed |
| CX8 | Codex reads files outside its cwd anywhere on the disk (the repository, `/etc`, the home directory) in `read-only` and `workspace-write` sandboxes | run | `tasks/05-feasibility/01-evidence-table/spikes/codex-sandbox-read.txt`, `tasks/05-feasibility/01-evidence-table/spikes/codex-sandbox-read-wide.txt` | confirmed |
| CX9 | Bracketed paste puts multi-line text into the Codex prompt without submitting it | run | `tasks/05-feasibility/01-evidence-table/spikes/codex-03-after-bracketed-paste.screen.txt` | confirmed |
| CX10 | `Ctrl+V` pastes a clipboard image into Codex running in the app's pty | run | `tasks/05-feasibility/01-evidence-table/spikes/codex-04-after-ctrl-v-image.screen.txt`, `tasks/05-feasibility/01-evidence-table/spikes/codex-nsimage/codex-04-after-ctrl-v-image.screen.txt`, `tasks/05-feasibility/01-evidence-table/spikes/codex-fullenv/codex-04-after-ctrl-v-image.screen.txt` | refuted |
| CX11 | Codex pastes a clipboard image in an ordinary terminal (tells whether CX10 is the app's fault) | assumption | HUMAN: Ctrl+V of a screenshot in iTerm2 | open |
| CX12 | Codex CLI has no voice input | doc | https://github.com/openai/codex/blob/rust-v0.159.2/codex-rs/tui/src/slash_command.rs#L130-L137 | refuted |
| CX13 | `--dangerously-bypass-approvals-and-sandbox` (alias `--yolo`) skips approvals and the sandbox | doc | https://github.com/openai/codex/blob/rust-v0.159.2/codex-rs/utils/cli/src/shared_options.rs#L53-L58 | confirmed |
| CX15 | Codex is migrating rollouts to a "paginated thread history" (`codex migrate-rollouts`); the last-reply parser holds for both forms | assumption | stub-CLI test of the Codex window task, tasks/<codex-window> after T00 | open |
| CX16 | `session_index.jsonl` under the Codex home maps a session id to its thread name | run | `tasks/05-feasibility/01-evidence-table/spikes/codex-session-index.txt` | confirmed |
| CX14 | Codex signs in with ChatGPT, no API key | doc | https://learn.chatgpt.com/docs/codex/cli | confirmed |

## Files, images, clipboard

| ID | Claim | Kind | Evidence | Status |
|---|---|---|---|---|
| F1 | A dropped file's path comes from `webUtils.getPathForFile`; `File.path` is gone | doc | https://github.com/electron/electron/blob/v44.6.0/docs/breaking-changes.md#L981-L983 | confirmed |
| F2 | `Ctrl+V` with an image in the clipboard makes Claude Code attach it (`[Image #1]`) | run | `tasks/05-feasibility/01-evidence-table/spikes/claude-04-after-ctrl-v-image.screen.txt` | confirmed |
| F3 | With text in the clipboard `Ctrl+V` does nothing in Claude Code, so the terminal must check the clipboard type and paste text itself | run | `tasks/05-feasibility/01-evidence-table/spikes/claude-text-clipboard/claude-04-after-ctrl-v-image.screen.txt` | refuted |
| F4 | Electron 44 clipboard is async (`has`, `read`, `write`); `readImage`/`writeImage`/`availableFormats` do not exist | run | `tasks/05-feasibility/01-evidence-table/spikes/electron-clipboard-api.txt` | confirmed |
| F5 | The main process can set files on a page's file input through CDP `DOM.setFileInputFiles` | doc | https://chromedevtools.github.io/devtools-protocol/tot/DOM/#method-setFileInputFiles | confirmed |
| F7 | Claude Code's clipboard-image key on Windows is `Alt+V` | doc | https://code.claude.com/docs/en/interactive-mode | confirmed |
| F8 | Drag-and-drop and paste of files and images work natively in the embedded sites | assumption | HUMAN: drop a file on each signed-in site in the sign-in window | open |
| F6 | Each site's file input accepts files set that way | assumption | the web-adapter task, tasks/ (created after T00) | open |

## Voice

| ID | Claim | Kind | Evidence | Status |
|---|---|---|---|---|
| V1 | Claude Code dictation: `/voice`, hold Space; needs Claude.ai sign-in and a local microphone; Linux falls back to `arecord` or SoX `rec` | doc | https://code.claude.com/docs/en/voice-dictation | confirmed |
| V2 | macOS attributes a child process's microphone use to the responsible app | assumption | HUMAN: first `/voice` in a Claude Code window of a dev build (the Apple forum thread cited by research could not be read) | open |
| V3 | The app needs `NSMicrophoneUsageDescription` in Info.plist | doc | https://github.com/electron/electron/blob/v44.6.0/docs/api/system-preferences.md#L360 | confirmed |
| V4 | The microphone can be granted per requesting origin | doc | https://github.com/electron/electron/blob/v44.6.0/docs/api/session.md | confirmed |
| V5 | An unsigned app is asked for the microphone again after each rebuild | assumption | HUMAN: first voice use after two dev builds | open |
| V7 | OS dictation (macOS Dictation, Windows Win+H) types into the terminal and the sites' inputs; Ubuntu has no built-in dictation | assumption | HUMAN: per-OS smoke | open |
| V6 | The sites' own voice buttons work in the app | assumption | HUMAN: signed-in check, NOTES.md | open |

## Web agents

| ID | Claim | Kind | Evidence | Status |
|---|---|---|---|---|
| W1 | chatgpt.com loads in Electron logged out, with an input, no bot challenge | run | `tasks/05-feasibility/01-evidence-table/spikes/web-chatgpt.png`, `tasks/05-feasibility/01-evidence-table/spikes/web-report.json` | confirmed |
| W2 | grok.com loads in Electron logged out, with an input, no bot challenge | run | `tasks/05-feasibility/01-evidence-table/spikes/web-grok.png`, `tasks/05-feasibility/01-evidence-table/spikes/web-report.json` | confirmed |
| W3 | chat.deepseek.com accepts Electron's default user agent | run | `tasks/05-feasibility/01-evidence-table/spikes/web-deepseek.png` | refuted |
| W4 | chat.deepseek.com shows its normal sign-in form when the `Electron/…` token is removed from the user agent | run | `tasks/05-feasibility/01-evidence-table/spikes/web-deepseek-plain-ua.png`, `tasks/05-feasibility/01-evidence-table/spikes/web-report-plain-ua.json` | confirmed |
| W5 | chat.deepseek.com requires sign-in (redirects to `/sign_in`) | run | `tasks/05-feasibility/01-evidence-table/spikes/web-report.json` | confirmed |
| W6 | Loading the sites logged out shows a bot challenge (a Cloudflare script is present in DeepSeek's HTML, none is shown) | run | `tasks/05-feasibility/01-evidence-table/spikes/web-report.json`, `tasks/05-feasibility/01-evidence-table/spikes/web-chatgpt.png`, `tasks/05-feasibility/01-evidence-table/spikes/web-grok.png`, `tasks/05-feasibility/01-evidence-table/spikes/web-deepseek-plain-ua.png` | refuted |
| W7 | Google sign-in is refused inside an embedded view | doc | https://developers.google.com/identity/protocols/oauth2/policies | confirmed |
| W8 | Email/password sign-in works by hand in the app's views | assumption | HUMAN: VERIFY item 6 of tasks/05-feasibility/01-evidence-table | open |
| W9 | A `persist:` partition keeps the sign-in across restarts | doc | https://github.com/electron/electron/blob/v44.6.0/docs/api/session.md | confirmed |
| W10 | Adapter code runs from the main process in an isolated world, with no preload in the remote page | run | `tasks/05-feasibility/01-evidence-table/spikes/web-report.json` | confirmed |
| W11 | The `<webview>` tag is discouraged; remote pages go into `WebContentsView` | doc | https://github.com/electron/electron/blob/v44.6.0/docs/api/webview-tag.md | confirmed |
| W12 | OpenAI terms forbid automatically or programmatically extracting Output | doc | https://openai.com/policies/row-terms-of-use/ | confirmed |
| W13 | xAI acceptable use policy forbids using bots to access the service | doc | https://x.ai/legal/acceptable-use-policy | confirmed |
| W14 | DeepSeek terms forbid capturing content with robots or other automatic setups | doc | https://cdn.deepseek.com/policies/en-US/deepseek-terms-of-use.html | confirmed |

## Keys, platforms, build

| ID | Claim | Kind | Evidence | Status |
|---|---|---|---|---|
| K1 | On Linux `safeStorage` reports `basic_text` when no secret store exists | doc | https://github.com/electron/electron/blob/v44.6.0/docs/api/safe-storage.md | confirmed |
| P1 | node-pty 1.1.0 has no Linux prebuilds; Ubuntu builds it from source | doc | https://github.com/microsoft/node-pty/blob/v1.1.0/package.json | confirmed |
| P2 | node-pty's prebuilt `spawn-helper` lacks the execute bit; every spawn fails until it is set | run | `tasks/05-feasibility/01-evidence-table/spikes/node-pty-spawn-helper.txt` | confirmed |
| P3 | Windows uses ConPTY (Windows 10 1809+) | doc | https://github.com/microsoft/node-pty/blob/v1.1.0/README.md | confirmed |
| P4 | node-pty win32 prebuilds load in Electron 44 without a rebuild | assumption | HUMAN: Windows 11 smoke | open |
| P5 | Ubuntu 24.04+ AppArmor userns restriction breaks the Chromium sandbox; the electron-builder `.deb` installs a profile | doc | https://documentation.ubuntu.com/release-notes/24.04/ | confirmed |
| P6 | The same restriction and fix hold on Ubuntu 26.04 | assumption | HUMAN: Ubuntu 26.04 smoke | open |

## Gate checks (docs/PROJECT.md §6)

| ID | Claim | Kind | Evidence | Status |
|---|---|---|---|---|
| G1 | The shellcheck, actionlint and both gitleaks lines exit 0 on the repository today | run | `tasks/05-feasibility/01-evidence-table/spikes/gate-non-ts.txt` | confirmed |
| G2 | The gitleaks line through `lint_changed` goes red on a planted token in an untracked file | run | `tasks/05-feasibility/01-evidence-table/spikes/gate-non-ts.txt` | confirmed |
| G3 | The shellcheck and actionlint lines go red on a bad file | assumption | the first task that adds a `.sh` or a workflow file (T00 if it adds one) | open |
| G4 | typescript-eslint works with the newest TypeScript (7.0.2) | doc | https://github.com/typescript-eslint/typescript-eslint/blob/v8.71.1/packages/typescript-estree/src/parseSettings/warnAboutTSVersion.ts#L11 | refuted |
| G5 | `vitest list`, `--sequence.shuffle`, `--reporter=junit --outputFile`, `--coverage.reporter=json-summary` exist in 5.0.3 | doc | https://github.com/vitest-dev/vitest/blob/v5.0.3/docs/guide/cli-generated.md | confirmed |
| G6 | `--poolOptions.forks.maxForks` limits workers in vitest 5 | doc | https://github.com/vitest-dev/vitest/blob/v5.0.3/packages/vitest/src/node/config/resolveConfig.ts#L266-L268 | refuted |
| G7 | `PLAYWRIGHT_JUNIT_OUTPUT_NAME=reports/x.xml` writes `reports/x.xml` when the config is at the repository root (the name resolves against the output dir, which defaults to the config dir) | doc | https://github.com/microsoft/playwright/blob/v1.63.0/packages/playwright/src/reporters/base.ts#L671-L675 | confirmed |
| G8 | `--reporter` on the Playwright command line replaces the configured reporters | doc | https://github.com/microsoft/playwright/blob/v1.63.0/docs/src/test-cli-js.md | confirmed |
| G9 | `git-guard` refuses all eight prefixes of the deny block and lets a local build through | run | `tasks/05-feasibility/01-evidence-table/spikes/deny-prefixes.txt` | confirmed |
| G10 | electron-builder publishes implicitly when no `--publish` is given and the npm script is `release`, a git tag is set in CI, or CI is detected; `--publish never` disables it | doc | https://github.com/electron-userland/electron-builder/blob/electron-builder@26.17.0/packages/app-builder-lib/src/publish/PublishManager.ts#L85-L104 | confirmed |
| G12 | electron-builder `-p` is the short form of `--publish` | doc | https://github.com/electron-userland/electron-builder/blob/electron-builder@26.17.0/packages/electron-builder/src/builder.ts#L271-L276 | confirmed |
| G11 | The evidence checker goes red when a row loses its evidence | run | `tasks/05-feasibility/01-evidence-table/spikes/reverse-control.txt` | confirmed |
