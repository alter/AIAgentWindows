# VERIFY — evidence table, second verification (2026-10-21, commit 4951a41)

Verifier: a separate Claude context (a second verifier; the first one's report, written for `d342c6a` and overwritten here, is called "verify 1" below); did NOT write `docs/EVIDENCE.md`, `scripts/evidence_check.py`, `tests/scripts/test_evidence_check.py`, the spikes or the `docs/tech/*.md` studies; ran VERIFY items 1-3 in a fresh clone (`.claude/scratch/verify2` at `4951a41`, under `env -i`), ran the reverse control there, re-ran the cheap spike commands that touch no network service and no model (`codex --help`, `codex sandbox -- cat`, `codex migrate-rollouts` report, `last_reply.py`, `git-guard`, `lint_changed`/`gitleaks`, `npm pack node-pty@1.1.0`, `curl -I` for frame headers), and re-fetched the pinned-version sources of the rows below. Sent no prompt to any site or CLI, did not touch the system clipboard, did not launch Electron.

## Per-item verdict

| # | Item | Result |
|---|---|---|
| 1 | `python3 scripts/evidence_check.py` exits 0 | pass (exit 0, `evidence_check: 77 rows, 0 problems`) |
| 2 | `python3 -m unittest discover -s tests/scripts` exits 0 | pass (exit 0, `Ran 12 tests`, OK) |
| 3 | reverse control: empty an evidence cell | pass (two reds, below); wording note: the cell edit turns the checker red, the named unit test goes red when the guard is removed |
| 4 | every run row points at an artefact that opens and shows the claimed result | pass for all 14 re-judged rows and the 15-row sample, with the exceptions listed under "Unsupported" (they are about wording around the rows, not about a run artefact) |
| 5 | every refuted claim has changed `docs/PROJECT.md` | pass: the 8 refuted rows (CC9, CX10, CX12, F3, W3, W6, G4, G6) are reflected, see V5; G7 is now `confirmed` and §6 keeps `_OUTPUT_FILE` |
| 6 | HUMAN: owner signs in to ChatGPT, Grok, DeepSeek | NOT CHECKED (HUMAN). It stays unchecked, so even with everything else green `verify:passed` cannot be set while it is open |

## Requirement evidence

- S1: `docs/EVIDENCE.md` — 77 rows (34 doc, 32 run, 11 assumption; 58 confirmed, 11 open, 8 refuted; counted by script, `exit 0`). Pass for existence; see "Unsupported" for sentences in `docs/PROJECT.md` and `docs/tech/` that go past the rows.
- S2: `scripts/evidence_check.py:33-57` read; tests `tests/scripts/test_evidence_check.py:41-79` read; `python3 -m unittest discover -s tests/scripts` exit 0. Pass.
- S3: spike scripts `spikes/pty-claude.js`, `spikes/web.js`, `spikes/last_reply.py`, `spikes/resume.js` and their kept outputs exist (`ls spikes`, 48 entries). Pass for existence (`spikes/pty-claude.js:43`, `spikes/web.js:19`, `spikes/last_reply.py:20` read; `python3 -I spikes/last_reply.py claude 7d58de11-…` exit 0, reply `OK`); nothing needing Electron could be rerun.
- S4: ten `docs/tech/*.md` files exist (`ls docs/tech`); pins re-checked by verify 1 with `npm view <pkg> time` (all at least 14 days old). `node-pty@1.1.0.md:5` makes a claim the evidence does not (see Unsupported U1). Fail on that line.
- S5: `docs/PROJECT.md` §3 is scope plus row ids; mechanics moved to `docs/tech/`; refuted rows reflected (V5). Pass on `docs/PROJECT.md:31-41` (`git diff 8440e1c 4951a41 -- docs/PROJECT.md` exit 0), except the sentences in U2-U4.
- V1: `python3 scripts/evidence_check.py` exit 0, fresh clone.
- V2: `python3 -m unittest discover -s tests/scripts` exit 0, fresh clone.
- V3: `python3 scripts/evidence_check.py` exit 1 with CC4's cell emptied; `python3 -m unittest tests.scripts.test_evidence_check.EvidenceCheckTest.test_row_without_evidence_fails` exit 1 with the guard removed.
- V4: all 29 first-round artefacts plus the new ones (`claude-trust-enter/run.out`, `codex-help.txt`, `codex-sandbox-read-wide.txt`, `claude-resume-inherited-env.txt`, `codex-session-index.txt`) opened; judgement per row below; `python3 scripts/evidence_check.py` exit 0 confirms every run artefact path exists, `spikes/claude-trust-enter/run.out:7` is the new CC13 evidence. Pass with the U-list.
- V5: `git diff 8440e1c 4951a41 -- docs/PROJECT.md` plus `grep -n isSidechain docs/PROJECT.md` (no hit; present at 8440e1c per verify 1), `PROJECT.md:31` (CC13 trust dialog, CC17), `:33` (F3 rule gone, CX10 "failed … open until CX11"), `:34` (CX12 Codex `/voice`), `:36` (W3/W6, D1 "proposed"), `:15` (TypeScript 6.0.3, G4), `:149` (`--maxWorkers`, G6). Pass.
- V6: HUMAN, not run here (exit 0 is not claimed; `tasks/05-feasibility/01-evidence-table/NOTES.md:25` lists sign-in under what was not checked). No sign-in record exists in `NOTES.md`.
- D1: `tasks/DECISIONS.md:14` `[proposed]`; `docs/PROJECT.md:36` now says "proposed as D1" (verify 1 flagged "decision D1"; fixed). Pass.
- D2: `tasks/DECISIONS.md:31` and `docs/PROJECT.md:15` agree (TypeScript 6.0.3); typescript-eslint range checked by verify 1 at `warnAboutTSVersion.ts:11`. Pass.
- D3: `tasks/DECISIONS.md:41`; `spikes/frame-headers.txt` re-run with `curl -sSI`: chatgpt.com `x-frame-options: SAMEORIGIN` (HTTP 403), grok.com `x-frame-options: DENY` (HTTP 200); deepseek 403 as recorded. Pass.

## Rows verify 1 named, re-judged against the artefact or the pinned source

- G7 (doc, confirmed): `base.ts` of Playwright v1.63.0 read (curl): lines 660-675 `outputDir` defaults to `options.configDir`; `outputFile = path.resolve(outputDir, reportName)`; `PLAYWRIGHT_JUNIT_OUTPUT_FILE` is resolved first (line 660). The row's corrected wording holds. PASS. (Minor: the cited range 671-675 shows the NAME half; the `_OUTPUT_FILE` half that §6 uses is at 660-663 and `docs/tech/playwright@1.63.0.md:4` cites the same range.)
- CC13 (run): `spikes/claude-trust-enter/run.out` — `trust dialog present → "" + Enter` then `[6.8s] pty exit 1`, 0.7 s after Enter; screens 02/03/09 are byte-identical to 01 (`cmp` same: the dialog was never left); `claude-01-start.screen.txt` shows `❯ No, exit` as default. PASS. Residue: the line `prompt visible: true` in the same log is a false positive (`pty-claude.js:43` matches `❯` in the dead dialog); and `claude-run.out` still logs `→ Enter` for a run that reached the prompt (earlier script version, not kept) — neither is cited by CC13.
- CX2 (run): `codex-update-dialog.screen.txt` shows option 1 `Update now (runs sh -c 'curl -fsSL … | … sh')` as the default (`›`); `codex-02-dialog-0.screen.txt` shows the folder-trust dialog; `codex-run.out` orders update dialog, trust dialog, prompt. The paste-before-dialog sentence is gone from the row and from `docs/tech/codex@0.159.2.md`. PASS.
- W1 (run): `web-report.json` chatgpt `input: true`, `challengeScriptInHtml: false`, `challengeShown: false`; `web-chatgpt.png` read: "Where should we begin?" with "Ask ChatGPT" input and Log in button. PASS.
- W6 (run, refuted): `web-report.json` separates `challengeScriptInHtml` (deepseek true) from `challengeShown` (false for all three); screenshots of chatgpt, grok, deepseek-plain-ua read: no challenge page. PASS as refuted ("shown" refuted; script present).
- CX3 (run): `codex-help.txt` lists every option of `codex` and `codex resume`, none sets a session id of a new session (`resume` takes `[SESSION_ID]` positional only). I regenerated `codex --help` (codex-cli 0.159.2): first 138 lines identical to the file; `codex --help | grep -i session.?id` empty. PASS.
- CX4 (doc): `recorder.rs` rust-v0.159.2 lines 1727-1735 read: `Resolve ~/.codex/sessions/YYYY/MM/DD path`, `codex_home().push(SESSIONS_SUBDIR)`, year/month/day dirs; filename pattern `rollout-<timestamp>-<id>.jsonl` is at lines 101-102. PASS (the `CODEX_HOME` override is `codex_home()` and is not on the cited lines).
- CX13 (doc): `shared_options.rs:53-58` rust-v0.159.2: `long = "dangerously-bypass-approvals-and-sandbox", alias = "yolo"`, doc "Skip all confirmation prompts and execute commands without sandboxing". PASS.
- CC10 (doc): `claude-directory.md` line 112 `projects/<project>/<session>.jsonl | Full conversation transcript: every message, tool call, and tool result`; no schema on that page. PASS, scoped to that one page (the row says "the docs"; I read only this page).
- CX8 (run): `codex-sandbox-read.txt` (read outside cwd exit 0 in `read-only` and `workspace-write`, write blocked in read-only) and `codex-sandbox-read-wide.txt` (`/etc/hosts`, `~/.zshrc`, the repository README, exit 0, both modes). I re-ran `codex sandbox -c sandbox_mode=… -- cat /etc/hosts` and `cat ~/.zshrc` in both modes: all four exit 0. `permissions.rs:2042-2062` (`ReadOnly` → `Root` with `Read`) agrees. PASS.
- G9 (run): `spikes/deny-prefixes.txt` lists DENY for all eight prefixes and allow for two builds. I re-ran `~/.claude/hooks/git-guard.py` with the clone as `cwd` on the eight commands plus `npx electron-builder --mac` and `npm run build`: eight deny, two allow. PASS.
- CC17 (run): `claude-resume-inherited-env.txt` shows the warning line "Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION marker" with the variable set in the harness. PASS for "the CLI says so"; no artefact checks that the jsonl was in fact not written, and "the app must drop it" is a design consequence.
- CX15 (assumption, open): place named; `codex migrate-rollouts` report re-run: `Scanned 11 rollout(s): 1 eligible, 10 already paginated`. PASS (honestly open).
- CX16 (run): `codex-session-index.txt`; I recomputed on `~/.codex/session_index.jsonl`: `{('id','thread_name','updated_at'): 9}`, 9 of 9 ids have a rollout under `~/.codex/sessions`. PASS.

## Fresh sample of 15 other rows (python3 `random.seed(20261021)`, `random.sample` of the 63 rows not named above)

CC1, CX1, CX11, F2, F3, G1, G10, G2, G8, P2, V2, V6, W4, W8, W9.

- CC1: `claude-run.out` electron 44.6.0, node-pty loaded, pty exit 0. PASS.
- CX1: `codex-02-dialog-1.screen.txt` Codex v0.159.2 prompt in the pty. PASS for "runs"; the ChatGPT sign-in itself is not on the screen, only the absence of a login prompt.
- CX11, V6, W8: assumptions, place named (HUMAN), status open; checker enforces it. PASS (nothing to prove).
- F2: `claude-04-after-ctrl-v-image.screen.txt` shows `[Image #1]`. PASS. F3 (refuted): `claude-text-clipboard/claude-04-…` shows the clipboard text pasted by Ctrl+V; `run.out` shows `pasteboard types: public.utf8-plain-text`. PASS.
- G1: re-ran the four lines in the clone: `shellcheck`, `actionlint`, `gitleaks dir`, `gitleaks git` all exit 0 (the first two with "no changed file matches", vacuous as §6 says). G2: planted a random `ghp_…` string in an untracked file in the clone, the gitleaks line through `lint_changed` exit 1; removed. PASS.
- G8: `test-cli-js.md:82` "Unlike `--reporter`, this keeps the configured reporters instead of replacing them". PASS.
- G10: first half PASS (`builder.ts:271-276` `option("publish", alias "p", choices onTag|onTagOrDraft|always|never)`). Second half FAILS as worded, see U2.
- P2: `node-pty-spawn-helper.txt` mode `-rw-r--r--` and `posix_spawnp failed`; I ran `npm pack node-pty@1.1.0`: `tar -tvzf` shows `package/prebuilds/darwin-arm64/spawn-helper` as `-rw-r--r--`, prebuilds only darwin-arm64/x64 and win32-arm64/x64 (P1 holds). PASS for the missing bit; "every spawn fails until it is set" rests on the one failure plus later successful runs, no artefact shows the chmod.
- V2: `developer.apple.com/forums/thread/763956` returns a JS shell without the thread text; CANNOT VERIFY HERE (same as verify 1). It is a forum post, not documentation.
- W4: `web-deepseek-plain-ua.png` read: normal sign-in form; `web-report-plain-ua.json` UA without `Electron/`. PASS, with a note: the png is the 10:48 file from the first spike round (`ls -l`), the rerun's JSON (11:06) records `capture error UnknownVizError`, so the screenshot was not regenerated, contrary to NOTES.md ("screenshots regenerated"). The JSON and the png agree on the UA and URL.
- W9: `session.md:37-39` `persist:` prefix is persistent. PASS.

## Unsupported (sentences that claim more than their row shows)

- U1: `docs/tech/node-pty@1.1.0.md:5` "the darwin and win32 prebuilds loaded under Electron 44.6.0 without a rebuild (spike log claude-run.out)". The log is macOS only; win32 was never loaded and EVIDENCE P4 says exactly that (open, HUMAN Windows smoke). Contradicts the table.
- U2: `docs/PROJECT.md:91` "The electron-builder config sets `publish: never`, so a plain local build can never upload", repeated in `docs/tech/electron-builder@26.17.0.md:3` and G10. At the pinned tag `never` is a publish policy (CLI `--publish`, `PublishOptions.publish`, `PublishManager.ts:81,104`), while the config key `publish` holds publisher configurations (`PublishManager.ts:154,467`; `null` disables). `PublishManager.ts:87-100` also turns on implicit publishing (npm lifecycle event `release`, a CI git tag, CI detection) when no policy is given. The cited lines `builder.ts:271-276` show only the CLI choice. The claim as worded is unsupported and probably wrong; the deny block still guards the explicit `-p`/`--publish` forms.
- U3: `docs/PROJECT.md:33-34` has no EVIDENCE row for: `Alt+V` on Windows (supported only in `docs/tech/claude-code@2.1.306.md:10` by the interactive-mode page, which I did not re-read), "Web windows: native drag-and-drop and paste", "OS dictation (macOS Dictation, Windows `Win+H`) types into any input; Ubuntu has none built in". Verify 1 listed these as missing rows; NOTES.md ("after verify:failed") does not mention them and they are unchanged.
- U4: `docs/PROJECT.md:36` "Logged out, ChatGPT and Grok load and chat without a challenge (W1, W2, W6)": W1/W2 show a loaded page with an input and no challenge; no prompt was sent, so "chat" is not shown.
- U5: V2 (above) — cannot verify; the sentence "Microphone granted to CLI children through the app (V2, V3)" in `PROJECT.md:34` rests on it.
- Minor: `docs/tech/claude-code@2.1.306.md:8` cites "NOTES.md" for the `isSidechain` check; the artefact is `spikes/claude-subagent-files.txt`. `docs/tech/chat-sites@2026-10-21.md:5-6` cite the sites' terms pages after observations the terms do not contain (the artefact is named in the header). `docs/tech/electron@44.6.0.md` cites `sandbox.md` for the harness `UnknownVizError`, which that page does not contain.

## How to reproduce

From an empty environment:

```
git clone <repo> scratch && cd scratch && git checkout 4951a41
python3 scripts/evidence_check.py                      # evidence_check: 77 rows, 0 problems
python3 -m unittest discover -s tests/scripts          # Ran 12 tests ... OK
python3 tasks/check.py                                 # problems: 0
```

- COMMAND: `env -i PATH=/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin HOME=$HOME python3 scripts/evidence_check.py` (clone at `4951a41`) exit 0, output `evidence_check: 77 rows, 0 problems`
- COMMAND: `python3 -m unittest discover -s tests/scripts` exit 0, `Ran 12 tests in 0.007s` OK
- COMMAND: `python3 tasks/check.py` exit 0, `problems: 0` (run in the clone, and again in the repository after this report was written)

## Reverse control

Both in the scratch clone `.claude/scratch/verify2`, restored after (`git status --short` empty, suite green: `restored exit 0`).

A. CC4's evidence cell emptied in `docs/EVIDENCE.md`:
```
CC4: [no-evidence] no evidence
evidence_check: 77 rows, 1 problems
COMMAND: python3 scripts/evidence_check.py -> exit 1
```
B. The `no-evidence` guard removed (`scripts/evidence_check.py`: `return problems + [...]` → `return problems`):
```
AssertionError: 'no-evidence' not found in set()
Ran 1 test ... FAILED (failures=1)
COMMAND: python3 -m unittest tests.scripts.test_evidence_check.EvidenceCheckTest.test_row_without_evidence_fails -> exit 1
whole suite: Ran 12 tests ... FAILED (failures=1)
```
C. G2 control (planted token, gitleaks via `lint_changed`) exit 1, removed afterwards.
Note: B proves the unit test is sensitive to the guard; A proves the real table is checked. The unit test uses its own fixture, not the real `docs/EVIDENCE.md`.

## What was not checked

- VERIFY item 6 (HUMAN): sign-in on ChatGPT, Grok, DeepSeek. W8, V6, persistence of a signed-in partition stay open; `NOTES.md` has no owner record. This alone keeps `verify:passed` from being set.
- Windows 11 and Ubuntu 26.04 rows (CC16, P4, P6, V5, CX11, F6): open assumptions, not checkable on macOS.
- No spike that needs Electron, `claude` or a website was rerun (instruction), so every `run` artefact for CC1-CC3, CC11, CC13, CX1, CX2, CX9, CX10, F2, F3, F4, W1-W6, W10 was judged by reading, not reproduced; the screens and screenshots could have been edited after the fact, I saw no sign of it. The site behaviour is one run on 2026-10-21.
- Rows I did not open at source this round: CC4, CC5, CC7, CC12, CC14, CC15, CX7, CX14, F1, F5, V1, V3, V4, W7, W11-W14, K1, P1 (tarball only), P3, P5, G4, G5, G6, CX12, CX5/CC6/CC8 beyond rerunning `last_reply.py` (output `OK` / Cyrillic reply, matches the artefact). Verify 1 read most of them and found them supported; I did not redo that.
- `CC8`'s reply structure and `claude-subagent-files.txt` were not regenerated.
- V2 (Apple forum) not retrievable. G10's `publish: never` half and the `.deb` SUID wording (`after-install.tpl` chmods 4755 only when user namespaces do not work) read from source but not run.
- NOTES.md side effects (a Haiku prompt through Claude Code, trust entries in `~/.claude.json` and `~/.codex/config.toml`, clipboard replaced and restored) were not checked.
- Secrets: `git diff` of the task not scanned beyond the `gitleaks` lines of item G1 (exit 0); `spikes/` text artefacts were not grepped again.
- `python3 tasks/scope_check.py` not run (its usage is `<task dir> [base]`; WRITE-SET compared by hand: every file changed between `8440e1c` and `4951a41` is under the task's WRITE-SET).

## Verdict

verify:failed for tasks/05-feasibility/01-evidence-table — every row verify 1 rejected and the three new rows now hold against their artefacts and the pinned sources, and items 1-3 reproduce, but `docs/tech/node-pty@1.1.0.md:5` claims win32 prebuilds loaded (P4 is open), `docs/PROJECT.md:91` claims a config `publish: never` that the source does not show, several §3 sentences have no row (U3, U4), V2 cannot be verified, and item 6 (HUMAN) is unchecked and by itself prevents `verify:passed`.
