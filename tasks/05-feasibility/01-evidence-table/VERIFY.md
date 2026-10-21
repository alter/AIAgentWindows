# VERIFY — evidence table (2026-10-21)

Verifier: a separate Claude context, 2026-10-21; did NOT write `docs/EVIDENCE.md`, `scripts/evidence_check.py`, `tests/scripts/test_evidence_check.py`, the spikes or the `docs/tech/` studies; did read every artefact under `spikes/`, re-fetched the pinned-version sources cited by sampled `doc` rows, ran VERIFY items 1–3 in a fresh clone at `d342c6a` (`.claude/scratch/verify-clean`, gitignored), ran the reverse control there, and re-ran the `git-guard` hook against the deny block. Sent no prompt to any site or CLI, did not touch the system clipboard, did not launch Electron.

## Per-item verdict

| # | Item | Result |
|---|---|---|
| 1 | `python3 scripts/evidence_check.py` exits 0 | pass (exit 0, 74 rows, 0 problems) |
| 2 | `python3 -m unittest discover -s tests/scripts` exits 0 | pass (exit 0, 12 tests) |
| 3 | reverse control: empty an evidence cell → `test_row_without_evidence_fails` | pass, with a wording note (see Reverse control) |
| 4 | every run row points at an artefact that opens and shows the claimed result | FAIL: all 29 artefacts open; 3 run rows are not fully shown by their artefact (CC13, CX2, W1 — see Unsupported rows) |
| 5 | every refuted claim has changed `docs/PROJECT.md` | pass for 8 of 9 refuted rows; G7's refutation is itself unsupported (see below), so its PROJECT.md edit rests on a claim that does not hold as worded |
| 6 | HUMAN: owner signs in to ChatGPT, Grok, DeepSeek by hand | not checked (HUMAN, outside this context; `NOTES.md` has no sign-in record) |

## Requirement evidence

