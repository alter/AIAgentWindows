---
status: paused
created: 2026-10-23
---
# OpenRouter chat agent

## Goal
Owner's answer, 2026-10-23: "Room + отдельный чат" — a sidebar agent that chats with one OpenRouter model.

## Acceptance criteria
- [x] AC1 Fast tier green: every command of docs/PROJECT.md §6 fast tier exits 0
- [x] AC2 Rules: `npx vitest run tests/unit/openrouter-chat.test.ts` exit 0 — SSE parser (comment lines ignored, split chunks, [DONE], mid-stream error), conversation parse and limits, malformed file refused; seen red first; reverse control (comment-line check skipped) red, output in NOTES.md
- [x] AC3 Integration: streaming against the fake server, Stop aborts, every request carries the stored conversation
- [x] AC4 Smoke: electron-smoke exit 0 — create the agent from "+", send two messages, streamed replies appear, Stop mid-stream, restart keeps the conversation, markup in reply and message shown as text — windows hidden
- [ ] AC5 HUMAN (excluded from /run): the owner chats with a free and a paid model

## Stack
As tasks/10-app-shell/06-room-layout/PLAN.md; OpenRouter per docs/tech/openrouter@2026-10-23.md (the API is unversioned: the dated study is the pinned reference, and DATA sources point at Wayback snapshots of the same pages dated 20261023). Node 22 fetch and http in the main process; no new dependency.

## Decisions
- D1 Streaming in the main process, deltas to the renderer through an event channel; the key never leaves main (study, Implications: chat pane; 16 D2).
- D2 Plain text replies drawn with textContent, as in the Room feed (agent's decision).
- D3 Conversation per agent in <shared>/openrouter/<agentId>.json, atomic writes (agent's decision, same pattern as room records).
- Branch: `room`. Commit per task, never push.

## Assumptions
- Model, effort and web controls reuse the Room row's components from 17.
- The agent's icon is OpenRouter's vendored logo from 14.
- Icon: the mono `openrouter.svg` (lobe-icons 1.95.1, black on light and inverted to white on dark, like openai.svg and grok.svg); the colour variant stays in the folder (coordinator).
- The key never leaves the main process; deltas travel as `{ id, text }` on an event channel; a 401 goes through OpenRouterService.keyRejected (coordinator).
- Conversation file `<shared>/openrouter/<agentId>.json`: UUID checked before it becomes a path, atomic write, unreadable or malformed file refused and never rewritten, closing the agent keeps it (coordinator).
- AgentKind gains `openrouter`; the five older kinds remain `ROOM_AGENT_KINDS` for Room participants (agent).
- Model, effort and web settings live on the agent in agents.json (`Agent.openrouter`), the conversation file holds messages only (agent).
- A stored reply of status failed is not sent again as context; a stopped reply with text is (agent).
- An SSE line that is not a comment, an empty line or data/event/id/retry makes the reply fail as unreadable (agent).
- Limits: message 100000 chars, reply 200000 chars, 2000 entries, 3000000 chars of text in a conversation, 32 MiB file, 120 s without a byte from the stream (agent).

## Out of scope
- Files and images, markdown rendering

## Tasks
- [x] T00 Baseline: the coordinator's last verified run before T01 — verify: the Log line exists
- [x] T01 Chat agent (S1–S5): SSE parser and conversation rules red first; stream channel; pane; store; smoke with reverse control — verify: AC2, AC3 + fast tier + electron-smoke
- [x] T02 Ledger and notes — verify: tasks/check.py no new problem + fast tier

## Log
- 2026-10-23 coordinator: T00 baseline = verification run on ddb04ea (17-openrouter-room): fast tier 12 commands exit 0, vitest 1112/1112, coverage 100.00 %, electron-smoke 65/65; tasks/check.py baseline 7 problems
- 2026-10-23 T01 done: OpenRouter chat agent (kind openrouter, streaming SSE in main, pane with Room row controls, per-agent conversation file); fast tier exit 0, vitest 1162/1162 (unit 27 + integration 16 new), coverage 100.00 %, build exit 0, electron-smoke 67/67, reverse control red then green, tasks/check.py 7 problems (baseline)
- 2026-10-23 coordinator: T01 verified (diff reviewed: conversation path from a UUID only, atomic write, unreadable refused and never rewritten, pane without innerHTML, deltas carry id and text only; openrouter.svg sha256 equals the study, not re-fetched; fast tier 12 exit 0, vitest 1162/1162, coverage 100.00 %, electron-smoke 67/67) — this run
- 2026-10-23 T02 done: OpenRouter ledger row (chat agent built), AGENTS.md map (main openrouter/, renderer OpenRouter files, study doc), NOTES summary, labels status:review; tasks/check.py 7 (baseline); paused on AC5 HUMAN
