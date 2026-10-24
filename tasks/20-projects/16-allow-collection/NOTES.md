# NOTES: allow data collection per participant, skip after a permanent refusal (2026-10-24)

Owner's request, authorization recorded in the Project rooms row of `docs/PROJECT.md` and in `## Assumptions` and `## Log` of `docs/plans/projects.md` (status stays `done`, no AC or task touched). Owner's words (Russian): do the switch allowing data collection for a participant; if it is not set, mark the participant as skipped after the first permanent refusal and do not run it again every round. It reverses ONE owner-reversible default of D12/D13 (project-room OpenRouter requests always carry `provider.data_collection: "deny"`).

## What was built
- `src/shared/room-model.ts`: `allowCollection` on an OpenRouter participant (boolean only, stored only when true, refused on any other kind), `PERMANENT_ERROR_CODE` (`refused`), `isPermanentError`, `COLLECTION_SWITCH_LABEL`, `StepState` gains `skipped`. `sameParticipant` is unchanged, so flipping the switch never blocks a Resume.
- `src/shared/room-view.ts`: chip `skipped` (a settled chip), `FormRow.allowCollection`, the row to participant mapping and `formFromRecord` carry it.
- `src/shared/context-digest.ts`, `context-sent.ts`: digest flag `collectionAllowed` (only `true` parses), the extra "Context sent" line and `collectionAllowed` of the view, `collectionRecipients` and the sentence of the recipients line.
- `src/main/runs/project-pack.ts`, `digest.ts`: `denyDataCollection` follows the participant (absent when allowed), `collectionAllowed` goes to the digest; map fit, `max_completion_tokens` and the pack are unchanged.
- `src/main/openrouter/chat.ts`: the "no endpoint accepts data_collection: deny" error has code `refused` and names the switch; 429, network and timeout errors keep their codes.
- `src/main/room.ts`: `RunState.skipped`; a step of a skipped participant emits progress `skipped` (the turn counter counts it) and calls no driver; the first failure keeps its `failed` chip and its one error entry; the set dies with the run, so the next run tries again once.
- Renderer: a "Allow data collection" column in the participant table, a checkbox and a visible warning (`data-row-field="collection"`, `collection-warning` with `data-state`) for OpenRouter rows in a project room (a dash in a room without a project), `data-collection` on the recipients line and on the "Context sent" node, chip `skipped` styled with `--stop-bg` (a token pair already in the contrast list).

## Decisions made alone (recorded in the plan's Assumptions)
- The switch is shown only in a project room; a stored value in a "No project" room changes nothing (no deny is sent there).
- The first refused turn keeps the ordinary `failed` chip; `skipped` shows from the second round on. No entry is written for a skipped turn.
- A skipped finalizer is passed over like a failed one; the fallback finalizer logic is unchanged.
- No new module was added, so the AGENTS.md Map got two sentences, no row.