- S1: `docs/EVIDENCE.md:1-112` — 74 rows (35 doc, 29 run, 10 assumption; `docs/EVIDENCE.md` counted with a script, escaped `\|` in CX2 handled by hand). Present, but see Unsupported rows: fail for G7, CC13, CX2, W1, CX3, CX4, CX13, CC10, V2 (evidence cell does not show the claim or status).
- S2: `scripts/evidence_check.py:33-57` — guards `[kind]` (37), `[no-evidence]` (41), `[doc-url]` (43), `[run-artefact]` (47, 50), `[assumption-place]` (53); tests `tests/scripts/test_evidence_check.py:41-59`, `python3 -m unittest discover -s tests/scripts` exit 0. Pass.
- S3: `tasks/05-feasibility/01-evidence-table/spikes/pty-claude.js:1-73`, `spikes/web.js:1-30`, `spikes/last_reply.py:1-30` read in this session; spikes read in this session: `spikes/pty-claude.js`, `spikes/web.js`, `spikes/last_reply.py`, `spikes/codex-sandbox-read.txt`; all four sites' screenshots opened. The CLI/pty, bracketed paste, Ctrl+V image, transcript parsing, codex sandbox read and three-site webview spikes all have kept outputs. Pass for existence. Note: `claude-run.out` (first claude run) logs `trust dialog present → Enter`, but the `pty-claude.js` kept in the directory sends Down+Enter by default (and `claude-submit/run.out`, `claude-text-clipboard/run.out` log `"\u001b[B" + Enter`): the first run came from an earlier script version that is not kept.
- S4: `docs/tech/electron@44.6.0.md:3` (pin rationale) and the other nine `docs/tech/*.md`; `npm view <pkg> time` exit 0 for each pin. `npm view <pkg> time` on 2026-10-21: electron 44.6.0 2026-10-06 (15 days), node-pty 1.1.0 2025-12-22, @xterm/xterm 6.0.0 2025-12-22, typescript 6.0.3 2026-04-16 (latest is 7.0.2), vitest 5.0.3 2026-09-30, @playwright/test 1.63.0 2026-09-04, electron-builder 26.17.0 2026-09-26. All at least two weeks old. Pass.
- S5: `docs/PROJECT.md:31-41` (§3 rows) and `git diff 8440e1c d342c6a -- docs/PROJECT.md` exit 0 — §3 rows rewritten to scope plus row-id citations; mechanics moved to `docs/tech/`. Pass.
- V1: `python3 scripts/evidence_check.py` exit 0 (output `evidence_check: 74 rows, 0 problems`), fresh clone.
- V2: `python3 -m unittest discover -s tests/scripts` exit 0 (`Ran 12 tests`, OK), fresh clone.
- V3: `python3 scripts/evidence_check.py` exit 1 on the emptied CC4 cell, and `python3 -m unittest tests.scripts.test_evidence_check.EvidenceCheckTest.test_row_without_evidence_fails` exit 1 with the guard removed (`scripts/evidence_check.py:41`). Pass.
- V4: `python3 scripts/evidence_check.py` exit 0 (every run artefact path exists) and each artefact opened by me, judgement per row below (`spikes/claude-run.out:7` for CC13). Fail on CC13, CX2, W1 (partial support).
- V5: `git diff 8440e1c d342c6a -- docs/PROJECT.md`: CC9 (isSidechain sentence removed), F3 (clipboard-type-check rule removed, `docs/PROJECT.md:33`), CX10 (`:33` "failed … open until CX11"), CX12 (`:34` Codex `/voice`), W3/W6 (`:36`), G4 (`docs/PROJECT.md:15` TypeScript 6.0.3, §4 last bullet), G6 (§6 audit-parallel row), G7 (§6 `PLAYWRIGHT_JUNIT_OUTPUT_FILE`). Pass on the diff; G7 caveat above.
- V6: HUMAN — not checked here; no command run, `tasks/05-feasibility/01-evidence-table/NOTES.md:23-29` lists it under what was not checked (exit n/a).
- D1: `tasks/DECISIONS.md:14` is `[proposed]`, waiting for the owner, yet `docs/PROJECT.md:36` says "decision D1". The row states the fact (DeepSeek refuses the default user agent, W3–W5) and points at an open proposal; no code to check. Recorded, not a failure.
- D2: `tasks/DECISIONS.md:31` and `docs/PROJECT.md:15` agree (TypeScript 6.0.3); typescript-eslint range `>=4.8.4 <6.1.0` re-read at `warnAboutTSVersion.ts:11` of v8.71.1. Pass.
- D3: `tasks/DECISIONS.md:41` and `docs/PROJECT.md:36` agree (`WebContentsView`); Electron `webview-tag.md:7` says "we currently recommend to …" against `<webview>`. Pass.

## How to reproduce

From an empty environment:

```
git clone <repo> scratch && cd scratch && git checkout d342c6a
python3 scripts/evidence_check.py                      # evidence_check: 74 rows, 0 problems
python3 -m unittest discover -s tests/scripts          # Ran 12 tests ... OK
python3 tasks/check.py                                 # problems: 0
```

Recorded:

- COMMAND: `python3 scripts/evidence_check.py` exit 0
- COMMAND: `python3 -m unittest discover -s tests/scripts` exit 0
- COMMAND: `python3 tasks/check.py` exit 0 (before VERIFY.md existed)
- COMMAND: re-run of the `git-guard` hook (`~/.claude/hooks/git-guard.py`, payload with `cwd` = clone) over the 8 deny prefixes: DENY for `npx electron-builder -p always`, `electron-builder --publish always --mac`, `npx electron-builder --publish always`, `npm publish`, `git push origin main`, `xcrun notarytool submit x`, `gh release create v1`; allow for `npx electron-builder --mac`, `npm run build`; also DENY `electron-builder -p never`. G9 reproduces and is wider than `spikes/deny-prefixes.txt` (that file covers 5 of the 8 prefixes).

