# AGENTS.md

Shared instructions for every coding agent in this repository. `CLAUDE.md` imports this file (`@AGENTS.md`); do not duplicate rules there. The personal working contract in `~/.claude/CLAUDE.md` still applies on top.

## Source of truth

- `docs/PROJECT.md` owns scope, the capability ledger, decisions the agent makes alone, the unattended policy and the gate checks. Read it first. A capability with no ledger row is `absent`; dormant code or an old doc is not a requirement.
- `docs/plans/<slug>.md` owns the current task list. Work from it; update it; never delete tasks.
- Runbooks in `docs/` own setup and operations. Verify against code, scripts and runtime output rather than trusting a stale doc; update the doc when behavior, contracts, setup or operations change.

## Map

Read the owning guide before changing an area; read only the sections you need. `/intake` fills this table.

| Area | Path | Read first |
|---|---|---|
| Main process | `src/main/` (window, IPC handlers, agent controller, pty manager, site views, state file, Codex rollout and Claude transcript lookup; Room: `room.ts` orchestrator, `room-drivers.ts` CLI and site participant drivers, `room-service.ts` state and IPC, `cli-turn.ts` one CLI process per turn (`claude -p`, `codex exec --json`), prompt on stdin; `site-adapters/` one generic site adapter (no per-site selectors) run in an isolated world; `capture-sites.ts` the owner's page-structure capture; `site-adapters/decide.ts` the pure turn decision rules, `recorder.ts`, `network-tap.ts` and `replay.ts` the opt-in site debug recording and its offline replay, `docs/site-debug.md`; `openrouter/` OpenRouter account (PKCE loopback sign-in, safeStorage key store, models), Room chat driver and streaming chat agent with its conversation store) | `docs/tech/electron@44.6.0.md`, `docs/tech/node-pty@1.1.0.md`, for OpenRouter `docs/tech/openrouter@2026-10-23.md`, for the Room `docs/tech/claude-code@2.1.306.md`, `docs/tech/codex@0.163.0.md` |
| Store | `src/main/store/` (`atomic-file.ts` exclusive temp + rename and the stale-temp sweep, `json-file.ts` size cap, parse and the fail-closed rule; used by `state-file.ts`, later `app-state.ts` and Save plan; imports no `electron`) | `docs/plans/projects.md` D18 |
| Preload | `src/preload/` (the app renderer's `contextBridge` only; remote views get no preload) | `docs/tech/electron@44.6.0.md` |
| Renderer | `src/renderer/` (DOM UI, xterm panes, `room-pane.ts` Room pane, `room-tree.ts` and `sidebar.ts` DOM of the sidebar tree on `shared/sidebar-tree.ts`, `room-feed.ts` feed by rounds with `<details>` spoilers built with `textContent`; `openrouter-account.ts` sidebar OpenRouter block, `openrouter-pane.ts` OpenRouter chat pane, `room-openrouter-row.ts` OpenRouter cells of a Room row; imports no Node or main-process module) | `docs/tech/xterm@6.0.0.md` |
| Shared | `src/shared/` (pure types and rules: agent state schema, CLI argv builder, restore, Codex claim, site policy, IPC validation; Room model, relay schedule, history and prompt builder, CLI print-output reader (`cli-print.ts`), turn-signal parsers and start-up dialog detector (kept, unused by the room since T20), room view reducer, `sidebar-tree.ts` sidebar tree reducer (section → item, collapse, selection; the room tree and the Agents list render from it), capture sanitizer; the coverage target) | `docs/PROJECT.md` §6 |
| Scripts | `scripts/` (build, postinstall, gate checks: arch_check, coverage_gate, evidence_check, check_publish_flags, project_check, lint_changed; `neutrality_check.py <commit> <vitest-list.json>` for behaviour-neutral refactors; `capture-sites.mjs` behind `npm run capture-sites`) | `docs/PROJECT.md` §6 |
| Tests | `tests/unit/`, `tests/integration/` (fast tier), `tests/full/` (Playwright `electron-smoke`), `tests/scripts/` (Python), `tests/fixtures/` (stub CLI that writes Claude and Codex transcripts, local site page, `sites/` captured page structures for the adapters); tests never spawn a real CLI and never load a real site | `docs/PROJECT.md` §5, §6 |

## Engineering

- Fix the owning cause, not a symptom in a caller. A cross-layer bug may have a one-file fix; verify affected callers.
- Smallest coherent change with clear ownership. Small duplication beats the wrong shared abstraction. Remove workarounds when their cause is fixed.
- Match investigation to the change: contracts need producer, consumer, serializer and read/write checks; auth and routing need enforcement, guards and state; async work needs retries, idempotency, ordering, cancellation and failure visibility.
- Architecture rules live in checks, not prose: put layering and import boundaries into a check that exits non-zero and reports `path:line [rule] message` — the tool the project already uses for it (an import contract, a dependency linter, a module-boundary rule of the build), or a short script — and list it under gate checks.
- Reproducible bug → failing regression test first, then the fix, then the original reproduction again.
- A behaviour change carries its test, and that test was seen failing before the change. Coverage may not fall: the floor in `.coverage-gate.json` rises by itself and is lowered only as a recorded decision. A check that has never been red does not count — break the code in a scratch copy once and keep the red output.

## Validation

- A check passes only when the behavior is correct and the command exits 0. Report failed or unavailable checks plainly; a task with broken primary behavior is not done.
- Run the baseline once before the first edit to separate pre-existing failures from new ones; record it in the plan's `## Log`.
- Narrowest stable check per change; the full gate list before a task is marked `[x]`; broad regression only for cross-cutting changes or release.
- End-to-end tests only for the minimal product-critical path; assert outcomes (persisted data, navigation), never wording or layout.
- Tests that use an external stateful resource (a database, a queue, a bucket):
  - a shared "world" built once is reached by read-only tests through a read-only connection (PostgreSQL: `SET default_transaction_read_only = on`, or a role with `SELECT` only), so a test that starts writing fails at once instead of poisoning the tests after it;
  - a fast world builder that bypasses the product's service layer (one SQL function, a bulk `INSERT … RETURNING`) has an equivalence test in the full tier: the world built both ways, table snapshots compared; at least one test per entity still goes through the service layer;
  - a resource named after a process (`test_<pid>_…`) has a sweeper that drops the ones whose process is gone, and the full tier declares a `leftover=` count for it;
  - parallel workers each get their own resource, and the distribution keeps a module on one worker when the resource is per module (pytest-xdist: `--dist loadfile` or `loadscope`, not `load`);
  - fewer calls per test before more workers: build what read-only tests share once, batch independent calls; the number of workers comes from measured peak memory, not from the number of cores.

## Git and workspace

- Inspect `git status --short --branch` and `git remote -v` before any git operation. Work on the branch the plan names; never switch mid-run. Stage by path, never `git add -A` (submodule pointers, marker files).
- Never `git stash`, `reset --hard`, `clean`, or `checkout -- .` to make progress. If uncommitted user changes block you, stop that task with `[!] BLOCKED` and continue with others.
- Commit per finished task when `docs/PROJECT.md` says so; message `T##: <what changed>`. Never push unless asked.
- Scratch goes to `.claude/scratch/`, never the repo root. Remove your own scratch when done.
- Never stop or kill processes to free a port; use another port.
- Parallel copies of this repository (worktrees of parallel workers, a night run beside a day session) share nothing mutable. Derive every local resource from the copy's path: ports, Compose project names, test database names, temporary directories, local buckets. A test database name ends in `_test` and a test refuses to run against any other; tearing down a database another copy may be using is never done.
- Secrets, tokens, cookies, customer data and raw `.env` values never appear in logs, tests, fixtures or replies. Never weaken auth, validation, rate limits or auditability to pass a check.
- Generated files change through their generator (schema → migration), never by hand.

## Reporting

- What changed, why, which checks ran with their results, remaining risk or blocked items, suggested commit message. No headings for their own sake, no restating the task.
