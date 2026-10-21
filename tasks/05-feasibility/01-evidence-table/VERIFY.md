# VERIFY — evidence table, fourth verification (2026-10-21, commit 7a349f0)

Verifier: a separate Claude context (fourth verifier); did NOT write `docs/EVIDENCE.md`, `scripts/evidence_check.py`, `tests/scripts/test_evidence_check.py`, the spikes or the `docs/tech/*.md` studies. Ran VERIFY items 1-3 in a fresh clone (`.claude/scratch/verify4` at `7a349f0`, under `env -i`) with three mutations; re-fetched the Playwright source for G7 with `curl`; read the artefacts of W16, W17, P2, W8 and the owner's messages in the session transcript for the navigation sentence. Scope of this round: the third report's failures (W16, navigation provenance) and minors (P2, W8, W17, G7), the diff `ed50da7..7a349f0`, and items 1-3. Everything else is carried forward from the third round (`ed50da7`) and was not re-checked. Sent no prompt to any site or CLI, did not launch Electron, did not touch the clipboard, did not open the owner's profiles under `.claude/scratch/spike/ud-signin`.

## Per-item verdict

| # | Item | Result |
|---|---|---|
| 1 | `python3 scripts/evidence_check.py` exits 0 | pass (exit 0, `evidence_check: 84 rows, 0 problems`, fresh clone at 7a349f0) |
| 2 | `python3 -m unittest discover -s tests/scripts` exits 0 | pass (exit 0, `Ran 12 tests`, OK) |
| 3 | reverse control: empty an evidence cell | pass (three reds, below) |
| 4 | every run row points at an artefact that opens and shows the claimed result | pass: W16 now says what its artefact shows; W8, W17 re-judged; P2 has one residual (see Unsupported); all other rows carried forward from round 3 |
| 5 | every refuted claim has changed `docs/PROJECT.md` | pass (carried forward; the diff since `ed50da7` touches one PROJECT.md row, the navigation one, and removes no refuted-claim change) |
| 6 | HUMAN: owner signs in to ChatGPT, Grok, DeepSeek | pass as a record (carried forward, not redone) |

## Requirement evidence

- S1: `docs/EVIDENCE.md`, 84 rows; `python3 scripts/evidence_check.py` exit 0 (fresh clone). Every `W/CC/CX/F/V/K/P/G` id mentioned in `docs/PROJECT.md` has a row (python check, empty list).
- S2: `scripts/evidence_check.py` and `tests/scripts/test_evidence_check.py`; `python3 -m unittest discover -s tests/scripts` exit 0, 12 tests; unchanged since `ed50da7` (`git diff --stat ed50da7 7a349f0` lists only EVIDENCE.md, PROJECT.md, `docs/tech/playwright@1.63.0.md`, NOTES.md, VERIFY.md). Pass.
- S3: spikes unchanged since round 3 (`git diff --stat ed50da7 7a349f0` exit 0 lists no file under `spikes/`). Pass for existence; nothing rerun.
- S4: `docs/tech/playwright@1.63.0.md:4` is the only tech file changed (G7 anchor `#L660-L675`); pins not redone. Pass.
- S5: `docs/PROJECT.md:36` is the only §3 row changed; scope plus row ids, mechanics in `docs/tech/`. Pass.
- V1: `python3 scripts/evidence_check.py` exit 0.
- V2: `python3 -m unittest discover -s tests/scripts` exit 0.
- V3: three mutations exit 1 (below).
- V4: `spikes/owner-signin-log.txt:5-8` (W16), `spikes/owner-restart-check.txt:6-9` (W17), `spikes/node-pty-spawn-helper.txt:2-4` (P2), base.ts:660-677 (G7); P2 residual; the rest carried from round 3; `python3 scripts/evidence_check.py` exit 0.
- V5: carried forward; `git diff ed50da7 7a349f0 -- docs/PROJECT.md` exit 0 shows the navigation sentence at `docs/PROJECT.md:36` only.
- V6: carried forward (`NOTES.md` "owner's sign-in check, second run", "owner's restart check"; `spikes/owner-signin-log.txt:1-2`, `spikes/owner-restart-check.txt:1-2`).
- D1, D2, D3: carried forward; `tasks/DECISIONS.md` is not in the diff `ed50da7..7a349f0`; `docs/PROJECT.md:36` still says the DeepSeek view sends the UA without `Electron/…` (D1, W15). Pass.

## Round-4 judgements

