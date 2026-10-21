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

## T08 room orchestrator

- `src/main/room.ts` (`Room`: start, stop, shutdown; events started/progress/entry/finished), `src/main/room-drivers.ts` (`createRoomDrivers`: CLI driver on room-owned ptys through `buildRoomSpawn` + `runCliTurn`, site driver on any T05 `SiteAdapter` + `PageRunner`; the orchestrator only sees the `ParticipantDriver` interface, so T07 adapters plug in through `siteFor`). `cli-turn.ts`, `site-adapters/turn.ts` and `types.ts` gained an optional `AbortSignal` / `aborted` error code.
- Relay: one turn at a time over `relaySchedule(participants, rounds)` (A,B,C,A,B,C, no extra return step); the history file is written and flushed before the next turn starts (a CLI participant reads it by path). Broadcast: all participants in parallel from the owner's prompt alone; rounds are ignored (one pass). A failed, timed-out or empty turn is an `error` entry labelled with the participant, its session is reset (CLI: pty killed, next turn spawns a new one with a new session id), the run continues. Stop aborts the turn in flight (the orchestrator does not wait for the driver), resets that session, adds a `Room | error` entry "Stopped by the owner." and ends with status `stopped`.
- CLI sessions live in `<rooms dir>/<participant>-<hash>/` (one cwd per participant: codex rollouts are matched by cwd, two codex participants in one cwd could not be told apart in a broadcast). A session is considered ready when its output has been quiet for `quietMs` (2 s default, 30 s cap); a real Claude may show a folder-trust dialog in a never-seen cwd, which will surface as a timeout error in the feed, not as a hang.
- Reverse controls (2026-10-21), both red then restored: (1) driver `reset()` removed from the failure path -> `× marks a failed participant, restarts its session and goes on with the next one` (`expected +0 to be 1`); (2) `Promise.race([first, abortion])` replaced by `await first` -> `× does not wait for a driver that ignores the stop` (timed out). The test of the history order was red on the first run (the next turn read the file before the write finished): the step now awaits the flush.
- Verify: `npx vitest run tests/integration/room.test.ts` -> 16 passed (two stub CLIs for 2 relay rounds in read-only argv, a hanging stub CLI timed out then a fresh session answers, fixture page as a web participant). No real CLI or site was started; the stub runs only.

## T09 room IPC and UI

- Main: `RoomService` (src/main/room-service.ts) wraps `Room`, mirrors every `RoomEvent` into a `RoomSnapshot` (pure reducer `applyRoomEvent` in src/shared/room-view.ts) and forwards it on the `room:event` channel; invoke channels `room:state`, `room:select`, `room:start` (payload validated by `parseRoomConfig`), `room:stop`, `room:carry` (`{id, what: final|history}`: the renderer never sends the text, main takes it from its own snapshot). `index.ts` wires `createRoomDrivers` (envFor = process.env, cwd `<shared>/rooms/sessions`, siteFor = `createSiteSeats`) and shuts the room down on quit.
- Participants of the UI are the five agent kinds with id = kind (`ROOM_PARTICIPANTS`); relay order is that fixed order, not the tick order. A site participant uses the first open site agent of its kind (its partition and sign-in); `pageFor` opens that agent's view hidden if it was never shown. `site-adapters/registry.ts` is empty until T07 (blocked on the owner's capture): a ChatGPT/Grok/DeepSeek participant therefore ends as an `error` entry "has no open chat page" and the run continues.
- Selecting Room: `AgentsSnapshot.roomOpen`; opening it hides every site view (`showSite(null)`), selecting or adding an agent leaves it, closing another agent does not. The Room item sits above the Agents header.
- Carry: only into a CLI working session (`AgentController.paste` = bracketed paste through `bracketedPaste`, never Enter), only when the run is not running; a site working session is not a carry target.
- Feed: every entry is built with `textContent` (`room-pane.ts`); markup in a reply stays text (checked once in a hidden Electron run with `<b>x</b>` in the prompt; the smoke test of it is T10).
- Reverse control (2026-10-21): `AgentController.paste` writing `bracketedPaste(text) + '\r'` -> `× pastes the text into a CLI session without submitting it` (`expected ... not to contain 'SUBMITTED:'`); restored, 8/8 green.
- Checked once in test mode (AIAW_USER_DATA tmp, windows hidden, stub CLI, no real CLI or site): Room item opens the pane, Start with nothing ticked shows a message, a relay of one stub claude ends `done`, the history file holds prompt then reply.

## T10 room smoke

