---
status: paused
created: 2026-10-23
---
# Sidebar palette — the left panel on the same palettes as the content, by APCA

## Goal
Owner, 2026-10-23: "а давай и левую часть по цветам сделаем как и правую? для выбора цветов фона и шрифта учитывай рекоммендацию APAC".

## Acceptance criteria
- [x] AC1 Fast tier green: every command of docs/PROJECT.md §6 fast tier exits 0; `python3 scripts/contrast_check.py` 0 findings
- [x] AC2 Levels: every sidebar text pair in contrast-pairs.json is at a level of Lc 90 (a new level `nav-preferred` or the pair at the body-preferred level, whichever the gate supports cleanly) and WCAG 4.5:1, non-text pairs Lc 45 and 3:1, in both palettes; no same-hue pair; reverse control (sidebar text token set to a grey of the sidebar hue) makes contrast_check exit 1 with a path:line finding, output in NOTES.md
- [x] AC3 Smoke: electron-smoke exit 0 — `the sidebar background follows the colour scheme` in tests/full/design-contrast.spec.ts: sidebar background equals --sidebar-bg and differs between light and dark, sidebar text equals --text — windows hidden
- [ ] AC4 HUMAN (excluded from /run): the owner looks at the sidebar in both themes

## Stack
As tasks/10-app-shell/05-design-contrast/PLAN.md; APCA per docs/tech/apca-w3@0.1.9.md. No new dependency.

## Decisions
- D1 The sidebar follows the content palettes; no fixed aubergine (owner, 2026-10-23).
- D2 Text level for the sidebar: Lc 90, the Bronze preferred level, though navigation needs only Lc 60 by Bronze — the owner asked for the APCA recommendation, so the preferred level (agent's decision; docs/tech/apca-w3@0.1.9.md:34-35).
- D3 States reuse content tokens: hover --hover-bg, selected --info-bg + bold, focus --focus, buttons --button-bg / --on-fill (agent's decision: one palette, fewer tokens).
- D4 Sidebar background is its own token, near the content background but not equal, plus a 1px --border separator, so the two areas stay distinct without a second hue (agent's decision).
- Branch: `room`. Commit per task, never push.

## Assumptions
- If a shared token (e.g. --info-bg, --hover-bg) cannot carry --text at Lc 90 in one palette, the sidebar's selected/hover state gets its own token rather than lowering the content's; recorded in NOTES.md.
- Agent kind tiles keep their colours; their pairs are non-text and unchanged.
- The contrast gate gets a new level only if Lc 90 cannot be expressed with the existing ones; any gate change carries its own test in tests/scripts/.

## Out of scope
- The content palette (unless S3 forces a shared token)
- The window title bar

## Tasks
- [x] T00 Baseline: the coordinator's verified run of 11-theme-switch (21a853a) is this plan's baseline — verify: the Log line exists
- [x] T01 Sidebar palette (S1–S4): tokens --sidebar-bg (both palettes) and any sidebar state tokens; sidebar rules moved off --aubergine*, --glyph-*, --focus-sidebar, --on-fill (except kind tiles and filled buttons); unused tokens removed; contrast-pairs.json updated (old aubergine pairs out, new sidebar pairs in at Lc 90 for text); gate level added with a test if needed; smoke in design-contrast.spec.ts; reverse control in NOTES.md with Lc values of every new pair in both palettes — verify: contrast_check 0 findings + fast tier + electron-smoke
- [x] T02 Ledger and notes: docs/PROJECT.md Themes row (sidebar on the palettes, Lc 90); NOTES.md summary; labels `status:review` when AC1–AC3 are [x] — verify: `python3 tasks/check.py` shows no new problem (baseline 7) + fast tier

## Log
- 2026-10-23 coordinator: T00 baseline = 11-theme-switch T01 verification run on 21a853a (fast tier 12 commands exit 0, vitest 974/974, coverage 100.00 %, electron-smoke 51/51); tasks/check.py baseline 7 problems
- 2026-10-23 T01 done: sidebar on --sidebar-bg/--sidebar-hover/--sidebar-select + shared tokens, aubergine/glyph/focus-sidebar removed, --danger-bg #a3123f->#9c1139, gate level `preferred` (Lc 90) with test seen red; every sidebar text pair Lc 91.0-107.4 and 8.2-21.0:1 in both palettes, non-text Lc 53.1-107.0; contrast_check 0 findings, reverse control exit 1 (45 findings), fast tier 12 commands exit 0, vitest 974/974, coverage 100.00 %, electron-smoke 52/52 (first run 51/52: sidebar queried before the DOM existed, fixed with waitFor)
- 2026-10-23 coordinator: T01 verified (`bash .claude/scratch/gates.sh` exit 0 on room with 12-sidebar-palette T01 and 09-room-resume T03 together: fast tier 12 commands exit 0, contrast_check 0 findings, vitest 976/976, coverage 100.00 %, build exit 0, electron-smoke 52/52 — this run); diff reviewed: own sidebar hover/select tokens because the light --hover-bg / --info-bg carry --text only at Lc 83.1 / 86.1; --danger-bg #a3123f → #9c1139 (confirm button Lc 89.9 → 91.4); AC1-AC3 met
- 2026-10-23 coordinator: T02 done: docs/PROJECT.md Themes row, NOTES summary, labels status:review; tasks/check.py baseline 7; paused on AC4 (owner)
