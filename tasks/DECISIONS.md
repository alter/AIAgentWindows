# Decisions

Cross-cutting decisions that belong to no single task. Recorded so they stop
being re-argued, and so that revisiting one is a deliberate act with a reason
rather than a drift.

Every entry: what was decided, when, why, and what was rejected. Where a number
appears it carries its source. Markers: **[already in the project]** — built,
decided earlier; **[proposed]** — waiting for the owner; ~~struck through~~ —
cancelled, with a date and a reason.

---

## D1. User agent of the embedded chat views — 2026-10-21, decided by the owner; extended 2026-10-22

**Decided.** Every site view (ChatGPT, Grok, DeepSeek, and the popups they
open) presents the owner's user agent
`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML,
like Gecko) Chrome/152.0.0.0 Safari/537.36`, with matching client hints:
`navigator.userAgentData` reports `Not?A_Brand` 24, `Chromium` 152 and
`Google Chrome` 152, and the full version list carries the engine's real
152.0.7977.130 for both. The string is one constant (`OWNER_USER_AGENT` in
`src/shared/site-policy.ts`), later a setting.

History. 2026-10-21: only DeepSeek, the Chromium string without the
`Electron/44.6.0` token; ChatGPT and Grok kept the default. 2026-10-22
(owner, plan D8): all sites. The owner first named Chrome 155 and changed it
to 152 the same day to avoid a version mismatch with the engine (Chromium
152), so the claimed version matches the real feature set.

**Why.** With the default user agent chat.deepseek.com shows "Abnormal usage
environment … we recommend using our official product"; without the token it
shows its normal sign-in form (`docs/EVIDENCE.md` W3, W4). The client hints
were the remaining mismatch (W15), now removed (W22, W24). Mechanism: the
session string plus CDP `Emulation.setUserAgentOverride` with
`userAgentMetadata` through `webContents.debugger`, applied to every view and
to every popup (`docs/tech/electron@44.6.0.md`). No code runs inside the
sites' pages.

**Not done.** Header rewriting: Electron 44.6.0 sends no `Sec-CH-UA*` request
header at all (W23), so there is nothing to make consistent; injecting them
would add a signal Electron never produced. Revisit if a site objects.

**Rejected.** Clicking the dialog away automatically: it would run adapter code
on DeepSeek's page on every load, against the ledger rule "only on a user
action, never in a loop"; it is tied to the dialog's markup; and a blind click
on a site's warning could one day dismiss a different warning the user should
read.

## D2. TypeScript 6.0.3, not 7.0.2 — 2026-10-21 [already in the project]

**Decided.** The project pins TypeScript 6.0.3.

**Why.** TypeScript 7.0 ships no programmatic API and typescript-eslint 8.71.1
supports `>=4.8.4 <6.1.0` (`docs/tech/typescript@6.0.3.md`, EVIDENCE G4).

**Rejected.** 7.0.2 with eslint lint rules that need no types: the gate's
`npx eslint .` would lose type-aware rules for no gain.

## D3. Remote chat pages in `WebContentsView` — 2026-10-21 [already in the project]

**Decided.** ChatGPT, Grok and DeepSeek load in `WebContentsView`s owned by the
main process, without a preload.

**Why.** Electron 44 discourages the `<webview>` tag (EVIDENCE W11); adapters
run from the main process in an isolated world (W10), so no preload or IPC is
exposed to a remote page.

**Rejected.** `<webview>`: discouraged and puts the remote page under the
renderer's control. An iframe: chatgpt.com sends `X-Frame-Options: SAMEORIGIN` and grok.com `DENY` (`tasks/05-feasibility/01-evidence-table/spikes/frame-headers.txt`); chat.deepseek.com answered curl with 403, so its header is unknown.
