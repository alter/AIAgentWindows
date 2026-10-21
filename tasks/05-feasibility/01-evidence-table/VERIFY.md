# VERIFY — evidence table, third verification (2026-10-21, commit ed50da7)

Verifier: a separate Claude context (third verifier; "verify 1" = report for `d342c6a`, "verify 2" = report for `4951a41`, the latter overwritten here); did NOT write `docs/EVIDENCE.md`, `scripts/evidence_check.py`, `tests/scripts/test_evidence_check.py`, the spikes or the `docs/tech/*.md` studies; ran VERIFY items 1-3 in a fresh clone (`.claude/scratch/verify3` at `ed50da7`, under `env -i`), ran three mutations there, re-fetched the pinned sources of the rows below with `curl`, read the spike artefacts and the owner's records. Sent no prompt to any site or CLI, did not touch the system clipboard, did not launch Electron, did not open the owner's profiles under `.claude/scratch/spike/ud-signin`.

## Per-item verdict

| # | Item | Result |
|---|---|---|
| 1 | `python3 scripts/evidence_check.py` exits 0 | pass (exit 0, `evidence_check: 84 rows, 0 problems`) |
| 2 | `python3 -m unittest discover -s tests/scripts` exits 0 | pass (exit 0, `Ran 12 tests`, OK) |
| 3 | reverse control: empty an evidence cell | pass (three reds, below) |
| 4 | every run row points at an artefact that opens and shows the claimed result | FAIL for one row: W16 claims "open WebRTC connections to STUN servers"; the artefact shows only failed name resolution (see Unsupported) |
| 5 | every refuted claim has changed `docs/PROJECT.md` | pass (8 refuted rows, see V5) |
| 6 | HUMAN: owner signs in to ChatGPT, Grok, DeepSeek | pass as a record: the owner's evidence is sufficient (see V6); I did not redo it |

## Requirement evidence

- S1: `docs/EVIDENCE.md` — 84 rows; `python3 scripts/evidence_check.py` exit 0 (fresh clone). Existence pass; see Unsupported for what the rows and sentences claim beyond their artefacts.
- S2: `scripts/evidence_check.py` (`check_row`, read in full in the clone) and `tests/scripts/test_evidence_check.py:41-58`; `python3 -m unittest discover -s tests/scripts` exit 0, 12 tests. Pass. The checker proves that an artefact path exists, not that it shows the claim (known limit, `check_row` run branch).
- S3: `ls spikes` (53 entries, `ls spikes | wc -l`, exit 0); new since verify 2: `signin.js`, `nav-smoke.js/.out`, `ua-probe.js`, `ua-client-hints.txt`, `owner-signin-log.txt`, `owner-restart-check.txt`. Pass for existence; nothing needing Electron or a site was rerun (instruction).
- S4: ten `docs/tech/*.md` files (`ls docs/tech`); pins judged by verify 1/2 (`npm view … time`), not redone. `docs/tech/node-pty@1.1.0.md:5` now reads "darwin-arm64 prebuild loaded … (win32 not run, EVIDENCE P4 open)" — U1 fixed. Pass.
- S5: `docs/PROJECT.md:29-47` (§3) holds scope plus row ids; mechanics in `docs/tech/`. Pass except the one sentence in U-new-2.
- V1: `python3 scripts/evidence_check.py` exit 0.
- V2: `python3 -m unittest discover -s tests/scripts` exit 0.
- V3: `python3 scripts/evidence_check.py` exit 1 with CC4's cell emptied; unit test exit 1 with the guard removed; exit 1 with W17's artefact path broken.
- V4: `docs/EVIDENCE.md` W16 row (`spikes/owner-signin-log.txt:5-8`) fails; all other judged rows below hold; `python3 scripts/evidence_check.py` exit 0 confirms every artefact path exists.
- V5: `grep -n -i "isSidechain\|clipboard type\|poolOptions" docs/PROJECT.md` → only the explanatory `poolOptions was removed` at :149; `docs/PROJECT.md:31` CC13/CC17, `:33` CX10 "failed … open until CX11", `:34` Codex `/voice` (CX12; `slash_command.rs:135` `Voice => "start or stop voice…"` re-read), `:36` W3/W6 (DeepSeek refuses default UA, no challenge shown), `:15` TypeScript 6.0.3 (G4), `:149` `--maxWorkers` (G6; `vitest@5.0.3 cli-generated.md:461-466` lists `--maxWorkers`). CC9 (subagents not in the session file): `spikes/claude-subagent-files.txt` shows `isSidechain` values `{None: 632, False: 609}`, 3 files under `subagents/`; no sentence in PROJECT claims the filter. F3: no "check clipboard type" rule remains. Pass.
- V6: HUMAN; judged as a record only (`NOTES.md:60-70`, `spikes/owner-signin-log.txt:1-2`, `spikes/owner-restart-check.txt:1-2`; `grep -n 'owner' NOTES.md` exit 0). `NOTES.md` "owner's sign-in check, second run" and "owner's restart check" state per site: signed in by hand (non-Google) on ChatGPT, Grok, DeepSeek; Google refused (partial section, W7); after Cmd+Q all three answered a prompt; `spikes/owner-signin-log.txt` and `spikes/owner-restart-check.txt` hold the pasted output and cookie names (not values). The item asks the owner to record "whether each accepted the sign-in": that is recorded, per site, in `NOTES.md`. Sufficient. Residual: the record is the owner's report pasted by the session; nothing in the logs shows the account state on screen (see "not checked").
- D1: `tasks/DECISIONS.md:9-33` "decided by the owner", DeepSeek view drops the `Electron/…` token, ChatGPT/Grok keep default; `docs/PROJECT.md:36` says the same and cites W15; `spikes/signin.js:6,38` implements it (`PLAIN_UA` default, only for `name === 'deepseek'`). Pass.
- D2: `tasks/DECISIONS.md` D2 and `docs/PROJECT.md:15` agree (TypeScript 6.0.3; `warnAboutTSVersion.ts:11` checked by verify 1). Pass.
- D3: `tasks/DECISIONS.md` D3; `spikes/frame-headers.txt` (checked by verify 2 with `curl -I`). Pass.