- W16 (was FAIL): the row now reads "ChatGPT asks for `geolocation` and `persistent-storage`; the open pages try to reach STUN servers (Google, Cloudflare), seen as failed name lookups inside the harness sandbox". `spikes/owner-signin-log.txt:5-8`: the `sandbox_extension_issue_file` line, "Failed to resolve address for stun.l.google.com., errorcode: -105", "31 such lines … for stun.l.google.com, stun1.l.google.com, stun.cloudflare.com", and the two `permission … -> denied` lines for chatgpt.com. `spikes/owner-restart-check.txt:2-3`: second run from a normal terminal, "no sandbox line, no STUN errors this time". The wording is an attempt, not a connection; the sandbox attribution has both artefacts. `docs/PROJECT.md:34` (W16) claims only the permission handling, not STUN. PASS. Residual: the 31 lines are the owner's paste summarised with an ellipsis, and the log does not say which of the three windows made the lookups ("the open pages").
- Navigation sentence, `docs/PROJECT.md:36` (was FAIL): now "reported by the owner during the sign-in check (NOTES of `tasks/05-feasibility/01-evidence-table`); Back and Home are smoke-tested in `spikes/nav-smoke.out`, Forward and Reload are not yet." Checked three sources. (a) `NOTES.md` "after the third verify:failed" records the owner's report. (b) The session transcript `~/.claude/projects/-Users-user-workflow-git-AIAgentWindows/68513e95-887c-4a3d-aecf-fce34fa5f566.jsonl`, user message at 2026-10-21T07:23:45.946Z, reads (Russian) "а еще проблема, ок, не могу через google, но я и назад выйти к обычной авторизации не могу" ("another problem: I cannot use Google, but I also cannot go back to the normal sign-in"), preceded at 07:23:12Z by the Google-refusal message the owner pasted. (c) `git show dc13631`: commit time 11:25:53 +0400 = 07:25:53Z, two minutes after the report, adds the Go menu to `signin.js` and `nav-smoke.js/.out`. `spikes/nav-smoke.out`: `{"before":"https://example.com/","afterBack":"https://chatgpt.com/","afterHome":"https://chatgpt.com/"}` — Back and Home only, as the sentence says. PASS. Two notes: the English quotation in NOTES.md is the session's translation of the Russian message, not verbatim; the transcript is on the owner's machine, not in the repository.
- P2 (minor): the row now says: ships without the execute bit, a spawn fails with `posix_spawnp failed`, after `chmod +x` spawns succeed; artefacts `spikes/node-pty-spawn-helper.txt` and `spikes/claude-run.out`. `node-pty-spawn-helper.txt:2-4` shows `-rw-r--r-- … spawn-helper` and `Error: posix_spawnp failed`; `claude-run.out:1,10` shows `node-pty loaded` and `pty exit 0`. The overclaim "every spawn fails" is gone from the row. Residual: no artefact records the `chmod` itself (`grep -rn chmod` over `spikes/` finds nothing). My own `ls -l` of the spike's `node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper` shows `-rwxr-xr-x` today, which is consistent but is scratch state, not an artefact. `docs/tech/node-pty@1.1.0.md:7` still says "every spawn then fails". Judged minor, not failing: the failure and the missing bit are shown, success after the bit is shown by the later runs.
- W8: row now names "Electron 44.6.0 windows with `persist:` partitions (the spike's BrowserWindows, not yet the product's views)"; matches `spikes/owner-signin-log.txt:1-2` and `signin.js`. PASS.
- W17: row now says ChatGPT and Grok keep session cookies on disk and DeepSeek "answered after the restart", with W5 as the reason that is informative. `spikes/owner-restart-check.txt:6-9`: ChatGPT `__Secure-next-auth.session-token.0/.1`, Grok `sso`, DeepSeek only `aws-waf-token` and the file's own statement that DeepSeek's session location was not checked. The row says what the artefact shows. PASS (owner's record; DeepSeek by inference from W5, stated).
- G7: the anchor is now `base.ts#L660-L675` in the row and in `docs/tech/playwright@1.63.0.md:4`. Fetched `raw.githubusercontent.com/microsoft/playwright/v1.63.0/packages/playwright/src/reporters/base.ts`: `:660` `PLAYWRIGHT_${name}_OUTPUT_FILE`, `:666` `…_OUTPUT_DIR`, `:672` `outputDir = options.configDir`, `:674` `…_OUTPUT_NAME`, `:677` `outputFile = path.resolve(outputDir, reportName)`. `junit.ts:50` calls `resolveOutputFile('JUNIT', options)` and passes no `default`, so the dir is the config dir. The range now holds both env vars and the default; the resolving line `:677` lies two lines outside it. PASS (cosmetic: the anchor could end at 677).

## Diff `ed50da7..7a349f0`

`git diff --stat ed50da7 7a349f0`: `docs/EVIDENCE.md` (rows W8, W16, W17, P2, G7 only), `docs/PROJECT.md` (the §3 navigation row only), `docs/tech/playwright@1.63.0.md` (the G7 anchor), `NOTES.md`, `VERIFY.md`. All paths are in the task's WRITE-SET. No `src/`, `scripts/`, `tests/`, `tasks/DECISIONS.md` or spike file changed. Nothing else changed in a way that breaks a row.

## Unsupported (sentences that claim more than their artefact shows)

- P2: "after `chmod +x` spawns succeed" — the chmod step is in no artefact (success is shown by `claude-run.out`); `docs/tech/node-pty@1.1.0.md:7` still says "every spawn then fails". Minor, non-failing.
- G7: anchor `#L660-L675` stops two lines before `path.resolve(outputDir, reportName)` at `:677`. Cosmetic.
- NOTES.md quotes the owner's message in English; the original is Russian (transcript, owner's machine). Minor.
- Carried forward minors: Forward and Reload not exercised (now stated in `docs/PROJECT.md:36`); CX4/CC10 judged by verify 2.