## Reverse control

Both in `.claude/scratch/verify-clean` (scratch clone), restored afterwards (`git status` clean, suite green again).

A. Evidence cell of CC4 emptied in `docs/EVIDENCE.md`:
```
CC4: [no-evidence] no evidence
evidence_check: 74 rows, 1 problems
COMMAND: python3 scripts/evidence_check.py exit 1
```
B. The `no-evidence` guard removed in `scripts/evidence_check.py:41` (`return problems`):
```
AssertionError: 'no-evidence' not found in set()
FAILED (failures=1)    # test_row_without_evidence_fails, exit 1
```
and the whole suite: `Ran 12 tests ... FAILED (failures=1)`.
Wording note: V3 says "empty the evidence cell … → test_row_without_evidence_fails". Emptying a cell in `docs/EVIDENCE.md` makes the checker (V1) red, not that unit test (it builds its own input); the unit test goes red when the guard in the checker is removed. Both directions are red, so the control is sound. Fixture-only: the unit test does not read the real `docs/EVIDENCE.md`.

## Row-by-row: what I opened (all 29 run rows, all 9 refuted rows, and the doc rows named below)

Supported (artefact or pinned-version source read, claim and status match):
- Run: CC1 (`claude-run.out`: electron 44.6.0, node-pty loaded, pty exit 0), CC2 (PATH `/usr/bin:/bin:/usr/sbin:/sbin`, claude ran), CC3 (`claude-01-start.screen.txt:1` "Identity added"), CC6 (`transcripts-last-reply.txt`: `-private-tmp-spike-cwd-2uJCQ6` for `/tmp/spike-cwd-2uJCQ6`), CC8 (`~/.claude/projects/-private-tmp-spike-cwd-2uJCQ6/7d58de11-….jsonl`: assistant records `['thinking']` then `['text']` with the same message id, so one reply spans two records; reply `OK`), CC9 refuted (`claude-subagent-files.txt`: isSidechain `{None: 632, False: 609}`, subagents in `<session>/subagents/`; `code.claude.com/docs/en/claude-directory` line 114 confirms the directory), CC11 (`claude-03-…`: two-line text in the prompt, not submitted), CX1 (`codex-02-dialog-1.screen.txt`: Codex 0.159.2 prompt in pty; sign-in itself is not shown on screen, only that no login prompt appeared), CX5 (`last_reply.py` logic; output omitted in the artefact), CX8 (`codex-sandbox-read.txt`: read outside cwd exit 0 in both modes; one directory under `/tmp`, not "whole disk"), CX9 (`codex-03-…`), CX10 refuted (all three `codex-04-…` screens: "Failed to paste image: no image on clipboard"), F2 (`claude-04-…`: `[Image #1]`), F3 refuted (`claude-text-clipboard/claude-04-…`: text pasted by Ctrl+V), F4 (`electron-clipboard-api.txt`: `has/read/readText/write/writeText`, no `readImage`), W2, W3 refuted (`web-deepseek.png`: "Abnormal usage environment"), W4 (`web-deepseek-plain-ua.png`: sign-in form; `web-report-plain-ua.json` UA without `Electron/`), W5 (`url: …/sign_in` in both reports), W6 refuted (three screenshots show no challenge page), W10 (`web.js` uses `executeJavaScriptInIsolatedWorld`, no preload; spike used `BrowserWindow`, not `WebContentsView`), P2 (`node-pty-spawn-helper.txt`: mode `-rw-r--r--`, `posix_spawnp failed`; I also listed the 1.1.0 tarball: prebuilds only darwin-arm64/x64 and win32-arm64/x64, so P1 holds), G1, G2 (`gate-non-ts.txt`; G1 shellcheck/actionlint lines are vacuous, as `docs/PROJECT.md` §6 says), G9 (re-run above), G11 (`reverse-control.txt`, reproduced above).
- Doc, refuted: CX12 (`slash_command.rs:136` `SlashCommand::Voice => "start or stop voice…"`), G4 (`warnAboutTSVersion.ts:11` `>=4.8.4 <6.1.0`), G6 (`resolveConfig.ts:266-268` "`test.poolOptions` was removed in Vitest 4"; `--maxWorkers` is in `cli-generated.md:463`).
- Doc, confirmed: CC4 (`cli-reference` `--session-id` row 128, `--add-dir` row 62), CC5 (`permissions` row 17: file reads "No" prompt within working dir and additional directories), CC7, CC12, CC14 (`legal-and-compliance` line 57, "unmodified Claude Code binary with their own Claude subscription"; line 55 says third-party developers may not offer Claude.ai login in their own applications, a tension the row does not mention), CC15 (`cli-reference` row 82 says "Equivalent to `--permission-mode bypassPermissions`"; the cited `permission-modes` page implies it), CX7, CX14 (`learn.chatgpt.com/docs/codex/cli.md`: "choose Sign in with ChatGPT or another available sign-in method"), F1 (`breaking-changes.md:981-983`), V1 (`voice-dictation`: claude.ai account, hold Space, `arecord`/SoX), V3 (`system-preferences.md:360`), W7 (Google policy: embedded user-agent prohibited), W9, W11, W12 (OpenAI terms: "Automatically or programmatically extract data or Output"), W13 (xAI: "using bots to access"), W14 (DeepSeek: "using any robots, spiders, or other automatic setups"), G5, G8, K1 (`safe-storage.md:25`), P3, P5 (Ubuntu release notes confirm the restriction; the `.deb` profile half is `docs/tech/electron-builder@26.17.0.md:4`, which I did not open at source).

