# NOTES — declared fixes of today's room (2026-10-24)

T10 of docs/plans/projects.md. Not neutral: three behaviour changes, each with a test seen red first (`npx vitest run tests/integration/room.test.ts tests/integration/room-archive.test.ts` before any change to `src/`, 6 failed / 96 passed).

## Red output (before the fix)
- `room-archive.test.ts > room delete in the service > moves the per-turn packs folder of a room to the trash function, none left`: `expected [ …(2) ] to include '<roomsDir>/<id>.packs'` (the delete moved only the `.json` and the `.md`).
- `room.test.ts > room relay > passes the turn timeout and a per-turn history file to the driver for a long history`: `expected '<roomsDir>/<id>.md' not to be '<roomsDir>/<id>.md'` (the attachment was the live room file).
- `room.test.ts > room relay > gives a broadcast web participant a file with only the entries of the earlier rounds`: red on the path assertion with the first version of the test; with the assertions reordered and the one-line `attachPath: run.historyPath` put back in a scratch copy of the fix: `expected '# Room room-…' not to contain 'reply a1'` (a round-1 attachment already held the same-round replies); the fix restored, green.
- `room.test.ts > room relay > refuses a second run while one is in progress and gives every run its own drivers, the first disposed`: `expected +0 to be 1` (the first driver was never disposed after its run; `t.created` was `['a']`).
- `room.test.ts > room with stub CLIs > relays two room-owned CLI sessions for two rounds in read-only modes`: `promise resolved "Stats{ … }" instead of rejecting` (`claude-1/history.md` and `codex-1/history.md` existed in the CLI's cwd).
- `room.test.ts > room with stub CLIs > names the folders again for every run and starts every CLI session fresh`: `expected [ 'claude-2', 'claude-2' ] to deeply equal [ 'claude-1', 'claude-1' ]` (folder names counted on across runs).

## What changed
- `CliDriver.turn` no longer writes `history.md`; `historyText` stays on `TurnRequest` (OpenRouter consumes it). The now unused `PARTICIPANT_HISTORY_FILE` in `shared/room-history.ts` is removed.
- Drivers live in `RunState`: created on the first turn of a participant in the run, disposed when the run ends (before the record is finished and `current` is cleared); `Room.shutdown` disposes the current run's drivers, once (the map is emptied). A continuation of a room is a new run: its CLI sessions start fresh, as after an app restart.
- `DriverFactory` is `(participant, runId)`; `createRoomDrivers` keeps the `FolderNames` of the latest run id and starts a new one when the id changes. D26's per-run context (`Room.start(ctx)`) is T11.
- A web participant whose prompt goes over `WEB_INLINE_LIMIT` gets `attachPath` = `<roomsDir>/<room id>.packs/<participant id>/<n>.md`, `n` counting the participant's turns in the run, written by `renderHistory(room id, seen)` (fresh nonce per render, the attach prompt carries none). `roomPackPath` confines the path inside the rooms folder; `roomPaths` returns the `.packs` folder, so deleting a room trashes it.
- Tests adapted because the contract they pinned is the declared one: the continuation and the stub-CLI relay tests read the driver of the new run (`requests[0]`), the web fixture test expects the packs paths, `site-recorder.test.ts` passes a run id.

## Decisions made alone
- Pack files are kept after the turn (T17's digest names them) and removed only with the room; a continuation of a room overwrites the files of the same participant and number.
- `FolderNames` per run keys on the run id (a continuation of the same room keeps the room's names), the simplest form before D26's context object.

## Renamed tests
- tests/integration/room.test.ts :: room relay > passes the turn timeout and the history file to the driver for a long history -> room relay > passes the turn timeout and a per-turn history file to the driver for a long history
- tests/integration/room.test.ts :: room relay > refuses a second run while one is in progress and reuses the sessions afterwards -> room relay > refuses a second run while one is in progress and gives every run its own drivers, the first disposed

## Host load
The first `coverage_gate.py --run` (7 failed in 5 files, one unhandled error in site-replay) and the first electron-smoke run (60 s timeouts from the first test on) ran while an Android NDK build held the host at load average 165-190 (`uptime`, clang++ processes); the repeat at load 23-34 passed: coverage gate 1354/1354 at 100.00 %, electron-smoke 76/76. Nothing else was changed between them.
