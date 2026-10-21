# claude-code@2.1.306

The installed CLI (`claude --version` → 2.1.306). Its docs are not versioned; quotes were read on 2026-10-21.

- `--session-id <uuid>` starts a session with that id, `--resume <id>` resumes it, `--add-dir` grants read and edit access to an extra directory; reads there need no prompt — https://code.claude.com/docs/en/cli-reference and https://code.claude.com/docs/en/permissions
- Transcripts live at `projects/<project>/<session>.jsonl` under `~/.claude` or `CLAUDE_CONFIG_DIR`; the docs call it "Full conversation transcript" and list no fields — https://code.claude.com/docs/en/claude-directory
- The project directory name comes from the resolved path: a session started in `/tmp/x` is stored under `-private-tmp-x`, so the app finds a transcript by globbing `projects/*/<id>.jsonl` (`tasks/05-feasibility/01-evidence-table/spikes/transcripts-last-reply.txt`) — https://code.claude.com/docs/en/claude-directory
- Subagent turns are written to `<session>/subagents/agent-*.jsonl`, not into the session file; the main file had no `isSidechain: true` records in a session with three subagents (`{S}/claude-subagent-files.txt`) — https://code.claude.com/docs/en/claude-directory
- One reply spans several `type: assistant` records (a `thinking` block, then `text`); the last reply is the text blocks after the last user prompt (`last_reply.py` in the spike directory) — https://code.claude.com/docs/en/claude-directory
- `Ctrl+V` (Alt+V on Windows) makes the CLI read the OS clipboard itself: an image becomes an `[Image #N]` chip, text is pasted as text (both seen in the spike screens) — https://code.claude.com/docs/en/interactive-mode
- The Linux clipboard helper Claude Code needs (xclip or wl-paste) is not named in the official docs — https://code.claude.com/docs/en/troubleshooting
- A new directory shows a workspace-trust dialog whose default choice is "No, exit" (Enter alone quits, `{S}/claude-trust-enter/run.out`); the answer is saved in the user's config — https://code.claude.com/docs/en/permissions
- Voice dictation: `/voice`, hold Space; needs a Claude.ai sign-in and a local microphone; on Linux it falls back to `arecord` or SoX `rec` when its native module cannot load — https://code.claude.com/docs/en/voice-dictation
- A `claude` that inherits `CLAUDE_CODE_CHILD_SESSION` from a Claude Code session turns transcript saving off ("Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION marker", `{S}/claude-resume-inherited-env.txt`); the app drops the variable when it spawns a window — https://code.claude.com/docs/en/claude-directory
- `--dangerously-skip-permissions` equals `--permission-mode bypassPermissions` — https://code.claude.com/docs/en/permission-modes
- Running the unmodified binary with the user's own subscription inside another product is allowed; the binary must not be modified and usage may not be resold or intermediated — https://code.claude.com/docs/en/legal-and-compliance
