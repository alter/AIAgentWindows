# NOTES: copy agents into a new project (2026-10-24)

Owner's request, authorization recorded in the Projects row of `docs/PROJECT.md` and in `## Assumptions` and `## Log` of `docs/plans/projects.md` (status stays `done`, no AC or task touched). Owner's words (Russian): agents should not be added to every project by hand; carry over the same agents that exist in No project or in another project; the create-project form gets a dropdown whose first item is No project, then "do not copy", then the other projects.

## What was built
- `src/shared/copy-agents.ts`: `copyAgentsOptions(projects)` (values `no-project`, `none`, `project:<id>` in that order, labels "No project", "Do not copy", project names in index order), `defaultCopyChoice` (the first option), `sourceOfChoice` (option value to source, `null` for anything else), `parseCopyAgentsFrom` (IPC: `'none'` or exactly `{ projectId: string | null }`, everything else `null`), `copySourceAgents` (agents of a source in order; No project = agents without `projectId`).
- IPC: `projects:create { token, name, copyAgentsFrom? }` and `projects:add-existing { copyAgentsFrom? }`; preload passes the choice always. An absent field means `none`; a present field that does not parse refuses the whole request (never read as `none` or as a copy). `ProjectResult` ok gains `copied?` and `copyError?`.
- `AgentController.copyAgents(source, projectId)`: refuses on a fail-closed store or when `folderOf(projectId)` fails; builds every copy through the one `build(kind, projectId, folder, settings?)` that `add` now uses (so the add-agent path is not duplicated), then pushes all copies and persists the agents slice once. Selection is not touched. CLI copies run in the new project folder with a fresh session (Claude gets a new session id, Codex none), titles are the default names of the add menu (`Claude Code · <folder>`, `ChatGPT`, ...), site copies carry only the project id (the kind's partition is shared, D3), OpenRouter copies take the model, effort and web settings of the source and, being a new agent id, an empty conversation.
- `ProjectService.create(token, name, copy = 'none')` and `addExisting(copy = 'none')`: after the project is enrolled, `copyInto` calls the `copyAgents` dependency (the controller, wired in `main/index.ts` through a callback because the service is built first).
- Renderer: the form is shown for both flows. "New folder…" keeps its name field and gains the select; "Existing folder…" now opens the same form without a name field and a "Choose folder…" button (the picker opens on that click), so the select exists in both flows. Default selection is the first option. A `copyError` is shown in the sidebar notice.

## Decisions made alone (recorded in the plan's Assumptions)
- Copy, not move: the owner's "carry over" is ambiguous, copy is non-destructive; the source agents are never touched. Owner-reversible.
- Atomicity: `app-state.update(slice, fn)` owns one slice, so project and agents cannot be one write. Order is project first, agents after, and the copies are one write of the agents slice, all or none. A crash between the two leaves the project without copies, never copies without a project.
- Unknown or deleted source id: the project is still created, no agent is copied, the result carries `copyError` ("The project to copy agents from no longer exists. The project was created without copies.") and the sidebar shows it. Chosen over refusing the whole create because a folder is already made (new folder flow) and a refusal would leave a stray folder.
- A source project whose folder is gone can still be copied from: the copy reads only the agent list of the source (kinds and OpenRouter settings), never its folder.
- An absent `copyAgentsFrom` is `none`, so existing callers and tests keep their meaning; the UI always sends the choice.
- A source with zero agents copies nothing, returns `copied: 0` and writes nothing.
- The Existing-folder flow gets a form step (one more click) because the select must be reachable before the folder is picked; ten smoke specs that clicked `add-existing` now also click `create` (one line each, no assertion changed).

## Red seen (tests written before the code, then the code)
```
unit tests/unit/copy-agents.test.ts (module missing)
 FAIL  tests/unit/copy-agents.test.ts
 Test Files  1 failed (1)
      Tests  no tests
unit tests/unit/ipc-validate.test.ts
       × add-existing takes an optional copy source and never a path
       × create carries the copy source and refuses a malformed one instead of reading it as none
      Tests  2 failed | 44 passed (46)
integration tests/integration/copy-agents.test.ts (before the controller and service code)
     × creates the same kinds in the same order, fresh, in the new folder, and leaves the source as it is
     × gives each copy its own empty conversation by the agent id, never the source id
     × persists the copies with one write of the agents and keeps them after a restart
     × copies from another project, whose folder may be gone, and leaves that project untouched
     × copies nothing from a source without agents and says so with a count of zero
     × creates the project without copies and reports an unknown source, adding no agent anywhere
     × copies into a project made with a new folder, through the token flow
     × refuses a target project that is unknown or whose folder is gone, adding nothing
     × refuses while the state file is fail-closed
     × reports that copying is unavailable when the service has no copier, and still creates the project
     × turns a refusal or a throw of the copier into a notice and keeps the project
      Tests  11 failed | 2 passed (13)
```
The electron-smoke spec `tests/full/projects-copy.spec.ts` was written after the UI and went green first; its red is the mutation below.

## Reverse control (code broken, red output kept, restored by diff against a saved copy)
```
mutation 1: copySourceAgents ignores the chosen source (returns every agent)
 first run: the integration file stayed green (13 passed): its sources never coexisted with other agents
 -> test added: "takes only the chosen source when the app holds agents of other sources too"
 second run, same mutation:
     × takes only the chosen source when the app holds agents of other sources too 62ms
      Tests  1 failed | 13 passed (14)
 (unit: × takes the agents outside any project, in order / × takes the agents of one project, in order / × is empty for a project without agents)
mutation 2: defaultCopyChoice returns the second option (Do not copy)
  ✘ projects-copy.spec.ts › the select lists No project, Do not copy and the projects in order ...
    Expected: "no-project"
    Received: "none"
  1 failed, 1 passed
```

## Checks (COMMAND, exit code)
```
npx tsc --noEmit                                   exit 0
npx eslint .                                       exit 0
python3 scripts/coverage_gate.py --run             exit 0   PASS 100.00% (floor 100.00%), 1689 tests
python3 -m unittest discover -s tests/scripts      exit 0   100 tests
python3 scripts/evidence_check.py                  exit 0
python3 scripts/arch_check.py                      exit 0
python3 scripts/check_publish_flags.py             exit 0
python3 scripts/contrast_check.py                  exit 0
lint_changed x3 and gitleaks git                   exit 0   base 4fdcc63 (see below)
npx playwright test --project=electron-smoke       exit 0   88 passed
```
The base `2393fe1` of the fast-tier linter lines no longer exists after the history rewrite; `4fdcc63` is the parent of `91f6195` (the scaffold commit, the first one with code), the same meaning. `aa401b8` of the integrity check is gone too; the first commit of the plan (`1d3185a`, "T00: projects plan") is used.

## Known limits
- A crash between the project write and the agents write leaves the project without copies.
- Copies take the default title, not a renamed title of the source agent.
- `src/renderer/project-tree.ts` has no unit test; the select is covered by electron-smoke (order, default, copy, restart, Do not copy).
