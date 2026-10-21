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

## T05 site adapter framework

- `src/main/site-adapters/`: `types.ts` (PageRunner, SelectorSet, SiteAdapter, SiteAdapterError), `page-scripts.ts` (page-side code as strings, results as JSON), `selector-adapter.ts` (`createSelectorAdapter(site, selectors)`; T07 adapters are a selector set each, or their own file overriding a method), `turn.ts` (`runAdapterTurn`: insert, submit, poll, timeout/no-response errors), `isolated-runner.ts` (`executeJavaScriptInIsolatedWorld`, world 1001; `setInputFiles` through CDP `DOM.setFileInputFiles`).
- Text goes in through the native value setter plus an `input` event (textarea/input) or `<p>` rows built with `textContent` (contenteditable); never `innerHTML`. The insert is read back and a mismatch is an error.
- Reverse control (2026-10-21): in `insertTextScript` the contenteditable branch replaced by `el.innerHTML = text`: `npx vitest run tests/unit/site-adapters.test.ts` -> `Tests  1 failed | 10 passed (11)`, `× inserts markup as literal text`; restored, green.
- jsdom 29.1.1 added as a devDependency for these tests (docs/tech/jsdom@29.1.1.md). jsdom is not Chromium, so the isolated-world run and the file input were checked once in a hidden Electron run (AIAW_USER_DATA temporary, `show: false`, local fixture copy, scratch bundle outside the repository): relay of one turn through `createIsolatedRunner` returned the reply, markup stayed text (`b` elements: 0), `attachFile` set `h.md` on the file input (EVIDENCE F6 stays open for the real sites).
- `vitest.config.ts` coverage `include` was not changed; `src/main/site-adapters/` is covered by the unit test but outside the ratchet's include list.
