---
status: paused
created: 2026-10-24
---
# Site replies without page chrome

## Goal
Owner, 2026-10-24: "тут что за проблемы были? изучи лог" — Grok entries of room-20261023-191123-53ed7f carried "Grok", "Worked for 56s" and follow-up suggestion buttons into the history.

## Acceptance criteria
- [x] AC1 Fast tier green: every command of docs/PROJECT.md §6 fast tier exits 0
- [x] AC2 Rules: `npx vitest run tests/unit/generic-adapter.test.ts tests/unit/site-adapters.test.ts` exit 0 — `a reply leaves out buttons and screen-reader labels` on a Grok-shaped fixture, existing fixtures keep their replies, link and inline code stay; seen red first; reverse control (BUTTON not skipped) red, output in NOTES.md
- [x] AC3 Smoke: electron-smoke exit 0 — windows hidden
- [ ] AC4 HUMAN (excluded from /run): a room with Grok has no "Worked for" or suggestions in its entries

## Stack
As tasks/10-app-shell/06-room-layout/PLAN.md. No new dependency.

## Decisions
- D1 Generic rules only: button / role=button, data-no-copy="true", visually hidden (sr-only) labels are not reply text (agent's decision; the adapter has no per-site selectors, 02-room T22).
- Branch: `room`. Commit per task, never push.

## Assumptions
- A site that puts reply text inside a button is not known among ChatGPT, Grok, DeepSeek captures (tests/fixtures/sites).

## Out of scope
- Rewriting stored rooms

## Tasks
- [x] T00 Baseline: the coordinator's last verified run before T01 — verify: the Log line exists
- [x] T01 Reader (S1–S3): fixture and tests red first, rules in generic-scripts.ts, reverse control — verify: AC2 + fast tier + electron-smoke
- [x] T02 Ledger and notes: docs/PROJECT.md Room row; NOTES.md; labels status:review — verify: tasks/check.py no new problem + fast tier

## Log
- 2026-10-24 coordinator: T00 baseline = verification run on 1989192 (21-popup-placement): fast tier 12 commands exit 0, vitest 1196/1196, coverage 100.00 %, electron-smoke 69/69; tasks/check.py baseline 7 problems
- 2026-10-24 T01 done: reader skips button, role=button, data-no-copy and sr-only labels (generic-scripts.ts); Grok-shaped fixture in composer.html (?chrome=1); test red first, reverse control red (NOTES.md); vitest 1197, coverage 100.00 %, smoke 69/69, check.py 7 problems
- 2026-10-24 coordinator: T01 verified (diff reviewed; fixture text invented; fast tier 12 exit 0, vitest 1197/1197, coverage 100.00 %, electron-smoke 69/69) — this run
- 2026-10-24 T02 done: Room ledger row, NOTES summary, labels status:review; tasks/check.py 7 (baseline); paused on AC4 HUMAN
