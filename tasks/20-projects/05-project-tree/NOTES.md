# NOTES — project nodes in the sidebar tree (2026-10-24)

## What was built
- `src/shared/sidebar-tree.ts`: the state gains `projects`; `sidebarNodes(state)` returns the project nodes in index order and the "No project" node last. A project node has a Rooms and an Agents section (empty until 06-project-agents and 08-room-run-context), both collapsible; a missing project has `missing: true`, its folder and no sections. The "No project" node carries `sidebarSections(state)` unchanged. Collapse keys: `no-project`, `project:<id>`, `project:<id>:rooms|agents`; a toggle for a project not in the tree or an unknown section is ignored, and the collapse of a project that left the list is forgotten.
- `src/renderer/project-tree.ts`: the Projects block above "No project": `+` menu (Existing folder, New folder), the new-folder form (parent through `projects:pick-parent`, name typed in the sidebar, `projects:create { token, name }`), rename (menu, F2, inline input), delete with a confirmation inside the sidebar (menu or Delete key; "Its folder on disk stays as it is"), missing note with the folder path, a notice line for refusals. All DOM through `textContent`; no `confirm()`.
- `src/renderer/sidebar.ts` wraps the room tree, the Agents header, notice, add menu, list and close confirmation in one `section[data-project="no-project"]` node with a collapse toggle. Nothing inside changed: every `data-room`, `data-agent`, `.add-button`, `.agent-list` selector is as before, and no existing spec needed a change.
- `src/shared/room-test-mode.ts` `testFolderPicker(env)`: `AIAW_TEST_FOLDER` is a path (answered every time, as before) or a JSON list of paths and `null` (answered in order, the last repeats, `null` is a cancelled dialog); a list that is not JSON, empty, or holds anything else throws at start. `main/index.ts` `pickFolder` uses it. The picker serves every folder dialog of the app: the CLI agent folder, an existing project, the parent of a new one.
- `tests/full/projects.spec.ts` (2 tests, AC2 tree parts).

## Decisions made alone
- The "No project" node sits last (below the projects) so its Agents list keeps the flexible height it always had; the Projects block scrolls above it (max 40vh).
- Inside a project node the Rooms and Agents sections exist but offer no add flow ("Nothing here yet."): agents belong to 06-project-agents, rooms to 08-room-run-context. The sections of a project are not selectable and take no clicks beyond collapse.
- After a refused `projects:create` the form stays open with the refusal shown. The service keeps the token after a refused name and spends it on any later refusal (existing folder, git), so a retry after that says the parent choice expired and the owner picks the parent again from the menu; the sidebar does not guess which case it is.
- A list answer `null` is a cancelled picker; an empty path inside a list is refused (an empty `AIAW_TEST_FOLDER` was already "unset").

## Red seen
Unit, tests written before the code (reducer and picker missing):
```
 Test Files  2 failed (2)
      Tests  15 failed | 15 passed (30)
TypeError: projectNodeKey is not a function
TypeError: sidebarNodes is not a function
```
Green after: `Tests  30 passed (30)`.
Smoke, each behaviour broken in place in the code, `npx playwright test --project=electron-smoke tests/full/projects.spec.ts`, code restored (diffed against a saved copy):
```
## missing flag dropped (sidebar-tree.ts: missing: false)      exit 1  x test 2 renames ... shows one whose folder is gone as missing   toHaveAttribute failed
## list answers always first (room-test-mode.ts: index 0)      exit 1  x test 1 creates projects ...
## delete confirmation never shown (project-tree.ts)           exit 1  x test 1 ... toBeVisible failed
```
The smoke passed on its first run before these mutations (the code was written first for the DOM; the reducer and picker had their red unit tests first).

## Smoke under load
Machine load was 56-123 from another repository's runs. First full smoke: 72/73, `smoke.spec.ts:195` ("closing an agent asks for confirmation") hit the 60 s test timeout; alone it passed (28 s, 18.6 s, 54 s as load moved from 74 to 123). The same test on a clean worktree of HEAD 4753633 (before this task) took 17.3 s at load 56 against 18.6 s here at load 60, so the cause is load, not this task. Second full smoke: 73/73 exit 0. `design-contrast.spec.ts:43` and `room-layout.spec.ts:79` were green in both runs but slow: 6.5 s and 6.1 s in the first run, 14.0 s and 6.9 s in the second (3.85 s and 2.1 s in the last junit report, reports/junit-electron-smoke.xml).

## Not covered here
- Agents and rooms inside a project: 06-project-agents, 08-room-run-context. A project's agents are not closed on delete yet (nothing belongs to a project).
- The DOM of `project-tree.ts` has no unit test (renderer code, outside the coverage include); the smoke is its check.
