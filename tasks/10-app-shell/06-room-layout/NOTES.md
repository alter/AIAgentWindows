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

## Coordinator reverse control for T01's validation tests (2026-10-23)
The T01 unit tests were written after the code. Mutation in place (copy kept in .claude/scratch, restored): `parseRoomTitle` without the control-character check and without the 80-character bound. COMMAND `npx vitest run tests/unit/room-model.test.ts tests/unit/ipc-validate.test.ts` → exit 1, 3 failed / 60 passed:
```
× refuses a record whose title is empty, over 80 characters, has a control character or is not a string
× validates a title on its own
× room rename rejects a malformed id or title
```
Restored: room-model + ipc-validate + integration room-archive 67/67.

## 2026-10-23 T02 rooms tree

Design: the Room pane owns the list and the opened id and hands `{rows, busy}` to the sidebar through `Content.watchRooms`; `src/renderer/room-tree.ts` renders `# Rooms` (arrow button `data-room="tree-toggle"` with aria-expanded, title button `data-room="open"` that shows the pane, `+` `data-room="new"`), items are buttons `[data-room-id]` (labels by textContent, opened one `aria-current` while the pane is open, `aria-disabled` while a run is busy), right-click or F2 -> `Rename` -> in-place input (Enter saves, Escape or blur cancels). The pane heading shows the opened room's title (textContent). Pure logic `roomTreeRows`, `renameTitle` in src/shared/room-view.ts replaced `roomListOption` (its tests rewritten in tests/unit/room-tree.test.ts). The pane's select and "New room" button are gone; the sidebar `+` is New room. Unreadable rooms are listed disabled.

Red first: tests/unit/room-tree.test.ts failed 7/7 (`renameTitle is not a function`) before the logic. The smoke specs could not be shown red on the old UI: the rewritten steps need the new markup, and electron-smoke rebuilds first, which failed on the removed `roomListOption` once the shared logic was swapped.

Reverse controls on the new smoke (each run restored afterwards, `npx playwright test --project=electron-smoke tests/full/room-layout.spec.ts`):
- the pane's rename no longer calls `api.roomRename` -> `a room renamed from the tree keeps its title ...` red (`Expected "Kept name", Received "layout question"`) and `markup in a room title is shown as text` red (`Expected the markup title, Received undefined`); the collapse test stayed green.
- tree label set through `innerHTML` instead of textContent -> `markup in a room title is shown as text` red (`Expected "<img src=x onerror=...><b>bold</b>", Received "bold"`); the other two stayed green.

A clash found by the full smoke: the tree menu first reused `.context-menu/.context-item`, which broke `smoke.spec` (`.context-item` resolved to 2 elements); the tree menu now has its own classes `rooms-menu`, `rooms-menu-item`.

Smoke rewrites: tests/full/room.spec.ts (two steps) and tests/full/room-archive.spec.ts (one step) count `[data-room="tree"] [data-room-id]` and open a room by clicking its item instead of the select; coverage kept. New: tests/full/room-layout.spec.ts (rename from the tree with Escape discarded then Enter saved -> title in the record -> restart -> tree shows it and opens the room; collapse reports aria-expanded; markup in a title is shown as text, no `img`/`b` elements, no `window.__pwned`).

Checks: fast tier 12 commands exit 0 (coverage 100.00 %); `npm run -s build` then electron-smoke 41/41.
