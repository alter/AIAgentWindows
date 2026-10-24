# NOTES — site seat by project, Add participant by project, one run at a time (2026-10-24)

T13 of docs/plans/projects.md. Not neutral: every behaviour below has a test that was red first (D10, AC4 seat and refusal parts).

## What was built
- `createSiteSeats(...)` returns `(participant, projectId = null)`: the seat is the agent of the kind whose `projectId ?? null` equals the room's project, so a "No project" room takes the agent outside every project (as today) and a project room never takes another project's agent. `DriverFactory` gets the run's `projectId` as an optional fourth argument (`Room` passes `ctx.projectId`), `RoomDriverDeps.siteFor(participant, projectId)`.
- `Room.runningName()` is the title of the running room (`roomTitle` of its entries and title); `RoomService.open` during a run returns `The room "<name>" is running: stop it first.` (both checks of `open`; `newRoom`, `delete` and the renderer's own busy refusals are unchanged).
- `projectSiteKinds(agents, projectId)` (null outside a project) and a fourth parameter of `addMenuOptions`: in a project room a site kind with no agent in the project is disabled with `Add a <label> agent to this project first` (after the "already in the table" and "no site adapter" reasons); a room outside any project is not restricted, as today.
- `RoomPane` gives the table the site kinds from the agent list and the snapshot's `projectId` in `renderState`; New room in the pane now builds `emptyRoomSnapshot(projectId)` so the project is known before the first run.

## Decisions made alone
- `DriverFactory`'s `projectId` is optional (default null) so the existing three-argument callers and stubs stay valid; `createSiteSeats`' `projectId` is optional for the same reason.
- A saved room whose site participant has no agent in its project is not blocked at Start; the driver reports "<label> has no open chat page" for that participant as before.
- The refusal is exercised through `window.aiaw.roomOpen` in the smoke because the sidebar already disables the room rows while a run is on; the main-side refusal is what D10 asks for.

## Red seen
Against HEAD 85759ec `src/` (the new test files only; `.claude/scratch/t13-red.txt`):
```
     × the seat of a project room is the site agent of that project, a room outside any project takes the agent outside every project, and a project without the kind has no seat 5ms
     × in a project room disables a site kind that has no agent in the project, with its reason, and leaves a room outside any project alone 1ms
     × asks for the site seat of the project of the room and of no project for a room outside one 169ms
     × refuses to open a room of another project while a room runs and names the running room 264ms
AssertionError: expected [ 'in-b', 'in-b', 'in-b' ] to deeply equal [ 'in-a', 'loose', 'in-b' ]
AssertionError: expected [ true, true, true, true, true, true ] to deeply equal [ Array(6) ]
AssertionError: expected [ undefined ] to deeply equal [ …(3) ]
AssertionError: expected 'a room run is in progress' to contain 'hang question one'
```
Smoke `tests/full/projects-seats.spec.ts` in a scratch copy of the HEAD archive (new spec only): the Add participant check fails with `Expected: "true" / Received: ""` on `aria-disabled` of the ChatGPT item; with those two assertions removed, the refusal check fails with `Expected substring: "hang question alpha" / Received string: "a room run is in progress"`.