## Red seen (tests written before the code)
```
unit tests/unit/room-model.test.ts
      Tests  4 failed | 61 passed (65)
 FAIL  |unit| tests/unit/room-model.test.ts > allowCollection of an openrouter participant > is stored only when true, so every earlier config and record reads as not allowed
 FAIL  |unit| tests/unit/room-model.test.ts > allowCollection of an openrouter participant > refuses anything but a boolean, and any kind other than openrouter
 FAIL  |unit| tests/unit/room-model.test.ts > allowCollection of an openrouter participant > survives a parse of the record it sits in
 FAIL  |unit| tests/unit/room-model.test.ts > isPermanentError > is true only for an error carrying the permanent code
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  1 failed (1)
unit tests/unit/room-view.test.ts
      Tests  3 failed | 101 passed (104)
 FAIL  |unit| tests/unit/room-view.test.ts > a skipped participant > shows the skipped chip, distinct from error, and counts the turn as done
 FAIL  |unit| tests/unit/room-view.test.ts > the collection switch of a row > comes back from a record into the row, so a reopened room shows the switch as saved
 FAIL  |unit| tests/unit/room-view.test.ts > the collection switch of a row > goes into the participant only when on, and only for an OpenRouter row
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  1 failed (1)
unit tests/unit/context-sent.test.ts tests/unit/context-digest.test.ts
      Tests  5 failed | 32 passed (37)
 FAIL  |unit| tests/unit/context-digest.test.ts > parseDigest > keeps the collection flag only as true, and refuses anything else
 FAIL  |unit| tests/unit/context-sent.test.ts > collection allowed in the context sent > flags a digest of a participant that may be collected, and adds a line for it
 FAIL  |unit| tests/unit/context-sent.test.ts > collectionRecipients > changes the recipients line for a room with such a row and not for one without
 FAIL  |unit| tests/unit/context-sent.test.ts > collectionRecipients > is empty without a project, where nothing is denied or collected by the room
 FAIL  |unit| tests/unit/context-sent.test.ts > collectionRecipients > lists only the OpenRouter rows that allow collection, in a project room
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 5 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  2 failed (2)
unit tests/unit/project-pack.test.ts
      Tests  2 failed | 21 passed (23)
 FAIL  |unit| tests/unit/project-pack.test.ts > an OpenRouter participant that may be collected > is sent no deny and is flagged, with the pack, the fit and the ceiling as for a participant that is not allowed
 FAIL  |unit| tests/unit/project-pack.test.ts > an OpenRouter participant that may be collected > puts the flag into the digest of the turn and leaves it out otherwise
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  1 failed (1)
unit tests/unit/openrouter-chat-body.test.ts
      Tests  1 failed | 5 passed (6)
     52|     expect(error).toBeInstanceOf(ChatError);
     54|     expect(isPermanentError(error)).toBe(true);
 FAIL  |unit| tests/unit/openrouter-chat-body.test.ts > a refusal for lack of endpoints > names data_collection when the request denied collection
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  1 failed (1)
AssertionError: expected 'failed' to be 'refused' // Object.is equality
integration tests/integration/room-collection.test.ts (before the skip in room.ts; the switch tests were green only because project-pack.ts was already changed, they are shown red by mutation M1 below)
     × is called once in a broadcast of three rounds too 66ms
     × is called once in a relay of three rounds, fails once in the feed, and the others carry on to a final answer 172ms
     × is passed over by the relay: the next participant still takes its turn each round 62ms
     × is tried once again by the next run of the same room, and skipped again after failing 171ms
     × keeps a skipped finalizer out of the final turn and hands it to a participant that answered 68ms
      Tests  5 failed | 8 passed (13)
 FAIL  |integration| tests/integration/room-collection.test.ts > a participant refused for lack of endpoints in a project room > is called once in a broadcast of three rounds too
 FAIL  |integration| tests/integration/room-collection.test.ts > a participant refused for lack of endpoints in a project room > is called once in a relay of three rounds, fails once in the feed, and the others carry on to a final answer
 FAIL  |integration| tests/integration/room-collection.test.ts > a participant refused for lack of endpoints in a project room > is passed over by the relay: the next participant still takes its turn each round
 FAIL  |integration| tests/integration/room-collection.test.ts > a participant refused for lack of endpoints in a project room > is tried once again by the next run of the same room, and skipped again after failing
 FAIL  |integration| tests/integration/room-collection.test.ts > a participant refused for lack of endpoints in a project room > keeps a skipped finalizer out of the final turn and hands it to a participant that answered
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 5 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  1 failed (1)
AssertionError: expected [ Array(2) ] to have a length of 1 but got 2
AssertionError: expected [ Array(3) ] to have a length of 1 but got 3
```

