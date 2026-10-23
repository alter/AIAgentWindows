---
status: todo
created: 2026-10-23
---
# Room delete — from the tree, to the Trash

## Goal
Owner, 2026-10-23: "А еще нет функционала удаления комнат, хотя часть из них могут быть уже не нужными".

## Acceptance criteria
- [ ] AC1 Fast tier green: every command of docs/PROJECT.md §6 fast tier exits 0
- [ ] AC2 Rules: ipc-validate `room delete rejects a malformed id`; integration in room-archive.test.ts — the three paths go to the trash function, a running room is refused, a missing file is fine; seen red first; reverse control (running check dropped) red, output in NOTES.md
- [ ] AC3 Smoke: electron-smoke exit 0 — Delete from the context menu and by the Delete key, confirm, files gone, tree updated, the open room replaced; Cancel and Escape keep it — windows hidden
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

## Out of scope
- Bulk delete, emptying the Trash

## Tasks
- [ ] T00 Baseline: the coordinator's last verified run before T01 — verify: the Log line exists
- [ ] T01 Delete (S1–S3) — verify: AC2 + fast tier + electron-smoke
- [ ] T02 Ledger and notes: docs/PROJECT.md Room row (delete; the "deleting a saved room — absent" note goes); NOTES.md; labels status:review — verify: tasks/check.py no new problem + fast tier

## Log
