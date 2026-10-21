# Decisions

Cross-cutting decisions that belong to no single task. Recorded so they stop
being re-argued, and so that revisiting one is a deliberate act with a reason
rather than a drift.

Every entry: what was decided, when, why, and what was rejected. Where a number
appears it carries its source. Markers: **[already in the project]** — built,
decided earlier; **[proposed]** — waiting for the owner; ~~struck through~~ —
cancelled, with a date and a reason.

---

## D1. User agent of the embedded chat views — 2026-10-21, decided by the owner

**Decided.** The DeepSeek view sends the Chromium user agent without the
`Electron/44.6.0` token. ChatGPT and Grok keep the default until a site
objects. The owner asked to remove the "Abnormal usage environment" dialog
either at its cause or by clicking it away; the cause was chosen.

**Why.** With the default user agent chat.deepseek.com shows "Abnormal usage
environment … we recommend using our official product"; without the token it
shows its normal sign-in form (`docs/EVIDENCE.md` W3, W4). One line in the main
process, no code running inside DeepSeek's page.

**Rejected.** Clicking the dialog away automatically: it would run adapter code
on DeepSeek's page on every load, against the ledger rule "only on a user
action, never in a loop"; it is tied to the dialog's markup; and a blind click
on a site's warning could one day dismiss a different warning the user should
read. Spoofing the client-hint brands too: the page still sees `Chromium`
without `Google Chrome` in `navigator.userAgentData` (W15), but DeepSeek does
not act on it today; revisit with the owner if it starts to.

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
