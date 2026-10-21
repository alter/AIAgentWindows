---
status: running
created: 2026-10-21
---
# Room — broadcast and relay rounds over CLI and web agents

## Goal
A "Room" item at the top of the sidebar opens a shared view above all agents. The owner types a prompt, ticks participants (Claude Code, Codex, ChatGPT, Grok, DeepSeek), picks "to all" or "relay" and a number of rounds, and presses Start. "To all" sends the prompt to every participant and shows each reply in the room feed. "Relay" sends the prompt to A, then the prompt with A's reply to B, then everything so far to C, and so on, back to A, for N rounds, with no confirmation between steps. CLI participants are room-owned sessions in read-only modes; web participants are driven by per-site adapters. The history lives in `<shared>/rooms/<id>.md`. Stop ends a run at the current step. "Carry result" pastes the final reply or the history into a chosen working session without submitting it.

## Acceptance criteria
- [ ] AC1 Fast tier green: every command of docs/PROJECT.md §6 fast tier exits 0
- [ ] AC2 Relay schedule and history: `npx vitest run tests/unit/room-model.test.ts tests/unit/room-history.test.ts` exit 0 — 3 participants × 2 rounds gives A,B,C,A,B,C; each prompt carries the whole history in order; replies are written verbatim
- [ ] AC3 Room CLI sessions are read-only: `npx vitest run tests/unit/room-sessions.test.ts` exit 0 (claude gets `--permission-mode plan`, codex gets `--sandbox read-only`), and red when the flag is dropped (reverse control kept in NOTES.md)
- [ ] AC4 CLI turn driver: `npx vitest run tests/integration/cli-turn.test.ts` exit 0 — with the stub CLI writing Claude-format and Codex-format transcripts, a sent prompt is submitted, the end of the turn is detected and the reply read; a turn that never ends times out with an error, not a hang
- [ ] AC5 Web adapters on fixtures: `npx vitest run tests/unit/site-adapters.test.ts` exit 0 — for each site's fixture page: insert as literal text, submit, generating → done, last reply read; markup in the prompt stays text
- [ ] AC6 Smoke: `PLAYWRIGHT_JUNIT_OUTPUT_FILE=reports/junit-electron-smoke.xml npx playwright test --project=electron-smoke --reporter=junit` exit 0, including a relay of two stub participants for 2 rounds (order checked in the history file), a broadcast, Stop in the middle, a carried result pasted but not submitted, and markup in a reply shown as text — windows hidden
- [ ] AC7 HUMAN (excluded from /run): the owner runs a Room with Claude Code, Codex, ChatGPT, Grok and DeepSeek for 2 relay rounds and records in NOTES.md what worked

## Stack
As tasks/10-app-shell/01-app-skeleton/PLAN.md (Electron 44.6.0, node-pty 1.1.0, xterm 6.0.0, TypeScript 6.0.3, vitest 5.0.3, Playwright 1.63.0). CLIs on the owner's machine: claude 2.1.306, codex 0.163.0 (updated by the owner on 2026-10-21; docs/tech holds 0.159.2 until T01).

## Decisions
- D1 Confirmation between steps -> none (owner, 2026-10-21).
- D2 Where submitted text may go -> only room-owned CLI sessions in read-only modes and the web chats; the owner's working sessions only receive pasted, unsubmitted text through "Carry result" (owner accepted separate sessions, 2026-10-21: "допустим отдельные сессии, но надо будет финальный результат перенести").
- D3 Web chats in the loop -> yes, terms risk is the owner's (owner, 2026-10-21; EVIDENCE W12–W14).
- D4 Context passed on -> the whole room history, in order, with author labels (owner, 2026-10-21).
- D5 UI -> a "Room" item at the top of the sidebar, like #general (owner, 2026-10-21).
- Branch: `room`, created from `app-shell-skeleton` (the skeleton is not merged to main yet).

## Assumptions
- Prompt to a CLI participant: a short instruction plus the path of the history file (`<shared>/rooms/<id>.md`), which the room CLI session can read (Claude through `--add-dir <shared>`, Codex through its whole-disk read access, EVIDENCE CX8). Prompt to a web participant: the history as text when it is up to 12,000 characters, otherwise the history file attached through the page's file input (EVIDENCE F5; F6 is checked by T07 on fixtures and by the owner in AC7).
- End of a CLI turn: Claude — the first `type: assistant` record after the send time whose `message.stop_reason` is `end_turn`; Codex — the `task_complete` event after the send time. T01 confirms both on the owner's versions before T03 builds on them; if either does not hold, T01 records the real signal and T03 uses it.
- One turn has a timeout (default 10 minutes, owner-editable in the Room); a timed-out or failed participant is marked in the feed and the relay continues with the next one.
- Participants of a Room are created by the Room itself (new room CLI sessions, and the existing site agents' partitions so the owner's sign-ins are reused); the room's CLI sessions appear under the Room, not in the agent list.
- Site adapters need the real pages' structure. Tests never load the real sites (docs/PROJECT.md §5): T06 gives the owner a capture command that saves the structure of each signed-in chat page (tags, attributes, roles; text replaced) to `tests/fixtures/sites/`, and T07 builds the adapters on those fixtures.
- Every Electron/Playwright run by a worker is in test mode (AIAW_USER_DATA set, windows hidden); no worker runs `npm start`.

## Out of scope
- Auto-submitting into the owner's working sessions
- OpenAI API participants — the OpenAI API provider task
- Import of existing local sessions — its own task
- Windows and Ubuntu verification — per-OS tasks closed by the owner

