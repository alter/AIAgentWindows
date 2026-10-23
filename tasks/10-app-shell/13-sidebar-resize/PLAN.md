---
status: paused
created: 2026-10-23
---
# Sidebar resize — a draggable divider, width kept

## Goal
Owner, 2026-10-23: "разделитель между левой панелью с агентами и правой с полем где происходит работа статический, а хотелось бы его двигать уметь".

## Acceptance criteria
- [x] AC1 Fast tier green: every command of docs/PROJECT.md §6 fast tier exits 0
- [x] AC2 Rules: `npx vitest run tests/unit/site-layout.test.ts tests/unit/ipc-validate.test.ts tests/unit/state-file.test.ts` exit 0 — siteBounds(width), clamp (min 180, max min(600, 50 % of window)), stored width parse (missing / out of range → 260), IPC `layout:sidebar` accepts only an integer in range; tests seen red first
- [x] AC3 Smoke: electron-smoke exit 0 — `the divider moves by drag and keys and the width survives a restart` in tests/full/sidebar-resize.spec.ts: drag by mouse, ArrowRight/ArrowLeft/Home/End by keyboard, sidebar width and a site view's bounds.x (main-process evaluate) equal the new width, restart keeps it; reverse control (width argument dropped from siteBounds in site-views) turns it red, output in NOTES.md — windows hidden
- [ ] AC4 HUMAN (excluded from /run): the owner drags the divider with a site open

## Stack
As tasks/10-app-shell/06-room-layout/PLAN.md. No new dependency.

## Decisions
- D1 Pointer drag plus keyboard (role="separator", 16 px per arrow, Home/End), double-click resets to 260 (agent's decision: standard splitter behaviour, WAI-ARIA window splitter pattern).
- D2 Limits 180 px .. min(600 px, 50 % of the window) (agent's decision).
- D3 The renderer owns the drag; the main process lays out site views from the width it receives (throttled while dragging, final value on release) and stores it in agents.json (agent's decision: one source of truth for persistence in main, as the theme).
- Branch: `room`. Commit per task, never push.

## Assumptions
- Width is stored through AgentController with the agents, like the theme (11-theme-switch: a separate writer of agents.json would be overwritten).
- The renderer receives the stored width at start (with the agents snapshot or a `layout:get`) and sets --sidebar-width before the first paint.
- The divider is a 6 px hit area drawn as a 1 px var(--border) line, var(--focus) ring when focused.

## Out of scope
- Collapsing the sidebar

## Tasks
- [x] T00 Baseline: the coordinator's verified run on aed0565 (12-sidebar-palette + 09 T03) is this plan's baseline — verify: the Log line exists
- [x] T01 Resize (S1–S4): siteBounds(width, ...) and clamp in src/shared/site-layout.ts, red first; `layout:sidebar` validated IPC; site-views relayout on width; width in agents.json via AgentController; `src/renderer/sidebar-resizer.ts` separator with pointer and keyboard; smoke tests/full/sidebar-resize.spec.ts with restart and reverse control — verify: AC2 command + fast tier + electron-smoke
- [x] T02 Ledger and notes: docs/PROJECT.md shell row (resizable sidebar); NOTES.md summary; labels `status:review` when AC1–AC3 are [x] — verify: `python3 tasks/check.py` no new problem (baseline 7) + fast tier

## Log
- 2026-10-23 coordinator: T00 baseline = verification run on aed0565 (fast tier 12 commands exit 0, contrast_check 0 findings, vitest 976/976, coverage 100.00 %, electron-smoke 52/52); tasks/check.py baseline 7 problems
- 2026-10-23 T01 done: draggable/keyboard separator, `layout:get`/`layout:sidebar` IPC, sidebarWidth in agents.json, site views follow; AC2 48/48 (was 16 red first), vitest 991/991, coverage 100.00 %, fast tier 12 exit 0, electron-smoke 53/53 (new spec 1), reverse control red (NOTES.md)
- 2026-10-23 coordinator: first gate run red only on tests/unit/site-replay.test.ts afterEach `rm` ENOTEMPTY (macOS recursive rm race, seen once before by the 09 worker); teardown of site-replay/site-recorder tests now `rm(..., { maxRetries: 3 })` (docs/tech/node@22.20.5.md); not reproducible red on demand
- 2026-10-23 coordinator: T01 verified (diff reviewed; fast tier 12 exit 0, vitest 991/991, coverage 100.00 %, electron-smoke 53/53) — this run
- 2026-10-23 T02 done: ledger row "Slack-like shell" extended, NOTES summary, labels status:review; tasks/check.py 7 problems (baseline); paused on AC4 HUMAN
