# NOTES — 02-room

## T04 reverse control: room sessions start read-only

Test: `tests/unit/room-sessions.test.ts` (describe "room sessions start read-only"). Both runs on 2026-10-21 against a temporary edit of `src/shared/cli-args.ts`, restored afterwards; the file is green again (9 passed).

1. `--permission-mode plan` removed from `ROOM_CLAUDE_ARGS`: `npx vitest run tests/unit/room-sessions.test.ts` -> `Tests  3 failed | 6 passed (9)`:
   - starts claude in plan mode
   - keeps plan mode when a claude room session is resumed
   - passes the same flags on Windows without a login shell
2. `--sandbox read-only` removed from `ROOM_CODEX_ARGS`: `Tests  2 failed | 7 passed (9)`:
   - starts codex with a read-only sandbox, no approvals and no daemon
   - keeps the read-only sandbox when a codex room session is resumed

Room spawns go through `buildRoomSpawn` (`src/shared/cli-args.ts`); `buildSpawn` for working sessions is unchanged and has a test that it carries no room flags.
