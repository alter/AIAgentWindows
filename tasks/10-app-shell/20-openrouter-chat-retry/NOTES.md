# NOTES 20-openrouter-chat-retry

## T01 evidence

Red first (tests written before the code, 2026-10-23 23:12):
`npx vitest run tests/unit/openrouter-chat.test.ts tests/unit/openrouter-room.test.ts tests/unit/ipc-validate.test.ts tests/integration/openrouter-chat.test.ts tests/integration/openrouter-room.test.ts`
exit 1, `Tests 23 failed | 119 passed (142)`. Failing: dismissFailed/retryTarget/rateLimitText not defined, `chats.retry`/`chats.dismiss` not functions, `INVOKE_CHANNELS.openrouterChatRetry` undefined (`openrouter chat retry rejects a malformed request`), the 429 integration tests for chat and Room.

Smoke red for S1: with the constructor call `setNotice(this.notice, '')` removed, the spec
`a failed reply is retried with the new model and the error text is shown as text` fails at the first notice check: `Expected: 0 / Received: 16` (the empty yellow bar is 16 px high).

Reverse control (retry appends the owner's message again; `[...dismissFailed(entries), userEntry(entries[index].text, 0)]` in `OpenRouterChats.retry`):
`npx vitest run tests/integration/openrouter-chat.test.ts tests/unit/openrouter-chat.test.ts` exit 1, `Tests 4 failed | 58 passed (62)`:
- integration `retry sends the stored conversation once with the new model and keeps one copy of the message`: `expected [ { role: 'user', …(1) }, …(1) ] to deeply equal [ { role: 'user', …(1) } ]` (two copies in the request)
- integration `retry of a message after a failed reply that follows an answered one resends only that message`: `expected [ 'First', …(3) ] to deeply equal [ 'First', …(2) ]`
- unit `retry sends the existing message once, drops the failed reply and keeps one copy of the message`: `expected [ …(4) ] to deeply equal [ …(3) ]`
- unit `retry answers a message that has no reply at all`: `expected [ 'lonely', 'lonely', 'ok' ] to deeply equal [ 'lonely', 'ok' ]`
Restored (byte-identical copy compared with `cmp`), the same tests green.

## Decisions made alone
- `setNotice(node, text)` (text + `hidden`) lives in `src/renderer/openrouter-account.ts` and is used by the sidebar block and the chat pane: one owner of "empty notice takes no space"; `dom.ts` is outside the write set. The obsolete `.or-notice:empty` rule is removed; `.or-notice[hidden]` is display:none.
- The 429 text is `rateLimitText` in `src/shared/openrouter-chat.ts` (pure, covered by the 100 % gate); `failedStatus`/`readAnswer` in `chat.ts` take the `X-RateLimit-Reset` value (epoch ms) and serve both the chat stream and the Room driver.
- The settings IPC handler (`ipc-handlers.ts`) calls `OpenRouterChats.dismiss(id)` after the settings were saved; `dismiss` takes the same per-agent lock as a send, so it cannot overwrite a running reply.
- The fake server gained two free models, `acme/provider-limited:free` (429 with `provider_name`) and `acme/account-limited:free` (429 with `X-RateLimit-*`), answered when the script gives no answer; `tests/integration/openrouter-signin.test.ts` counts them in the model list.
- The Retry button reuses `.room-button`; its focus ring is `--text` (the global `--focus` is a same-hue blue on the owner's message fill); one new pair `--border` on `--info-bg` (disabled outline) is in `contrast-pairs.json`.

## 2026-10-23 Summary

- Empty notice hidden (`setNotice`, pane and sidebar block); a settings change dismisses a trailing failed reply (file and screen); Retry icon on the last unanswered owner message resends it once with the current settings (`openrouter:chat-retry`, validated index); one `rateLimitText` for chat and Room: provider limit vs account cap with reset time, server message appended.
- Checks (coordinator, this run): fast tier 12 commands exit 0, vitest 1185/1185, coverage 100.00 %, electron-smoke 68/68; tasks/check.py 7 (baseline).
- Open: AC5 HUMAN — hit a rate limit, switch model, Retry.