## Re-judged: U1-U4, V2 (verify 2) and minor items

- U1 (node-pty win32 loaded): fixed, `docs/tech/node-pty@1.1.0.md:5` says win32 not run, P4 open. PASS.
- U2 (`publish: never` in config): fixed. I read `PublishManager.ts` at tag `electron-builder@26.17.0` (curl), lines 85-104: with `publishOptions.publish === undefined`, `npm_lifecycle_event === "release"` → `"always"`, else CI git tag → `"onTag"`, else `isCI` → `"onTagOrDraft"`; `isPublish` is false when the policy is `"never"`; the warnings say "disabled in electron-builder v27". `builder.ts:271-276`: `option("publish", alias: "p", choices: [onTag, onTagOrDraft, always, never])`. `docs/PROJECT.md:91` ("every command carries `--publish never`, no npm script named `release`"), `docs/tech/electron-builder@26.17.0.md:4`, EVIDENCE G10 and G12 all agree with the source. The statement that `git-guard` would not see a flag inside an npm script is a design remark about prefix matching (verify 2 ran git-guard on the eight prefixes). PASS. (The pull-request branch of that code, `isPullRequest()`, is not mentioned in G10; it only suppresses publishing.)
- U3 (rows missing): F7 (`Alt+V`), F8 (open, HUMAN), V7 (open, HUMAN) exist. F7: `code.claude.com/docs/en/interactive-mode` fetched: "`Ctrl+V` or `Cmd+V` (iTerm2) or `Alt+V` (Windows and WSL) — Paste image from clipboard". PASS.
- U4 ("chat" without a prompt): `docs/PROJECT.md:36` now says "load with a chat input and no challenge (W1, W2, W6; no prompt was sent)". PASS.
- U5/V2 (Apple forum): now an open assumption with place HUMAN (`docs/EVIDENCE.md` V2); `docs/PROJECT.md:34` says "attribution to the app is V2, open". PASS.
- Minor: `docs/tech/claude-code@2.1.306.md` now cites `{S}/claude-subagent-files.txt` for `isSidechain`; `chat-sites@2026-10-21.md` lists the terms pages and the observations separately; `electron@44.6.0.md` no longer cites `sandbox.md` for `UnknownVizError` (`grep` finds none). PASS. Still open from verify 2: `electron@44.6.0` tech note's G7 range remark and P2's "every spawn fails" (below).

## Rows added since 4951a41

