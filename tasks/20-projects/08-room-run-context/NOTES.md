# NOTES — per-run room context, rooms per project (2026-10-24)

T11 of docs/plans/projects.md. Not neutral: every behaviour below has a test that was red first (D26, D19, D9 room part, D10 storage part).

## What was built
- `src/main/room-context.ts`: `RoomRunContext { roomsDir, projectId, cwdFor(participant) -> { path, create } }`, `FolderNames` (moved out of `room-drivers.ts`), `noProjectContext(roomsDir)` (`<roomsDir>/<kind>-<n>`, `create: true`, a fresh `FolderNames` per run) and `projectContext(roomsDir, projectId, folder)` (the realpath of the project, `create: false`), `projectRoomsDir(userData, id)` = `<userData>/projects/<id>/rooms`.
- `Room.start(config, from, ctx)`; `RoomDeps` no longer has `roomsDir`; the run state writes the record and the history under `ctx.roomsDir`; `DriverFactory(participant, runId, cwd)` gets the participant's `{ path, create }`; `CliDriver` creates its folder only when told, `createRoomDrivers` has no `cwd` dependency. A project room never `mkdir`s or writes below the project folder.
- `src/main/room-folders.ts`: room id -> project index over "No project" and every project's `rooms/` (built at `init`, refreshed on `list`, added on start, dropped on delete), `stopInterrupted` per folder, `ProjectService.ids()`.
- `RoomService`: `newRoom(projectId)` (refused while a run is going and for an unknown project), `RoomSnapshot.projectId` set at `room:new` and `room:open`, kept by the `started` event, `list` over every folder with `RoomListItem.projectId`, `start` takes the project from the snapshot (a continuation: from the index) and asks `projects.folderOf` first — a missing, moved or deleted project is refused with that reason and nothing is created, `open`/`rename`/`delete`/continue read the room's own folder (an id no folder knows falls back to the "No project" folder, as before), `closeProject(id)` (registered in `index.ts` next to the unchanged room veto) forgets the index entries and the open snapshot of that project.
- IPC: `room:new { projectId: string | null }` with `parseRoomNew` (`isProjectId` or `null`), preload, handler; `room:list` and the other `room:*` channels stay id-only.
- Shared: `RoomTreeRow.projectId`, `roomItems` in `sidebar-tree.ts` (the "No project" section holds the rooms without a project, each project node's Rooms section its own, `busy` carried), `nextRoomAfterDelete` looks inside the deleted room's project.
- Renderer: T08's "Nothing here yet" stub is gone from the Rooms section; a project node has "+" (`data-project="add-room"`), its rooms (`.rooms-item[data-room-id]`, click opens, the opened one `aria-current`) and a delete "×" with a confirmation row (`room-delete-confirm`), the pane's "new room" passes the project of the node.
- `AGENTS.md` Map row names the two new modules.

## Decisions made alone
- Rename of a project's room from its node is not built (T09 did the same for agents); the room is renamed in the pane's own flow only for rooms under "No project" until a later task needs it.
- A room id that no folder knows is read from the "No project" folder (today's behaviour), so `delete` of a stray id still reaches `trashRoom` there; nothing is ever read from a folder derived from the id itself.
- `RoomServiceDeps.projects` is optional; without it every project id is unknown (the existing room tests build the service without projects).
- A deleted project's open room leaves the snapshot at once (`closeProject`); the renderer's room list refreshes on its own events (a stale row of a deleted project is shown nowhere, because its node is gone).

## Red seen (integration, HEAD 05c7afc plus the new test file against the old `src/`)
```
     × runs the CLI participant of each room in its own project folder with a fresh session 119ms
     × keeps the records of each room in the rooms folder of its project and lists them under it 161ms
     × runs a room outside any project in its own subfolder of the rooms folder, as before 57ms
     × lists a project room under its project, opens it with its feed and continues it in the project folder 111ms
     × opens the latest room of any project at start and marks interrupted runs of every folder as stopped 106ms
     × is refused at start, creates nothing and does not bring the folder back 58ms
     × is refused when the project is gone from the index, and a new room there is refused too 4ms
     × forgets the open room of a project that is deleted and does not list its rooms any more 57ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 8 ⎯⎯⎯⎯⎯⎯⎯
      Tests  8 failed | 3 passed (11)
```
(the room-projects suite has 11 tests; the 3 that passed before the change are the project-folder snapshot test, which became meaningful only with the mutation below, the rename/delete test and the refusal of an unknown room.)

## Mutations of the finished code, each run and restored (diffed against a saved copy)
```
## room-context project cwd becomes a subfolder that is created | exit 1
    × runs the CLI participant of each room in its own project folder with a fresh session 937ms
    × writes nothing into the project folder during a project room run 478ms
    × lists a project room under its project, opens it with its feed and continues it in the project folder 939ms
    failed tests: 3
## room-service start skips the project check | exit 1
    × is refused at start, creates nothing and does not bring the folder back 327ms
    failed tests: 1
## listRecords does not tag the project | exit 1
    × tags every item, readable or not, with the project it is listed for 10ms
    × keeps the records of each room in the rooms folder of its project and lists them under it 838ms
    × lists a project room under its project, opens it with its feed and continues it in the project folder 523ms
    failed tests: 3
## stopInterrupted only in the No project folder | exit 1
    × opens the latest room of any project at start and marks interrupted runs of every folder as stopped 585ms
    failed tests: 1
## started event drops the project of the snapshot | exit 1
    × carries the project of the snapshot through a started run and the events after it 12ms
    × carries the id, history path, status as phase, entries and plan of the record 4ms
    × lists a project room under its project, opens it with its feed and continues it in the project folder 582ms
    × opens the latest room of any project at start and marks interrupted runs of every folder as stopped 528ms
    failed tests: 5
## project rooms leak into the No project section | exit 1
    × lists the rooms of a project in its Rooms section and keeps them out of the No project node 12ms
    failed tests: 1
## project Rooms section ignores the project | exit 1
    × lists the rooms of a project in its Rooms section and keeps them out of the No project node 13ms
    failed tests: 1
## next room after delete looks across projects | exit 1
    × looks only among the rooms of the same project 6ms
    failed tests: 1
## room:new parser accepts any project id | exit 1
    × room new takes a project id or null and nothing else 8ms
    failed tests: 1
## room:new parser accepts a payload without projectId | exit 0
    failed tests: 0
## newRoom does not check the project | exit 1
    × is refused when the project is gone from the index, and a new room there is refused too 9ms
    failed tests: 1
## closeProject keeps the open room | exit 1
    × forgets the open room of a project that is deleted and does not list its rooms any more 271ms
    failed tests: 1
## rename and delete use the No project folder | exit 1
    × lists a project room under its project, opens it with its feed and continues it in the project folder 532ms
    × renames and deletes a project room in its own folder and drops it from the list 271ms
    failed tests: 2
```
The one survivor, "room:new parser accepts a payload without projectId", showed the `hasOwn` guard was redundant (`isProjectId(undefined)` is false); the guard was removed and the test for `{}` stays green. The renderer: `onNewRoom` of a project node passing `null` turns `tests/full/projects-room.spec.ts` red (`Expected: 1  Received: 0` project rooms).

## Tests
- tests/integration/room-projects.test.ts (new, stub CLI argv log with cwd): two rooms of two projects one after the other (cwd of each, fresh session, no `--resume`), records under each project's `rooms/` and listed under it, "No project" cwd unchanged, the project folder snapshot (name, type, size, mtime) equal after a run, restart on the same userData (listed under the project, opened with its feed, Continue spawns in the project folder), interrupted runs stopped in every folder, a room of a missing project refused with the userData tree and the folder unchanged, a deleted project, rename/delete in the project's folder, `closeProject`.
- tests/full/projects-room.spec.ts (new): a room made from a project node runs in the project folder (argv log), is listed under the project and not under "No project", survives a restart, continues, is deleted from the node; the project folder listing is unchanged.
- Unit: ipc-validate (`room:new`), room-view (`projectId`), room-tree (rows, next after delete), sidebar-tree (rooms by project), room-archive (tag).
- Shapes forced by the new parameter, expectations unchanged: `new Room(` -> `TestRoom` (tests/integration/helpers/test-room.ts supplies the "No project" context), `RoomServiceDeps.userData`, `newRoom(null)`, `createRoomDrivers` without `cwd`, the factory's third argument, `projectId: null` in list and row fixtures.

## Host load
Smoke and the coverage gate ran at load average 4-11 (`uptime`); no timeout.
