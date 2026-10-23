---
status: paused
created: 2026-10-24
---
# Projects and project rooms in PLAN mode

## Goal
The app is organised by projects. A project is a code directory (existing, or new: folder plus `git init`). Its agents work in that directory; its rooms discuss the project in PLAN mode: CLI participants run in the project folder in their read-only modes with the owner's and the project's hooks kept out, web and OpenRouter participants get the history plus a project map built from `git ls-files`, and the final answer is saved by a button to `<project>/docs/plans/<room slug>.md`. Agents and rooms without a project stay under a "Без проекта" node; site logins and the OpenRouter key survive the upgrade. The third layer — roles and an orchestrator — is its own plan, `docs/plans/roles.md`, started after the owner's real run of a project room (AC5). Owner, 2026-10-24; rewritten after the agent's review on the owner's word ("перепиши", 2026-10-24).

## Acceptance criteria
- [ ] AC1 Fast tier green after every task: every command of docs/PROJECT.md §6 fast tier exits 0; electron-smoke exit 0; `python3 tasks/check.py` no new problem
- [ ] AC2 Projects: a smoke run creates a project from an existing folder and a new one (folder + `.git` exists), refuses the same folder twice, adds a Claude Code agent whose pty cwd is the project folder, restarts and finds both projects with their agents in the sidebar tree; a project whose folder is gone shows as missing and its agents do not start; deleting a project removes the record, trashes its rooms and leaves the code folder untouched (integration test on a temp folder); the "Без проекта" node keeps agents and rooms without a project, pre-upgrade room records included
- [ ] AC3 Site logins survive: a version-1 agents.json fixture with a signed-in ChatGPT/Grok/DeepSeek agent yields a version-2 state whose partition for that site kind is the old `persist:<agentId>`, with the theme, sidebar width and OpenRouter key kept and no agents (unit test); a site agent of that kind in any project opens on that partition
- [ ] AC4 Project rooms: an integration run on stub CLIs shows each CLI participant spawned with cwd = project folder in its read-only mode and with the setting-source flags from T03; the project map sent to web/OpenRouter participants lists only `git ls-files` paths, none matching the deny list, none outside the realpath of the project, with the size cap applied, and `.env` in the folder absent from it; "Save plan" writes `<project>/docs/plans/<slug>.md` with a sanitised slug and no front matter, an existing file only after confirmation, and refuses a `docs/plans` that resolves outside the project
- [ ] AC5 HUMAN (excluded from /run): the owner runs a real project room on a real project and judges whether a Claude plan-mode participant in the project folder answers as text; this run is the entry condition of `docs/plans/roles.md`

## Stack
Electron 44.6.0, Node 22 (docs/tech/node@22.20.5.md), TypeScript 6.0.3, vitest 5.0.3, Playwright 1.63.0; Claude Code 2.1.308 installed (studied 2.1.306), Codex CLI 0.164.0 installed (studied 0.163.0), git 2.50.1 (no study yet), OpenRouter per docs/tech/openrouter@2026-10-23.md.

