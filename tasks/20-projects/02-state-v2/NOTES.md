# NOTES — state v2 (2026-10-24)

Not neutral by plan. Synthetic fixtures only (UUIDs made up, temp `userData` via `AIAW_USER_DATA` / `mkdtemp`); the owner's data folder was never opened.

Existing tests changed only in imports and renamed shapes: `stateFile: <dir>/agents.json` + `emptyState()` became `store: await openStore(dir[, initial])` (tests/unit/helpers/app-state.ts), `version: 1` became `version: 2` in AppState literals, the wrong-version case in state-store.test.ts swapped 2 for 1, smoke specs read `state.json` instead of `agents.json`. No assertion weakened or removed. `python3 scripts/neutrality_check.py 663e326 tasks/20-projects/02-state-v2/vitest-list.json-before` exits 0 (1128 -> 1152 listed vitest tests). Smoke 69 -> 71.

## Red outputs (mutation of the code in place, restored afterwards)

```
M1 first valid agent of a kind -> last          × takes the first valid agent of a kind in file order
M2 UUID check removed                           × never puts an id that is not a UUID into a partition name
M3 one invalid agent drops the others           × skips an invalid agent and keeps the partitions of the valid ones
M4 refusal removed from AppStateStore.update    4 failed: app-state "writes no state.json, shows the error ... agents.json cannot be read", "does not create state.json ... cannot be written", "keeps a truncated, a future-version and an invalid-agent state.json byte-identical"; state-v2-controller "lets the theme ... go on"
M5 state.json present but agents.json migrated again   × never opens agents.json again
M6 update rebuilds the document from its own slice only (the old persist)   × keeps the partition map when another slice changes; × ... a rename, a theme change and a key write keep the partition map
M7 add not refused while fail-closed            × refuses to add an agent of any kind with the error and the file path
M8 key change not refused                       × refuses to change the key, keeps the old value in memory and writes nothing
M9 key save refusal not caught in the service   × while state.json cannot be read the key is not saved, the block says so
M10 theme write while fail-closed throws        × lets the theme, the sidebar width and a restart go on for this run
smoke: SiteViews on `persist:<agentId>` of the new agent:  expect(after).not.toEqual(before)  Expected: not ["seed.txt:22:..."]   (Partitions/<old agentId>/ unchanged)
smoke: add not refused:  expect(locator('[data-sidebar="notice"]')).toBeVisible()  Received: hidden
smoke: capture on `persist:<kind>`:  Expected ["1111...","2222...","3333..."]  Received ["chatgpt","deepseek",...]
```

## Decisions made alone

- `AppState` is version 2 in `shared/agents.ts`; `parseStateDocument` throws on an invalid or repeated agent, a bad partition or a wrong version, so `state.json` with one bad agent is fail-closed (byte-identical) instead of read as empty and overwritten. `parseState(text)` keeps its old contract (empty state) on top of it.
- Partition values are validated on read: `persist:<uuid>` or exactly `persist:<kind>` of that kind; anything else makes the file unreadable rather than opening a path chosen by the file.
- `AppStateStore.open` is the only reader of `agents.json` (through a local `JsonFile`, never written). Failures that block writes for the run: unreadable `state.json`, unreadable `agents.json` (no `state.json` created, tried again next start), failed first write of `state.json`. `failure()` carries the file path.
- `AgentController`: `add` returns `AddAgentResult` (IPC `agents:add` now returns it; the sidebar shows the error in `[data-sidebar="notice"]`). `setOpenrouterCipher` throws `StateRefusedError` when the value would change; `OpenRouterService` turns that into the notice `state-refused` (text names `state.json`; the path is in the log line at start and in the add error). Theme, sidebar width, rename, close and restart keep working in memory while fail-closed and write nothing.
- No agents migrate, so `capture-auto-main` opens every site kind with a synthetic agent id `capture-<kind>` on the mapped partition (it used to skip kinds without an agent) and flushes the three mapped partitions. It opens the store with `AppStateStore.open`, which runs the same one-time migration if `state.json` is still absent.
- `SiteViews` takes `partitionOf(kind)` as a constructor argument (third); popups use the same partition string.
- Checks run: fast tier of docs/PROJECT.md section 6 (all exit 0, coverage 100.00 %), electron-smoke 71/71, `python3 tasks/check.py` 7 problems as at T00.

Write set widened (scope_check.py): the preload, renderer index, sidebar styles and `shared/openrouter.ts` carry the readable refusal (`AddAgentResult`, the notice, the `state-refused` text); the integration and smoke specs and `tests/unit/helpers/app-state.ts` only move to the store and to `state.json`.
