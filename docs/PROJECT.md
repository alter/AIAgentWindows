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
| Stack (from the machine, with versions) | Electron 44.6.0, node-pty 1.1.0, xterm 6.0.0, TypeScript 6.0.3 (not 7: typescript-eslint supports `<6.1.0`), vitest 5.0.3, Playwright 1.63.0, electron-builder 26.17.0; Node v22.22.0, npm 10.9.4, Python 3.14.8 (repo scripts only); targets macOS, Windows 11, Ubuntu 26.04; `claude` 2.1.306, `codex` 0.159.2. Each pinned version is studied in `docs/tech/<name>@<version>.md`; every claim below has its evidence in `docs/EVIDENCE.md` |

## 2. Goal

| Question | Answer |
|---|---|
| What must work end to end first | Slack-like window: sidebar of agents; any number of Claude Code (and Codex CLI) windows, the first journey proving two (interactive `claude` in a pty under the user's own subscription login) plus ChatGPT, Grok, DeepSeek in persistent-profile webviews; "Forward" a message/selection to a chosen window; write context to the shared directory with a manifest that other agents read |
| What the first version must NOT do | Automate login, passwords or captchas; use Anthropic API keys for Claude Code or OpenAI API keys for Codex (both run on the user's subscription login); scrape beyond the visible chat; auto-update; cloud sync; release signing/publishing |

## 3. Capability ledger

One state per row: `included` (present, expected to work) · `available` (partly there; note says what is missing) · `absent` (not part of this project; build only on request) · `removed` (deleted on purpose; restore only on request). No row means `absent`.

| Capability | State | Note |
|---|---|---|
| Slack-like shell (agent sidebar, tabs, multiple windows) | included | built in 10-app-shell/01: one window, sidebar with a "+" menu, selection switches the content area, agent list restored at start. Not built yet: tabs, several app windows |
| Claude Code windows, subscription, interactive CLI in pty (xterm.js) | included | the unmodified `claude` under the user's own login, no API key (CC14). Started through the login shell on macOS/Linux (CC2, CC3), with a fresh `--session-id` and `--add-dir <shared dir>` in a directory the user picks; reopened with `--resume`. The last reply comes from the transcript, never from the screen (CC6–CC10). The app never answers the trust dialog for the user: its default choice exits (CC13). The spawned environment drops `CLAUDE_CODE_CHILD_SESSION`, otherwise the window saves no transcript (CC17). Mechanics: `docs/tech/claude-code@2.1.306.md`. Built in 10-app-shell/01: spawn through the login shell, `--session-id`, `--add-dir <shared dir>`, restore with `--resume` only when the transcript exists, otherwise `--session-id` again (`src/shared/restore.ts`); not built: last reply, trust-dialog handling beyond leaving it to the user |
| Codex CLI windows, ChatGPT subscription, interactive CLI in pty | included | owner's request 2026-10-21; same model as Claude Code under the user's ChatGPT sign-in (CX1, CX14). No session id at launch: the window claims its rollout file (CX3–CX6), reopens with `codex resume`. Startup dialogs (update, whose default runs `curl … \| sh`; folder trust) are the user's to answer (CX2). Rollouts are being migrated to a paginated form, so the parser is checked on both (CX15). Mechanics: `docs/tech/codex@0.159.2.md`. Built in 10-app-shell/01: lazy rollout claim (on add, on quit, before restore) and `codex resume <id>`; an unclaimed window restores as a fresh `codex` in its folder; only the first-line rollout form is covered, the paginated form (CX15) is not |
| Files and images into an agent window | included | owner's request 2026-10-21. CLI windows: a dropped file is pasted as its quoted path (F1); `Ctrl+V` (`Alt+V` on Windows, F7) always goes to the pty untouched, the CLI reads text or image from the OS clipboard itself (F2, F3). Clipboard-image paste into Codex failed in the app's pty (CX10) — open until CX11 says whether an ordinary terminal does better. Web windows: native drag-and-drop and paste (F8, open). Forwarding a file: saved to the shared directory; a CLI gets its path, a web chat gets it through its file input set from the main process (F5, F6). Built in 10-app-shell/01: Ctrl+V/Alt+V raw to the pty and dropped paths pasted single-quoted POSIX style (Windows quoting is a per-OS task); forwarding a file is not built |
| Voice input | included | owner's request 2026-10-21, pass-through only: Claude Code `/voice` (V1), Codex `/voice` (CX12), the sites' own voice buttons (V6). Microphone for CLI children goes through the app's own permission (V3; attribution to the app is V2, open) and to webviews only for the configured sites' origins (V4); those origins also get `persistent-storage`, every other permission (geolocation included) is refused (W16). OS dictation (macOS Dictation, Windows `Win+H`; none built into Ubuntu) is expected to type into any input (V7, open) |
| App-level speech-to-text (own recognizer for any window) | absent | build only on request |
| ChatGPT, Grok, DeepSeek as embedded views with per-agent persistent profile | included | `WebContentsView`, not the discouraged `<webview>` tag (W11); `persist:` partition per agent (W9). The user signs in by hand (W8); every site view has Back, Forward, Home (the site's start page) and Reload, because a refused sign-in (Google, W7) otherwise strands the user on a foreign page — reported by the owner during the sign-in check (NOTES of `tasks/05-feasibility/01-evidence-table`); Back and Home are smoke-tested in `spikes/nav-smoke.out`, Forward and Reload are not yet. Logged out, ChatGPT and Grok load with a chat input and no challenge (W1, W2, W6; no prompt was sent); DeepSeek requires sign-in and refuses Electron's default user agent (W3–W5): its view sends the user agent without the `Electron/…` token (D1, decided by the owner; client hints still say Chromium, W15). "Sign in with Google" is refused in an embedded view by Google's policy (W7): the user signs in by email, Apple or the site's own account. Facts: `docs/tech/chat-sites@2026-10-21.md`. Built in 10-app-shell/01: `src/main/site-views.ts` (view per agent, `persist:<id>` partition, no preload, same-origin media/persistent-storage only, popups in a child window with the same partition) and a renderer navigation bar with Back, Forward, Home, Reload; Home and Back are covered by the Electron smoke against a local page, Forward and Reload are not |
| DOM adapters: read last reply, insert text into input | included | remote pages get no preload and no IPC; adapters run from the main process in an isolated world (W10), so a hostile page cannot reach the pty, files or keys (an `/attack` target once adapters exist); one isolated adapter per site; only on a user action — a Room run started by the owner counts as one, and then the adapters run in a loop for the rounds the owner set (owner's decision 2026-10-21). The framework (`src/main/site-adapters/`: insert as literal text through input events, submit, generating/done polling, last reply, file attach through CDP) is built and tested on `tests/fixtures/sites/generic.html`; the three per-site adapters wait for the owner's page capture. Owner's risk, confirmed in the current terms: OpenAI forbids programmatic extraction of Output (W12), xAI forbids bot access (W13), DeepSeek forbids automatic capture (W14) |
| Room: broadcast and relay rounds over agents | included | owner's request 2026-10-21. A "Room" item at the top of the sidebar: one prompt to all chosen participants, or a relay A→B→C→…→A for N rounds where each participant receives the whole room history. Owner's decisions 2026-10-21: no confirmation between steps; the room runs its own CLI sessions in read-only modes (`claude --permission-mode plan`, `codex --sandbox read-only`), so another model's output never reaches a session that can write files or run commands; web chats take part through their adapters, terms risk accepted by the owner (W12–W14); the history is kept as markdown in the shared directory; the final result is carried into a chosen working session by "Carry result" (pasted, not submitted; CLI working sessions only; refused while a run is in progress). Built in 10-app-shell/02-room: orchestrator, CLI turn driver that runs one non-interactive process per turn (`claude -p --output-format stream-json`, `codex exec --json`; no terminal, so no start-up dialog can receive a keystroke) and takes the reply and the end of the turn from the CLI's own JSON (CC29–CC31, CX27–CX30), read-only room sessions (CC18, CC22, CX17), feed rendered with `textContent`, history file `<shared>/rooms/<id>.md`; smoke runs on stub CLIs. ChatGPT, Grok and DeepSeek take part through one generic site adapter (T22: the composer nearest the bottom of the page, Enter then the nearest send button, end of reply by a stop button or by the reply text going quiet, reply = the conversation text after the submitted prompt; no per-site selectors, because the capture cannot keep the sites' class names); it is tested on jsdom fixtures only, so its behaviour on the real pages is the owner's check (AC7); a web participant whose page fails ends as an `error` entry and the run goes on. Owner's request 2026-10-22: participants become instances, so one CLI can take part several times with its own model and effort (Fable 5.1; Opus 5.5 effort high; Sonnet 5.5 effort medium); model names are the CLI's own aliases, never a list kept by the app — 10-app-shell/03-room-participants. Owner's request 2026-10-23: room CLI participants get the internet (web search and fetching any page; files and shell stay off): claude `--tools …,WebSearch,WebFetch --allowedTools WebSearch,WebFetch` under plan mode, codex `-c web_search="live"` (CC32, CC33, CX33, CX34); the room prompt intro tells CLI participants the web is available — 02-room T40; the feed is grouped by round with collapsed entries and the final open with Copy above and below — 02-room T41. Owner's request 2026-10-22, built in 10-app-shell/04-room-archive: every room is a JSON record `<shared>/rooms/<id>.json` next to its markdown history, written atomically after every entry and status change; the Room pane lists saved rooms (newest first, unreadable ones disabled and never rewritten), opens one with its feed and settings, and Start continues the room on screen with a new prompt (same id, history file and nonce; earlier entries go to the participants; CLI sessions start fresh); New room starts a fresh one; at app start a record left running is rewritten as stopped and the most recent room is opened; nothing is relaunched |
| Forward to another window (action + window picker) | included | forwarded text is pasted, never submitted (CC11, CX9): the user presses Enter. It is another model's output reaching an agent with tools; the app never launches `claude` with `--dangerously-skip-permissions` (CC15), nor `codex` with `--dangerously-bypass-approvals-and-sandbox` (CX13) or a looser sandbox/approval policy than the user's own |
| Shared directory + manifest readable by other agents | included | markdown/JSON files. CLI agents read the path themselves: Claude Code through `--add-dir` (CC4, CC5), Codex through its whole-disk read access (CX8); web agents get the content inserted or attached; API agents get it in the message or through a tool |
| Import of existing local Claude Code / Codex sessions | included | owner's request 2026-10-21; only by the owner's choice, nothing imported automatically: a picker shows each session's title, folder, last activity, with filters "yesterday", "this week", "all"; opens with `--resume`/`codex resume` in the session's own folder (CC6, CX16). After 10-app-shell/01 |
| OpenAI API provider | included | secondary, after the subscription/free-account paths work; key stored through Electron `safeStorage`; on Linux the app refuses to save a key when the backend reports `basic_text` (K1) |
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
- Isolation of parallel copies: ports, Compose project names, test databases and temporary directories are derived from the checkout path, so two worktrees never collide. Tests and dev runs never open the owner's real `userData` or webview partitions (those hold the logged-in sessions); they get a temporary directory per run. Tests never spawn the real `claude` or `codex` (that spends the owner's subscription): pty tests run a stub CLI that echoes input and writes a transcript in the recorded format into a temporary `CLAUDE_CONFIG_DIR` / `CODEX_HOME`.
- Which docs to update when behavior, contracts, setup or operations change.
- Electron process split (main/preload/renderer), IPC contract, module layout, UI styling that resembles Slack (own assets, no Slack branding), xterm.js and node-pty choice, shared-directory file format and manifest schema, OS-specific paths.
- Adapter selectors/fixtures for each site and how breakage is isolated.
- Where API keys are stored (OS keychain via Electron safeStorage).
- Pinned versions: newest release at least two weeks old, unless a study in `docs/tech/` shows an incompatibility (TypeScript 6.0.3 instead of 7.0.2).

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
| Platform reach | only macOS is verifiable by the session (no remote, no CI). `/plan` never puts another OS into a code task's acceptance: the code task closes on macOS plus its tests, and per-OS verification is its own task, closed by the owner after the manual smoke (`[!] BLOCKED: needs <OS>` until then). Per-OS facts: node-pty needs `chmod +x` on its prebuilt `spawn-helper` (P2) and builds from source on Linux (P1); Windows uses ConPTY (P3); Ubuntu's AppArmor userns restriction needs the electron-builder `.deb` profile (P5). Open per-OS claims: CC16, P4, P6 in `docs/EVIDENCE.md` |
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

Every electron-builder command in the project carries `--publish never`, and no npm script is named `release`: without an explicit `--publish`, electron-builder publishes on its own under `npm run release`, a CI tag or CI detection (G10). `git-guard` matches word prefixes and would not see a publish flag inside an npm script.

## 6. Gate checks

Two tiers. The harness runs what is declared here and nothing else; a tool the project does not list is not run.

### Fast tier

Commands that must exit 0 before any task is marked `[x]`. `/plan` copies them into every verify line. Unit tests, plus at most three heavy tests per task; the rest of the heavy tests belong to the full tier.

```
npx tsc --noEmit
npx eslint .
python3 scripts/coverage_gate.py --run
python3 -m unittest discover -s tests/scripts
python3 scripts/evidence_check.py
python3 scripts/arch_check.py
python3 scripts/check_publish_flags.py
python3 scripts/lint_changed.py --base 2393fe1 --glob '*.sh' -- shellcheck -S warning
python3 scripts/lint_changed.py --base 2393fe1 --glob '.github/workflows/*.yml' --glob '.github/workflows/*.yaml' -- actionlint
python3 scripts/lint_changed.py --base 2393fe1 --glob '*' -- sh -c 'for f do gitleaks dir --no-banner --log-level error "$f" || exit 1; done' sh
gitleaks git --no-banner --log-level error --log-opts="2393fe1..HEAD"
```

`2393fe1` is the last commit before any code; linters see only what changed since it, committed or not. The shellcheck and actionlint lines have had no input yet and so have never been red (G3). The first three lines exist after `T00` scaffolds the TypeScript project (eslint ignores `out/`, `dist/`, `coverage/`, `reports/`; with several tsconfigs for main/preload/renderer `T00` replaces `npx tsc --noEmit` by the equivalent `tsc -b` form, since a solution tsconfig checks nothing on its own); the coverage gate runs the unit and integration tests once, with coverage, and ratchets the floor — the tests are not run a second time without coverage. The gitleaks line through `lint_changed` covers uncommitted and untracked files (seen red on a planted GitHub token, green without it, gitleaks 8.25.1); the `git` line covers secrets added and removed inside history.

### Full tier

Run by the night full run and at the end of a milestone, never before a single `[x]`: the whole suite, mutation testing, fuzzing, long integration. The runner does not stop at a failing command; it reports every one. A red full run holds the milestone; surviving mutants become tasks and do not hold it.

```
#: budget=3m report=reports/junit-vitest-fast.xml list="npx vitest list tests/unit tests/integration"
npx vitest run tests/unit tests/integration --reporter=junit --outputFile=reports/junit-vitest-fast.xml
#: budget=6m report=reports/junit-electron-smoke.xml list="npx playwright test --list --project=electron-smoke"
PLAYWRIGHT_JUNIT_OUTPUT_FILE=reports/junit-electron-smoke.xml npx playwright test --project=electron-smoke --reporter=junit
```

Budgets are provisional until `T00` measures a run; the whole-run budget below is the cap. Reporter, list and order flags are confirmed for the pinned versions (G5, G8 in `docs/EVIDENCE.md`); a `--reporter` on the Playwright command line replaces the reporters of the config, so the JUnit path is given by `PLAYWRIGHT_JUNIT_OUTPUT_FILE` on the same line (`…_OUTPUT_NAME` resolves against the config directory and would work as well with a root config, G7), not by the config. The full tier is the whole suite, unit and integration included; within one run each test runs once (the three directories are disjoint), so this is not a repetition.

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
| How a test is marked full-only here (marker, build tag, `#[ignore]`, a directory, a separate command) | directory `tests/full/`, run by Playwright (`electron-smoke`). The vitest line for `tests/full` was removed 2026-10-21: the first full run reported it `empty` (no vitest test lives there, FULLRUN-2026-10-21-171409079665 of tasks/10-app-shell/01-app-skeleton); it comes back when a vitest test is added there; everything else under `tests/unit/` and `tests/integration/` |
| Fast tier wall time at `T00`, seconds, from the run | measured at `T00` once the project exists |
| Full tier budget, minutes, whole run (over it: a finding, and `/test-audit` is due) | 15 |
| Audit: run in another order (a command, for `/test-audit`; e.g. `pytest -p random_order`, `go test -shuffle=on`) | `npx vitest run tests/unit tests/integration --sequence.shuffle` |
| Audit: run in parallel (a command, for `/test-audit`; e.g. `pytest -n 4`, `go test -p 4`, `cargo nextest run`) | `npx vitest run tests/unit tests/integration --pool=forks --maxWorkers=4` (`poolOptions` was removed in vitest 4, G6) |
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
| Floor today (from the tool, not from memory) | 100.00 (`.coverage-gate.json`, tolerance 0.2), over `src/shared/**`, `src/main/pty-manager.ts`, `src/main/state-file.ts`; 124 tests at 2026-10-21 |
| Ratchet per task or per plan | per task |
| Areas deliberately left uncovered, and why | Electron glue in `src/main/` other than `pty-manager.ts` and `state-file.ts` (`index.ts`, `ipc-handlers.ts`, `menu.ts`, `site-views.ts`; `agent-controller.ts`, `codex-rollouts.ts` and `claude-transcripts.ts` have integration tests but are outside the coverage include) and `src/preload/` and `src/renderer/` DOM code: they need a running Electron, so the full tier's Playwright `electron-smoke` is their check. Site views have only the smoke against a local page, never the real sites. DOM adapters, when built, are covered by recorded HTML fixtures, not live sites |

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
| Whole app | `AGENTS.md` Map |
| Any pinned technology | `docs/tech/<name>@<version>.md` |
| Any claim about how the product works | `docs/EVIDENCE.md` (checked by `scripts/evidence_check.py`) |

## 10. Fingerprint

The signal files of the repository when this file was last reconciled with it: manifests, lint/test/type configs, build and CI files, container files, test and migration directories. `scripts/project_check.py` compares it with the repository and reports what appeared or disappeared since; a new line inside a manifest is not a change of this kind. After reconciling (`/intake refresh`), run `python3 scripts/project_check.py --refresh-fingerprint`.

```fingerprint
commit f14c64f9af7d
.coverage-gate.json
eslint.config.mjs
package.json
tests/
tsconfig.json
vitest.config.ts
```
