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