## Unsupported rows (evidence cited does not show the claim or the status)

- G7 (status `refuted`): `PLAYWRIGHT_JUNIT_OUTPUT_NAME=reports/x.xml` — Playwright v1.63.0 `reporters/base.ts:674-677` does `path.resolve(outputDir, reportName)` with `outputDir` defaulting to the config directory (`:671-672`), and `junit.ts:96` creates the parent directory recursively; the cited doc lines say NAME is "relative to the output dir", default "cwd or config directory". With the config at the repository root the file is written to `reports/x.xml`. The claim as worded holds (conditionally on the config location); `refuted` is not demonstrated. Switching to `_OUTPUT_FILE` in §6 is harmless, but the stated reason is wrong.
- CC13 (run, confirmed): the screen shows the default `❯ No, exit` (supported), but "Enter alone quits" has no artefact. `claude-run.out` logs `trust dialog present → Enter` and the session then proceeds to the prompt, which if anything points the other way; the script version that produced it is not kept. No `02-trust-only` snapshot is kept.
- CX2 (run, confirmed): update dialog with default `curl … | sh` and trust dialog are shown; "text pasted before they are answered lands in the dialog" is shown by no artefact (every paste in the spikes came after the dialogs were dismissed). Same sentence is repeated in `docs/tech/codex@0.159.2.md:12`.
- W1 (run, confirmed): the screenshot shows the "Ask ChatGPT" input, but the cited `web-report.json` says `"input": false` for chatgpt (selector `#prompt-textarea` did not match), unexplained. Separately `challenge: true` for deepseek in both reports (regex match over raw HTML) contradicts the screenshots without comment; W6's refutation rests on the screenshots.
- CX4 (doc, confirmed): cited `recorder.rs:82-83` is a doc-comment example with a flat path `~/.codex/sessions/rollout-….jsonl` (no `YYYY/MM/DD`, no `CODEX_HOME`). The claim is true (`recorder.rs:1727` "Resolve ~/.codex/sessions/YYYY/MM/DD path", and `~/.codex/sessions/2026/09/17/rollout-…jsonl` on this disk), but the cited lines do not show it.
- CX13 (doc, confirmed): cited `protocol.rs:986-1009` is the `AskForApproval` enum, not the flag. The flag is at `utils/cli/src/shared_options.rs:55` (`dangerously-bypass-approvals-and-sandbox`, alias `yolo`) and `cli/src/main.rs:1988-1993`; claim true, citation wrong.
- CX3 (doc, confirmed): "no flag sets the session id of a new session" is a negative claim; cited `main.rs:350-354` is `ResumeCommand.session_id`. A grep of `main.rs` finds no such flag, but the cited lines cannot show an absence.
- CC10 (doc, confirmed): "no public schema exists" — `claude-directory` lists `projects/<project>/<session>.jsonl` (line 112) and says nothing about a schema; absence is not shown.
- CX8 as used in `docs/PROJECT.md:35` ("Codex through its whole-disk read access"): the artefact shows a read of one `/tmp` directory under two sandbox modes, not the whole disk.
- V2 (doc, confirmed): `developer.apple.com/forums/thread/763956` returned a page without the thread body in my fetch; cannot verify here. It is a forum post, not Apple documentation.

