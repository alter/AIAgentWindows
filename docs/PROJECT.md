---
intake: completed 2026-10-21
---
# PROJECT

Single source of truth for what this project is, what it contains, and what the agent may decide alone. `/plan` reads it before every task. Unasked cells stay open until asked, `n/a` when not applicable.

## 1. Identity

| Question | Answer |
|---|---|
| Name / slug | AIAgentWindows |
| Repository | local git, /Users/user/workflow/git/AIAgentWindows (no remote) |
| Other agents or people working in this repo | owner (Roman Dolgov) and Claude Code sessions; no other people |
| Stack (from the machine, with versions) | Electron + TypeScript, Node v22.22.0, npm 10.9.4, Python 3.14.8 (repo scripts only); targets macOS, Windows 11, Ubuntu 26.04; `claude` CLI at ~/.local/bin/claude. Exact library versions pinned in `docs/tech/<name>@<version>.md` before the first design against them |

## 2. Goal

| Question | Answer |
|---|---|
| What must work end to end first | Slack-like window: sidebar of agents; any number of Claude Code windows, the first journey proving two (interactive `claude` in a pty under the user's own subscription login) plus ChatGPT, Grok, DeepSeek in persistent-profile webviews; "Forward" a message/selection to a chosen window; write context to the shared directory with a manifest that other agents read |
| What the first version must NOT do | Automate login, passwords or captchas; use Anthropic API keys for Claude Code; scrape beyond the visible chat; auto-update; cloud sync; release signing/publishing |

## 3. Capability ledger

One state per row: `included` (present, expected to work) · `available` (partly there; note says what is missing) · `absent` (not part of this project; build only on request) · `removed` (deleted on purpose; restore only on request). No row means `absent`.

| Capability | State | Note |
|---|---|---|
| Slack-like shell (agent sidebar, tabs, multiple windows) | included | |
| Claude Code windows, subscription, interactive CLI in pty (xterm.js) | included | no API key; uses the installed `claude` and the user's own login. The pty starts through the user's login shell so `PATH` matches their terminal (an app launched from Dock/Finder/Explorer does not inherit it). Each window has a working directory the user picks when creating it (the transcript slug derives from it); `claude` is launched there with a fresh `--session-id <uuid>` and `--add-dir <shared dir>`. Text goes in by bracketed paste into the pty; the last reply is read from the session transcript `~/.claude/projects/<cwd slug>/<session-id>.jsonl` (`type: assistant` records with `isSidechain` false — subagent turns live in the same file), never by scraping the terminal. That format is internal and unversioned: the parser skips unknown records, and when it finds no reply the user's terminal selection is the fallback |
| ChatGPT, Grok, DeepSeek as webviews with per-agent persistent profile | included | user logs in by hand in the window. Feasibility unproven: Google sign-in may refuse embedded user agents, sites may show bot challenges to Electron — first task after `T00` is a spike on all three |
| DOM adapters: read last reply, insert text into input | included | one isolated adapter per site; breakage must not touch other adapters; only on a user action, never in a loop. Owner's risk: OpenAI and xAI terms restrict programmatic extraction of output |
| Forward to another window (action + window picker) | included | |
| Shared directory + manifest readable by other agents | included | markdown/JSON files. Claude Code reads the path itself; web agents cannot read files — the app inserts or attaches the content; API agents get it in the message or through a tool |
| OpenAI API provider | included | secondary, after the subscription/free-account paths work; key stored through Electron `safeStorage`; on Linux the app refuses to save a key when the backend reports plaintext (`basic_text`) |
| Other API providers (Anthropic API, Gemini, etc.) | absent | |
| Credential or captcha automation | absent | never |
| Release builds, signing, notarization, auto-update | absent | build packages locally only |
| Cloud sync, accounts, telemetry | absent | |
| Mobile | absent | |

## 4. Decided by the agent — never asked

Defaults; extend per project. The agent makes these calls, records them under a plan's `## Assumptions`, and explains them in one line.

- File layout, naming, formatting; modular code — no single giant file, modules split by responsibility.
- Library choice when the repo already uses one for the purpose; standard library over a new dependency.
- Test shape: unit for pure rules, integration through real boundaries for shared behavior, end-to-end only for the minimal happy path. Never test wording or layout.
- No speculative layers, base classes or options; the existing structure of the repository is followed, not replaced by a preferred one.
- Scope of validation for a change: the narrowest stable check that proves it, plus directly coupled risks.
- Isolation of parallel copies: ports, Compose project names, test databases and temporary directories are derived from the checkout path, so two worktrees never collide. Tests and dev runs never open the owner's real `userData` or webview partitions (those hold the logged-in sessions); they get a temporary directory per run.
- Which docs to update when behavior, contracts, setup or operations change.
- Electron process split (main/preload/renderer), IPC contract, module layout, UI styling that resembles Slack (own assets, no Slack branding), xterm.js and node-pty choice, shared-directory file format and manifest schema, OS-specific paths.
- Adapter selectors/fixtures for each site and how breakage is isolated.
- Where API keys are stored (OS keychain via Electron safeStorage).

## 5. Unattended policy

| May run alone | Must become `[!] BLOCKED` |
|---|---|
| tests, lint, type check, local builds | production deploy |
| launching the app with a throwaway profile (temporary `userData` and webview partitions) | payments, money movement |
| commits on the current branch | deleting user data, dropping tables |
| reading docs and public web | sending email/messages to real users |
| builds of unsigned packages for the host OS | new paid dependency or service account |

| Question | Answer |
|---|---|
| Platform reach | only macOS is verifiable by the session (no remote, no CI). Windows 11 and Ubuntu 26.04 are checked by the owner's manual smoke; `/plan` therefore never puts another OS into a code task's acceptance: the code task closes on macOS plus its tests, and per-OS verification is its own task, closed by the owner after the manual smoke (`[!] BLOCKED: needs <OS>` until then). Known per-OS pitfalls go to `docs/tech/` at `T00`: node-pty native rebuild for the Electron ABI and Windows ConPTY; Ubuntu's AppArmor restriction on unprivileged user namespaces breaking the Chromium sandbox of unpacked/AppImage builds |
| A non-production target is recognised by (database name, kube context, workspace, profile, host group) | n/a: no live backend. Tests never talk to the real chatgpt.com, grok.com, chat.deepseek.com or claude accounts unless the owner runs a named live-smoke command themselves |

Commands that need the owner, as prefixes; `git-guard` refuses them in every session:

```deny
git push
npm publish
electron-builder --publish
electron-builder -p
npx electron-builder --publish
npx electron-builder -p
xcrun notarytool
gh release
```

The electron-builder config sets `publish: never`, so a plain local build can never upload (`git-guard` matches word prefixes and would not see `-p` inside an npm script).

## 6. Gate checks

Two tiers. The harness runs what is declared here and nothing else; a tool the project does not list is not run.

### Fast tier

Commands that must exit 0 before any task is marked `[x]`. `/plan` copies them into every verify line. Unit tests, plus at most three heavy tests per task; the rest of the heavy tests belong to the full tier.

```
npx tsc --noEmit
npx eslint .
python3 scripts/coverage_gate.py --run
python3 scripts/lint_changed.py --base 2393fe1 --glob '*.sh' -- shellcheck -S warning
python3 scripts/lint_changed.py --base 2393fe1 --glob '.github/workflows/*.yml' --glob '.github/workflows/*.yaml' -- actionlint
python3 scripts/lint_changed.py --base 2393fe1 --glob '*' -- sh -c 'for f do gitleaks dir --no-banner --log-level error "$f" || exit 1; done' sh
gitleaks git --no-banner --log-level error --log-opts="2393fe1..HEAD"
```

`2393fe1` is the last commit before any code; linters see only what changed since it, committed or not. The first three lines exist after `T00` scaffolds the TypeScript project (eslint ignores `out/`, `dist/`, `coverage/`, `reports/`; with several tsconfigs for main/preload/renderer `T00` replaces `npx tsc --noEmit` by the equivalent `tsc -b` form, since a solution tsconfig checks nothing on its own); the coverage gate runs the unit and integration tests once, with coverage, and ratchets the floor — the tests are not run a second time without coverage. The gitleaks line through `lint_changed` covers uncommitted and untracked files (seen red on a planted GitHub token, green without it, gitleaks 8.25.1); the `git` line covers secrets added and removed inside history.

### Full tier

Run by the night full run and at the end of a milestone, never before a single `[x]`: the whole suite, mutation testing, fuzzing, long integration. The runner does not stop at a failing command; it reports every one. A red full run holds the milestone; surviving mutants become tasks and do not hold it.

```
#: budget=3m report=reports/junit-vitest-fast.xml list="npx vitest list tests/unit tests/integration"
npx vitest run tests/unit tests/integration --reporter=junit --outputFile=reports/junit-vitest-fast.xml
#: budget=6m report=reports/junit-vitest-full.xml list="npx vitest list tests/full"
npx vitest run tests/full --reporter=junit --outputFile=reports/junit-vitest-full.xml
#: budget=6m report=reports/junit-electron-smoke.xml list="npx playwright test --list --project=electron-smoke"
PLAYWRIGHT_JUNIT_OUTPUT_NAME=reports/junit-electron-smoke.xml npx playwright test --project=electron-smoke --reporter=junit
```

Budgets are provisional until `T00` measures a run; the whole-run budget below is the cap. Reporter and list flags (`vitest list`, `--sequence.shuffle`, the pool options) are confirmed against the versions `T00` pins (`docs/tech/`); a `--reporter` on the Playwright command line replaces the reporters of the config, so the JUnit path is given by `PLAYWRIGHT_JUNIT_OUTPUT_NAME` on the same line, not by the config. The night run repeats the unit and integration tests on purpose: it runs on a different state than any single task's fast tier.

A command may carry attributes on a `#:` line directly above it. Keys: `budget` (`40m`; over it the command is stopped with its children and reported `timeout`; without it, twice the last passing time), `expect` (a postcondition on the result; exit 0 with a failed `expect` is `empty`), `report` (JUnit XML the command writes), `list` (a command that lists the tests without running them — `pytest --collect-only -q`, `go test -list .`, `cargo nextest list`, `jest --listTests`), `shards` and `parallel` (the command uses `{shard}`/`{shards}`; shard 1 runs alone first and the rest start only after it passed its budget, its `expect` and its census), `repeat` with `reason` (a declared repetition; anything else that runs a test twice is a duplicate), `mem` (`512M`, `2G`; the peak of the command's process group is sampled every half second, over it the command is stopped and reported `mem`, which holds a milestone; without it, 75% of the machine's RAM), `leftover` (a command printing one number — databases, temp dirs, containers named by tests — counted before and after; growth is a finding). With `report` and `list` the run is censused: each test ran exactly once, every listed test ran, shards are disjoint. `{shard}` counts from 1, `{shard0}` from 0 — tools differ, check yours.

Census attributes belong on **test-runner** commands only, and `list=` must list exactly the selection the command runs (`pytest -m slow` pairs with `pytest --collect-only -q -m slow`, not with the whole suite). A mutation run executes the tests many times on purpose and reports mutants, not test cases: give it `budget`, `expect` on its own result files and `shards`, never `report`/`list`.

```text example-full-tier
#: budget=20m mem=2G shards=4 parallel=4 report=reports/junit-{shard}.xml list="pytest --collect-only -q" leftover="psql -Atc \"select count(*) from pg_database where datname like 'test_%'\""
pytest --splits {shards} --group {shard} --junitxml=reports/junit-{shard}.xml
#: budget=60m shards=8 parallel=4 expect="cat mutants-{shard}/mutants.out/caught.txt mutants-{shard}/mutants.out/missed.txt mutants-{shard}/mutants.out/timeout.txt | grep -q ."
cargo mutants --shard {shard0}/{shards} --baseline=skip --output mutants-{shard}
```

The first line uses pytest-split (`--splits N --group k`, groups from 1 — https://jerry-git.github.io/pytest-split/); the second cargo-mutants (`--shard k/n`, k from 0; `caught.txt`/`missed.txt`/`timeout.txt` in `mutants.out` — https://mutants.rs/shards.html, https://mutants.rs/mutants-out.html). Replace both with your project's own tools.

| Question | Answer |
|---|---|
| How a test is marked full-only here (marker, build tag, `#[ignore]`, a directory, a separate command) | directory `tests/full/` (pty and Electron smoke); everything else under `tests/unit/` and `tests/integration/` |
| Fast tier wall time at `T00`, seconds, from the run | measured at `T00` once the project exists |
| Full tier budget, minutes, whole run (over it: a finding, and `/test-audit` is due) | 15 |
| Audit: run in another order (a command, for `/test-audit`; e.g. `pytest -p random_order`, `go test -shuffle=on`) | `npx vitest run tests/unit tests/integration --sequence.shuffle` |
| Audit: run in parallel (a command, for `/test-audit`; e.g. `pytest -n 4`, `go test -p 4`, `cargo nextest run`) | `npx vitest run tests/unit tests/integration --pool=forks --poolOptions.forks.maxForks=4` |
| Audit: isolation between parallel workers (a command that runs two workers and fails when one sees the other's data) | n/a: no shared external resource; tests use per-test temp directories |
| Audit: calls to the external resource per test (a command printing `<test id> <count>` lines; PostgreSQL: `pg_stat_statements` deltas or driver tracing) | n/a |

Baseline accepted as-is (pre-existing failures tolerated): none (empty repository)

Coverage: the command, its report format, and where the floor lives (`.coverage-gate.json`). The ratchet
(`python3 scripts/coverage_gate.py --run`) belongs in the list above per task, or runs at `T00` and at the
plan's finish when the suite is slow — say which. The floor rises on its own; lowering it is a decision
recorded here, with a date and a reason, and never a way to make a check pass.

| Question | Answer |
|---|---|
| Coverage command | `npx vitest run tests/unit tests/integration --coverage --coverage.reporter=json-summary` (the `command` key of `.coverage-gate.json`, written at `T00`) |
| Report format (`coverage-py` / `json-summary` / `cobertura` / `lcov` / `go`) | json-summary, `coverage/coverage-summary.json` |
| Floor today (from the tool, not from memory) | recorded at `T00` with `--set-floor` |
| Ratchet per task or per plan | per task |
| Areas deliberately left uncovered, and why | none yet; DOM adapters are covered by recorded HTML fixtures, not live sites |

## 7. Delivery

| Question | Answer |
|---|---|
| Commit per task or per plan | per task, `T##: <what>` |
| Branch policy | the branch named in the plan; main is not committed to by `/run`; no push |
| Who reviews before merge | owner |

## 8. Disclosure required by the receiving repository

Read the target's `CONTRIBUTING.md` / `AGENTS.md` before filling this in; the answer belongs to them, not to us. `none` means the repository asks for nothing and nothing is volunteered. A wording means it is inserted verbatim into the pull-request body. An open cell blocks opening a pull request there.

| Target | What it requires | Wording to use |
|---|---|---|
| this repository | none | none |

Whatever this says, a direct question from a person is answered by the owner, not by the session, and the session never writes in their voice outside this machine.

## 9. Owning docs

Read before working in the area. Prefer `.claude/rules/<area>.md` with `paths:` so this loads automatically.

| Area | Document |
|---|---|
| Whole app | `AGENTS.md` Map; `docs/tech/` once created |

## 10. Fingerprint

The signal files of the repository when this file was last reconciled with it: manifests, lint/test/type configs, build and CI files, container files, test and migration directories. `scripts/project_check.py` compares it with the repository and reports what appeared or disappeared since; a new line inside a manifest is not a change of this kind. After reconciling (`/intake refresh`), run `python3 scripts/project_check.py --refresh-fingerprint`.

```fingerprint
commit 6373980918e2
```
