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

## T06 capture command (the capture itself is the owner's step)

How to run: `npm run capture-sites` (builds, then starts the app in normal mode with your own profile; unset `AIAW_USER_DATA` first, the script refuses otherwise). Open each site agent (ChatGPT, Grok, DeepSeek), signed in, on a chat that already has at least one assistant reply and the prompt box visible, then press Cmd/Ctrl+Shift+K (menu Capture > Capture site structure). A dialog lists, per site, `saved to tests/fixtures/sites/<site>.html`, `failed` or `not opened`. Sites that were not opened in this run are not captured; run it again after opening them.

What is saved: a rebuilt copy of the page body (a new document is built element by element, nothing is cloned): tag names, `id`, `class` tokens, `role`, `type`, `aria-*`, structural `data-*` names; every text node becomes `x`; script, style, head, template, comments and the contents of svg, iframe, canvas and media are dropped; `href`/`src`/`value` and every other unknown attribute keep their name with the value `x`; ids that look like uuids or long digit runs become `x`; `aria-label`/`placeholder`/`alt`/`title` keep their value only when it is one of a short closed list of control labels (send, stop, attach, copy, ...), otherwise `x`; `data-*` values are kept only for structural names (testid, role, author, state, type, ...) and only as short tokens. Not read at all: cookies, localStorage, sessionStorage, the URL, request headers. Nothing is sent to the sites: the script only reads the DOM of a page that is already loaded, in an isolated world, and the capture never types or clicks.

Backstop: before a file is written, `findLeaks` (independent regex check of the output: forbidden elements, comments, inline handlers, free-text attribute values, any text other than `x`) must return nothing, otherwise the site is reported `failed` and no file is written; the message names the category, never the text.

Limits to know in T07: open shadow roots are not entered (their content is absent from the fixture); text-based selectors (`button` with a text label) cannot be derived from a fixture, only attributes, roles and classes; a class that carries content (non-ASCII, longer than 80 characters, uuid-like) is dropped.

Reverse control (2026-10-21): in `sanitizePage` the text placeholder replaced by the original node text: `npx vitest run tests/unit/capture-sanitize.test.ts` -> `Tests  6 failed | 9 passed (15)` (leaves no original text, same result as script, keeps structure, replaces every text node, both capture-command writes); text-attribute rule replaced by `return value`: `6 failed | 9 passed (15)`. Both restored, 15/15 then 22/22 green.

Checks done once in test mode only: `AIAW_USER_DATA=<tmp> AIAW_CAPTURE_SITES=<tmp>/cap npx electron . --smoke-exit` exits 0 with the capture menu installed (no site was loaded).