## Decisions
- D1 Sidebar: one tree: project → # Rooms / Agents → items, each project collapsible, plus a "Без проекта" node (owner).
- D2 Existing test agents are not migrated (owner: "можешь удалять, мигрировать не надо"); site logins and the OpenRouter key are kept (owner: "для веба сессии ... и для openrouter ... не хочется с нуля перелогинивать"). Existing room records stay on disk and show under "Без проекта" (agent's review 1.4, accepted by "перепиши"): nothing is deleted, nothing is converted.
- D3 One site login for all projects: one persistent partition per site kind, recorded in state v2 as `siteKind → partition`; existing kinds keep the old `persist:<agentId>`, new kinds get `persist:<kind>`; a site agent still exists per project (owner; review 1.2).
- D4 A new project creates the folder and runs `git init` (owner).
- D5 Web and OpenRouter participants of a project room get the room history plus an automatic project map: the file tree from `git ls-files` (a repository without commits or `git` falls back to a directory walk under the same rules) and README / CLAUDE.md / AGENTS.md, with a size cap, a deny list by name (`.env*`, `*.pem`, `id_*`, `*credentials*`, `*secret*`, `settings.local.json`, `.npmrc`, `.netrc`), and paths checked against the realpath of the project (owner; review 2.3).
- D6 "Save plan" button writes the final answer to `<project>/docs/plans/<room slug>.md`: slug sanitised (no `/`, `..`, control characters, ≤ 80 chars), no front matter added, an existing file overwritten only after confirmation, `docs/plans` refused when it resolves outside the project; models get no write access in rooms (owner; review 2.4).
- D7 Layers in order projects → PLAN rooms → roles (owner). Roles are `docs/plans/roles.md`, drafted by this plan and started after AC5 (review "Процесс", accepted by "перепиши").
- D8 CLI participants of a project room run in the project folder with their read-only flags of today plus the setting-source and hook isolation found by T03, so neither the owner's `~/.claude/settings.json` hooks nor the project's own hooks drive a room turn; a participant's session title names the room (review 2.1, 2.2).
- D9 Deleting a project never touches its code folder: the record goes, its pty agents are closed, its rooms go to the Trash as today (`room:delete`), after confirmation inside the sidebar (review 1.3).
- D10 One room run at a time stays; a site participant's page is the site agent of that kind in the room's project, never the first agent of that kind in the app (review 2.5).
- Branch: `projects`, created from `main` (aa401b8, tag v0.0.1) by T00. Commit per task, never push.

## Assumptions
- State moves to version 2 (src/shared/agents.ts:48) through an explicit `migrateV1` that reads the version-1 agents for their partitions before dropping them; a version-1 file yields the kept theme, sidebar width, OpenRouter key and the partition map, and no agents.
- Project metadata lives in the app's data folder, never inside the project directory; the only file the app writes into a project is a saved plan.
- Room CLI sessions of a project are looked up by Claude under the project folder and therefore appear in the owner's `claude --resume` list for that project; that is accepted and the sessions carry the room title.
- A project is identified by the realpath of its folder; two projects on one folder are refused.
- If T03 finds no way to keep hooks out of a `-p` turn, D8 falls back to today's cwd (`<shared>/rooms/<kind>-<n>`) with `--add-dir <project>` for Claude and whole-disk read for Codex, and the Assumption is recorded in the task's NOTES with the T03 evidence.

## Out of scope
- Roles, worktrees, an orchestrator — `docs/plans/roles.md`
- Importing CLI sessions started outside the app
- Pushing, pull requests, releases
- Several app windows
- Migration of existing agents

## Tasks
- [x] T00 Baseline and branch: create branch `projects` from main; run the gate list once; record vitest count, coverage, smoke count and tasks/check.py count in the Log — verify: Log line exists, `git branch --show-current` = projects
- [ ] T01 Ledger and tree: docs/PROJECT.md rows "Projects" and "Project rooms in PLAN mode" (state `available`, owner's request 2026-10-24, D1–D10) and a "Roles and orchestrator" row (`available`, note: planned in docs/plans/roles.md, nothing built); phase `tasks/20-projects/` with its task.txt and labels listing children 01–04; GOAL.md milestone M3; tasks/DECISIONS.md D5 (room CLIs in the project folder with hook isolation, D8 here) — verify: `python3 tasks/check.py` no new problem
- [ ] T02 Study git: docs/tech/git@2.50.1.md — `git init` defaults (initial branch, hooks dir), `git ls-files` (tracked, `--others --exclude-standard`, submodules), `git rev-parse --show-toplevel`, symlinks and realpath, plus the worktree facts the roles plan needs (add/remove/prune, `--detach`, a branch checked out in another worktree, moving a ref checked out elsewhere, merge in a dirty tree, `merge --no-ff` into a branch held in a separate worktree) — verify: tasks/check.py no item without URL
- [ ] T03 Study CLI config isolation and write modes: claude-code@2.1.308 and codex@0.164.0 docs — which settings, hooks, CLAUDE.md/AGENTS.md and MCP config a `-p` / `exec` turn loads from the cwd and from the user's home; `--setting-sources` and whether an empty or `project`-only value keeps user hooks (Stop, PreToolUse) out of a `-p` turn; `--permission-prompts none`, `--allowedTools "Edit Write Bash(npm test:*)"` patterns, `acceptEdits`/`auto` in `-p`, the `sandbox` setting (file system and network), `--permission-prompt-tool`; codex `--sandbox workspace-write`, its network default, `--add-dir`, `--approve-for-me`, hook trust; session per cwd and resume for both — verify: tasks/check.py no item without URL; the file names which flags are verified by `--help` parse only
- [ ] T04 Task 20-projects/01-project-model: shared project record (id, name, realpath, createdAt), state v2 with `migrateV1` (partition map per site kind, theme, sidebar width, key kept, agents dropped), `projectId` on agents and room records (absent = "Без проекта"), duplicate-folder and missing-folder rules, unit tests on a v1 fixture — verify: AC3 unit part + fast tier
- [ ] T05 Task 20-projects/02-project-tree: sidebar tree per D1, create project (existing folder through the picker, new folder + `git init` through the main process), rename, delete per D9 with confirmation, "Без проекта" node with the pre-upgrade rooms — verify: AC2 tree and delete parts + fast tier + electron-smoke
- [ ] T06 Task 20-projects/03-project-agents: agents created inside a project get cwd = project folder (CLI pty) or the kind's partition (site view); site seat lookup by project (D10); restart restores agents under their projects — verify: AC2 agent part, AC3 partition part + fast tier + electron-smoke
- [ ] T07 Task 20-projects/04-project-rooms: rooms per project; CLI participants with cwd = project folder, read-only flags plus the T03 isolation flags (D8); project map per D5 (`src/shared/project-map.ts`, pure, tested on a temp repository with a `.env`, a symlink outside and an oversized file); web/OpenRouter prompts carry the map; "Save plan" per D6 with the confirmation in the pane — verify: AC4 + fast tier + electron-smoke
- [ ] T08 Close: ledger rows to `included` where built, NOTES of each task, full suite against T00, `docs/plans/roles.md` left in `draft` with its entry condition (AC5) — verify: AC1

## Log
- 2026-10-24 T00: branch `projects` created from main aa401b8 (tag v0.0.1); baseline = coordinator's verification run on aa401b8 (22-reply-chrome, same tree): fast tier 12 commands exit 0, vitest 1197/1197, coverage 100.00 %, electron-smoke 69/69; tasks/check.py 7 problems
- 2026-10-24 stopped by the owner before T01 ("останови реализацию плана"); nothing after T00 was started
- 2026-10-24 plan rewritten after the agent's review (owner: "перепиши"): T05 split into 01–03, project-room rules D5/D6/D8/D10 made explicit, roles moved to docs/plans/roles.md; T00 and its baseline unchanged