Missing rows (claims in `docs/PROJECT.md` §3/§6 with no row): "Ubuntu has none built in" (OS dictation), macOS Dictation/`Win+H`, `Alt+V` on Windows (supported at `claude-code@2.1.306.md:10` and `interactive-mode` line 28, but no EVIDENCE row), "both CLIs attach image paths as images" was dropped from §3.

## What was not checked

- VERIFY item 6 (HUMAN): sign-in on ChatGPT, Grok, DeepSeek. W8, V6 and persistence of a signed-in partition stay open; `NOTES.md` has no owner record.
- Windows 11 and Ubuntu 26.04 rows (CC16, P4, P6, V5, CX11): open assumptions, not checkable on macOS.
- Spike reruns: I did not launch Electron, claude, codex or the sites (instructions), so every `run` artefact was judged by reading, not reproduced. Consequently the screenshots, screens and logs could be post-edited; I saw no sign of that but could not exclude it. The site behaviour (W1–W6) is a single run on 2026-10-21.
- The `codex-sandbox-read.txt` and `gate-non-ts.txt` outputs, and `claude-subagent-files.txt` (counts for a session that is still growing), were not regenerated. The CC8 reply structure was re-read from the spike's own session file under `~/.claude/projects/`, which is the author's artefact, not a clean one.
- Doc rows not opened at source: CC12 and CC7 (read in the fetched Claude Code pages only by a grep, not line-checked), F5 (CDP `DOM.setFileInputFiles`), W9 and V4 beyond `session.md` headline text, G8, G10 (`builder.ts:271-276` was read: `-p` alias of `publish`; the `publish: never` half was not), P3 (README text read), P5 `.deb` profile.
- `python3 tasks/scope_check.py` crashed with a traceback when called with `--help`; I did not determine its normal invocation. WRITE-SET was checked by hand: files changed in `d342c6a` all fall under the task's WRITE-SET (`.gitignore`, `docs/`, `scripts/evidence_check.py`, `tasks/DECISIONS.md`, `tests/scripts/test_evidence_check.py`, the task directory).
- The `NOTES.md` side-effects section (a Haiku prompt sent through Claude Code, trust entries left in `~/.claude.json` and `~/.codex/config.toml`, clipboard replaced and restored) was not checked and was not redone; note that `NOTES.md` admits a prompt to a CLI, which the task's `−` line forbids only for the real sites.
- Secrets scan of `spikes/` and `docs/` by grep for token/secret/password/private-key patterns: only text mentions, no values.

## Verdict

verify:failed for tasks/05-feasibility/01-evidence-table — items 1–3 and 5's diff pass, but item 4 fails (rows CC13, CX2, W1 are not fully shown by their artefacts) and G7 is marked `refuted` without support (plus citation mismatches on CX3, CX4, CX13, CC10 and V2 not retrievable); item 6 is HUMAN and not checked, which alone would keep it from `passed`.