- F7: PASS (above). F8, V7: assumptions, place named (HUMAN), open; checker enforces it. PASS (nothing to prove).
- W8 (run, confirmed): `spikes/owner-signin-log.txt` header: owner's report of sign-in on three sites by a non-Google method; `NOTES.md` partial section: Google refused. PASS as the owner's record. Wording: "in the app's views" — the views are the spike's `BrowserWindow`s (`signin.js`), the app does not exist yet; minor.
- W15 (run, confirmed): `spikes/ua-client-hints.txt` (script `ua-probe.js`): token removed, brands `Not?A_Brand`, `Chromium` 152, no `Google Chrome`; `webdriver: false`; `electronGlobals: []` (probe tests only `process`, `require`, `module`). The page probed is `example.com`, not DeepSeek; the row does not say DeepSeek. PASS.
- W16 (run, confirmed): half supported. `owner-signin-log.txt` shows `geolocation` and `persistent-storage` requested by `chatgpt.com` (denied by the spike's handler): PASS. "open WebRTC connections to STUN servers (Google, Cloudflare)": the log has 31 lines `Failed to resolve address for stun.l.google.com … errorcode: -105` from the run inside the Claude Code sandbox, and none in the second run (`owner-restart-check.txt`); a failed lookup is an attempt, not an open connection, and the log does not say the pages were signed in. FAIL as worded (U-new-1).
- W17 (run, confirmed): `spikes/owner-restart-check.txt`: after Cmd+Q all three answered a prompt; cookie names on disk: ChatGPT `__Secure-next-auth.session-token.0/.1`, Grok `sso`, DeepSeek only `aws-waf-token` (session location not checked, stated in the file). ChatGPT and Grok answer a prompt logged out too, so "answered a prompt" alone does not prove sign-in; the session cookies do, for those two. DeepSeek rests on W5 (redirects to `/sign_in` logged out; `web-report.json`). PASS as the owner's record with that inference stated; the row's "still signed in" is the owner's observation, not something an artefact displays.
- G10, G12: PASS (above).

## Fresh sample of 10 other rows (python3 `random.seed(20261022)`, `random.sample` of the 75 rows not named above)

CC1, CC16, CC7, CC8, CX13, CX15, CX6, F4, G6, W1.

- CC1: `claude-run.out` line 1 "electron 44.6.0 … node-pty loaded", `[16.4s] pty exit 0`. PASS.
- CC16, CX6, CX15: assumptions, place named (HUMAN / T00 test / task after T00), open. PASS.
- CC7: `claude-directory` page fetched: "If you set `CLAUDE_CONFIG_DIR`, every `~/.claude` path on this page lives under that directory instead". PASS.
- CC8: the real session file of the spike (`~/.claude/projects/-private-tmp-spike-cwd-2uJCQ6/7d58de11-….jsonl`) parsed with `python3 -I`: record sequence `user(str)` → `assistant[thinking]` → `assistant[text]`; matches the row and `transcripts-last-reply.txt` (`last reply: 'OK'`). PASS.
- CX13: `shared_options.rs` rust-v0.159.2 lines 52-58: `long = "dangerously-bypass-approvals-and-sandbox", alias = "yolo"`, "Skip all confirmation prompts and execute commands without sandboxing". PASS.
- F4: `spikes/electron-clipboard-api.txt` typings list `clear, has, read, readText, write, writeText` (and Linux `selection`); runtime probe `clear,has,readText,writeText,read,write`; no `readImage`/`writeImage`/`availableFormats`. PASS.
- G6 (refuted): `resolveConfig.ts` v5.0.3 lines 266-268: "`test.poolOptions` was removed in Vitest 4. All previous `poolOptions` are now top-level options". PASS as refuted.
- W1: `web-report.json` chatgpt `input: true`, `challengeScriptInHtml: false`, `challengeShown: false`; `web-chatgpt.png` read: "Where should we begin?" input "Ask ChatGPT", Log in button. PASS.

## Unsupported (sentences that claim more than their row shows)

- U-new-1: `docs/EVIDENCE.md` W16 "open WebRTC connections to STUN servers (Google, Cloudflare)" and "Signed-in pages": the artefact shows failed DNS resolution of STUN hosts (`owner-signin-log.txt`, 31 lines, sandboxed run), no connection, no sign-in state per page. Reword to "tried to resolve STUN hosts".
- U-new-2: `docs/PROJECT.md:36` "because a refused sign-in (Google, W7) otherwise strands the user on a foreign page — found in the owner's sign-in check": `NOTES.md` partial section records only Google's refusal message and the harness-sandbox line, no stranded page; commit `dc13631` carries no description. `spikes/nav-smoke.out` shows Back and Home work on one view (Forward and Reload are not exercised). The requirement is reasonable; the "found in the owner's check" provenance has no record.
- Minor (kept, not failing): EVIDENCE P2 "every spawn fails until it is set" — `node-pty-spawn-helper.txt` shows one failing spawn, no artefact shows the `chmod`; W8 "in the app's views" (spike windows); `docs/tech/playwright@1.63.0.md:4` and G7 cite `base.ts#L671-L675` for the `OUTPUT_NAME` half only (the `_OUTPUT_FILE` half is at 660-663, verify 2); CX4/CC10 judged by verify 2, not reread.

## How to reproduce

From an empty environment (clone path `.claude/scratch/verify3`):

```
git clone <repo> verify3 && cd verify3 && git checkout ed50da7
env -i PATH=/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin HOME=$HOME python3 scripts/evidence_check.py   # evidence_check: 84 rows, 0 problems
env -i ... python3 -m unittest discover -s tests/scripts                                                  # Ran 12 tests ... OK
env -i ... python3 tasks/check.py                                                                          # problems: 0
```

- COMMAND: `env -i PATH=… HOME=$HOME python3 scripts/evidence_check.py` (clone at `ed50da7`) exit 0, `evidence_check: 84 rows, 0 problems`
- COMMAND: `env -i PATH=… HOME=$HOME python3 -m unittest discover -s tests/scripts` exit 0, `Ran 12 tests in 0.007s`, OK
- COMMAND: `env -i PATH=… HOME=$HOME python3 tasks/check.py` exit 0, `problems: 0` (clone; again in the repository after writing this report)
- COMMAND: `gitleaks dir … spikes/` exit 0; `gitleaks git --log-opts="2393fe1..HEAD"` exit 0 (clone)

## Reverse control

All in the scratch clone, restored after (`git checkout` of the file; `git status --short` empty; final `evidence_check` exit 0, suite `Ran 12 tests … OK`).

A. CC4's evidence cell emptied in `docs/EVIDENCE.md`:
```
CC4: [no-evidence] no evidence
evidence_check: 84 rows, 1 problems        COMMAND: python3 scripts/evidence_check.py -> exit 1
```
B. The `no-evidence` guard removed in `scripts/evidence_check.py` (`return problems + [...]` → `return problems`):
```
AssertionError: 'no-evidence' not found in set()
Ran 1 test … FAILED (failures=1)           COMMAND: python3 -m unittest tests.scripts.test_evidence_check.EvidenceCheckTest.test_row_without_evidence_fails -> exit 1
whole suite: Ran 12 tests … FAILED (failures=1)
```
C. W17's artefact path pointed at a file that does not exist:
```
W17: [run-artefact] artefact tasks/05-feasibility/01-evidence-table/spikes/owner-restart-check.MISSING.txt does not exist
evidence_check: 84 rows, 1 problems        COMMAND: python3 scripts/evidence_check.py -> exit 1
```
Note: A and C show the real table is checked; B shows the unit test is sensitive to the guard. The unit test uses its own fixture. The checker cannot go red on a row whose artefact exists but does not show the claim (W16 is such a case).

## What was not checked

- Windows 11 and Ubuntu 26.04 rows (CC16, P4, P6, V5, CX11, F6, F8, V7): open assumptions, not checkable on macOS.
- Item 6 was not redone: whether the owner really signed in, and the account state after the restart (no screenshot in the record); I did not open the owner's profiles or the cookie database, so the cookie names in `owner-restart-check.txt` are the owner-side session's report. DeepSeek's session storage was not checked (the file says so).
- No spike needing Electron, `claude`, `codex` or a site was rerun, so every `run` artefact for CC1-CC3, CC11, CC13, CX1, CX2, CX9, CX10, F2, F3, F4, W1-W6, W10, W15 was judged by reading; the site behaviour is one run on 2026-10-21. `nav-smoke.out` and `ua-client-hints.txt` were read, not regenerated.
- Rows I did not re-open at source this round (verify 1/2 judged them): CC4, CC5, CC10, CC12-CC15, CX4, CX7, CX14, F1, F5, V1, V3, V4, W7, W9, W11-W14, K1, P1, P3, P5, G4, G5, G7, G8, CX3, CX8, CX16, G9, G1, G2, CC17, CC13, CX2, W3-W6 — not re-judged in this round beyond what is stated above.
- D1's claim that DeepSeek "does not act" on client hints today is inferred from W4 and W15, not tested on DeepSeek.
- NOTES.md side effects on the owner's machine (a Haiku prompt, trust entries in `~/.claude.json` and `~/.codex/config.toml`, clipboard replaced and restored) were not checked.
- `python3 tasks/scope_check.py` not run; WRITE-SET compared by hand: `git diff --stat 4951a41 HEAD` touches only `docs/EVIDENCE.md`, `docs/PROJECT.md`, `docs/tech/`, `tasks/DECISIONS.md` and the task directory (all in WRITE-SET).
- No `[full]` item exists in `task.txt`; no `FULLRUN-*.md` next to the task.

## Verdict

verify:failed for tasks/05-feasibility/01-evidence-table — items 1-3 and 5 reproduce, U1-U4, V2 and the minor items are fixed, the nine new rows hold except W16, and item 6 is sufficiently recorded; but W16 claims WebRTC connections to STUN servers where the artefact shows only failed name lookups, and `docs/PROJECT.md:36` attributes the Back/Forward/Home/Reload requirement to an observation ("found in the owner's sign-in check") that no record contains.