- `tests/full/room.spec.ts` (5 tests, hidden windows, test mode, stub CLI for both room participants): relay of claude+codex stubs for 2 rounds (history headings Owner, Claude Code, Codex, Claude Code, Codex), broadcast, Stop in the middle (stub reply delay 1.5 s, status `stopped`, `Room | error` entry, fewer than 6 replies), carried result pasted into a working stub session without `SUBMITTED:`, markup in a reply shown as text (no img/b in the feed, `window.__pwned` unset).
- Test-mode override: `AIAW_ROOM_FAST=1` (only honoured when `AIAW_USER_DATA` is set; `src/shared/room-test-mode.ts`) shortens room poll/settle/submit/kill timing and sets `AIAW_STUB_TRANSCRIPT=<kind>` for room CLI sessions so the stub writes Claude/Codex transcripts. `quietMs` is deliberately not shortened: with 300 ms the prompt was pasted while the login shell was still starting (cooked tty, Enter arrived as `\n`, stub never submitted) — root cause found from the stub's stdin log.
- Stub CLI gained `AIAW_STUB_REPLY` (fixed reply text).
- Reverse controls (2026-10-21), both red then restored: (1) `AgentController.paste` writing `bracketedPaste(text) + '\r'` -> carried test `not.toContainText('SUBMITTED:')` failed; (2) feed entry built with `innerHTML` -> markup test `toHaveText` failed (received `bold`).
- Verify: `PLAYWRIGHT_JUNIT_OUTPUT_FILE=reports/junit-electron-smoke.xml npx playwright test --project=electron-smoke --reporter=junit` exit 0, 14 tests; fast tier 11/11 (FASTRUN-2026-10-21-202108444464).

## T12b reverse control (capture sanitizer closed vocabulary)
`isClosedValue` made to accept every value (`parts.length >= 0 ||`): `npx vitest run tests/unit/capture-sanitize.test.ts` -> 6 failed (token-shaped value kept, free-word class / data-state / aria / test id / free-text attribute not flagged by findLeaks). Restored; 32 passed.

## T12a start-up dialogs (ATTACK finding 2)
- Room codex sessions start with `-c check_for_update_on_startup=false` (key verified in the 0.163.0 `config.schema.json` and `tui/src/updates.rs`, docs/tech/codex@0.163.0.md, EVIDENCE CX26); the flag sits before `resume`.
- `src/shared/start-screen.ts` `blockingStartScreen(output)` (escape codes and whitespace removed, case-folded) names update, folder-trust and "enter continue/confirm" dialogs. `CliDriver.session` runs it on the output captured from spawn until the session went quiet; a hit kills the session and fails the turn (`unavailable`, error entry in the feed) before anything is written to the pty. The stub CLI has `AIAW_STUB_DIALOG=update|trust` and `AIAW_STUB_STDIN_LOG` (records every byte written to its stdin).
- Reverse control (2026-10-21): the `if (blocked !== null)` branch in `room-drivers.ts` switched off -> `npx vitest run tests/integration/room.test.ts` -> `Tests  2 failed | 16 passed (18)` (update dialog, trust dialog: a prompt and Enter reached the stub). Restored.
- Not done by design: a positive "at the prompt" marker (the prompt glyphs are not verified across CLI versions, a false negative would fail every real turn) and the `turn_context.sandbox_policy` check (the record only exists after the first turn, i.e. after the first submit). Read-only stays enforced by the flags (T04 tests).


## T12c fix (ATTACK.md finding 1: history entry forgery)

- `renderHistory` fences every entry as `<<<entry-<nonce> author="…" time=… kind=…>>>` … `<<<end-<nonce>>>`; the nonce is 24 hex chars from `crypto.getRandomValues`, drawn again for every render and redrawn while any entry text or label contains it, so a reply cannot know or embed the nonce of the file that will contain it. The file's notice line and the participant intro say that only markers carrying that nonce are entries and everything inside is data. The same renderer feeds the history file, the inline web prompt and Carry history.
- Labels: `parseParticipant` rejects control, format and line/paragraph-separator characters and `|` (first vector, renderer via `room:start`); the marker also replaces them and `"` with spaces (defence in depth).
- Reverse control (2026-10-21): the redraw-on-collision check removed -> `npx vitest run tests/unit/room-history.test.ts` -> `Tests  1 failed | 14 passed (15)` (draws again when the nonce is already inside a body). Restored. All 13 new tests were red before the change (history module had no nonce, labels were accepted).

## T12d fix (ATTACK.md finding 4: unbounded reply)

