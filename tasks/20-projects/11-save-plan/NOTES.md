# NOTES — Save plan into the project (2026-10-24)

T14 of docs/plans/projects.md. Not neutral: every behaviour below has a test that was red first (D6, AC7). Milestone M3: project rooms usable with CLI participants; the CLI part of AC5 may run.

## What was built
- `room:save-plan { id, replace }` (renderer sends the room id and a boolean only). `RoomService.savePlan` reads the record from the room's folder, takes the last non-empty `final` entry's raw text (`lastFinalText`, which `finalText` now uses too, so the Copy and the saved text are one rule), asks `ProjectService.folderOf` for the project's realpath (a missing, moved or deleted project is refused with its message and nothing is created) and calls `savePlanFile`.
- `shared/plan-file.ts`: `planSlug(title, id)` lowercases, keeps letters, marks and digits of any script, joins runs with `-`, cuts at 80 characters and 240 bytes, and falls back to `room-<id>` when nothing is left or the slug is a Windows device name (`con`, `nul`, `com1`...); `planText` rewrites every line among the first 8 that matches `^status: *running *$` to `status: draft` and, for the looser `status:\s*running` found inside a line, only that part (indentation and the rest of the line stay); a `\r` is kept.
- `main/projects/save-plan.ts`: for `docs` then `docs/plans`: `lstat`; missing -> `mkdir` of that one level; a symlink or a non-folder -> refused before anything is created; then `realpath(plans)` must lie under `realpath(project)`; target `lstat`: a symlink (even with `replace`), a folder or a special file refused; an existing file asks (`{ ok:false, exists:true, file }`) unless `replace`, in which case it goes to the Trash first (`deps.trash`, the same function as room delete) and a Trash failure stops before the write; the write is `writeAtomic` with `ensureDir: false` (temp `wx`, never `mkdir -p`).
- `store/atomic-file.ts`: `writeAtomic(file, text, { suffix?, ensureDir? })`; the default is unchanged (`ensureDir: true`), so no other caller changed.
- Renderer: the final entry of a room that has a project gets a `Save plan` button beside the first Copy (`data-room="save-plan"`); `room-plan-save.ts` shows `Saved to <path>` or the refusal, and for an existing file a Replace / Cancel row in the pane (`data-room="plan-replace"`, `plan-cancel`); opening or creating a room clears it. A room outside any project has no button (its Copy buttons are unchanged).

## Decisions made alone
- Slug letters: any Unicode letter, mark or digit survives (the owner writes Russian titles), lower-cased; dots never survive, so `..` and an extension cannot appear.
- The loose pattern `status:\s*running` rewrites the matched part of its line only; the anchored pattern rewrites the whole line, so the saved line is exactly `status: draft`.
- The confirmation is two calls: the first without `replace` returns `exists`, the pane asks, the second carries `replace: true`. Main never replaces without the flag; the file is looked at again on the second call (a symlink planted in between is still refused).
- Save plan is not blocked while a room runs (the record is the source; nothing in AC7 asks for it).
- The renderer shows the absolute path returned by main.
- AGENTS.md map rows name the three new files (documentation of the change, listed in CONTEXT).

## Red seen
New test files against HEAD c9d3804 `src/` (no `plan-file.ts`, `save-plan.ts`): `npx vitest run tests/unit/plan-file.test.ts tests/integration/save-plan.test.ts` failed to import (`.claude/scratch/t14-red1.txt`, "Test Files 2 failed (2) / Tests no tests"). Then each behaviour with one mutation of the finished code, the tests of the task run (`.claude/scratch/t14-mutations.txt`); exit 1 means red:
```
M1 planText returns the raw text                    exit 1  plan-file.test.ts 7 failed (front matter, fenced block, bare, no space, loose, first 8, CR)
M2 a symlinked docs/plans component accepted         exit 1  "refuses a symlinked docs folder before creating anything": expected [ Array(1) ] to deeply equal []
M3 `replace` ignored (always replaces)               exit 1  save-plan.test.ts "asks for confirmation when the file exists..."; room-save-plan.test.ts "asks before replacing..."
M4 a symlinked target file accepted                  exit 1  "refuses a symlinked target file even when replace is confirmed": expected { ok: true, ... } to match object { ok: false, ... }
M5 realpath containment check dropped                exit 1  "refuses when the real path of the parent is not under the real path of the project": expected { ok: true } to match { ok: false }
M6 temp file not exclusive (flag 'w')                exit 1  atomic-file.test.ts planted symlink; save-plan.test.ts "refuses a planted temp symlink..."
M7 ensureDir ignored                                 exit 1  atomic-file.test.ts "creates no directory when ensureDir is false": promise resolved "undefined" instead of rejecting
M8 a room outside a project goes on to the project lookup   exit 1  room-save-plan.test.ts after the error text was asserted ("only for a room of a project")
M9 slug keeps dots and slashes                       exit 1  plan-file.test.ts 2 failed ('../../etc/passwd' not to match /[\\/.]/)
M10 Trash skipped                                    exit 1  save-plan.test.ts 2 failed, room-save-plan.test.ts 1 failed
M12 Save plan button on every room                   exit 1  projects-plan.spec.ts: Expected: 0 / Received: 1 (the room outside any project)
```
M8 was green on its first run (the lookup refused the room by another route with another message); the test now asserts the message and is red. M11 (`mkdir` of the default creator made recursive) is not a behaviour change here: `docs` is created before `docs/plans`, so the parent always exists; the test of order injects its own `mkdir`. The python test `tests/scripts/test_save_plan_hook.py` bundles `save-plan.ts` and `plan-file.ts` with esbuild, saves five model-style plans (front matter, intro line plus fenced block, no front matter, `status:running`, padded) and runs the hook's exact `head -n 8 | grep -qE '^status: *running *$'`: the raw text of each matches (control, so the check can be red), the saved file of each does not; red with M1 run alone: `AssertionError: True is not false : the saved plan of front-matter still matches the hook` (`.claude/scratch/t14-m1-py.txt`).

## Checks
Fast tier of docs/PROJECT.md §6 and the smoke are in the plan's Log line.
