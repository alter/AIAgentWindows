---
status: todo
created: 2026-10-23
---
# OpenRouter account — sign in, key store, models

## Goal
Owner, 2026-10-23: "нужно OpenRouter подключать уметь, как платные модели, так и бесплатные ... выбрать самый короткий путь(самый быстрый и удобный вариант)"; answer: Room + separate chat. This task is the shared base.

## Acceptance criteria
- [ ] AC1 Fast tier green: every command of docs/PROJECT.md §6 fast tier exits 0
- [ ] AC2 Rules: `npx vitest run tests/unit/openrouter.test.ts` exit 0 — model parse, free rule (:free suffix or zero price, openrouter/free), filter/sort, key-info parse, pasted key rules; seen red first
- [ ] AC3 Sign-in: `npx vitest run tests/integration/openrouter-signin.test.ts` exit 0 against a local fake server — S256 challenge of the verifier, wrong state refused with no key stored, expired/invalid code refused, callback page echoes nothing, key stored as safeStorage ciphertext only, 401 clears it; reverse control (state check skipped) red, output in NOTES.md
- [ ] AC4 Smoke: electron-smoke exit 0 — `tests/full/openrouter-account.spec.ts`: Connect against the fake server (openExternal replaced in test mode), the block shows connected with free requests left, the renderer never receives the key (no IPC result or event carries it), Disconnect; a model name with markup shows as text — windows hidden
- [ ] AC5 HUMAN (excluded from /run): the owner connects a real account once; the unverified paths of the study (exchange success, GET /key) are recorded in NOTES.md

## Stack
As tasks/10-app-shell/06-room-layout/PLAN.md; OpenRouter per docs/tech/openrouter@2026-10-23.md (the API is unversioned: the dated study is the pinned reference, and DATA sources point at Wayback snapshots of the same pages dated 20261023). Node 22 fetch and http in the main process; no new dependency.

## Decisions
- D1 Sign-in: PKCE with a loopback callback on 127.0.0.1 port 0 announced as http://localhost:<port>/callback (localhost on any port is documented as allowed), plus a paste-key / paste-code fallback (owner: "самый короткий путь"; study, Implications).
- D2 The key lives in the main process only, encrypted with safeStorage; the renderer sees only "connected / signed out" and the key info numbers (agent's decision, AGENTS.md secrets rule).
- D3 Test mode only: base URL and openExternal are replaceable through the existing test-mode switch, so no test reaches openrouter.ai (AGENTS.md: tests never load a real site).
- D4 Place: an "OpenRouter" block at the bottom of the sidebar next to Theme (agent's decision).
- Branch: `room`. Commit per task, never push.

## Assumptions
- Attribution headers: HTTP-Referer http://localhost and X-OpenRouter-Title "AI Agent Windows", X-OpenRouter-App-Visibility hidden (study: Attribution).
- safeStorage unavailable → the key is not stored and the block says so; nothing is written in clear text.
- The model list is fetched once per app run and on demand (Refresh), not on a timer.

## Out of scope
- Room participants (17), chat agent (18), buying credits

## Tasks
- [ ] T00 Baseline: the coordinator's last verified run before T01 — verify: the Log line exists
- [ ] T01 Account (S1–S6): shared rules red first; client, loopback sign-in, key store, models, key info in src/main/openrouter/; IPC; sidebar block; fake server fixture; integration and smoke tests with reverse control — verify: AC2, AC3 + fast tier + electron-smoke
- [ ] T02 Ledger and notes: docs/PROJECT.md OpenRouter row (account built); NOTES.md; labels status:review — verify: tasks/check.py no new problem + fast tier

## Log
