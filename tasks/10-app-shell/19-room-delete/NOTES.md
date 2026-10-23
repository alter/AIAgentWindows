# NOTES 19-room-delete

## T01 red first (before src changes)

Command: `npx vitest run tests/unit/ipc-validate.test.ts tests/unit/room-tree.test.ts tests/integration/room-archive.test.ts`

Result: `Tests 8 failed | 43 passed (51)`, `Test Files 3 failed (3)`; failing: ipc-validate `room delete rejects a malformed id`, room-tree `nextRoomAfterDelete`, and six `room delete in the service` tests (`room.delete` did not exist).

## T01 reverse control

Change (scratch, restored afterwards): in `src/main/room-service.ts` `delete`, the running check dropped: `if (!isRoomId(id) || this.room.isRunning()) return false;` became `if (!isRoomId(id)) return false;`.

Command: `npx vitest run tests/integration/room-archive.test.ts`

Red output:

```
FAIL  |integration| tests/integration/room-archive.test.ts > room delete in the service > a running room cannot be deleted
AssertionError: expected true to be false // Object.is equality
Tests  1 failed | 15 passed (16)
```

Restored: same command, `Tests  16 passed (16)`.

## T01 observations

- Smoke run 1 of the whole suite: 58 passed, 1 failed (`design-contrast.spec.ts:43`, 60 s timeout at launch, run took 7.8 min on a loaded machine); the same spec alone passed in 6.7 s and the whole suite passed again 59/59 in 3.7 min with `--trace=retain-on-failure`. The first launch of `room-delete.spec.ts` alone also hit one 60 s timeout once and then passed in 21 s. Both look like a slow cold Electron launch, not the delete code.
- One `python3 scripts/coverage_gate.py --run` of the fast tier had `1 failed | 1007 passed` plus one error under load (output not kept); the next run was 1008/1008, coverage 100.00 %.

## 2026-10-23 Summary

- Delete from the Rooms tree: context menu "Delete" and Delete/Backspace on an item; confirmation inside the sidebar (focus on Cancel, Escape cancels); `room:delete` (isRoomId) → RoomService.delete → `trashRoom` moves `debug/sites/<id>`, `<id>.md`, `<id>.json` to the Trash (shell.trashItem; a missing file is skipped; paths resolved inside their directories). Test mode (AIAW_USER_DATA set) moves them into `<userData>/trash`.
- Refused while any run is in progress (a superset of "the running room": room.ts was outside the write set). Unreadable records cannot be deleted from the tree yet.
- Deleting the open room opens the next readable room, else the previous one, else a new room.
- Checks (coordinator, this run): fast tier 12 commands exit 0, vitest 1008/1008, coverage 100.00 %, electron-smoke 59/59.
- The worker saw two launch timeouts (60 s) under machine load in its runs and one unidentified vitest failure; the coordinator's single run was clean. Not diagnosed; watch for repeats.
- Open: AC4 HUMAN — the owner deletes a room and finds it in the Trash.
