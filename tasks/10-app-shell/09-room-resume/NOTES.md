# NOTES

## 2026-10-23 T01 reverse control

`Run.isDone` in src/main/room.ts forced to `false` (resume ignores the done turns), then
`npx vitest run tests/integration/room-archive.test.ts -t "a resumed relay skips the answered turns"` exit 1:

```
× a resumed relay skips the answered turns
AssertionError: expected [ 'claude', 'codex', 'claude', …(2) ] to deeply equal [ 'claude', 'codex', 'claude' ]
- Expected
+ Received
    "claude", "codex", "claude",
+   "codex",
+   "claude",
Tests  1 failed | 7 skipped (8)
```

The original was restored and byte-compared (`cmp` clean, sha1-equal shasum 408d83c5…); the test is green again.

## 2026-10-23 T01 scope

- `src/renderer/room-table.ts` added to WRITE-SET: the model input, the effort select and the final radio did not notify the pane, so editing them could not turn Resume back into Continue (S4); each now calls the existing change listener.
- `formFromRecord` prefills the prompt box with the prompt of a resumable (stopped or failed) run; without it the button could never read Resume after opening a saved room. Records that are not resumable keep the empty prompt.

# NOTES — summary (2026-10-23)
- Built: `resumePoint` / `resumeMatches` / `entriesBeforeRound` in src/shared/room-model.ts; `resume` flag through ipc, preload, handler; room-service refuses a resume with nothing to resume or a changed prompt/setup and writes nothing; Room appends no owner prompt on resume, replays progress of done turns, relay skips done (participant, round) turns, broadcast runs only the missing participants of a round with the entries seen before that round; button `data-room-action` start|continue|resume from a pure rule in room-view; opening a stopped room prefills its prompt.
- Coordinator review: for a normal (not resumed) broadcast run `entriesBeforeRound` equals the old `[...run.entries]` at the round's start, because no entry of that round exists yet.
- Checks (coordinator, this run): `bash .claude/scratch/gates.sh` exit 0 — fast tier 12 commands exit 0, vitest 966/966, coverage 100.00 %, build exit 0, electron-smoke 49/49.
- Left for the owner: AC5 (stop a real room mid-run and resume it).
