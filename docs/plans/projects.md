---
status: running
created: 2026-10-24
---
# Projects, project rooms in PLAN mode, roles with an orchestrator

## Goal
The app is organised by projects. A project is a code directory (existing, or new: folder plus `git init`). Its agents work in that directory; its rooms discuss the project in PLAN mode (CLI participants read the code, web and OpenRouter participants get the history plus a project map), and the final answer is saved by a button to `<project>/docs/plans/<room>.md`. A third layer assigns roles to models (for example 3× Claude Sonnet programmers, Claude Haiku web researcher, Codex + Claude Fable architects, OpenRouter GLM secops). An orchestrator model (for example Claude Opus, effort high) routes work and context between them on its own: implementation → testing → secops attack → architects patch → back. Writing roles work in their own git worktrees, and the orchestrator merges finished work into the project's working branch. Owner, 2026-10-24.

## Acceptance criteria
- [ ] AC1 Fast tier green after every task: every command of docs/PROJECT.md §6 fast tier exits 0; electron-smoke exit 0; `python3 tasks/check.py` no new problem
- [ ] AC2 Projects: a smoke run creates a project from an existing folder and a new one (folder + `.git` exists), adds a Claude Code agent whose pty cwd is the project folder, restarts and finds both projects with their agents in the sidebar tree; the "Без проекта" node keeps agents and rooms without a folder
- [ ] AC3 Site logins survive: after the upgrade a ChatGPT/Grok/DeepSeek agent in any project opens with the session of the partition the owner already signed in to; the OpenRouter key is kept (integration test on a pre-upgrade agents.json fixture)
- [ ] AC4 Project rooms: an integration run on stub CLIs shows each CLI participant spawned with cwd = project folder in its read-only mode, and web/OpenRouter participants receiving the project map (no `.env`, no file over the size cap, no path outside the project); "Save plan" writes `<project>/docs/plans/<slug>.md`, an existing file only after confirmation
- [ ] AC5 Roles: a project holds a roles table (role name, agent kind, model, effort, count, instructions); a smoke run creates the owner's example set
- [ ] AC6 Orchestrator: an integration run on stub CLIs and the fake OpenRouter server goes programmer → tester → secops (finding) → architect → programmer → tester → done; every handoff carries the context the orchestrator chose; each writing role works in its own worktree; the merge lands on the working branch; Stop aborts every running turn
- [ ] AC7 HUMAN (excluded from /run): the owner runs a real project room and a real orchestrated task

## Stack
Electron 44.6.0, Node 22 (docs/tech/node@22.20.5.md), TypeScript 6.0.3, vitest 5.0.3, Playwright 1.63.0; Claude Code 2.1.308 installed (studied 2.1.306), Codex CLI 0.164.0 installed (studied 0.163.0), git 2.50.1 (no study yet), OpenRouter per docs/tech/openrouter@2026-10-23.md.

## Decisions
- D1 Sidebar: one tree: project → # Rooms / Agents → items, each project collapsible, plus a "Без проекта" node (owner).
- D2 Existing test agents and rooms are not migrated (owner: "можешь удалять, мигрировать не надо"); site logins and the OpenRouter key are kept (owner: "для веба сессии ... и для openrouter ... не хочется с нуля перелогинивать").
- D3 One site login for all projects: one persistent partition per site kind; a site agent still exists per project (owner).
- D4 A new project creates the folder and runs `git init` (owner).
- D5 Web and OpenRouter participants of a project room get the room history plus an automatic project map: file tree and README / CLAUDE.md / AGENTS.md, with a size cap, without `.env` and secret files (owner).
- D6 "Save plan" button writes the final answer to `<project>/docs/plans/<room slug>.md`; an existing file is overwritten only after confirmation; models get no write access in rooms (owner).
- D7 All three layers in this plan, in the order projects → PLAN rooms → roles (owner).
- D8 Writing roles each get their own git worktree and branch (owner).
- D9 The orchestrator decides and hands off on its own, with no step limit and no spend limit, and merges finished work into the working branch on its own (owner: "Полностью сам, без лимитов"). Push stays out: nothing is pushed by the app (agent's reading: the answer named the merge, not the push).
- D10 Secops and testers may do anything — read, run tests and exploits, use the internet — but only in their own worktree; their changes are never merged; they report to the orchestrator (owner).
- Branch: `projects`, created from `main` (aa401b8, tag v0.0.1) by T00. Commit per task, never push.

## Assumptions
- Site partition reuse: today a partition is `persist:<agentId>` (src/main/site-views.ts:174); the upgrade records, per site kind, the partition of the most recently used existing agent of that kind as the kind's shared partition, so the existing login stays.
- State moves to version 2 (src/shared/agents.ts:48); a version-1 file yields the kept theme, sidebar width, OpenRouter key and site partitions, and no agents.
- Project metadata lives in the app's data folder, never inside the project directory; the only file the app writes into a project is a saved plan (and worktrees for layer 3, under the app's data folder).
- The orchestrator speaks a small JSON protocol (handoff to a role with a message, merge, done); a reply that does not parse is sent back once with the error, then the run stops with a readable error.
- Writing CLI turns use the CLIs' own non-interactive write modes (claude -p with a permission mode that allows edits and Bash; codex exec with a writable sandbox); the exact flags come from the T03 study, not from memory.
- Web chats and OpenRouter models can hold any role whose work is text (architect, secops review, researcher); a role that must edit files needs a CLI kind, and the roles table says so.

