---
status: running
created: 2026-10-23
---
# Room layout — saved rooms as a tree under # Rooms, rename, participants as a table

## Goal
Saved rooms appear in the sidebar under "# Rooms" like Slack channels and open with one click; a room is named from its first prompt and can be renamed; participants are a table in relay order with a button to add a row. Owner, 2026-10-23: "Saved rooms ... я бы их как в слаке саб-комнаты показывал ... # Rooms и под ним как дерево у нас другие вложеные комнаты кликабельные"; "почему нельзя таблчкой показать, в табличку кнопочкой добавлять".

## Acceptance criteria
- [ ] AC1 Fast tier green: every command of docs/PROJECT.md §6 fast tier exits 0
- [x] AC2 Title and rename: `npx vitest run tests/unit/room-model.test.ts tests/unit/ipc-validate.test.ts tests/integration/room-archive.test.ts` exit 0 — a record without title parses and derives one from the first prompt; a title with a control character or over 80 chars is refused; rename during a run survives the next entry write; an unreadable record is refused and its file unchanged; reverse control: the title dropped from the record write turns `a rename during a run survives the next entry` red (output in NOTES.md)
- [x] AC3 Rows: `npx vitest run tests/unit/room-view.test.ts` exit 0 — move up, move down, remove keep ids unique, keep the final writer or fall back by the default rule, refuse moves past the ends; a site already present or without an adapter is not offered
- [x] AC4 Smoke: electron-smoke exit 0 — three participant rows reordered in the table, relay started, authors in <shared>/rooms/<id>.md in the table's order; a room renamed from the tree keeps its title in the record after an app restart and opens from the tree; markup in a title shows as text — windows hidden
- [ ] AC5 HUMAN (excluded from /run): the owner opens rooms from the tree, renames one, builds Fable / Opus high / Sonnet medium in the table and records in NOTES.md whether it reads as a table and works from the keyboard

## Stack
As tasks/10-app-shell/05-design-contrast/PLAN.md; palette tokens and the contrast gate from 05 apply to every new rule. No new dependency.

## Decisions
- D1 Rooms -> a tree under "# Rooms" in the sidebar, clickable, like Slack channels; the select in the pane goes (owner, 2026-10-23).
- D2 Names -> from the first prompt, renamed through the context menu (owner, 2026-10-23).
- D3 Participants -> one table for CLI and site participants, row order is relay order, ↑ ↓ buttons, final writer as a radio column, one "Add participant" menu (owner, 2026-10-23).
- Branch: `room`. Commit per task, never push.

## Assumptions
- The Room pane owns the room list and the opened id; it hands the list to the sidebar through a callback, the sidebar renders the tree and calls back on open, new and rename. One owner, no second fetch.
- Derived title: the first prompt's first line, whitespace collapsed, cut at 60 characters with "…"; a room with no prompt yet is "New room". A stored title wins.
- Rename goes through room-service: the in-memory record of a running room gets the title and the next atomic write carries it; a room not running is read, given the title and written atomically; unreadable records are refused and not touched.
- The tree lists every saved room, newest first, and scrolls inside the sidebar; the "# Rooms" header collapses it; the collapsed state is per app run.
- The old top "Room" item of the sidebar becomes the "# Rooms" header; "+" on it is New room.
- Site rows have "—" in Model and Effort; a site already in the table, or without an adapter, is disabled in the Add menu with its reason as text.
- Focus after ↑/↓ stays on the same button of the moved row; after ✕ it goes to the next row's ✕, else the previous, else "Add participant".
- UI language stays English, as the rest of the app.
- The table starts with the Claude Code and Codex rows and has no ticked state: every row is a participant. When a moved row reaches an end its pressed arrow is disabled, so the focus goes to the other arrow of the same row; after Add the focus returns to the Add participant button.

## Out of scope
- Colours and arrows (05-design-contrast)
- Deleting saved rooms
- Drag-and-drop reordering

