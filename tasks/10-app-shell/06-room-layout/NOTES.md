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

Write set gained src/renderer/content.ts (T02): Content is the only owner of the RoomPane, so the tree callbacks (watchRooms, roomOpen, roomNew, roomRename) pass through it.

## 2026-10-23 T03 participants table

Design: `src/renderer/room-table.ts` (`RoomTable`) is one real `<table>` (`data-room="participants"`, `aria-label`): `<th scope="col">` for #, Agent, Model, Effort, Final and a visually hidden Actions; the Agent cell is `<th scope="row">`. A CLI row has the model input (datalist from `room:models`) and the effort select (codex levels per chosen model); a site row shows "—" with a visually hidden "not applicable". Final is a radio group (`name="room-final"`). Actions are three buttons (up, down, remove) named by the instance label ("Move Claude Code · opus · high up"), refreshed on every model or effort edit; up is disabled on the first row, down on the last. The "Add participant" button (`aria-haspopup="menu"`, `aria-expanded`) opens a `role="menu"` of the five kinds: ArrowDown/Up/Home/End move, Enter/Space activate, Escape closes and returns focus to the button, leaving the widget closes it; a site already in the table or without an adapter is `aria-disabled` with its reason as visible text.

Shared logic (src/shared/room-view.ts): `moveRow`, `focusAfterRemove`, `addMenuOptions`, `rowLabel`; `addRow` now appends a site row once (refused when present or without an adapter); `formFromRecord` returns a row for every participant in relay order; `formToConfig` keeps a site row at its place in the order (a site in `checked` and not in `rows` is still appended, as before). A removed final writer's row falls back through the existing `resolveFinalizer` default rule.

Red first: the new `participant row logic` tests in tests/unit/room-view.test.ts failed before the logic, `Tests  9 failed | 77 passed (86)` (`moveRow`, `addMenuOptions`, `focusAfterRemove`, `rowLabel` not functions; a site row not at its place in the order; `addRow` of a site unchanged); after: 86/86.

Reverse controls on the smoke (each run restored afterwards, `npx playwright test --project=electron-smoke tests/full/room-layout.spec.ts -g ...`):
- Start sends the rows sorted by id instead of the table order -> `three participant rows reordered with the buttons are relayed in the table order` red (`Expected ["Codex","Claude Code · sonnet","Claude Code"]`, received sonnet first).
- After a removal the focus always goes to Add participant -> `a table is read as a table ...` red (`Expected "chatgpt:remove", Received ":"`).

Smoke: new tests in tests/full/room-layout.spec.ts (three rows reordered with the buttons and from the keyboard, relay, the authors in `<shared>/rooms/<id>.md` equal the table order; the Add menu from the keyboard and a present site disabled with its reason; table headers, button names, focus after move and removal). Existing specs rewritten onto the table through tests/full/room-table-helpers.ts (`setParticipants`, `addParticipant`, `removeParticipant`, `rowIds`): room, room-participants, room-archive, room-hidden-views, room-site-debug, design-contrast; the finalizer test now drives the radios (default Claude Code, fall-back after removing the final writer's row, move up after re-adding). `button[aria-haspopup="menu"]` in seven specs became `.add-button` (the pane now has a second such button).

Decisions: the table starts with the Claude Code and Codex rows (the old checkboxes started unticked); every row takes part, there is no ticked state; a row has no checkbox. When a moved row reaches an end its pressed arrow is disabled, so the focus goes to the other arrow of the same row. After Add the focus returns to the Add participant button.

Checks: fast tier 12 commands exit 0 (coverage 100.00 %, 943 tests); `npm run -s build` then electron-smoke 44/44.

## 2026-10-23 T03b native controls on the palette

Design (src/renderer/styles.css): radios and checkboxes are `appearance: none`, 24x24, border 2px `--border`, background `--input-bg`; checked is drawn by `::before` in `--text` — an inner dot in the radio, a check mark (rotated L) in the checkbox — so the checked state differs by shape, not by colour; disabled is a dashed border like the other controls; `:focus-visible` uses the global `--focus` ring. `::placeholder` is `color: var(--text)`, `opacity: 1`, italic. Manifest: added `--text` on `--input-bg` (non-text) and `--input-bg` on `--text` (non-text, the dot is drawn with `--text` as a background, which the gate wants covered); `--border` and `--focus` on `--input-bg` already existed.

Smoke: `a final radio and the debug checkbox toggle by click and by Space` in tests/full/room-layout.spec.ts (outcome: checked/not checked of the Final radios and of `debug-sites`).

Reverse control (scratch edit, restored afterwards): `pointer-events: none` on the control rule, `npm run -s build`, `npx playwright test --project=electron-smoke tests/full/room-layout.spec.ts -g "toggle by click" --timeout 15000` -> red:
```
✘  1 [electron-smoke] › tests/full/room-layout.spec.ts:268:5 › a final radio and the debug checkbox toggle by click and by Space (15.0s)
    Test timeout of 15000ms exceeded.
  1 failed
```
Green without it: `1 passed`.
