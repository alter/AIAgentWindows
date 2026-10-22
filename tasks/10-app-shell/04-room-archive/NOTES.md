# NOTES 04-room-archive

## T01 reverse control (AC3)
Command: the `writeRecord(roomsDir, { ...record, status: 'stopped' })` line of `stopInterrupted` in `src/main/room-archive.ts` replaced by `void 0;`, then `npx vitest run tests/unit/room-archive.test.ts`. Restored afterwards; the suite is green again (29 passed).

```
 ❯ stopInterrupted (3)
   × a running record is loaded as stopped 6ms
 FAIL  |unit| tests/unit/room-archive.test.ts > stopInterrupted > a running record is loaded as stopped
AssertionError: expected 'running' to be 'stopped' // Object.is equality
Expected: "stopped"
Received: "running"
 Tests  1 failed | 28 passed (29)
```

## T02 write set
`tests/integration/room.test.ts` added to WRITE-SET: the plan names it for the Room.start record and continuation tests, and the Room rig lives there.

## T03 reverse control
Tests written after the code, so red was shown by breaking the code in place and restoring (diff clean afterwards): dropping the running-to-stopped mapping of `snapshotFromRecord` and the fallback-final `total` count turned red `equals the live snapshot after a timeout, a failed finalizer and a fallback final`, `a stopped record keeps its replies and says Stopped`, `a record still marked running is shown as stopped, never as running` (tests/unit/room-view.test.ts: 3 failed, 125 passed). `restored entries render like live entries` guards existing renderHistory and buildParticipantPrompt against a record round trip; it was green at first run because the product code already fenced entries (it is a regression guard, not a new behaviour test).

## T03 — reverse control of `restored entries render like live entries` (2026-10-23, coordinator)

The worker's test was green on its first run. Mutation in `parseEntry` of `src/shared/room-model.ts`: `text` → `text.trim()`; `npx vitest run tests/unit/room-history.test.ts -t "restored entries"`: 1 failed, `AssertionError: expected '# Room r1 ...' to be '# Room r1 ...' // Object.is equality`. File restored from a copy, `git status` clean.


## T04 write set
src/main/index.ts (await roomService.init() before the window loads), tests/integration/room-wiring.test.ts (RoomService tests) and tests/unit/ipc-validate.test.ts (channel validation) added to WRITE-SET: the task line names init from index.ts and the service and IPC tests, which live in these files.