## Tasks
- [x] T00 Baseline: the coordinator's last verified run of 05-design-contrast is this plan's baseline — verify: the Log line exists
- [x] T01 Title and rename (S1, S2): `title?` on RoomRecord with parse rules, `roomTitle(record)`, RoomService `rename(id, title)`, validated IPC `room:rename` through ipc/preload/handlers; tests red first in room-model, ipc-validate, integration room-archive — verify: AC2 command + fast tier
- [x] T02 Rooms tree (S3, S5): `src/renderer/room-tree.ts` rendered inside the sidebar from the pane's list; header with arrow and "+", items by title (textContent), selected/aria-current, click opens, context menu Rename with in-place input; pane select removed; 04-room-archive smoke specs rewritten onto the tree; smoke for rename + restart + markup title — verify: fast tier + electron-smoke
- [x] T03 Participants table (S4, S5): `src/renderer/room-table.ts` (`<table>`, headers with scope, rows from room-view pure logic `moveRow`, existing add/remove, finalizer radio), Add participant menu with five kinds, focus kept after move/remove, accessible names with the instance label; pure logic red first in room-view.test.ts; smoke: reorder three rows, relay, history author order — verify: AC3 command + fast tier + electron-smoke
- [ ] T03b Native controls on the palette (coordinator's screenshot review, scratchpad shots dark.png/light.png 2026-10-23): radios and checkboxes are drawn by the browser in grey on the dark surface and the input placeholder is browser-default grey — both break the owner's no-grey rule; draw radio and checkbox with `appearance: none` from tokens (border `--border`, checked mark `--focus` or `--text`, 24×24 px target, :focus-visible ring, checked state visible without colour alone), placeholder `color: var(--text)` set apart by italic, the pairs in contrast-pairs.json; smoke step: a radio and a checkbox still toggle by click and by Space (outcome: checked) — verify: contrast_check 0 findings + fast tier + electron-smoke
- [ ] T04 Ledger and notes: docs/PROJECT.md Room row (tree, rename, table); NOTES.md summary; labels `status:review` when AC1-AC4 are [x] — verify: `python3 tasks/check.py` shows no new problem + fast tier

## Log
- 2026-10-23 coordinator: T00 baseline = 05-design-contrast T05 verification run on c56b372 (fast tier 12 commands exit 0, coverage 920/920 100 %, electron-smoke 38/38)
- 2026-10-23 T01 done: `title?` on RoomRecord (parseRoomTitle, roomTitle), list item carries title, RoomService.rename via Room.retitle / atomic write, room:rename validated through ipc/preload/handlers; AC2 command exit 0, reverse control red in NOTES.md; fast tier 12 commands exit 0 (coverage 100 %), electron-smoke 38/38
- 2026-10-23 coordinator: T01 verified (fast tier 12 commands exit 0 with coverage 931/931 100 %, electron-smoke 38/38 — this run); tests were written after the code, so the coordinator ran a reverse control on title validation (3 tests red, NOTES.md); AC2 reverse control (title dropped from the record write) by the worker in NOTES.md
- 2026-10-23 T02 done: `src/renderer/room-tree.ts` in the sidebar (# Rooms header with arrow and +, items by title, aria-current, context menu / F2 Rename with in-place input), pane select and New room button removed, pane heading shows the title, `roomTreeRows`/`renameTitle` in room-view replace `roomListOption`; room.spec and room-archive.spec rewritten onto the tree, new room-layout.spec (3 tests) with reverse controls in NOTES.md; fast tier 12 commands exit 0 (coverage 100 %), electron-smoke 41/41
- 2026-10-23 coordinator: T02 verified (fast tier 12 commands exit 0 with coverage 935/935 100 %, electron-smoke 41/41 — this run; reverse controls for the new specs in NOTES.md)
- 2026-10-23 T03 done: `src/renderer/room-table.ts` (table with scoped headers, radio Final, up/down/remove named by the instance label, Add participant menu of five kinds, keyboard operable, focus kept after move and removal) replaces the participant row and the finalizer select; `moveRow`, `focusAfterRemove`, `addMenuOptions`, `rowLabel` in room-view, sites are rows in relay order; room-view tests red first (9 failed) then 86/86; 3 new smoke tests and 6 specs rewritten onto the table, reverse controls in NOTES.md; fast tier 12 commands exit 0 (coverage 100 %), electron-smoke 44/44
- 2026-10-23 coordinator: T03 verified (fast tier 12 commands exit 0 with coverage 943/943 100 %, electron-smoke 44/44 — this run); AC3, AC4 met
