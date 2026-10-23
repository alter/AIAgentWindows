---
status: paused
created: 2026-10-23
---
# Theme switch — System / Light / Dark inside the app

## Goal
Owner, 2026-10-23: "палитры где переключаются?" → "а сделай кнопку переключения тем". A choice inside the app, kept across restarts.

## Acceptance criteria
- [x] AC1 Fast tier green: every command of docs/PROJECT.md §6 fast tier exits 0 (contrast_check 0 findings)
- [x] AC2 Rule: `npx vitest run tests/unit/theme.test.ts tests/unit/ipc-validate.test.ts` exit 0 — stored choice parse (unknown or missing → system), IPC accepts only system | light | dark; tests seen red first
- [x] AC3 Smoke: electron-smoke exit 0 — `the chosen theme applies and survives a restart` in tests/full/theme-switch.spec.ts: pick Light, then Dark (one by click, one by arrow keys), `nativeTheme.themeSource` follows (electronApp.evaluate), with `page.emulateMedia({ colorScheme: null })` the page's `matchMedia('(prefers-color-scheme: dark)')` follows, restart → Dark still checked and applied; reverse control (themeSource write dropped) turns it red, output in NOTES.md — windows hidden
- [ ] AC4 HUMAN (excluded from /run): the owner switches themes and looks at both palettes

## Stack
As tasks/10-app-shell/05-design-contrast/PLAN.md; Electron nativeTheme per docs/tech/electron@44.6.0.md:85-88. No new dependency.

## Decisions
- D1 Three choices System / Light / Dark, System by default (agent's decision: keeps today's behaviour for anyone who never touches it).
- D2 Place: the bottom of the sidebar, a labelled radio group "Theme" (agent's decision: always visible, one click, standard control).
- D3 Mechanism: `nativeTheme.themeSource` in the main process — the CSS already follows `prefers-color-scheme`, terminals already follow it live, so no palette code changes (docs/tech/electron@44.6.0.md:85-86, EL1).
- D4 Stored in the app state file by the main process (agent's decision).
- Branch: `room`. Commit per task, never push.

## Assumptions
- nativeTheme is app-wide, so the ChatGPT / Grok / DeepSeek views also switch; accepted (they follow the system setting today in the same way).
- The smoke removes Playwright's colour emulation with `page.emulateMedia({ colorScheme: null })` before asserting the page follows nativeTheme (EL2, EL3).
- The choice is applied before the first window shows so there is no flash of the other palette.

- The choice lives in AgentController and is saved with the agents in agents.json: a separate writer of the same file would be overwritten by the controller's whole-file save (worker, T01); agent-controller.ts, shared/agents.ts and renderer/index.ts added to WRITE-SET.

## Out of scope
- Per-site palettes
- New colours

## Tasks
- [x] T00 Baseline: the coordinator's verified run of 10-copy-feedback (813b70c) is this plan's baseline — verify: the Log line exists
- [x] T01 Theme switch (S1–S4): `src/shared/theme.ts` (ThemeChoice, parseThemeChoice) red first in tests/unit/theme.test.ts; `theme:get` / `theme:set` validated through ipc/preload/handlers (red first in ipc-validate.test.ts); state-file keeps the choice; main applies themeSource at start and on set; `src/renderer/theme-switch.ts` radio group at the sidebar bottom; styles from tokens; smoke tests/full/theme-switch.spec.ts with restart and reverse control in NOTES.md — verify: AC2 command + fast tier + electron-smoke
- [x] T02 Ledger and notes: docs/PROJECT.md Themes row (switch inside the app); NOTES.md summary; labels `status:review` when AC1–AC3 are [x] — verify: `python3 tasks/check.py` shows no new problem (baseline 7) + fast tier

## Log
- 2026-10-23 coordinator: T00 baseline = 10-copy-feedback T01 verification run on 813b70c (fast tier 12 commands exit 0, vitest 966/966, coverage 100.00 %, electron-smoke 50/50); tasks/check.py baseline 7 problems
- 2026-10-23 T01 done: theme.ts + theme:get/theme:set + AppState.theme + nativeTheme at start/set + sidebar radiogroup; AC2 exit 0, fast tier 12 commands exit 0, vitest 974/974, coverage 100.00 %, contrast 0 findings, electron-smoke 51/51, reverse control red (NOTES.md)
- 2026-10-23 coordinator: T01 verified (`bash .claude/scratch/gates.sh` exit 0: fast tier 12 commands exit 0, vitest 974/974, coverage 100.00 %, build exit 0, electron-smoke 51/51 — this run; diff reviewed); AC1-AC3 met
- 2026-10-23 coordinator: T02 done: docs/PROJECT.md Themes row (switch inside the app), NOTES summary, labels status:review; tasks/check.py 7 problems (baseline 7); paused on AC4 (owner)
