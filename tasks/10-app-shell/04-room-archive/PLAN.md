---
status: running
created: 2026-10-23
---
# Room archive — saved rooms the owner can reopen and continue

## Goal
A room survives the application. Every room is a JSON record next to its markdown history in `<shared>/rooms/`, written after every entry and status change. The Room pane lists the saved rooms; opening one shows its feed, participants and settings and enables "Carry result"; a new prompt in an opened room continues it with the same id, the same history file and the whole earlier history in the participants' context. A run cut by quitting the app is kept as stopped; nothing is relaunched. Owner's request and decisions of 2026-10-22 (task.txt).

## Acceptance criteria
- [ ] AC1 Fast tier green: every command of docs/PROJECT.md §6 fast tier exits 0
- [x] AC2 Record round trip: `npx vitest run tests/unit/room-archive.test.ts` exit 0 — a record written after each entry parses back into the same entries; a record with status running loads as stopped; an unreadable file is listed as unreadable and left byte-identical; an id with a path separator or outside `[A-Za-z0-9_-]{1,64}` is refused
- [x] AC3 Reverse control: skipping the running→stopped rewrite makes `tests/unit/room-archive.test.ts::a running record is loaded as stopped` red (red output kept in NOTES.md)
- [x] AC4 Restored entries are rendered and prompted like live ones: `tests/unit/room-history.test.ts::restored entries render like live entries` and the room-view snapshot rebuild tests exit 0
- [ ] AC5 Smoke: electron-smoke exit 0, including run → app restart with the same AIAW_USER_DATA → room reopened from the list with its entries → continuation run whose entries land after the old ones in the same `<shared>/rooms/<id>.md` and `<id>.json`, Carry result enabled on the reopened room — windows hidden
- [!] AC6 HUMAN (excluded from /run): the owner runs a Room, quits the app mid-run, starts it, finds the room as stopped with its replies, continues it with a new prompt and records the result in NOTES.md

## Stack
As tasks/10-app-shell/02-room/PLAN.md (Electron 44.6.0, TypeScript 6.0.3, vitest 5.0.3, Playwright 1.63.0). No new dependency.

## Decisions
- D1 Returning to a room -> open and continue: feed, participants and settings restored, Carry result, a new run in the same room with the whole earlier history (owner, 2026-10-22).
- D2 A run interrupted by quitting the app -> saved as stopped, continued by hand, nothing relaunched (owner, 2026-10-22).
- D3 Model and effort per participant -> not here: 10-app-shell/03-room-participants follows this task and extends the record's participant shape.
- Branch: `room` (02-room is not merged; this work builds on its code). Commit per task, never push.

## Assumptions
- T03: `snapshotFromRecord(record, historyPath)` takes the history path as an argument (shared code has no `path`); it replays the record as a synthetic event stream through `applyRoomEvent` (started with the earlier runs as `previous`, entry and progress events for the last run, finished), so chips, round, completed/total and banner match the live snapshot; a record still marked running is shown as stopped; a turn aborted before its entry was written cannot be recovered, so its chip is waiting, not stopped. `OWNER_ID` and `ROOM_ID` moved from room.ts to room-model.ts.
- The record is `<shared>/rooms/<id>.json`: `{ version: 1, id, createdAt, updatedAt, status: 'running'|'done'|'stopped'|'failed', config: RoomConfig without the prompt, entries: RoomEntry[], nonce }`; the parser lives in `src/shared/room-model.ts` (shared code is the coverage target), the file I/O in `src/main/room-archive.ts`. Writes are atomic (write to a temp file in the same directory, rename), serialized through the same queue as the history file.
- The markdown history stays the participants' and the owner's document; the JSON record is the app's. On continuation the existing nonce is reused (from the record, else `historyNonce` of the .md), so entry markers of both runs carry one nonce.
- A continued run may change participants, mode, rounds and finalizer (the form is prefilled from the record); the record's `config` is the last run's. CLI participants start fresh sessions; the prompt carries the whole history, as in any later round.
- The list shows id, last update time, status and the first line of the first prompt (up to 120 chars), newest first; at most 200 records are listed.
- App start: every record with status running is rewritten as stopped before the Room is used; the most recent record is loaded into the Room snapshot; with no records the Room opens empty.
- A record over 50 MB or failing to parse is listed as unreadable, never opened, never rewritten.
- `RoomEvent` 'started' carries `previous` (the earlier entries) only for a continuation; no record is written at the started event itself because the owner prompt entry is appended in the same tick and writes the record with status running. A continued run's rounds restart at 1; `feedSections` groups by owner prompt (keys `run2-prompt`, `run2-round-1`, `run2-final`, the first run keeps `prompt`, `round-N`, `final`) and the finished banner reads only the entries after the last prompt (T02).

## Out of scope
- Deleting or renaming rooms
- Resuming room CLI sessions across app starts
- Relaunching the remaining turns of an interrupted run
- Model and effort per participant (03-room-participants)

