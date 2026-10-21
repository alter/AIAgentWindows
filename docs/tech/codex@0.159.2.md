# codex@0.159.2

The installed CLI (`codex --version` → codex-cli 0.159.2). Source read at tag `rust-v0.159.2`.

- Transcripts: `~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<uuid>.jsonl`, root relocated by `CODEX_HOME` — https://github.com/openai/codex/blob/rust-v0.159.2/codex-rs/rollout/src/recorder.rs#L82-L83
- `codex resume <SESSION_ID>` resumes; no flag sets the id of a new session — https://github.com/openai/codex/blob/rust-v0.159.2/codex-rs/cli/src/main.rs#L350-L354
- The last reply is the last `response_item` with `payload.type == message` and `role == assistant`, text in `output_text` blocks; `session_meta.payload.cwd` names the directory (`tasks/05-feasibility/01-evidence-table/spikes/transcripts-last-reply.txt`) — https://github.com/openai/codex/blob/rust-v0.159.2/codex-rs/rollout/src/recorder.rs
- `read-only` and `workspace-write` sandboxes read the whole disk; only writes are confined (`codex sandbox` run in `tasks/05-feasibility/01-evidence-table/spikes/codex-sandbox-read.txt`) — https://github.com/openai/codex/blob/rust-v0.159.2/codex-rs/protocol/src/permissions.rs#L2042-L2062
- `--add-dir` adds writable roots — https://github.com/openai/codex/blob/rust-v0.159.2/codex-rs/utils/cli/src/shared_options.rs#L9-L18
- `-i/--image` attaches images to the first prompt; the TUI pastes clipboard images through `paste_image_as_png` — https://github.com/openai/codex/blob/rust-v0.159.2/codex-rs/tui/src/clipboard_paste.rs#L1-L30
- `/voice` exists in the TUI ("start or stop voice") — https://github.com/openai/codex/blob/rust-v0.159.2/codex-rs/tui/src/slash_command.rs#L130-L137
- Startup can show an update dialog whose default choice runs `curl … | sh`, then a folder-trust dialog; text pasted before they are answered lands in the dialog (`codex-update-dialog.screen.txt` in the spike directory) — https://github.com/openai/codex/blob/rust-v0.159.2/codex-rs/tui/src/onboarding/trust_directory.rs#L50-L72
- `--dangerously-bypass-approvals-and-sandbox` removes sandbox and approvals; `-a` takes `untrusted`, `on-request`, `never` — https://github.com/openai/codex/blob/rust-v0.159.2/codex-rs/protocol/src/protocol.rs#L986-L1009
- Sign-in with ChatGPT needs no API key — https://learn.chatgpt.com/docs/codex/cli
