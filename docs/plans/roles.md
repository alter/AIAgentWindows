---
status: draft
created: 2026-10-24
---
# Roles and an orchestrator inside a project

## Goal
Inside a project the owner assigns roles to models (for example 3× Claude Sonnet programmers, Claude Haiku web researcher, Codex + Claude Fable architects, OpenRouter GLM secops). An orchestrator model (a CLI kind, for example Claude Opus effort high) routes work and context between them on its own: implementation → testing → secops attack → architects patch → back. Code moves between roles as git branches, not as text: every writing role works in its own worktree and branch, testers and secops take the programmer's branch into their own worktree, and finished work is merged by the app into an integration branch of the project that the owner merges into their working branch by hand. Nothing is pushed. Drafted 2026-10-24 from `docs/plans/projects.md` after the agent's review; starts after the owner's real project-room run (projects AC5) and after T03 of that plan says which write-mode flags exist.

## Entry condition
- `docs/plans/projects.md` closed (T09) and its AC5 run done by the owner
- `docs/tech/claude-code@2.1.308.md` and `docs/tech/codex@0.164.0.md` hold the write-mode and hook-isolation facts (projects T03); `docs/tech/git@2.50.1.md` holds the worktree facts (projects T02)

## Acceptance criteria
- [ ] AC1 Fast tier green after every task: every command of docs/PROJECT.md §6 fast tier exits 0; electron-smoke exit 0; `python3 tasks/check.py` no new problem
- [ ] AC2 Roles: a project holds a roles table (role name, agent kind, model, effort, count, instructions, writes yes/no); a smoke run creates the owner's example set; a writing role with a web or OpenRouter kind is refused with a reason
- [ ] AC3 Worktrees: on a temporary repository the manager creates a worktree and branch per writing role instance at a stable path under the app's data folder, updates a worktree to another role's branch, pulls the integration branch into a role branch before a new task, merges a role branch into the integration branch in the app's own worktree with `--no-ff`, reports a conflict as a failed step and keeps the role branch, removes worktrees on project delete; the owner's working tree is never touched (integration test)
- [ ] AC4 Orchestrator: an integration run on stub CLIs (which write a file in their worktree) and the fake OpenRouter server goes programmer → tester → secops (finding) → architect → programmer → tester → done; every handoff carries the orchestrator's message and, for code, the branch the receiving role is updated to; the merge lands on the integration branch; two consecutive failed turns of one role stop the run with a readable reason; Stop kills every running CLI turn and aborts every request; a run left running at app start is rewritten as stopped
- [ ] AC5 Isolation: a writing Claude turn runs with the flags T03 found (no `bypassPermissions`, no `--dangerously-skip-permissions`), a writing Codex turn with `--sandbox workspace-write` and never `--dangerously-bypass-approvals-and-sandbox`; the argv builder test proves both; tester and secops branches are never merged (test)
- [ ] AC6 HUMAN (excluded from /run): the owner runs a real orchestrated task on a real project

## Stack
As `docs/plans/projects.md`; git 2.50.1 per docs/tech/git@2.50.1.md.

