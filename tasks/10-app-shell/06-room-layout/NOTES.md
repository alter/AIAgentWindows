# NOTES

## 2026-10-23 T01 reverse control (AC2)

Change: the `title` spread removed from `RunState.recordOf` in src/main/room.ts (the title dropped from the record write of the running room). Restored afterwards.
Command: `npx vitest run tests/integration/room-archive.test.ts` -> exit 1, output:

```
 RUN  v5.0.3 /Users/user/workflow/git/AIAgentWindows
 ❯ |integration| tests/integration/room-archive.test.ts (4 tests | 2 failed) 343ms
   ❯ room rename in the service (4)
     × a rename during a run survives the next entry 112ms
     × a continued room keeps its title 112ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |integration| tests/integration/room-archive.test.ts > room rename in the service > a rename during a run survives the next entry
AssertionError: expected undefined to be 'Renamed mid-run' // Object.is equality
- Expected:
"Renamed mid-run"
+ Received:
undefined
 ❯ tests/integration/room-archive.test.ts:79:27
     77|     await finished(seen);
     78|     const record = await readRecord(roomsDir(), id);
     79|     expect(record?.title).toBe('Renamed mid-run');
       |                           ^
     80|     expect(record?.status).toBe('done');
     81|     expect(record?.entries.length).toBeGreaterThanOrEqual(4);
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯
 FAIL  |integration| tests/integration/room-archive.test.ts > room rename in the service > a continued room keeps its title
AssertionError: expected undefined to be 'Kept' // Object.is equality
- Expected:
"Kept"
+ Received:
undefined
 ❯ tests/integration/room-archive.test.ts:111:55
    109|     await vi.waitFor(async () => expect((await readRecord(roomsDir(), …
    110|     await vi.waitFor(async () => expect((await readRecord(roomsDir(), …
    111|     expect((await readRecord(roomsDir(), id))?.title).toBe('Kept');
       |                                                       ^
    112|   });
    113|
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯
 Test Files  1 failed (1)
      Tests  2 failed | 2 passed (4)
   Start at  07:47:30
   Duration  480ms (tests 84%, transform 13%, import 3%)
```

With the change restored: 4 passed.

Out-of-list edits (small, needed by T01): src/main/room.ts and src/main/room-archive.ts (the record write and the list item live there, not in room-service), tests/unit/room-archive.test.ts (one `toEqual` gained `title`). tests/integration/room-archive.test.ts is new.