## Mutation checks (code broken in place, output kept, file restored byte for byte)
```
COMMAND: npx vitest run tests/integration/room-collection.test.ts tests/unit/project-pack.test.ts  (mutation M1: project-pack.ts ignores allowCollection)
      Tests  5 failed | 31 passed (36)
 FAIL  |integration| tests/integration/room-collection.test.ts > a participant allowed to be collected in a project room > applies a change from the next turn: switched on for the next run, the refused model answers
 FAIL  |integration| tests/integration/room-collection.test.ts > a participant allowed to be collected in a project room > omits data_collection from its request and answers, while the others still carry deny
 FAIL  |integration| tests/integration/room-collection.test.ts > a participant allowed to be collected in a project room > says so in the context sent of its turns and of no other participant
 FAIL  |unit| tests/unit/project-pack.test.ts > an OpenRouter participant that may be collected > is sent no deny and is flagged, with the pack, the fit and the ceiling as for a participant that is not allowed
 FAIL  |unit| tests/unit/project-pack.test.ts > an OpenRouter participant that may be collected > puts the flag into the digest of the turn and leaves it out otherwise
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 5 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  2 failed (2)

COMMAND: npx vitest run tests/integration/room-collection.test.ts (mutation M2: room.ts never adds to run.skipped)
      Tests  5 failed | 8 passed (13)
 FAIL  |integration| tests/integration/room-collection.test.ts > a participant refused for lack of endpoints in a project room > is called once in a broadcast of three rounds too
 FAIL  |integration| tests/integration/room-collection.test.ts > a participant refused for lack of endpoints in a project room > is called once in a relay of three rounds, fails once in the feed, and the others carry on to a final answer
 FAIL  |integration| tests/integration/room-collection.test.ts > a participant refused for lack of endpoints in a project room > is passed over by the relay: the next participant still takes its turn each round
 FAIL  |integration| tests/integration/room-collection.test.ts > a participant refused for lack of endpoints in a project room > is tried once again by the next run of the same room, and skipped again after failing
 FAIL  |integration| tests/integration/room-collection.test.ts > a participant refused for lack of endpoints in a project room > keeps a skipped finalizer out of the final turn and hands it to a participant that answered
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 5 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  1 failed (1)
COMMAND: npx playwright test --project=electron-smoke tests/full/projects-collection.spec.ts (M2)
  ✘  1 [electron-smoke] › tests/full/projects-collection.spec.ts:82:5 › the collection switch of an OpenRouter row, the skipped chip after a refusal, and a reopen (1.3s)
    Error: expect(received).toBe(expected) // Object.is equality
      129 |     await expect(field(page, 'feed').locator('.room-entry[data-kind="final"]')).toHaveCount(1, { timeout: RUN_MS });
      130 |     await expect(field(page, 'status')).toContainText('done', { timeout: RUN_MS });
    > 131 |     expect(refusedCalls()).toBe(1);
      132 |     await expect(field(page, 'feed').locator('.room-entry[data-author="openrouter-2"]')).toHaveCount(1);
      133 |     await expect(field(page, 'feed').locator('.room-entry[data-author="openrouter-2"]')).toHaveAttribute('data-kind', 'error');
    Error Context: test-results/projects-collection-the-co-3db54-fter-a-refusal-and-a-reopen-electron-smoke/error-context.md
pw exit via pipe-free rerun skipped; see lines above

COMMAND: npx vitest run tests/integration/room-collection.test.ts tests/unit/openrouter-chat-body.test.ts (mutation M3: a 429 answer becomes a permanent refusal)
      Tests  2 failed | 17 passed (19)
 FAIL  |integration| tests/integration/room-collection.test.ts > an error that is not a permanent refusal > keeps today's behaviour for a rate limit: the participant is called every round and never skipped
 FAIL  |unit| tests/unit/openrouter-chat-body.test.ts > a refusal for lack of endpoints > never makes a rate limit permanent, with or without the deny
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  2 failed (2)
```
Mutation M2 on the Playwright spec went red at `expect(refusedCalls()).toBe(1)`; the spec is green on the real code (exit 0, tests/full/projects-collection.spec.ts alone).

## Existing spec changed
- `tests/full/room-layout.spec.ts`: the participant table has one more column header ("Allow data collection"), so the header count assertion went from 7 to 8. No other assertion changed; the full electron-smoke run is 89 passed, exit 0.

## Gates (2026-10-24)
Fast tier of docs/PROJECT.md §6 with `4fdcc63` as the lint and gitleaks base (the old base hashes no longer exist), each exit 0: tsc, eslint, coverage_gate --run (100.00%, floor 100.00%, no exclude), unittest tests/scripts, evidence_check, arch_check, check_publish_flags, contrast_check, the three lint_changed lines, gitleaks git. electron-smoke exit 0. `tasks/check.py` reports the 7 baseline problems and no new one.