## Out of scope
- Importing CLI sessions started outside the app
- Pushing, pull requests, releases
- Several app windows

## Tasks
- [x] T00 Baseline and branch: create branch `projects` from main; run the gate list once; record vitest count, coverage, smoke count and tasks/check.py count in the Log — verify: Log line exists, `git branch --show-current` = projects
- [ ] T01 Ledger and tree: docs/PROJECT.md rows "Projects", "Project rooms in PLAN mode", "Roles and orchestrator" (state `available`, owner's request 2026-10-24, decisions D1–D10); phase `tasks/20-projects/` with its task.txt and labels; GOAL.md milestone M3 — verify: `python3 tasks/check.py` no new problem
- [ ] T02 Study git worktree: docs/tech/git@2.50.1.md (worktree add/remove/prune, branch per worktree, locked worktrees, merge without checkout, `git init` defaults) — verify: tasks/check.py no item without URL
- [ ] T03 Study write modes: claude-code@2.1.308 and codex@0.164.0 docs — non-interactive turns that may edit files and run commands (permission modes, sandbox modes, network), resuming a session per role, cwd and `--add-dir` — verify: tasks/check.py no item without URL
- [ ] T04 Study orchestration: how existing multi-agent tools route work and context between heterogeneous agents (Claude Code subagents, Codex, OpenHands, AutoGen, CrewAI, LangGraph supervisor): handoff message shape, shared state, stop rules; docs/tech/orchestration@2026-10-24.md — verify: tasks/check.py no item without URL
- [ ] T05 Task 20-projects/01-project-model: project record, state v2 with kept partitions and key, create from existing folder or new (folder + git init), agents spawned in the project folder, sidebar tree with "Без проекта", rename and delete a project — verify: AC2, AC3 + fast tier + electron-smoke
- [ ] T06 Task 20-projects/02-project-rooms: rooms per project, CLI participants with cwd = project folder in read-only mode, project map for web/OpenRouter participants, "Save plan" to docs/plans — verify: AC4 + fast tier + electron-smoke
- [ ] T07 Task 20-projects/03-roles: roles table per project (role, kind, model, effort, count, instructions), the owner's example as a preset — verify: AC5 + fast tier + electron-smoke
- [ ] T08 Task 20-projects/04-worktrees: worktree manager (create per writing role, branch name, cleanup, merge into the working branch, conflict reported as a failed step) on a temporary repository — verify: integration test + fast tier
- [ ] T09 Task 20-projects/05-role-turns: writing CLI turns in a worktree with the studied flags; text roles (web, OpenRouter) through the existing drivers — verify: integration on stub CLIs + fast tier
- [ ] T10 Task 20-projects/06-orchestrator: orchestrator loop with the JSON protocol, handoff context, feed of steps, Stop, merge on "done" — verify: AC6 + fast tier + electron-smoke
- [ ] T11 Close: ledger rows to `included` where built, NOTES of each task, full suite against T00 — verify: AC1

## Log
- 2026-10-24 T00: branch `projects` created from main aa401b8 (tag v0.0.1); baseline = coordinator's verification run on aa401b8 (22-reply-chrome, same tree): fast tier 12 commands exit 0, vitest 1197/1197, coverage 100.00 %, electron-smoke 69/69; tasks/check.py 7 problems
