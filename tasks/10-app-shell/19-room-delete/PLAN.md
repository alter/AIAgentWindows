---
status: paused
created: 2026-10-23
---
# Room delete — from the tree, to the Trash

## Goal
Owner, 2026-10-23: "А еще нет функционала удаления комнат, хотя часть из них могут быть уже не нужными".

## Acceptance criteria
- [x] AC1 Fast tier green: every command of docs/PROJECT.md §6 fast tier exits 0
- [x] AC2 Rules: ipc-validate `room delete rejects a malformed id`; integration in room-archive.test.ts — the three paths go to the trash function, a running room is refused, a missing file is fine; seen red first; reverse control (running check dropped) red, output in NOTES.md
- [x] AC3 Smoke: electron-smoke exit 0 — Delete from the context menu and by the Delete key, confirm, files gone, tree updated, the open room replaced; Cancel and Escape keep it — windows hidden
- [ ] AC4 HUMAN (excluded from /run): the owner deletes a room and finds it in the Trash

## Stack
As tasks/10-app-shell/06-room-layout/PLAN.md. Electron shell.trashItem (docs/tech/electron@44.6.0.md; the task's T01 adds the item with its URL if missing). No new dependency.

## Decisions
- D1 Files go to the system Trash, not unlinked: recoverable (agent's decision).
- D2 Confirmation inside the sidebar like the agent close confirm; no browser dialogs (agent's decision; the viewer rule of the app).
- D3 Test mode replaces trashItem with a move into a test folder, so tests never touch the real Trash.
- Branch: `room`. Commit per task, never push.

## Assumptions
- After deleting the open room the pane opens the next room in the list, else a new room.
- T01: when the deleted room was the last readable one in the list, the pane opens the previous readable room before falling back to a new room.
- T01: delete is refused while any run is in progress (stricter than the running room only; the tree is disabled then and Room exposes no running id inside the write set).
- T01: test mode for the trash function is any run with AIAW_USER_DATA set; it moves into <userData>/trash, so no test touches the real Trash.

## Out of scope
- Bulk delete, emptying the Trash

## Tasks
- [x] T00 Baseline: the coordinator's last verified run before T01 — verify: the Log line exists
- [x] T01 Delete (S1–S3) — verify: AC2 + fast tier + electron-smoke
- [x] T02 Ledger and notes: docs/PROJECT.md Room row (delete; the "deleting a saved room — absent" note goes); NOTES.md; labels status:review — verify: tasks/check.py no new problem + fast tier

## Log
- 2026-10-23 coordinator: T00 baseline = verification run on ba7a2f9 (14-agent-identity): fast tier 12 commands exit 0, contrast_check 0 findings, vitest 1000/1000, coverage 100.00 %, electron-smoke 57/57; tasks/check.py baseline 7 problems
- 2026-10-23 T01 done: room:delete (isRoomId) -> RoomService.delete trashes <id>.md, debug/sites/<id>, <id>.json (shell.trashItem; test mode moves to <userData>/trash), tree menu Delete + Delete/Backspace + in-sidebar confirm, open room replaced; vitest 1008/1008, coverage 100.00 %, electron-smoke 59/59 (one earlier launch timeout, see NOTES.md), reverse control red/green in NOTES.md
- 2026-10-23 coordinator: T01 verified (diff reviewed; fast tier 12 exit 0, vitest 1008/1008, coverage 100.00 %, electron-smoke 59/59 in one run) — this run
- 2026-10-23 T02 done: Room ledger row extended (delete to the Trash), NOTES summary, labels status:review; tasks/check.py 7 problems (baseline); paused on AC4 HUMAN
