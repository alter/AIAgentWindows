---
status: running
created: 2026-10-23
---
# Room setup collapse — participants and settings fold away on Start

## Goal
The participants table and run settings sit in one disclosure that closes by itself when a run starts, so the feed gets the screen. Owner, 2026-10-23: "давай всю нижнюю половину с настройками агентов сворачивать научимся при чем автоматически по кнопке Start, чтобы они место не занимали от экрана, все равно эти настройки уже не нужны после запуска".

## Acceptance criteria
- [ ] AC1 Fast tier green: every command of docs/PROJECT.md §6 fast tier exits 0 (incl. `python3 scripts/contrast_check.py`)
- [ ] AC2 Rule: `npx vitest run tests/unit/room-view.test.ts` exit 0 — the open rule (new room → open; saved room with entries → closed; accepted start/continue → closed; refused start → unchanged) and the digest (participant count, mode, rounds); tests seen red first
- [ ] AC3 Smoke: electron-smoke exit 0 — Start closes the setup (`open` false) while Stop stays enabled; a click on the summary opens it; a saved room with entries opens with the setup closed; reverse control (close on accepted start removed) turns `tests/full/room-layout.spec.ts::the setup closes on start and opens by click` red, output in NOTES.md — windows hidden
- [ ] AC4 HUMAN (excluded from /run): the owner starts a room and records in NOTES.md whether the feed now has the screen and the setup is easy to reopen

## Stack
As tasks/10-app-shell/06-room-layout/PLAN.md; palette tokens and the contrast gate apply. No new dependency.

## Decisions
- D1 What folds: the participants table, Add participant, Mode, Rounds, Turn timeout, Record site debug. Start/Continue and Stop leave the settings row for a row of their own outside the disclosure; prompt, status, message, Working session row stay outside (owner: "нижнюю половину с настройками агентов"; buttons must stay reachable during a run).
- D2 When: closes on an accepted start/continue; a refused start keeps it as it was so the error is next to the fields (agent's decision).
- Branch: `room`. Commit per task, never push.

## Assumptions
- Element: a native `<details class="room-setup">` with `<summary>` drawing the same disclosure arrow as `.room-entry-head` (right closed, down open); keyboard comes from the native element.
- Summary text: "Participants and settings" plus a digest, e.g. "6 participants · To all · 2 rounds", built with textContent; the digest is a pure function in room-view.
- New room (no entries, openedId null) → open; opening a saved room with at least one entry → closed; the end of a run does not reopen it.
- The open state is per pane and not stored in the room record.
- During a run the disclosure can be opened; the fields stay disabled as today.

## Out of scope
- Colours beyond existing tokens (05-design-contrast)
- Collapsing the prompt or the Working session row
- Remembering open state across restarts

## Tasks
- [x] T00 Baseline: the coordinator's last verified run of 06-room-layout (2daabcf) is this plan's baseline — verify: the Log line exists
- [ ] T01 Setup disclosure (S1–S4): pure `setupDigest(rows, mode, rounds)` and `setupOpenOnRoom(entries)` in room-view, red first in room-view.test.ts; room-pane wraps table + settings fields in `<details class="room-setup">`, Start/Stop row outside, close on accepted start, closed/open on room open, digest refreshed on every table/mode/rounds change; styles reuse the entry disclosure arrow and tokens (contrast-pairs.json if a new pair appears); smoke `the setup closes on start and opens by click` + saved room opens closed in tests/full/room-layout.spec.ts; existing specs that click table/settings controls after a start open the setup first; reverse control in NOTES.md — verify: AC2 command + fast tier + electron-smoke
- [ ] T02 Ledger and notes: docs/PROJECT.md Room row (setup folds on start); NOTES.md summary; labels `status:review` when AC1–AC3 are [x] — verify: `python3 tasks/check.py` shows no new problem (baseline 7) + fast tier

## Log
- 2026-10-23 coordinator: T00 baseline = 06-room-layout T03b verification run on 2daabcf (fast tier 12 commands exit 0, coverage 943/943 100 %, electron-smoke 45/45); tasks/check.py baseline 7 problems
