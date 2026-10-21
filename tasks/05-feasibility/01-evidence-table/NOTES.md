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