## Tasks
- [x] T00 Baseline on branch `room`: run the fast tier and electron-smoke once, record results in `## Log` — verify: the Log line exists with both results
- [x] T01 Room record: `RoomRecord` type and `parseRoomRecord` (strict, bounded: id pattern, entries array of valid RoomEntry, status enum, config through the existing participant validation) and `isRoomId` in `src/shared/room-model.ts`; `src/main/room-archive.ts` with `recordPath(roomsDir, id)` (refuses ids that fail `isRoomId` and any path outside roomsDir), `writeRecord` (atomic), `readRecord`, `listRecords` (summaries newest first, unreadable files as `{ id, unreadable: true }`, files left untouched), `stopInterrupted` (running → stopped, updatedAt kept); tests red first in `tests/unit/room-archive.test.ts` incl. reverse control of AC3 kept in NOTES.md — verify: `npx vitest run tests/unit/room-archive.test.ts tests/unit/room-model.test.ts` + fast tier
- [x] T02 Run writes the record and can continue: `RunState` writes the record (through `writeRecord`, same queue as the .md) after the started event, after every entry and at finish with the final status; `Room.start(config, from?)` where `from = { roomId, entries, nonce, createdAt }` reuses the id, history path and nonce, seeds `run.entries` with the old entries (prompts to participants see them), appends the new owner prompt and turns to the existing .md without rewriting it; `RoomEvent` 'started' carries the previous entries so the view keeps them; integration tests red first in `tests/integration/room.test.ts` (record after each entry; continuation appends after old entries in .md and .json, nonce unchanged; a continued participant's prompt contains an old reply) — verify: `npx vitest run tests/integration/room.test.ts tests/unit/room-history.test.ts` + fast tier
- [x] T03 Snapshot from a record: `snapshotFromRecord(record)` in `src/shared/room-view.ts` (phase = record status, entries, chips per participant from the last entries, plan from config, roomId, historyPath) and `formFromRecord` for the prefilled settings; `tests/unit/room-view.test.ts` red first; `tests/unit/room-history.test.ts::restored entries render like live entries` (a record parsed from JSON renders byte-identical to the live entries) — verify: `npx vitest run tests/unit/room-view.test.ts tests/unit/room-history.test.ts` + fast tier
- [ ] T04 Service, IPC, preload: `RoomService` gains `list()`, `open(id)` (refused while a run is in progress; loads the record into the snapshot), `start(config, continueId?)` (continueId must equal the opened room; reads the record and passes `from` to `Room.start`) and `init()` called from `src/main/index.ts` before the window loads (`stopInterrupted`, then open the most recent record); IPC channels `room:list`, `room:open` with argument validation in `src/shared/ipc.ts` (id through `isRoomId`), `roomStart` accepts `{ config, continueId? }`; preload exposes `roomList`, `roomOpen`; tests red first in the existing IPC validation and room-service tests — verify: `npx vitest run tests/unit tests/integration` + fast tier
- [ ] T05 Room pane: a "Rooms" list above the feed (newest first; label = time · status · first prompt line, unreadable rooms shown disabled), "New room" button that clears the snapshot, opening a room loads its feed and prefills participants, mode, rounds, timeout, finalizer; Start in an opened room sends `continueId`, the prompt box is empty for the new prompt; the list refreshes on 'finished' events; all text through `textContent` — verify: `npx vitest run tests/unit` + electron-smoke + fast tier
- [ ] T06 Smoke for AC5 in `tests/full/room.spec.ts` (or a new `tests/full/room-archive.spec.ts`): two stub participants relay 1 round, close the app, relaunch with the same AIAW_USER_DATA, the room is in the list and its entries are shown, Carry result enabled, continue with a new prompt, assert order of entries in the .md and .json files; plus a run stopped by closing the app mid-turn reopens as stopped — verify: electron-smoke + fast tier
- [ ] T07 Ledger and docs: `docs/PROJECT.md` Room row says what is built (record, list, reopen, continue, interrupted = stopped); NOTES.md section for this task; task labels `status:review` once AC1-AC5 are [x] — verify: `python3 tasks/check.py` shows no new problem for 04-room-archive + fast tier

## Log
- 2026-10-23 02:03 T00 done: branch room at dea6d3e; fast tier 11 commands exit 0 (coverage 760/760, 100 %), electron-smoke 27/27 in 92 s; load average 1.8 before, 4.3 after
- 2026-10-23 02:10 T01 done: RoomRecord, parseRoomRecord, isRoomId in room-model.ts; src/main/room-archive.ts (recordPath, writeRecord atomic, readRecord, listRecords, stopInterrupted); 29 tests in room-archive.test.ts red first (module missing), reverse control red kept in NOTES.md; fast tier 11 commands exit 0, coverage 100 %
- 2026-10-23 coordinator: T01 verified (vitest room-archive+room-model 54/54, coverage gate 789/789 100 %, tsc and eslint exit 0 — this run)
- 2026-10-23 coordinator: AC2 and AC3 met by T01 (room-archive tests for round trip, running→stopped, unreadable untouched, id refusal pass; reverse control red in NOTES.md 'T01 reverse control')
- 2026-10-23 02:47 T02 done: RunState writes the record (same queue as the .md; final status before 'finished' is emitted) and Room.start(config, from?) continues with the same id, history file, nonce, old entries seeded (history budget counted, .md rewritten whole if missing); 'started' carries previous; feedSections groups per owner prompt, banner reads the current run; 12 integration tests + 4 unit tests red first (started-previous reverse-checked red); fast tier 11 commands exit 0, coverage 100 %
- 2026-10-23 coordinator: T02 verified (vitest integration/room+room-history+room-view 198/198, fast tier 11 commands exit 0 with coverage 825/825 100 %, electron-smoke 29/29 — this run)
- 2026-10-23 03:00 T03 done: snapshotFromRecord (event replay, equals live snapshot incl. continued room, fallback final, stopped, broadcast) and formFromRecord in room-view.ts; 11 view tests + restored-entries test; red evidence in NOTES.md 'T03 reverse control'; fast tier 11 commands exit 0, coverage 100 %
- 2026-10-23 coordinator: T03 verified (vitest room-view+room-history 128/128, fast tier 11 commands exit 0 with coverage 837/837 100 %, electron-smoke 29/29; reverse control of the restored-entries test red, NOTES.md — this run); AC4 met