- `truncateText(text, limit)` in `src/shared/room-model.ts`: over the limit, keeps `limit - 64` characters (never half a surrogate pair) and appends `\n[truncated N chars]`, so the result is at most `limit`. `Room.append` applies it: `MAX_REPLY_CHARS` = 1,000,000 per entry (the DATA range) and, for replies, the rest of `MAX_HISTORY_CHARS` = 4,000,000 for the whole run (a spent budget leaves only the marker). The stored entry, the `entry` event, the history file, web prompts and Carry all see the truncated text.
- The history file is appended to (`appendFile` of one entry block) after the first write; `RunState` keeps the file's nonce. When an appended entry (text or label) contains the current nonce, a new nonce is drawn and the whole file is rewritten once (T12c guarantee kept). A failed write is sticky: later appends are skipped and the run ends `failed`.
- Tests red first: `tests/integration/room.test.ts` "room reply size and history file" (src reverted to HEAD: 4 of 5 failed, among them the append test: 5 different inodes for 6 entries, and the nonce-redraw test), `tests/unit/room-model.test.ts` `truncateText`.
- Reverse control (2026-10-21): the collision check removed from `RunState.add` (`if (nonce !== null) {`) -> `npx vitest run tests/integration/room.test.ts` -> `Tests  1 failed | 22 passed (23)` (redraws the nonce and rewrites the file when an entry contains the current one); restored.

## T12e fix (ATTACK.md "Claude tool denylist")

- Room claude now starts with `--permission-mode plan --tools Read,Grep,Glob --strict-mcp-config --mcp-config '{"mcpServers":{}}' --disallowedTools 'mcp__*'` instead of the denylist. Flags checked against the official CLI reference and tools reference and `claude --help` of 2.1.306 (`spikes/claude-tools-flags.txt`, docs/tech/claude-code@2.1.306.md, EVIDENCE CC27-CC28); claude was never started.
- Tests `tests/unit/room-sessions.test.ts` (allowlist exactly Read/Grep/Glob and no `--allowedTools`, strict empty MCP config, `mcp__*` denied, resumed session keeps them) were red first against the old denylist (4 failed, 8 passed), green after.
- Reverse control (2026-10-21): the 4 new/changed assertions failing against the previous `ROOM_CLAUDE_ARGS` is the red run; no separate break was made.
- Not verified without starting claude: that an empty `mcpServers` object is accepted, and that `--tools` with `Read,Grep,Glob` leaves plan mode answering. A start-up error would fail the turn visibly (T12a guard, timeout); the owner's AC7 run is the check.

## T12f folder trust pause
- Folder: every room CLI participant has a stable folder `<shared>/rooms/<kind>-<n>` (`FolderNames` in `room-drivers.ts`; n counts participants of one kind in order of first use, the UI has one per kind so it is always `-1`), reused across runs, so the CLI's trust dialog is asked once.
- Pause: `startScreenIssue` (shared/start-screen.ts) names the kind of start-up screen (`trust`, `update`, `enter`; update wins when both are on screen). `trust` makes `CliDriver.session` throw `OwnerPause(sessionId, note)` with the session left alive and nothing typed; `update` and `enter` still kill the session and fail the turn (T12a). `Room.turn` catches `OwnerPause`, emits `paused` (participant, session id, one-line note "<label>: accept the folder once in the terminal below, then press Resume"), waits for `Room.resume()` or Stop, emits `resumed`, resets the driver (kills the old session) and runs the same step again, which spawns a new session in the same folder; if the dialog is still there it pauses again. Nothing is ever typed into the dialog by the app: the owner answers it in the terminal shown in the Room.
- UI: while a run is paused the Room pane shows a block with the note, an xterm for each paused session (backlog + live data on `room:terminal-data`, typing and resize through `room:terminal-write|resize|backlog`, accepted by main only for a session that is currently paused) and a Resume button (`room:resume`). `TerminalPane` takes a `TerminalIo` (agent pty or room session) instead of an id.
- Stub CLI: with `AIAW_STUB_DIALOG=trust` the dialog is skipped when the file `.aiaw-stub-trusted` exists in the stub's cwd, which is how the tests play "the owner accepted the folder".
- Tests (red first, `room.test.ts`: 2 failed on the missing `resume`, 1 on the old sleep; room-view/ipc/wiring/start-screen unit tests; smoke `a folder trust dialog pauses the run ...`): pause with nothing typed (stdin log empty), Resume after the marker completes the same step with prompt+reply, a second run needs no pause, Resume without the marker pauses again and Stop ends the paused run, update dialog still fails the turn.
- Reverse control (2026-10-21): the `issue?.kind === 'trust'` throw switched off -> `npx vitest run tests/integration/room.test.ts` -> `Tests  2 failed | 23 passed (25)` (both pause tests time out). Restored.
- Not verified without starting the real CLIs: that claude and codex persist the trust answer so that the respawned session in the same folder starts without the dialog; if one does not, the run pauses again after every Resume, which is visible and Stop-able. Left to the owner's AC7 run.