## Tasks
- [x] T00 Baseline: create branch `room` from `app-shell-skeleton`; run the fast tier and the full tier once, record results in `## Log` — verify: `git branch --show-current` = `room` and the Log line exists
- [ ] T01 Study the owner's CLI versions: claude 2.1.306 `--permission-mode plan` (what it allows, that it still answers), the end-of-turn signal in its transcript; codex 0.163.0 `--sandbox read-only`, `resume`, the end-of-turn event and the rollout form (paginated, EVIDENCE CX15); write `docs/tech/codex@0.163.0.md`, extend `docs/tech/claude-code@2.1.306.md`, add EVIDENCE rows (run rows only from a session that sends no prompt, or doc rows) — verify: `python3 scripts/evidence_check.py && python3 tasks/check.py`
- [ ] T02 `src/shared/room-model.ts` (participants, mode, rounds 1..50, relay schedule with return to the first, history entries) and `src/shared/room-history.ts` (markdown render, prompt builder per participant kind with the 12,000-character rule) + `tests/unit/room-model.test.ts`, `tests/unit/room-history.test.ts` (red first) — verify: `npx vitest run tests/unit/room-model.test.ts tests/unit/room-history.test.ts` + fast tier
- [ ] T03 CLI turn driver `src/main/cli-turn.ts`: send through the pty (sanitized bracketed paste, then Enter), watch the transcript for the end-of-turn signal from T01, return the reply or a timeout error; extend the stub CLI to write Claude-format and Codex-format transcript records on submit + `tests/integration/cli-turn.test.ts` (red first) — verify: `npx vitest run tests/integration/cli-turn.test.ts` + fast tier
- [ ] T04 Room CLI sessions: `buildSpawn` variants for room participants (claude `--permission-mode plan --session-id <id> --add-dir <shared>`, codex `--sandbox read-only`), never `--dangerously-*`; `tests/unit/room-sessions.test.ts` "room sessions start read-only" (red first, reverse control in NOTES.md) — verify: `npx vitest run tests/unit/room-sessions.test.ts` + fast tier
- [ ] T05 Site adapter framework `src/main/site-adapters/`: interface (insertText, submit, isGenerating, lastReply, attachFile), run from main through `executeJavaScriptInIsolatedWorld`, text inserted through input events (never innerHTML), polling with timeout; a generic fixture page in `tests/fixtures/sites/generic.html` + `tests/unit/site-adapters.test.ts` "inserts markup as literal text" (red first) — verify: `npx vitest run tests/unit/site-adapters.test.ts` + fast tier
- [ ] T06 Capture command for the owner: `npm run capture-sites` starts the app in normal mode with the owner's profile and, for each signed-in site view, saves its chat page structure (tags, ids, classes, roles, aria and data attributes; all text replaced by placeholders; no cookies, no storage) to `tests/fixtures/sites/<site>.html`; unit test that the sanitizer leaves no original text (red first). The capture itself is the owner's step and goes to `## Log` as `[!] needs owner` if not yet done — verify: `npx vitest run tests/unit/capture-sanitize.test.ts` + fast tier
- [ ] T07 Adapters for ChatGPT, Grok, DeepSeek on the captured fixtures (or, while the owner's capture is missing, `[!] BLOCKED: needs owner's npm run capture-sites`); each adapter isolated in its own file; fixture tests per site for insert, submit, generating/done, last reply, file attach — verify: `npx vitest run tests/unit/site-adapters.test.ts` + fast tier
- [ ] T08 Room orchestrator `src/main/room.ts`: broadcast (all participants in parallel), relay (schedule from T02, one turn at a time), Stop, per-turn timeout, failure of one participant marked and skipped, history file written after every reply; integration test with two stub CLIs — verify: `npx vitest run tests/integration/room.test.ts` + fast tier
- [ ] T09 Room IPC and UI: sidebar "Room" item at the top; feed with author labels rendered with textContent; prompt box; participant checkboxes; mode; rounds; timeout; Start/Stop; progress; "Carry result" picks a working session and pastes without submitting — verify: fast tier + `npm run build` + arch_check
- [ ] T10 Smoke `tests/full/room.spec.ts`: relay of two stub participants for 2 rounds (history order), broadcast, Stop in the middle, carried result pasted not submitted, markup in a reply shown as text — verify: `PLAYWRIGHT_JUNIT_OUTPUT_FILE=reports/junit-electron-smoke.xml npx playwright test --project=electron-smoke --reporter=junit` + fast tier
- [ ] T11 Docs: AGENTS.md map rows for the room modules, docs/PROJECT.md ledger notes, EVIDENCE rows for the adapters and the turn signals; `python3 scripts/project_check.py --refresh-fingerprint` — verify: `python3 scripts/project_check.py && python3 scripts/evidence_check.py && python3 tasks/check.py`
- [ ] T12 Final: fast and full tier against the T00 baseline; `/attack` on the Room (auto-submit boundary, read-only room sessions, adapters, history file, feed) by the attacker agent; confirmed findings become fix tasks — verify: all §6 commands exit 0 and ATTACK.md exists in the task directory

## Log
- 2026-10-21 19:13 T00 done: branch room from app-shell-skeleton (ba0376b); baseline fast tier 11/11 green in 28s (FASTRUN-2026-10-21-191149909265), full tier 2/2 green in 74s (FULLRUN-2026-10-21-191223519599, smoke in test mode)
