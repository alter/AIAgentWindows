# NOTES T01 (2026-10-23)

## Write-set additions (declared in task.txt)
- src/shared/agents.ts: `isCliKind` and `isSiteKind` take `string` (the participant kind is now `RoomKind = AgentKind | 'openrouter'`; AGENT_KINDS and the sidebar agents stay five).
- src/shared/room-history.ts: `buildParticipantPrompt` returns for `openrouter` the instructions only with `placeHistory: true` (the web path would swap the history for "the attached file" above 12000 chars, which an API request cannot read). The driver sends the instructions as the system message and `historyText` (the run's nonce-fenced history) as the user message.
- src/renderer/room-openrouter-row.ts: new file, the OpenRouter cells of a table row (model filter/search/select, effort, web), so room-table.ts stays readable.
- src/renderer/room-pane.ts is untouched: RoomTable asks `api.openrouterStatus/onOpenRouterChanged/openrouterModels` itself; the authoritative sign-in and effort check is `openrouterProblem` (src/main/openrouter/gate.ts) called from RoomService.start.

## Decisions
- Label is `OpenRouter · <model name from the list, else the id> [· effort]`; the name travels as `modelName` (<= 200 chars, no control characters), the label part is cut to 80 UTF-16 units so an entry label stays within 128 (a longer label makes `parseEntry` reject the whole record). Test: a 200-char id + 200-char name + 16-char effort round-trips through `parseRoomRecord`.
- `web` is explicit on a row; a record without it gets `!isFreeModel(id)` (`:free` suffix or `openrouter/free` -> off).
- `ModelItem.efforts` is the resolved `reasoning.supported_efforts` (null -> the gateway values, `none` dropped when `mandatory`). Effort `max_tokens` budgets are not offered (study S4 Implications: only when `supports_max_tokens`; out of scope here).
- No `max_tokens` is sent (study: default when omitted is unverified); an empty answer with `finish_reason: length` is a failed turn with a "raise the limit" text.
- 429: one retry after `Retry-After` in seconds (1 s when absent or not a number), the wait is `min(Retry-After, remaining turn time)` and ends on Stop; when the wait used the whole turn the retry is not sent and the entry is a timeout. 402 is never retried (study: only `openrouter_in_flight_budget` may be, not asked for here).
- 401 goes through `OpenRouterService.chat` -> `keyRejected()` (signed out, cipher cleared, notice `key-rejected`).
- The driver aborts through `AbortSignal.any([Stop/run signal, driver controller in the shared `running` set])`, so `RoomDrivers.shutdown` closes requests in flight.
- Contrast: no new colour pair. The new rows use `--text` on `--content-bg`/`--input-bg`/`--surface`, all listed in contrast-pairs.json; `scripts/contrast_check.py` 0 findings.
- Docs: no new fact beyond the study (web tool parameters, reasoning shape, error codes, Retry-After seconds are all in docs/tech/openrouter@2026-10-23.md); nothing added there.

## Red first
Unit (tests/unit/room-model.test.ts, tests/unit/openrouter-room.test.ts), before any source change, `npx vitest run tests/unit/room-model.test.ts tests/unit/openrouter-room.test.ts`: `Tests 21 failed | 54 passed (75)`:
```
      Tests  21 failed | 54 passed (75)
FAIL tests/unit/openrouter-room.test.ts > add participant menu > lists OpenRouter last, usable when signed in and disabled with its reason when signed out
FAIL tests/unit/openrouter-room.test.ts > form rows of kind openrouter > become participants with their model, effort, web flag and label
FAIL tests/unit/openrouter-room.test.ts > form rows of kind openrouter > come back from a saved record with their settings
FAIL tests/unit/openrouter-room.test.ts > model choice for a room row > only models whose id has the allowed shape can be picked
FAIL tests/unit/openrouter-room.test.ts > model choice for a room row > the price is shown per million tokens, or as free
FAIL tests/unit/openrouter-room.test.ts > model choice for a room row > web search starts on for a paid model and off for a free one, and the name is kept
FAIL tests/unit/openrouter-room.test.ts > model efforts > are accepted when empty, when the model is unknown, or when listed
FAIL tests/unit/openrouter-room.test.ts > model efforts > are empty when the model has no reasoning field, no efforts, or something that is not a list
FAIL tests/unit/openrouter-room.test.ts > model efforts > are every gateway value when supported_efforts is null
FAIL tests/unit/openrouter-room.test.ts > model efforts > are offered by the room only from the model, and a saved value only while the model is unknown
FAIL tests/unit/openrouter-room.test.ts > model efforts > are the supported_efforts of the model, in the listed order
FAIL tests/unit/openrouter-room.test.ts > model efforts > drop none when the model is mandatory, and values of a wrong shape and duplicates
FAIL tests/unit/openrouter-room.test.ts > prompt for an openrouter participant > carries only the instructions and leaves the whole history to the driver, however long it is
FAIL tests/unit/room-model.test.ts > instanceLabel for openrouter > is OpenRouter with the name or the id, and the effort
FAIL tests/unit/room-model.test.ts > openrouter participant > a record written before this kind existed loads unchanged, and a record with openrouter rows keeps their settings
FAIL tests/unit/room-model.test.ts > openrouter participant > a resume does not match when the web flag or the model of an openrouter row changed
FAIL tests/unit/room-model.test.ts > openrouter participant > an openrouter participant needs a model id of the allowed shape
FAIL tests/unit/room-model.test.ts > openrouter participant > keeps model, effort, web and name, builds the label from them, and several rows may share a room
FAIL tests/unit/room-model.test.ts > openrouter participant > refuses a name with a control character or over 200 characters and a web flag or name on any other kind
FAIL tests/unit/room-model.test.ts > openrouter participant > the label uses the model id when no name is given and stays within the entry label limit
FAIL tests/unit/room-model.test.ts > openrouter participant > web is on for a paid model and off for a :free one or the free router unless the row says otherwise
⎯⎯⎯⎯⎯⎯ Failed Tests 21 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  2 failed (2)
```
Integration (tests/integration/openrouter-room.test.ts) with `gate.ts` present but no chat/driver code: `Tests 19 failed | 5 passed (24)`:
```
      Tests  19 failed | 5 passed (24)
FAIL tests/integration/openrouter-room.test.ts > a broadcast with two OpenRouter rows > sends only the owner prompt in the first round and every first-round reply in the second
FAIL tests/integration/openrouter-room.test.ts > a reply written to attack the history > a reply carrying an entry marker stays inside its entry
FAIL tests/integration/openrouter-room.test.ts > abort > shutting the room down closes a request in flight
FAIL tests/integration/openrouter-room.test.ts > abort > Stop closes the request on the server side and the run ends stopped
FAIL tests/integration/openrouter-room.test.ts > abort > the turn timeout closes the request and the entry is marked as a timeout
FAIL tests/integration/openrouter-room.test.ts > failed turns > a 401 fails the turn, signs the app out and clears the stored key
FAIL tests/integration/openrouter-room.test.ts > failed turns > a provider failure with HTTP 200 ends the turn as an error and the run goes on
FAIL tests/integration/openrouter-room.test.ts > failed turns > a server error (500) ends the turn as an error and the run goes on
FAIL tests/integration/openrouter-room.test.ts > failed turns > an answer that is not JSON ends the turn as an error and the run goes on
FAIL tests/integration/openrouter-room.test.ts > failed turns > empty content at the token limit ends the turn as an error and the run goes on
FAIL tests/integration/openrouter-room.test.ts > failed turns > finish_reason error ends the turn as an error and the run goes on
FAIL tests/integration/openrouter-room.test.ts > failed turns > no credits (402) ends the turn as an error and the run goes on
FAIL tests/integration/openrouter-room.test.ts > rate limit > a 429 is retried once after Retry-After and the second answer is the reply
FAIL tests/integration/openrouter-room.test.ts > rate limit > a Retry-After longer than the turn is capped by the remaining time: one request, a timeout entry
FAIL tests/integration/openrouter-room.test.ts > rate limit > a second 429 fails the turn after exactly two requests
FAIL tests/integration/openrouter-room.test.ts > rate limit > Stop ends the wait for Retry-After without a second request
FAIL tests/integration/openrouter-room.test.ts > two OpenRouter rows and a stub CLI in one relay > every OpenRouter turn carries the whole room history
FAIL tests/integration/openrouter-room.test.ts > two OpenRouter rows and a stub CLI in one relay > replies land in the record in relay order, finalized by the CLI
FAIL tests/integration/openrouter-room.test.ts > two OpenRouter rows and a stub CLI in one relay > sends the effort and the web tool as set on the row, nothing for a row without them
⎯⎯⎯⎯⎯⎯ Failed Tests 19 ⎯⎯⎯⎯⎯⎯⎯
```

## Reverse controls (code broken in place, restored afterwards)
1. History dropped from the OpenRouter request (`user: request.historyText ?? ''` -> `user: ''` in OpenRouterDriver), `npx vitest run tests/integration/openrouter-room.test.ts`:
```
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
FAIL tests/integration/openrouter-room.test.ts > two OpenRouter rows and a stub CLI in one relay > every OpenRouter turn carries the whole room history
FAIL tests/integration/openrouter-room.test.ts > a broadcast with two OpenRouter rows > sends only the owner prompt in the first round and every first-round reply in the second
FAIL tests/integration/openrouter-room.test.ts > a reply written to attack the history > a reply carrying an entry marker stays inside its entry
      Tests  3 failed | 21 passed (24)
```
Restored: 24/24 green.
2. The abort signal not passed to the request (`signal: new AbortController().signal`), `-t abort`:
```
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
FAIL tests/integration/openrouter-room.test.ts > abort > Stop closes the request on the server side and the run ends stopped
Error: Test timed out in 5000ms.
FAIL tests/integration/openrouter-room.test.ts > abort > shutting the room down closes a request in flight
Error: Test timed out in 5000ms.
      Tests  2 failed | 1 passed | 21 skipped (24)
```
Restored: green.

## Existing smoke assertions changed by design
- tests/full/room-layout.spec.ts: the Add participant menu now has 6 items (OpenRouter) and the participants table 7 column headers (a Web column); both are counts of structure the task adds.

## 2026-10-23 Summary

- Participant kind `openrouter` (model id, effort from supported_efforts, web flag) in room-model, old records load; row cells in src/renderer/room-openrouter-row.ts (Free/Paid/All, prices, effort, Web with per-search price); "OpenRouter" in Add participant disabled with its reason when signed out.
- Driver: src/main/openrouter/chat.ts — one non-streaming chat/completions per turn, room intro as system, nonce-fenced history as user, reasoning effort, openrouter:web_search tool; 401 → OpenRouterService.keyRejected (signed out), 402/429 (Retry-After once)/200-error/empty-at-length → failed turns with readable text; Stop, timeout and shutdown abort.
- Checks (coordinator, this run): fast tier 12 commands exit 0, vitest 1112/1112, coverage 100.00 %, electron-smoke 65/65; tasks/check.py 7 (baseline).
- Open: AC5 HUMAN — a real room with a free and a paid OpenRouter model.
