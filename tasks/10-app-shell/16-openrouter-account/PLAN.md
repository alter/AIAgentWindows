---
status: paused
created: 2026-10-23
---
# OpenRouter account — sign in, key store, models

## Goal
Owner, 2026-10-23: "нужно OpenRouter подключать уметь, как платные модели, так и бесплатные ... выбрать самый короткий путь(самый быстрый и удобный вариант)"; answer: Room + separate chat. This task is the shared base.

## Acceptance criteria
- [x] AC1 Fast tier green: every command of docs/PROJECT.md §6 fast tier exits 0
- [x] AC2 Rules: `npx vitest run tests/unit/openrouter.test.ts` exit 0 — model parse, free rule (:free suffix or zero price, openrouter/free), filter/sort, key-info parse, pasted key rules; seen red first
- [x] AC3 Sign-in: `npx vitest run tests/integration/openrouter-signin.test.ts` exit 0 against a local fake server — S256 challenge of the verifier, wrong state refused with no key stored, expired/invalid code refused, callback page echoes nothing, key stored as safeStorage ciphertext only, 401 clears it; reverse control (state check skipped) red, output in NOTES.md
- [x] AC4 Smoke: electron-smoke exit 0 — `tests/full/openrouter-account.spec.ts`: Connect against the fake server (openExternal replaced in test mode), the block shows connected with free requests left, the renderer never receives the key (no IPC result or event carries it), Disconnect; a model name with markup shows as text — windows hidden
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
- T01: the ciphertext sits in agents.json as `openrouterKey` (base64, validated on load), as task.txt says "app state"; test mode (D3) also replaces the secret box with an in-process AES-GCM one, so smoke never touches the owner's Keychain; safeStorage is first used when a key is stored or read, not at every start; a pasted key is checked with GET /key before it is stored; Linux `basic_text` counts as safeStorage unavailable.
- Attribution headers: HTTP-Referer http://localhost and X-OpenRouter-Title "AI Agent Windows", X-OpenRouter-App-Visibility hidden (study: Attribution).
- safeStorage unavailable → the key is not stored and the block says so; nothing is written in clear text.
- The model list is fetched once per app run and on demand (Refresh), not on a timer.

## Out of scope
- Room participants (17), chat agent (18), buying credits

## Tasks
- [x] T00 Baseline: the coordinator's last verified run before T01 — verify: the Log line exists
- [x] T01 Account (S1–S6): shared rules red first; client, loopback sign-in, key store, models, key info in src/main/openrouter/; IPC; sidebar block; fake server fixture; integration and smoke tests with reverse control — verify: AC2, AC3 + fast tier + electron-smoke
- [x] T02 Ledger and notes: docs/PROJECT.md OpenRouter row (account built); NOTES.md; labels status:review — verify: tasks/check.py no new problem + fast tier

## Log
- 2026-10-23 coordinator: T00 baseline = verification run on 7c99ed1 (19-room-delete): fast tier 12 commands exit 0, vitest 1008/1008, coverage 100.00 %, electron-smoke 59/59; tasks/check.py baseline 7 problems
- 2026-10-23 T01 done: src/main/openrouter/ (pkce, loopback, client, key-store, secret-box, models, service, test-mode), shared rules, IPC, sidebar block, fake server fixture; vitest 1063/1063, coverage 100.00 %, fast tier 12/12 exit 0, build ok, electron-smoke 61/61, reverse controls red (state check, echo, plaintext key) in NOTES.md
- 2026-10-23 coordinator: T01 verified (security review of src/main/openrouter: key only in main, ciphertext only on disk, base URL override only with AIAW_USER_DATA and a loopback origin, constant-time state, static callback page, redirect: error; fast tier 12 exit 0, vitest 1063/1063, coverage 100.00 %, electron-smoke 61/61) — this run. tasks/check.py had risen to 17: the test-mode line in docs/tech/electron@44.6.0.md was a list item without a URL; rewritten as a project observation, back to 7
- 2026-10-23 T02 done: OpenRouter ledger row (account built, unverified real-service paths named), NOTES summary, labels status:review; paused on AC5 HUMAN