## How to reproduce

From an empty environment (clone path `.claude/scratch/verify4`):

```
git clone <repo> verify4 && cd verify4 && git checkout 7a349f0
env -i PATH=/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin HOME=$HOME python3 scripts/evidence_check.py   # evidence_check: 84 rows, 0 problems
env -i ... python3 -m unittest discover -s tests/scripts                                                  # Ran 12 tests ... OK
env -i ... python3 tasks/check.py                                                                          # problems: 0
```

- COMMAND: `env -i PATH=… HOME=$HOME python3 scripts/evidence_check.py` (clone at `7a349f0`) exit 0, `evidence_check: 84 rows, 0 problems`
- COMMAND: `env -i PATH=… HOME=$HOME python3 -m unittest discover -s tests/scripts` exit 0, `Ran 12 tests in 0.006s`, OK
- COMMAND: `env -i PATH=… HOME=$HOME python3 tasks/check.py` exit 0, `problems: 0`
- COMMAND: `curl -sL https://raw.githubusercontent.com/microsoft/playwright/v1.63.0/packages/playwright/src/reporters/base.ts` (lines 660-678 read) and `…/junit.ts` (lines 28-55)

## Reverse control

All in the scratch clone, restored with `git checkout` of the file afterwards (`git status --short` empty; final `evidence_check` exit 0, suite `Ran 12 tests … OK`).

A. W16's evidence cell emptied in `docs/EVIDENCE.md`:
```
W16: [no-evidence] no evidence
evidence_check: 84 rows, 1 problems        COMMAND: python3 scripts/evidence_check.py -> exit 1
```
B. The `no-evidence` guard removed in `scripts/evidence_check.py:41` (`return problems + [...]` → `return problems`):
```
AssertionError: 'no-evidence' not found in set()
Ran 1 test in 0.001s … FAILED (failures=1)   COMMAND: python3 -m unittest tests.scripts.test_evidence_check.EvidenceCheckTest.test_row_without_evidence_fails -> exit 1
whole suite: exit 1
```
C. W17's artefact path pointed at a file that does not exist:
```
W17: [run-artefact] artefact tasks/05-feasibility/01-evidence-table/spikes/owner-restart-check.MISSING.txt does not exist
evidence_check: 84 rows, 1 problems        COMMAND: python3 scripts/evidence_check.py -> exit 1
```
Limit, unchanged: the checker proves an artefact path exists, not that it shows the claim; W16 passed the checker while overclaiming in round 3, and only a reader caught it. Mutations A and C show the real table is checked; B shows the unit test is sensitive to the guard.

## What was not checked

- Carried forward from the third round and NOT re-checked now: the fresh sample of ten rows (CC1, CC16, CC7, CC8, CX13, CX15, CX6, F4, G6, W1), U1-U5 and the minor fixes, G10/G12 (electron-builder source), F7/F8/V7, W15, the `gitleaks` runs, and every row listed in the third report's "Rows I did not re-open". They were judged at `ed50da7`; the diff to `7a349f0` does not touch their artefacts, rows or tech notes, but I did not re-fetch their sources.
- Item 6 not redone: whether the owner really signed in, and the account state after the restart (no screenshot in the record). The cookie names in `spikes/owner-restart-check.txt` are the owner's report; I did not open the owner's profiles or cookie database. DeepSeek's session storage was not checked.
- Windows 11 and Ubuntu 26.04 rows (CC16, P4, P6, V5, CX11, F6, F8, V7): open assumptions, not checkable on macOS. These are OUTCOME-outside-the-repository items and are not passed, only recorded as open.
- No spike needing Electron, `claude`, `codex` or a site was rerun; `nav-smoke.out` and the STUN lines were read, not regenerated. Site behaviour is one run on 2026-10-21.
- The 31 STUN lines are summarised by the owner's paste; the raw log is not in the repository. Which window issued the lookups is not recorded.
- The owner's navigation message was confirmed in the session transcript on this machine only; it is not an artefact in the repository. Forward and Reload were never exercised.
- D1's claim that DeepSeek does not act on client hints today is inferred from W4 and W15, not tested on DeepSeek.
- Side effects of the spikes on the owner's machine (a Haiku prompt, trust entries in `~/.claude.json` and `~/.codex/config.toml`, clipboard replaced and restored) were not checked.
- `python3 tasks/scope_check.py` not run; WRITE-SET compared by hand from the diff stat.
- No `[full]` item exists in `task.txt`; no `FULLRUN-*.md` next to the task.

## Verdict

verify:passed for tasks/05-feasibility/01-evidence-table — items 1-3 reproduce at 7a349f0, W16 now says only what its artefact shows, the navigation sentence has a verifiable provenance (owner's message 07:23:45Z, commit dc13631 at 07:25:53Z) and states what is and is not smoke-tested, and W8, W17, G7 hold; residual minors (P2's chmod step not in an artefact, G7's anchor two lines short) are listed above and do not contradict any row's claim.
