# NOTES — 16-openrouter-account

## T01 Account

Design from docs/tech/openrouter@2026-10-23.md only. Modules: `src/shared/openrouter.ts` (pure rules), `src/main/openrouter/` (`pkce`, `loopback`, `client`, `key-store`, `secret-box`, `models`, `service`, `test-mode`), `src/renderer/openrouter-account.ts` (the sidebar block). Ciphertext lives in `agents.json` as `openrouterKey` (base64, validated on load). IPC: `openrouter:status|connect|paste|cancel|disconnect|refresh|models`, event `openrouter:changed`; the renderer sees `{state, mode, notice, info}` and the model list, never the key.

### Red first
- `tests/unit/openrouter.test.ts`: written before `src/shared/openrouter.ts` existed; first run red (module not found), then green 15/15:
```
1| // openrouter.test.ts
      2| import { describe, expect, it } from 'vitest';
      3| import {
       | ^
      4|   MAX_KEY_CHARS,
      5|   attributionHeaders,

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  no tests
   Start at  19:54:22
   Duration  106ms (worker 97%, environment 3%)
```
- `tests/integration/openrouter-signin.test.ts` was written after the modules. First run: 1 of 35 red (a real bug: after a failed browser open the status stayed `signing-in`; the epoch was bumped before it was compared). Fixed, green 35/35. The negative checks below prove the tests can fail.

