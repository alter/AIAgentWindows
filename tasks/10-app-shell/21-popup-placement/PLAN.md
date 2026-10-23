---
status: paused
created: 2026-10-23
---
# Popup placement — menus stay inside the window and scroll

## Goal
Owner, 2026-10-23 (screenshot): "нажал добавить и не могу скролить этот список, он уходит вниз за приложение, не скролится, в общем, так интерфейсы делать нельзя".

## Acceptance criteria
- [x] AC1 Fast tier green: every command of docs/PROJECT.md §6 fast tier exits 0
- [x] AC2 Rules: `npx vitest run tests/unit/popup-place.test.ts` exit 0 — below when it fits, above when more room, clamped at both sides with an 8 px margin, max-height on the chosen side, taller-than-window popup scrolls; seen red first
- [x] AC3 Smoke: electron-smoke exit 0 — tests/full/popup-placement.spec.ts `every popup stays inside the window and its last item is reachable` on a 900 x 560 window for Add participant (setup expanded, button near the bottom), the agents "+", the agent context menu, the room context menu; reverse control (no flip, no max-height) red, output in NOTES.md — windows hidden
- [ ] AC4 HUMAN (excluded from /run): the owner opens Add participant at the bottom of the window

## Stack
As tasks/10-app-shell/06-room-layout/PLAN.md. No new dependency.

## Decisions
- D1 One pure placement rule in src/shared/popup-place.ts and one renderer helper used by every popup (AGENTS.md: fix the owning cause, not each caller) (agent's decision).
- D2 Popups are position: fixed while open, so a scrolled Room pane cannot cut them off (agent's decision).
- D3 Below first, above when there is more room above; never outside an 8 px margin; a list longer than the room scrolls (standard menu behaviour, e.g. WAI-ARIA menu button pattern).
- Branch: `room`. Commit per task, never push.

## Assumptions
- The popup's natural size is measured with the popup shown but invisible before placement.

## Out of scope
- Native selects (drawn by the system)

## Tasks
- [x] T00 Baseline: the coordinator's last verified run before T01 — verify: the Log line exists
- [x] T01 Placement (S1–S3): rule red first; helper; four call sites; smoke with reverse control — verify: AC2 + fast tier + electron-smoke
- [x] T02 Ledger and notes: docs/PROJECT.md shell row; NOTES.md; labels status:review — verify: tasks/check.py no new problem + fast tier

## Log
- 2026-10-23 coordinator: T00 baseline = verification run on a021618 (20-openrouter-chat-retry): fast tier 12 commands exit 0, vitest 1185/1185, coverage 100.00 %, electron-smoke 68/68; tasks/check.py baseline 7 problems
- 23:49 T01 done: placePopup rule (11 unit tests, red first), popup.ts helper in 4 call sites, popup-placement smoke with reverse control red; fast tier exit 0, vitest 1196, coverage 100.00 %, electron-smoke 69/69, tasks/check.py 7
- 2026-10-23 coordinator: T01 verified (diff reviewed; unit red-first was a missing module only, the smoke reverse control reproduces the owner's case: menu bottom 703.5 px in a 560 px window; fast tier 12 exit 0, vitest 1196/1196, coverage 100.00 %, electron-smoke 69/69) — this run
- 2026-10-23 T02 done: shell ledger row, NOTES summary, labels status:review; tasks/check.py 7 (baseline); paused on AC4 HUMAN
