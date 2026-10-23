# NOTES — sidebar tree reducer (2026-10-24)

Behaviour-neutral (AC6). No earlier vitest list existed, so `vitest-list.json-before` is `npx vitest list --json` of 3b1e720 taken before the first edit; `vitest-list.json` is the list of the final tree (1120 -> 1128 tests, 8 added in tests/unit/sidebar-tree.test.ts). No existing test or assertion changed; no `old -> new` line is needed.

`python3 scripts/neutrality_check.py 3b1e720 tasks/20-projects/03-sidebar-tree/vitest-list.json-before` compares the saved list with a fresh `npx vitest list --json` and the sum of `git grep -c 'expect(' <commit> -- tests/` with the working tree (untracked files included); a lost id needs an `old -> new` line in the NOTES.md beside the saved list (`--notes` overrides), `old` written as `<tests/path> :: <test name>`.

Red seen. Rules removed in a scratch copy of scripts/neutrality_check.py (vanished-id and expect-count checks), its fixture tests:
```
FAIL: test_a_duplicated_id_losing_one_copy_is_red
FAIL: test_a_note_for_another_id_does_not_excuse_a_vanished_one
FAIL: test_cli_exit_codes
FAIL: test_cli_reads_notes_beside_the_saved_list
FAIL: test_removed_assertion_is_red
FAIL: test_vanished_test_without_a_note_is_red
FAILED (failures=6)
```
arch_check rules `renderer-ipc-table` (D21) and `shared-layer` (D23) against HEAD's arch_check.py:
```
FAIL: test_renderer_uses_the_ipc_table
FAIL: test_shared_imports_main_or_renderer
FAILED (failures=2)
```
Selection rule of the reducer (`selected: row.current && state.roomOpen` weakened to `row.current`):
```
     × selects the opened room only while the room pane is open, and the agent only while it is not
     × tells a changed section from an unchanged one
      Tests  2 failed | 6 passed (8)
```

Design: `Sidebar` owns the `SidebarTreeState`; `RoomTree` renders the rooms section it is handed (`setSection`) and asks to collapse through `onToggle`; the section is pushed only when `sameSection` says it changed, so an agents snapshot does not rebuild the room list (focus). The Agents list rebuilds on every snapshot as before. Every `data-room` and `data-agent` attribute, class and handler is unchanged. The agents section is not collapsible (it never was). No project nodes yet (05-project-tree).

shellcheck (fast tier line 9) is red on tasks/20-projects/probes/t03/run-claude.sh and run-codex.sh (SC2164), written by the parallel T03 task; neither is a file of this task.
