---
status: paused
created: 2026-10-23
---
# OpenRouter chat — retry, no stale error, no empty notice

## Goal
Owner, 2026-10-23 (screenshot 23:04): "внизу желтая строка без текста осталась", "Красная строка с ошибкой висит, хотя я уже выбрал другую модель и еще не отправлял промпт", "мой предыдущий промпт не был обработан ... может быть добавить кнопочку-иконку retry, чтобы запрос по новой переотправлялся?"

## Acceptance criteria
- [x] AC1 Fast tier green: every command of docs/PROJECT.md §6 fast tier exits 0
- [x] AC2 Rules: `npx vitest run tests/unit/openrouter-chat.test.ts tests/unit/openrouter-room.test.ts tests/unit/ipc-validate.test.ts` exit 0 — dismiss rule, retry target rule, 429 text by source (provider vs account cap, reset time), retry IPC validation `openrouter chat retry rejects a malformed request`; seen red first
- [x] AC3 Integration: `npx vitest run tests/integration/openrouter-chat.test.ts` exit 0 — retry sends the stored conversation once with the new model; a settings change removes the trailing failed reply from the file; reverse control (retry appends the message again) red, output in NOTES.md
- [x] AC4 Smoke: electron-smoke exit 0 — tests/full/openrouter-chat-retry.spec.ts `a failed reply is retried with the new model and the error text is shown as text`: 429 from a provider model, model change removes the failed reply, the empty notice has no box (hidden or zero height), Retry, the reply appears — windows hidden
- [ ] AC5 HUMAN (excluded from /run): the owner hits a rate limit, switches the model and retries

## Stack
As tasks/10-app-shell/18-openrouter-chat/PLAN.md. No new dependency.

## Decisions
- D1 A failed reply is not part of the conversation's future: it is removed on a settings change and on Retry, so it is never sent to a model (agent's decision; a failed reply carries no model text).
- D2 Retry resends the existing owner message, never a copy; it applies to the last owner message without a successful reply only (agent's decision).
- D3 Retry is an icon button with the accessible name "Retry" on that owner message (owner: "кнопочку-иконку retry").
- D4 The 429 text names the source of the limit from error.metadata (provider_name / provider_code → the model's provider; otherwise the account's free cap, with X-RateLimit-Reset when present) — docs/tech/openrouter@2026-10-23.md, Errors.
- Branch: `room`. Commit per task, never push.

## Assumptions
- The empty notice is hidden with the `hidden` attribute whenever its text is empty (root cause: `.or-notice` keeps padding, border and --warn-bg when empty, styles.css:239, :597 only resets min-height).

## Out of scope
- Retry in the Room feed (Resume exists), editing a sent message

## Tasks
- [x] T00 Baseline: the coordinator's last verified run before T01 — verify: the Log line exists
- [x] T01 Retry and cleanup (S1–S4): rules red first; chats.ts retry/dismiss; IPC; pane Retry icon and notice hiding; shared 429 text; smoke with reverse control — verify: AC2, AC3 + fast tier + electron-smoke
- [x] T02 Ledger and notes: docs/PROJECT.md OpenRouter row; NOTES.md; labels status:review — verify: tasks/check.py no new problem + fast tier

## Log
- 2026-10-23 coordinator: T00 baseline = verification run on 6d71aa3 (18-openrouter-chat): fast tier 12 commands exit 0, vitest 1162/1162, coverage 100.00 %, electron-smoke 67/67; tasks/check.py baseline 7 problems
- 2026-10-23 T01 done: S1 hidden empty notice (setNotice, pane and sidebar), S2 dismiss on settings change, S3 Retry icon + openrouter:chat-retry IPC, S4 shared rateLimitText (chat and Room); fast tier 12/12 exit 0, vitest 1185/1185, coverage 100.00 %, electron-smoke 68/68, reverse control red (4 failed) and restored, tasks/check.py 7 problems; evidence in NOTES.md
- 2026-10-23 coordinator: T01 verified (diff reviewed: send and retry share one guarded path, dismiss takes the per-agent lock; fast tier 12 exit 0, vitest 1185/1185, coverage 100.00 %, electron-smoke 68/68) — this run
- 2026-10-23 T02 done: OpenRouter ledger row, NOTES summary, labels status:review; tasks/check.py 7 (baseline); paused on AC5 HUMAN
