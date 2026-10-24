# NOTES — context pack and kind capabilities (2026-10-24)

T15 of docs/plans/projects.md. Behaviour-neutral (AC6): the prompts, the web attachment files and the record bytes are the ones of d5ceac4.

## Neutrality
`vitest-list.json-before` is `npx vitest list --json` of d5ceac4 taken before the first edit (1367 tests); `vitest-list.json` is the list of the final tree (1382: 5 in tests/unit/kind-capabilities.test.ts, 10 in tests/unit/context-pack.test.ts). No test id vanished, so no `old -> new` line is needed. The number of `expect(` calls did not fall.
```
COMMAND: python3 scripts/neutrality_check.py d5ceac4 tasks/20-projects/12-context-pack/vitest-list.json-before
neutrality_check: 0 problems
exit 0
```

## What the tests that read the request now read
D22 names them: the request carries `system?`, `text`, `files[]` instead of `text`, `attachPath`, `historyText`. Same expectations, other accessor, no assertion added or removed:
- `attachPath` -> `files[0]` (long-history web test, broadcast web test) and `files` equal to `[]` for a short history.
- `historyText` of a CLI participant was the run's render (run nonce, Finalizer line), a value no CLI driver read; the CLI's own prompt (fresh nonce, no Finalizer line) is `text`. The broadcast tests that read the history out of `historyText` read `text`. The test "hands a CLI participant the current history ... the same as the history file at that moment" compares the entry blocks of `text` with the history file, nonce replaced; the invisible-lead forgery test takes the run nonce from the history file at that moment (`t.snapshots`), which is the nonce `historyText` carried; "a web participant has no `historyText`" is "has no `system`".
- `site-recorder.test.ts` builds a request with `files: []`; `room-wiring.test.ts` collects `request.text`.

## Red seen
New code: the two new test files failed on the missing modules before the modules were written. Mutations on the finished code, each red, restored:
- `splitsSystem` branch of `historyProvider` removed -> `context-pack.test.ts > keeps the system and user split for OpenRouter ...`.
- attach branch of `historyProvider` forced off -> 4 tests: context-pack long-history test, `room.test.ts` per-turn history file, broadcast web file, web participant attaches a long history.
- `Room.turn` delivers `files: []` -> 3 tests in room.test.ts (same web ones).
- OpenRouter driver `system`/`user` swapped -> 4 tests in tests/integration/openrouter-room.test.ts (every turn carries the whole room history, effort and web tool, first round and second round, entry marker).
- priority order reversed in `composePack` -> `context-pack.test.ts > puts providers in priority order ...`.
- site driver attaches `files.slice(1)` -> `room.test.ts > room with a web participant > ... attaches a long history as a file`.
arch_check rules `runs-electron` and `context-pack-layer` against HEAD's arch_check.py:
```
FAIL: test_runs_import_electron
FAIL: test_context_pack_imports_main_node_or_a_package
FAILED (failures=2)
```

## Decisions made alone
- `Capabilities` has a third field, `splitsSystem`, beside `attachesFiles` and `tokenBudget?`: the OpenRouter system/user split of D12 must come from the recipient's capabilities, not from a kind test inside the pack. `ModelCatalog { contextLength(model) }` is the catalog argument; `Room` passes `NO_CATALOG` until T17 wires the OpenRouter model list, so `tokenBudget` has no consumer yet.
- `ContextProvider` has `id`, `priority` and `provide(capabilities)`; the budget share of D22 is not declared here: with one provider it would be a field nothing reads, and it arrives with the project map provider (T17) that needs it.
- `historyProvider` is built on `buildParticipantPrompt`, which stays in `shared/room-history.ts` with its tests unchanged: that is what keeps the prompt bytes. `capabilities` picks the layout (system split, file, inline), the prompt's flags say whether a web history went over `WEB_INLINE_LIMIT`.
- The OpenRouter user text is still the run's render (`run.render`, run nonce and Finalizer line), passed in as `renderRun`; a CLI participant no longer gets one computed that nobody read.
- A pack file is `{ content }`; `Room.deliver` writes it to the participant's next pack path (T10's `<roomsDir>/<room>.packs/<participant>/<n>.md`), the counter moving only when a file is written, as before.
- vitest.config.ts coverage include gains `src/main/runs/**` (D23 asks for it; no exclude, no threshold).
- labels.txt says `type:feature`, not `type:refactor`: `tasks/check.py` accepts feature, fix, research, decision, chore only (a `refactor` is the 8th problem), and the neutral sibling 03-sidebar-tree is `feature` too.
