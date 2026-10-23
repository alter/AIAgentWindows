---
status: paused
created: 2026-10-23
---
# Copy feedback — Copy reads Copied and rests for 3 s

## Goal
Owner, 2026-10-23: "\"Final result copied\" - целая строка под это зачем? При клике на скопировать, кнопка должна стать неактивной на 3с и в ней текст должен поменяться с Copy, на Copied, а через 3 все обратно должно вернуться и текст и активность".

## Acceptance criteria
- [x] AC1 Fast tier green: every command of docs/PROJECT.md §6 fast tier exits 0
- [x] AC2 Smoke: electron-smoke exit 0 — `the final's Copy rests for 3 s after a copy`: clipboard holds the whole final; both Copy buttons aria-disabled=true with data-copied; message line empty; after the rest both active and data-copied gone (assert attributes, never wording); reverse control (inactive state dropped) turns it red, output in NOTES.md — windows hidden
- [ ] AC3 HUMAN (excluded from /run): the owner copies a final and looks at the button

## Stack
As tasks/10-app-shell/06-room-layout/PLAN.md. No new dependency.

## Decisions
- D1 Feedback on the button, no status line on success; 3 s inactive, text Copy → Copied → Copy (owner, 2026-10-23).
- D2 Both Copy buttons of the final (top and bottom) change together: they copy the same text, so one state (agent's decision).
- D3 Inactive = `aria-disabled="true"`, the palette's disabled look and clicks ignored, not the `disabled` attribute: a disabled button drops keyboard focus to the page, `aria-disabled` keeps it on the button (agent's decision).
- Branch: `room`. Commit per task, never push.

## Assumptions
- Rest time is a named constant COPY_REST_MS = 3000 in src/shared/room-view.ts.
- A failed copy keeps the existing message line.
- Timers are cleared when the feed drops the buttons (reload, room switch).

## Out of scope
- The clipboard path itself

## Tasks
- [x] T00 Baseline: the coordinator's verified run of 09-room-resume (457a9da) is this plan's baseline — verify: the Log line exists
- [x] T01 Copy rest (S1–S3): room-feed copy buttons take the copy outcome, set Copied + aria-disabled + data-copied on both for COPY_REST_MS, restore, clear timers on reload; room-pane stops writing the success line; CSS `[aria-disabled="true"]` joins the disabled rule; smoke `the final's Copy rests for 3 s after a copy` in tests/full/room.spec.ts with reverse control in NOTES.md — verify: fast tier + electron-smoke
- [x] T02 Ledger and notes: docs/PROJECT.md Room row; NOTES.md summary; labels `status:review` when AC1–AC2 are [x] — verify: `python3 tasks/check.py` shows no new problem (baseline 7) + fast tier

## Log
- 2026-10-23 coordinator: T00 baseline = 09-room-resume T01 verification run on 457a9da (fast tier 12 commands exit 0, vitest 966/966, coverage 100.00 %, electron-smoke 49/49); tasks/check.py baseline 7 problems
- 2026-10-23 T01 done: Copy rests 3 s (room-feed copy state, COPY_REST_MS, aria-disabled CSS, no success line); smoke red before / red on reverse control / green; fast tier 12 commands exit 0, vitest 966/966, coverage 100.00 %, electron-smoke 50/50
- 2026-10-23 coordinator: T01 verified (`bash .claude/scratch/gates.sh` exit 0: fast tier 12 commands exit 0, vitest 966/966, coverage 100.00 %, build exit 0, electron-smoke 50/50 — this run; diff reviewed); AC1-AC2 met
- 2026-10-23 coordinator: T02 done: docs/PROJECT.md Room row (copy feedback), NOTES summary, labels status:review; tasks/check.py 7 problems (baseline 7); paused on AC3 (owner)
