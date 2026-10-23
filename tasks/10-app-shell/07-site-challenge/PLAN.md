---
status: running
created: 2026-10-23
---
# Site challenge — Cloudflare Turnstile passes for the owner's own click inside a site view

## Goal
The owner's own click on the Turnstile box on grok.com passes inside the app. Owner, 2026-10-23: "я не могу в grok залогиниться, потому что cloudflare проверка фейлится ... ищи где проблема, что мы не передаем или наоборот передаем и фикси".

## Acceptance criteria
- [ ] AC1 Fast tier green: every command of docs/PROJECT.md §6 fast tier exits 0
- [ ] AC2 Unit: `npx vitest run tests/unit/site-user-agent.test.ts tests/unit/site-policy.test.ts` exit 0 — the override and runIfWaitingForDebugger go with the child sessionId to every iframe target, auto-attach is repeated in each child; reverse control: the per-target override dropped turns `override reaches every attached frame target` red (output in NOTES.md)
- [ ] AC3 Smoke: electron-smoke exit 0 including tests/full/site-ua-frames.spec.ts — a localhost page with a 127.0.0.1 iframe in another renderer process (processId differs) reports in both frames the same navigator.userAgent without `Electron/`, the same userAgentData brands with Google Chrome, and the fixture server records the D1 User-Agent on a fetch from the iframe; the spec was red on the pre-fix code (output in NOTES.md) — windows hidden
- [ ] AC4 HUMAN (excluded from /run): the owner, starting the app from a normal Terminal, passes the Turnstile check on grok.com and records it in NOTES.md

## Stack
Electron 44.6.0 (`webContents.debugger`, CDP 1.3 with flat sessions), Chromium 152.0.7977.130. No new dependency.

## Decisions
- D1 (tasks/DECISIONS.md) holds: owner UA and Google Chrome/Chromium 152 brands in every site view; this task extends the mechanism to frames in other processes.
- Priority P0 (owner cannot sign in to Grok); runs before 05-design-contrast T04.
- Only electron-smoke may start Electron (owner, 2026-10-23); no spike, no harness, no `npm start`.
- Branch: `room`. Commit per task, never push.

## Assumptions
- Workers created by the page (dedicated, shared, service) are attached too when CDP reports them; Emulation is sent only where the target type accepts it (page, iframe); a command a target refuses is logged as `user-agent-override-failed` with the target type and does not stop the page (runIfWaitingForDebugger is always sent).
- The permission rules stay unchanged (H1 refuted).

## Out of scope
- Solving or automating any challenge or login
- Changing D1 (owner's decision)

## Tasks
- [x] T00 Baseline: the coordinator's run at 05-design-contrast T03 verification on 676615e (fast tier 12 commands exit 0, coverage 910/910 100 %, electron-smoke 35/35) — verify: the Log line exists
- [x] T01 Diagnosis: spike under spikes/, root cause in NOTES.md, EVIDENCE W22 and W23 narrowed — verify: `python3 scripts/evidence_check.py` exit 0
- [ ] T02 Red smoke (S3): tests/fixtures/ua-frames/ (a page served on localhost embedding an iframe served on 127.0.0.1, both from one fixture server started by the spec, which records request User-Agent headers) and tests/full/site-ua-frames.spec.ts opening the fixture in a site view through the existing AIAW_SITE_URL_<KIND> override; asserts the two frames run in different processes, then equal UA/brands/fetch header per AC3; red on today's code with the output in NOTES.md; the spec is committed red-marked only in NOTES (the suite stays green: commit the spec together with T03 if the gate would otherwise fail) — verify: the red output in NOTES.md
- [ ] T03 Fix (S2): src/main/site-user-agent.ts — auto-attach with flatten and waitForDebuggerOnStart, per-target override with sessionId, nested auto-attach, runIfWaitingForDebugger, detach handling; popups unchanged; unit tests red first in tests/unit/site-user-agent.test.ts with a fake debugger; AC2's reverse control; electron@44.6.0.md section "OOPIF user agent" with URLs; DECISIONS D1 mechanism sentence extended — verify: AC2 command + fast tier + electron-smoke
- [ ] T04 Close: NOTES summary, labels status:review when AC1-AC3 are [x] — verify: `python3 tasks/check.py` shows no new problem

## Log
- 2026-10-23 coordinator: T00 baseline = 05-design-contrast T03 verification run on 676615e (fast tier 12 commands exit 0, coverage 910/910 100 %, electron-smoke 35/35)
- 2026-10-23 coordinator: T01 done — spike (n=1 per variant) A/B/C fail, D passes; root cause: D1's UA override does not reach the out-of-process Turnstile frame (NOTES.md); H1 and H3 refuted; EVIDENCE W22/W23 narrowed; evidence_check 154 rows 0 problems
