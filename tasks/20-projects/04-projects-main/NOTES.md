# NOTES — projects in the main process (2026-10-24)

Main process only (T07). Sidebar nodes, dialogs and the tree smoke are 05-project-tree; `projectId` on agents and the closing of a project's agents and site views are 06-project-agents (no agent belongs to a project yet, so nothing exists to close: only the room veto is registered in index.ts).

## What was built
- `src/main/projects/git.ts`: `GitRunner({ platform, gitBinary, xcodeSelectBinary, hooksDir, env, exec?, exists? })`. One `execFile` call site (`defaultExec`); every git call goes through `run`, which prepends `-c core.hooksPath=<hooksDir> -c core.fsmonitor=false`; every call, `xcode-select -p` included, gets `GIT_TERMINAL_PROMPT=0` and `GIT_OPTIONAL_LOCKS=0` (the `-c` pair is git-only: `xcode-select` takes no `-c`). `available()` is lazy, runs `xcode-select -p` first on darwin and refuses (never touching `/usr/bin/git`) when it fails, prints nothing, or its folder has no `usr/bin/git` (docs/tech/git@2.50.1.md, community evidence only). Success is cached per runner, a failure is not (installing the tools needs no restart). `init(folder)` runs `git init` with `cwd` = the folder.
- `src/main/projects/service.ts`: index on the optional `projects` slice of `state.json` (no version bump); `pickParent` keeps the parent in main and returns a one-time token; `create(token, name)`; `addExisting()` through the same picker; `rename`; `delete` (all `canClose` before any `closeProject`, then the index, then the storage folder `<userData>/projects/<id>` to the Trash, which must be a direct child of `realpath(<userData>/projects)`); `list()` marks a project `missing` when `realpath(folder)` is not the stored path or not a directory; `folderOf(id)` is the re-check that room and agent starts will call; nothing recreates a folder. Imports only `store/`, `projects/` and `shared/`.
- `src/shared/projects.ts` (record, id like `isRoomId`, folder-name rules of D9, `parseProjects`) and `src/shared/title.ts` (the title rule shared by agents and projects; `parseAgentTitle` behaves as before). `shared/projects.ts` imports no Node module because the renderer bundle pulls `shared/agents.ts` (the first smoke run failed in `scripts/build.mjs` on `node:path`).
- IPC (D21): `projects:list`, `projects:pick-parent`, `projects:create { token, name }`, `projects:add-existing`, `projects:rename`, `projects:delete`, with parsers, preload, `AppApi` and handlers; `RoomService.isRunning()` for the veto.
- arch_check rules `projects-electron` and `projects-service-layer` (D23); coverage include `src/main/projects/**`; Map row.

## Decisions made alone (also under Assumptions)
- The token is spent by the first attempt that passes name validation; a refused name keeps it, an existing folder or a missing git spends it.
- The storage folder `<userData>/projects/<id>` is created at enrolment (its trash is part of delete).
- A Trash failure after the index change is `{ ok: true, warning }`, never a project that is half deleted.
- The room veto refuses any project delete while a room runs, because rooms are not per project yet (T10 makes it per project).
- `projects:create` never reaches the filesystem with a name that failed `parseFolderName`; `git init` runs in a folder the app created one call earlier, and a failed init leaves that folder in place (the no-delete rule) and says so.

## Red seen
arch_check rules against HEAD's scripts/arch_check.py (new tests in tests/scripts/test_arch_check.py):
```
ERROR: test_project_service_layer_names_the_file_and_line
FAIL: test_project_service_imports_main_outside_projects_and_store
FAIL: test_projects_import_electron
FAILED (failures=2, errors=1)
```
Each rule or behaviour broken in place, the test run, the code restored (`x` = failing test):
```
## git.ts: no -c core.fsmonitor=false
   exit=1 ['      Tests  3 failed | 9 passed (12)', '⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯']
   x keeps the module to one execFile call and one child_process import
   x passes the hooks directory, the fsmonitor override and the two environment variables to every call, the version check and init included
   x runs init inside the folder with the hardened argv and environment
## git.ts: no GIT_OPTIONAL_LOCKS
   exit=1 ['      Tests  3 failed | 9 passed (12)', '⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯']
   x keeps the module to one execFile call and one child_process import
   x passes the hooks directory, the fsmonitor override and the two environment variables to every call, the version check and init included
   x runs init inside the folder with the hardened argv and environment
## git.ts: no darwin gate
   exit=1 ['      Tests  2 failed | 10 passed (12)', '⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯']
   x on darwin never runs git when xcode-select fails, prints nothing or names a folder without git
   x runs the gate command on darwin only
## git.ts: second execFile call without the flags
   exit=1 ['      Tests  1 failed | 11 passed (12)', '⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯']
   x keeps the module to one execFile call and one child_process import
## service.ts: duplicates by picked path, not realpath
   exit=1 ['      Tests  2 failed | 34 passed (36)', '⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯']
   x refuses the same realpath twice, also through a symlink, and keeps one project
   x stores the realpath of the folder, names it after the folder and creates its storage folder
## service.ts: folder name not validated
   exit=1 ['      Tests  1 failed | 35 passed (36)', '⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯']
   x keeps the token after a refused name and spends it on the first real attempt
## service.ts: no veto check before close
   exit=1 ['      Tests  1 failed | 35 passed (36)', '⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯']
   x asks every canClose before any closeProject and refuses on a veto
## service.ts: token reusable
   exit=1 ['      Tests  2 failed | 34 passed (36)', '⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯']
   x keeps the token after a refused name and spends it on the first real attempt
   x spends the token on an existing name too
## service.ts: trash target not guarded
   exit=1 ['      Tests  1 failed | 35 passed (36)', '⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯']
   x trashes only a direct child of the real projects folder
## service.ts: project folder inside userData allowed
   exit=1 ['      Tests  2 failed | 34 passed (36)', '⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯']
   x refuses a folder inside the application data folder, the data folder itself and a file
   x refuses a parent that is gone or is a file, and a parent inside the data folder
## projects.ts: parseFolderName lets .. through
   exit=1 ['      Tests  2 failed | 9 passed (11)', '⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯']
   x gives a readable reason
   x refuses anything that is not one path segment
## ipc.ts: create accepts any token
   exit=1 ['      Tests  1 failed | 40 passed (41)', '⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯']
   x create takes a token and a name, never a path
```
`delete also trashes the code folder` is the mutation that matters for AC2: an extra `trash(project.folder)` before the index change makes 4 tests red, among them the listing-before-and-after test. Removing the `projects` line of `parseStateDocument` turns red: the state-document test, the restart test and the Trash-warning test.

## Not covered here
- T02 found that only `core.fsmonitor` fires for the runner's commands (`ls-files`, `status`), and not for `init`; `GitRunner` has no `ls-files` yet, so the hostile-config test that must go red with `-c core.fsmonitor=false` removed belongs to the map task (13-project-map). Here the argv test goes red on that removal instead (first block above).
- `AIAW_TEST_FOLDER` is still one folder; a list of answers for the duplicate-folder smoke comes with the tree smoke (05-project-tree).
