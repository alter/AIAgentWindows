---
status: todo
created: 2026-10-23
---
# OpenRouter in the Room

## Goal
Owner, 2026-10-23: OpenRouter paid and free models as Room participants, passing context like the other chats.

## Acceptance criteria
- [ ] AC1 Fast tier green: every command of docs/PROJECT.md §6 fast tier exits 0
- [ ] AC2 Rules: unit tests for the openrouter participant (model id shape, effort only from supported_efforts, web default on for paid / off for :free, labels); seen red first
- [ ] AC3 Run: `npx vitest run tests/integration/openrouter-room.test.ts` exit 0 on the fake server — two OpenRouter rows and a stub CLI relayed; every OpenRouter request carries the whole history, reasoning effort and the web_search tool as set; replies in order in the record; 401/402/429/200-with-error/length-empty end as failed turns with readable text; abort on Stop; a reply carrying an entry marker stays inside its entry; reverse control (history dropped) red, output in NOTES.md
- [ ] AC4 Smoke: electron-smoke exit 0 — two OpenRouter rows added from the menu, models picked with the Free filter, relay on the fake server, history order, markup in a reply shown as text — windows hidden
- [ ] AC5 HUMAN (excluded from /run): the owner runs a real room with a free and a paid OpenRouter model

## Stack
As tasks/10-app-shell/06-room-layout/PLAN.md; OpenRouter per docs/tech/openrouter@2026-10-23.md (the API is unversioned: the dated study is the pinned reference, and DATA sources point at Wayback snapshots of the same pages dated 20261023). Node 22 fetch and http in the main process; no new dependency.

## Decisions
- D1 Non-streaming request per turn (study, Implications: Room turns).
- D2 Web search through the openrouter:web_search server tool, on by default for paid models and off for :free (each search is billed even on free models) (agent's decision; study S5).
- D3 Effort offered only from the model's reasoning.supported_efforts (study S4).
- Branch: `room`. Commit per task, never push.

## Assumptions
- The participant prompt is the same text the CLIs get (buildParticipantPrompt), sent as one user message with the room intro as the system message.
- A 429 is retried once after Retry-After (capped by the turn timeout), then the turn fails.

## Out of scope
- The chat agent (18), streaming in the Room

## Tasks
- [ ] T00 Baseline: the coordinator's last verified run before T01 — verify: the Log line exists
- [ ] T01 Room participant (S1–S5): model rules red first; OpenRouterDriver in room-drivers; row with model picker, effort, web; integration and smoke with reverse control — verify: AC2, AC3 + fast tier + electron-smoke
- [ ] T02 Ledger and notes — verify: tasks/check.py no new problem + fast tier

## Log