### Reverse control (state check skipped)
`!statesMatch(options.state, parsed.state)` removed from `src/main/openrouter/loopback.ts`; restored afterwards (green 35/35).
```
REVERSE CONTROL 1: state check skipped in src/main/openrouter/loopback.ts (statesMatch call removed)

 RUN  v5.0.3 /Users/user/workflow/git/AIAgentWindows

 ❯ |integration| tests/integration/openrouter-signin.test.ts (35 tests | 1 failed) 250ms
   ❯ PKCE sign-in against the fake server (15)
     × a callback with a wrong state is refused and no key is stored 19ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |integration| tests/integration/openrouter-signin.test.ts > PKCE sign-in against the fake server > a callback with a wrong state is refused and no key is stored
AssertionError: expected 200 to be 400 // Object.is equality

- Expected
+ Received

- 400
+ 200

 ❯ tests/integration/openrouter-signin.test.ts:184:28
    182|     const code = fake.issueCode(fake.auth[0]?.challenge ?? '');
    183|     const refused = await fake.hitCallback(callbackBase(), `?code=${co…
    184|     expect(refused.status).toBe(400);
       |                            ^
    185|     const missing = await fake.hitCallback(callbackBase(), `?code=${co…
    186|     expect(missing.status).toBe(400);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 34 passed (35)
   Start at  19:59:10
   Duration  504ms (tests 58%, transform 31%, import 11%, worker 1%)

REVERSE CONTROL 1b (after the wait fix): state check skipped
     × a callback with a wrong state is refused and no key is stored 9ms
     × a wrong state sent by the browser leaves the user signed out of a stored key 7ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
      Tests  2 failed | 33 passed (35)
```
First attempt of this control left `a wrong state sent by the browser…` green because it asserted straight after `connect` (before the exchange ran); the test now waits (`Promise.race` with `settled()` and 150 ms) and the control turns both tests red.

### Further reverse controls
- Refused page echoes the request URL (`reply(..., REFUSED_PAGE + decodeURIComponent(request.url))`):
```
REVERSE CONTROL 2: refused page echoes the request url
     × the callback page echoes nothing from the request 8ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 34 passed (35)
```
- Key written to the state file as plain base64 instead of safeStorage ciphertext (first run was green for the main test because the assertion only looked for the literal key; the test now decodes the stored base64 first):
```
REVERSE CONTROL 3: key written to the state file as plain base64
     × a stored key survives a restart: a new service reads the ciphertext and shows connected 11ms
     × a 401 at start-up clears the stored key too 4ms
     × re-encrypts a key that the platform asks to re-encrypt 4ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
      Tests  3 failed | 32 passed (35)
REVERSE CONTROL 3b: key written to the state file as plain base64, decoded check
     × sends the S256 challenge of the verifier and a 43 character state, exchanges the code and keeps only ciphertext 33ms
     × a stored key survives a restart: a new service reads the ciphertext and shows connected 7ms
     × a 401 at start-up clears the stored key too 4ms
     × re-encrypts a key that the platform asks to re-encrypt 3ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯
      Tests  4 failed | 31 passed (35)
```
- Not reverse-checked: the smoke test `a model name with markup is shown as text` (textContent to innerHTML) — one smoke run is allowed per verification, so it was not broken on purpose; the block builds every server string with `textContent` (`el(tag, class, text)`), nothing in `src/renderer/openrouter-account.ts` uses `innerHTML`.

### Security properties and where they are tested
- Key only in the main process, encrypted: `openrouter-signin.test.ts` (state file holds no key, decoded ciphertext holds no key, no status event holds it), smoke (renderer: every IPC result, every event, the DOM and `Object.keys(window)` contain neither the key nor `FAKE`; `agents.json` has no key).
- safeStorage unavailable: nothing stored, no request made, notice `storage-unavailable` (integration). The Linux `basic_text` backend counts as unavailable (`secret-box.ts`, not run here: no Linux machine).
- Loopback: `127.0.0.1` port 0 only; one GET `/callback` with 43-char state (constant-time compare, `timingSafeEqual`) and a code of 1..512 chars; Host must be `localhost:<port>` or `127.0.0.1:<port>`; closes after the first valid callback, on Cancel, or after 10 minutes; a fixed static page with `no-store`, `no-referrer`, `nosniff`, `default-src 'none'`; every other request gets a fixed 400 page.
- Test mode (D3): base URL, opener and secret box are replaced only when `AIAW_USER_DATA` is set and `AIAW_OPENROUTER_BASE` is exactly `http://127.0.0.1:<port>` or `http://localhost:<port>` (`openrouterBase`, unit-tested with hostile values). Nothing reaches openrouter.ai.

### Unverified paths (study) — kept unverified until AC5
Nothing in this task ran against the real OpenRouter. These stay open for the owner's one real sign-in (AC5):
- the exchange success path `POST /api/v1/auth/keys` (`{ key, user_id }`) and the real status of its failures (400 vs 403 are treated alike as "start again");
- `GET /api/v1/key` with a real key (`free_model_daily_requests`, `is_free_tier`);
- whether OpenRouter accepts `callback_url=http://localhost:<port>/callback` with an arbitrary port for this app (documented for `localhost`), and the base64url challenge without padding;
- whether a browser reaches a `127.0.0.1`-only listener through `localhost` (IPv6 first, then fallback);
- the macOS Keychain behaviour of `safeStorage` for the unsigned app (first use may prompt); test mode deliberately does not touch Keychain.

### Checks (T01)
vitest 1063/1063 (baseline 1008, +55: 15 unit openrouter, 35 integration, 1 state, 4 ipc), coverage gate 100.00 %, the other 11 fast-tier commands exit 0, `npm run -s build` exit 0, electron-smoke 61/61 (baseline 59, +2). One smoke run failed on first try: my own assertion on the order of the model list (`<` sorts before letters); fixed to compare a sorted set, then the whole smoke ran once more green.

## 2026-10-23 Summary

- src/main/openrouter/: pkce (S256, 32 random bytes for verifier and state, timingSafeEqual), loopback (127.0.0.1 port 0, GET /callback only, Host checked, one valid callback then close, 10 min, static no-echo page with CSP default-src 'none'), client (fetch, redirect: error, 20 s timeout, size caps, attribution headers), key-store + secret-box (safeStorage async API; Linux basic_text counts as unavailable), models (cache per app run), service (connect by browser or by pasted code, paste key checked with GET /key, Disconnect, 401 clears), test-mode (fake opener, in-process AES-GCM box).
- src/shared/openrouter.ts: model parse, free rule, filter/sort, key-info parse, pasted-key rules, test-mode gate (AIAW_USER_DATA and a loopback AIAW_OPENROUTER_BASE).
- Renderer: "OpenRouter" block at the bottom of the sidebar (src/renderer/openrouter-account.ts), status only — no IPC result or event carries the key.
- Checks (coordinator, this run): fast tier 12 commands exit 0, vitest 1063/1063, coverage 100.00 %, electron-smoke 61/61; tasks/check.py 7 (baseline) after the doc fix.
- Residual risk: the callback URL says `localhost` while the server listens on 127.0.0.1 only; a browser that resolves localhost to ::1 first relies on its IPv4 fallback. Only the owner's real sign-in shows it (AC5), together with the code exchange and GET /key on the real service.
- Open: AC5 HUMAN.
