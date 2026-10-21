# NOTES — evidence pass (2026-10-21)

## Method

- Every claim of `docs/PROJECT.md` §3, §5, §6 became a row of `docs/EVIDENCE.md`; `scripts/evidence_check.py` refuses a row without evidence (reverse control: `spikes/reverse-control.txt`).
- Versions pinned at least two weeks old by npm publish date (`npm view <pkg> time`): Electron 44.6.0 (45.0.0 was published the same day), node-pty 1.1.0, xterm 6.0.0, TypeScript 6.0.3 (see D2), vitest 5.0.3, Playwright 1.63.0, electron-builder 26.17.0.
- Documentation was read by three research subagents at pinned tags; their reports were treated as claims. Re-read by this session before use: the Claude Code legal text (CC14), typescript-eslint's supported range (G4), vitest's `poolOptions` removal (G6), OpenAI's extraction clause (W12), Google's embedded-agent clause (W7).
- Spikes: `spikes/pty-claude.js` (claude or codex in node-pty inside Electron, screen read through `@xterm/headless`), `spikes/web.js` (the three sites in Electron windows with temporary partitions), `spikes/last_reply.py` (transcript parsing), `spikes/spike-package.json` (the spike's pinned `package.json`). They ran from `.claude/scratch/spike/` with `env -i` and a GUI-like `PATH=/usr/bin:/bin:/usr/sbin:/sbin`.

## What the evidence changed

- Refuted: subagent turns in the session file (CC9); `Ctrl+V` with text doing nothing in Claude Code (F3) — the "check the clipboard type" rule is gone; Codex has no voice (CX12); DeepSeek accepting Electron (W3); bot challenges on logged-out load (W6); TypeScript 7 with typescript-eslint (G4); vitest `poolOptions` (G6); `PLAYWRIGHT_JUNIT_OUTPUT_NAME` with a path (G7); clipboard-image paste into Codex in the app's pty (CX10).
- New facts: node-pty's `spawn-helper` ships without the execute bit (P2); Electron 44's clipboard is async with no image helpers (F4); Codex shows an update dialog whose default runs `curl … | sh` (CX2); Claude Code's trust dialog defaults to "No, exit" (CC13); the login shell runs the user's rc files (CC3); the sites forbid framing (`spikes/frame-headers.txt`).

## Side effects on the owner's machine

- One prompt was sent to Claude Code on Haiku ("Reply with the single word OK…", session `7d58de11-…`, `spikes/claude-submit/`); nothing was sent to any website or to Codex.
- The CLIs saved trust for the spike directories: three `/private/tmp/spike-cwd-*` entries in `~/.claude.json` and six in `~/.codex/config.toml`. Left in place; they point at deleted temporary directories.
- The system clipboard was replaced for about ten seconds per clipboard run and restored. The first restore ran without a UTF-8 locale and turned the owner's Cyrillic text into `?`; it was put back by hand the same minute, and the script now restores with `LANG=en_US.UTF-8`. Text copied during a run would have been lost.
- Electron renderer spikes ran outside the Claude Code harness sandbox (inside it Chromium fails with `UnknownVizError`).
- The CLI-research subagent cloned the Codex repository to `/tmp/codex-src`; removed after the pass.

## What was not checked

- Signing in on any site (VERIFY item 6, HUMAN), so W8, V6 and the persistence of a signed-in partition are open.
- Windows 11 and Ubuntu 26.04 (CC16, P4, P6).
- Why Codex rejects the clipboard image (CX10): the same clipboard worked for Claude Code; CX11 decides whether the app is at fault.
- Setting files on each site's file input (F6) and the sites' voice buttons (V6).
- shellcheck and actionlint have had no input, so their gate lines were never red (G3).

# NOTES — after verify:failed (2026-10-21)

The first `/verify` (VERIFY.md) failed item 4 and named nine rows. What changed:

- G7 was wrongly refuted: Playwright resolves `PLAYWRIGHT_JUNIT_OUTPUT_NAME` against the output dir, which defaults to the config dir (`base.ts:671-675`, re-read by this session). Now confirmed; §6 keeps `…_OUTPUT_FILE` with a corrected reason.
- CC13 "Enter alone quits" now has its own run: `spikes/claude-trust-enter/run.out` (pty exit 1 0.7 s after Enter).
- CX2 claimed that a paste before the dialogs lands in them; no artefact showed it. The claim is cut to what the screens show.
- W1/W6: the site probe used a ChatGPT selector that no longer matches and a regex over the whole HTML. Rerun with a generic input probe and separate `challengeScriptInHtml` / `challengeShown`; screenshots regenerated and re-read, except `web-deepseek-plain-ua.png`: its rerun capture failed (`UnknownVizError` in `web-report-plain-ua.json`), so that image is from the first round (10:48) with the same user agent.
- CX3 is now a run (`codex-help.txt`), not a citation of the resume command; CX4 and CX13 cite the lines that hold the facts; CC10 states only what the page says; CX8 is backed by reads of the repository, `/etc/hosts` and `~/.zshrc` (`codex-sandbox-read-wide.txt`); G9 covers all eight deny prefixes.
- New rows: CC17 (an inherited `CLAUDE_CODE_CHILD_SESSION` turns transcript saving off — found while answering the owner's question about existing sessions), CX15 (Codex rollouts are being migrated to a paginated form; parser unproven on it), CX16 (Codex `session_index.jsonl`).
- The rerun spikes ran `claude` once more in a new temporary directory (no prompt) and re-opened the Haiku session `7d58de11-…` with `--resume` (no prompt). No clipboard was touched.
- `tasks/scope_check.py --help` crashes: it takes `<task dir> [base]` and has no `--help`. Template script, left as is.

# NOTES — after the second verify:failed (2026-10-21)

- U1: node-pty's tech note claimed win32 prebuilds loaded; only darwin-arm64 ran. Fixed.
- U2: "the config sets `publish: never`" was wrong: `never` is the CLI policy, the config key holds providers, and electron-builder publishes implicitly under `npm run release`, a CI tag or CI detection (`PublishManager.ts:85-104`, re-read by this session). §5 now requires `--publish never` on every build command and no `release` script (G10, G12).
- U3: `Alt+V` (F7), native drag-and-drop/paste in the sites (F8, open) and OS dictation (V7, open) got rows.
- U4: "load and chat" cut to "load with a chat input": no prompt was sent.
- V2 became an open assumption: the Apple thread could not be read.
- The harness-only observation (Electron renderers fail inside the Claude Code sandbox with `UnknownVizError`) moved out of `docs/tech/electron@44.6.0.md`; it is about this session's tooling, not Electron.
- While writing this note an unquoted shell heredoc ran its backticks: `npm run release` executed in the repository root (no package.json: "Missing script") and a few words were tried as commands; nothing was changed by it.
