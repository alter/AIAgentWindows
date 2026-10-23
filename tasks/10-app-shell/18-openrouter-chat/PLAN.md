---
status: todo
created: 2026-10-23
---
# OpenRouter chat agent

## Goal
Owner's answer, 2026-10-23: "Room + отдельный чат" — a sidebar agent that chats with one OpenRouter model.

## Acceptance criteria
- [ ] AC1 Fast tier green: every command of docs/PROJECT.md §6 fast tier exits 0
- [ ] AC2 Rules: `npx vitest run tests/unit/openrouter-chat.test.ts` exit 0 — SSE parser (comment lines ignored, split chunks, [DONE], mid-stream error), conversation parse and limits, malformed file refused; seen red first; reverse control (comment-line check skipped) red, output in NOTES.md
- [ ] AC3 Integration: streaming against the fake server, Stop aborts, every request carries the stored conversation
- [ ] AC4 Smoke: electron-smoke exit 0 — create the agent from "+", send two messages, streamed replies appear, Stop mid-stream, restart keeps the conversation, markup in reply and message shown as text — windows hidden
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

## Out of scope
- Files and images, markdown rendering

## Tasks
- [ ] T00 Baseline: the coordinator's last verified run before T01 — verify: the Log line exists
- [ ] T01 Chat agent (S1–S5): SSE parser and conversation rules red first; stream channel; pane; store; smoke with reverse control — verify: AC2, AC3 + fast tier + electron-smoke
- [ ] T02 Ledger and notes — verify: tasks/check.py no new problem + fast tier

## Log
