---
status: running
created: 2026-10-23
---
# Room resume — a stopped run continues from its first unanswered turn

## Goal
Stop (or quit) then the start button with the same prompt and setup goes on from the first unanswered turn. Owner, 2026-10-23: "нажал stop и затем continue - почему все с нуля началось? у нас же промпт тот же, ответы от моделей уже имеются, что мешало нам продолжить?"

## Acceptance criteria
- [x] AC1 Fast tier green: every command of docs/PROJECT.md §6 fast tier exits 0
- [x] AC2 Resume point: `npx vitest run tests/unit/room-model.test.ts tests/unit/ipc-validate.test.ts` exit 0 — relay and broadcast segments, none after a final or for a done record, stopped entries not counted, `resume` accepted only as a boolean with a continue id; tests seen red first
- [x] AC3 Run: `npx vitest run tests/integration/room-archive.test.ts` exit 0 — stop a relay after two answered turns, resume: one owner prompt in the segment, no repeated (author, round) pair, final present; broadcast stopped mid-round resumes only the missing participants; a resume with a changed prompt or participants is refused and writes nothing; reverse control (done turns ignored) turns `a resumed relay skips the answered turns` red, output in NOTES.md
- [x] AC4 Smoke: electron-smoke exit 0 — stubs, relay stopped mid-run, the button reads Resume (assert by a data attribute, not wording), pressed, history has no repeated answer and ends with the final — windows hidden
- [ ] AC6 Stop entry dropped on resume: `npx vitest run tests/integration/room-archive.test.ts` exit 0 — `a resume drops the stop entries of its segment` (record entries, history .md file and the history text given to participants contain no stopped entry of the resumed segment, after two stops and a resume; a Continue keeps the old segment's stop entry); seen red first; reverse control (drop skipped) turns it red, output in NOTES.md
- [ ] AC5 HUMAN (excluded from /run): the owner stops a real room mid-run and resumes it

## Stack
As tasks/10-app-shell/06-room-layout/PLAN.md. No new dependency.

## Decisions
- D1 Resume, not restart, when the prompt and the setup are those of the stopped run (owner, 2026-10-23).
- D2 Which turns are done is decided in the main process from the stored record; the renderer only asks (agent's decision, auth rule of AGENTS.md).
- D3 The button is one control: label Resume when resumable and unchanged, Continue otherwise; `data-room-action="resume|continue|start"` carries the state for tests (agent's decision).
- Branch: `room`. Commit per task, never push.

## Assumptions
- A turn is identified by (authorId, round); every entry of a turn carries `round` today (relay and broadcast set it); entries without `round` in a segment (old records) make the segment not resumable.
- Error entries (including timeout) count as done, as in an uninterrupted run; the Room "stopped" entry and a turn aborted without an entry are not done.
- Resumable record statuses: stopped and failed (app start already rewrites running as stopped).
- Equality for resume: prompt text (exact), mode, rounds, participants (id, kind, model, effort, order), finalizerId; turn timeout and site debug may differ and take the new values.
- No marker entry for the resume; the feed shows the resumed turns after the stop entry under their round.
- A participant error entry without `round` is a failed final-phase turn: it is not a done turn and does not block resume; a reply without `round` still blocks it (T01).
- Opening a stopped or failed room prefills the prompt box with that run's prompt, otherwise the button could never read Resume after a reopen; other records keep an empty box (T01).
- The pane derives the button from its snapshot (entries, phase, plan) and the form; no new IPC for the offer. The main process re-checks everything from the stored record (T01).
- The resumed run replays progress events for the done turns, so round, chips and counters continue where the stop cut them (T01).
- `src/renderer/room-table.ts` joined the WRITE-SET: model, effort and final edits notify the pane (T01).

- Owner, 2026-10-23, after a resume: "теперь у меня висит красное: Room stopped ... Stopped by the owner. - зачем? если продолжил, то надо убирать эту запись" → D4: on resume the stop entries of the resumed segment are removed from record, history file and feed; Continue (new prompt) keeps the old segment's stop entry, since that run really ended stopped (agent's decision).

## Out of scope
- Continue with a new prompt (unchanged)
- Resume after changing the setup
- Keeping partial text of the cut turn

## Tasks
- [x] T00 Baseline: the coordinator's verified run of 08-room-setup-collapse (d1fec41) is this plan's baseline — verify: the Log line exists
- [x] T01 Resume (S1–S4): `resumePoint(record)` and the equality rule in src/shared (red first in room-model.test.ts); `resume?: boolean` through ipc parser/preload/handlers (red first in ipc-validate.test.ts); room-service builds the continuation with the done turns and refuses mismatches; Room.execute/relay/broadcast skip done turns and append no prompt when resuming, progress starts at the done count; room-pane button label and `data-room-action` from a pure rule in room-view (red first in room-view.test.ts); integration tests in room-archive.test.ts with reverse control; smoke in tests/full/room-archive.spec.ts — verify: AC2, AC3 commands + fast tier + electron-smoke
- [x] T02 Ledger and notes: docs/PROJECT.md Room row (resume); NOTES.md summary; labels `status:review` when AC1–AC4 are [x] — verify: `python3 tasks/check.py` shows no new problem (baseline 7) + fast tier

- [ ] T03 Drop stop entries on resume (S5): room-service removes the Room stopped entries after the last owner prompt from the continuation when resuming; RunState rewrites the history .md atomically from the cleaned entries on a resume (not append); the record write carries the cleaned entries; the renderer feed reloads from the `started` event's previous entries so the removed entry disappears; integration test red first; smoke in tests/full/room-archive.spec.ts: stop, resume, no feed entry with data-kind error from the Room for that segment — verify: AC6 command + fast tier + electron-smoke

## Log
- 2026-10-23 coordinator: T00 baseline = 08-room-setup-collapse T01 verification run on d1fec41 (fast tier 12 commands exit 0, vitest 947/947, coverage 100.00 %, electron-smoke 48/48); tasks/check.py baseline 7 problems
- 2026-10-23 T01 done: resumePoint/resumeMatches/entriesBeforeRound in room-model, resume flag through ipc/preload/handler/service, Room skips done turns without a new prompt, button rule startAction + data-room-action; AC2 exit 0 (72 tests), AC3 exit 0 (8 tests, reverse control red in NOTES.md), gates.sh exit 0: fast tier 12 commands 0, vitest 966/966, coverage 100.00 %, electron-smoke 49/49
- 2026-10-23 coordinator: T01 verified (`bash .claude/scratch/gates.sh` exit 0: fast tier 12 commands exit 0, vitest 966/966, coverage 100.00 %, build exit 0, electron-smoke 49/49 — this run; diff of room.ts, room-service.ts, room-model.ts reviewed); AC1-AC4 met
- 2026-10-23 coordinator: T02 done: docs/PROJECT.md Room row (resume), NOTES summary, labels status:review; tasks/check.py 7 problems (baseline 7); paused on AC5 (owner)