## Decisions
- D1 Writing roles each get their own git worktree and branch (owner, 2026-10-24).
- D2 The orchestrator decides and hands off on its own, with no step limit and no spend limit (owner: "Полностью сам, без лимитов"). Repeated failure is not spend: two consecutive failed turns of one role stop the run (agent's review 3.7, accepted by "перепиши").
- D3 Merge target is an integration branch `aiaw/<project>/integration`, kept in a worktree owned by the app; the app performs the merge when the orchestrator says so; the owner merges the integration branch into their working branch by hand. Replaces the owner's "merges into the working branch" after the review (3.2: a ref checked out in the owner's folder cannot be moved safely, a dirty owner tree blocks a merge there) — owner: "перепиши", 2026-10-24. Push stays out.
- D4 Secops and testers may do anything — read, run tests and exploits, use the internet — but only in their own worktree; their changes are never merged; they report to the orchestrator (owner). Their worktree is updated to the programmer's branch (`reset --hard`) before each task (review 3.1).
- D5 Code travels as branches: a handoff that passes code names the branch, the manager updates the receiving worktree; text roles (web, OpenRouter, architects) get `git diff <base>..<branch>` with a size cap (review 3.1).
- D6 The orchestrator is a CLI kind only (resumable session with the CLI's own compaction); web and OpenRouter kinds are refused as orchestrator because the app would resend the whole history every call (review 3.6).
- D7 Writing roles are CLI kinds only; the app never launches `claude` with `bypassPermissions` or `codex` with `--dangerously-bypass-approvals-and-sandbox`; the exact write flags, sandbox settings and hook isolation come from projects T03. This reverses the Room rule "another model's output never reaches a session that can write files" for roles only, and the ledger row says so with the limits (review 3.4, 3.5).
- D8 Worktree paths are stable per role instance (`<userData>/worktrees/<projectId>/<role>-<n>`) so a CLI session tied to its cwd survives between tasks (review 3.9). A project may carry a setup command run once in a fresh worktree (review 3.9).
- D9 A programmer worktree pulls the integration branch before every new task; a conflict is a failed step reported to the orchestrator (review 3.3). At the start of every role run the owner's working branch is merged into the integration branch, so work the owner merged and continued is the base; a conflict there stops the run before any turn (second review 9).
- D11 A project without a commit gets an empty initial commit before the first worktree; missing `user.name`/`user.email` is refused with a readable error naming the git command to fix it, the app never sets identity itself (second review 10).
- D12 A failed turn is classified: a subscription or provider limit (CLI result or HTTP 429 with a reset time) is reported as "limit, resets at HH:MM" and stops the run as paused-by-limit, distinct from a real failure; the two-consecutive-failures rule of D2 counts real failures only (second review 11).
- D10 The orchestrator's reply is text with one trailing fenced `handoff` block (JSON: `to`, `message`, optional `branch`, or `merge`/`done`); an unparseable reply goes back once with the error, then the run stops (review 3.10).

## Assumptions
- A role run is recorded like a room (JSON record, atomic writes, entries per step) so a quit mid-run leaves a readable record; resuming a role run is not in this plan.
- Role instances with Bash run on the owner's machine with the owner's credentials; the worktree isolates git state, the CLI sandbox (T03) isolates files and network where the CLI offers it; the UI says so once when the first writing role is added.
- Dependencies of a project are not installed by the app; the setup command (D8) or the role itself does it.

## Out of scope
- Pushing, pull requests, releases
- Resuming a stopped role run from its last step
- Merging into the owner's working branch (owner's hand, D3)
- Roles outside a project

## Tasks
- [ ] T00 Baseline: run the gate list once on the current tree; record vitest count, coverage, smoke count and tasks/check.py count in the Log; branch per the repository's pattern — verify: Log line exists
- [ ] T01 Ledger and tree: docs/PROJECT.md row "Roles and orchestrator" with D1–D10 and the D7 reversal spelled out; phase `tasks/30-roles/` with children 01–05; tasks/DECISIONS.md D6 (model output into a writing session: allowed for roles only, with the limits) — verify: `python3 tasks/check.py` no new problem
- [ ] T02a Study git worktrees: extend docs/tech/git@<installed>.md — add/remove/prune, `--detach`, a branch checked out in another worktree, moving a ref checked out elsewhere, merge in a dirty tree, `merge --no-ff` into a branch held in a separate worktree, worktree of a repository without commits — verify: tasks/check.py no item without URL
- [ ] T02 Study orchestration: how existing multi-agent tools route work and context between heterogeneous agents (Claude Code subagents and `--worktree`, Codex, OpenHands, AutoGen, CrewAI, LangGraph supervisor): handoff message shape, shared state, how code is passed, stop rules; docs/tech/orchestration@2026-10-24.md — verify: tasks/check.py no item without URL
- [ ] T03 Task 30-roles/01-roles-table: roles table per project (D7 and D6 refusals), the owner's example as a preset, kept in the project record — verify: AC2 + fast tier + electron-smoke
- [ ] T04 Task 30-roles/02-worktrees: worktree manager on a temporary repository (create, update to branch, pull integration, merge `--no-ff` into the integration branch in the app's worktree, conflict = failed step, remove, working branch into integration at run start (D9), initial commit and identity check (D11)) — verify: AC3 + fast tier
- [ ] T05 Task 30-roles/03-role-turns: writing CLI turns in a worktree with the T03 flags (argv builder + tests), text roles through the existing drivers with the diff of D5, the setup command — verify: AC5 + integration on stub CLIs + fast tier
- [ ] T06 Task 30-roles/04-orchestrator: orchestrator loop with the handoff block (D10), code handoff (D5), failure stop (D2) with limit classification (D12), feed of steps, Stop, merge on `merge`/`done` — verify: AC4 + fast tier + electron-smoke
- [ ] T07 Task 30-roles/05-run-record: role run record written atomically after every step, rewritten as stopped at app start, shown in the project's tree — verify: AC4 record part + fast tier + electron-smoke
- [ ] T08 Close: ledger row to `included` where built, NOTES of each task, full suite against T00 — verify: AC1

## Log
