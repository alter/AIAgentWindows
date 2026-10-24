# NOTES — agents inside a project (2026-10-24)

T09 of docs/plans/projects.md. Not neutral: every behaviour below has a test that was red first. Milestone "projects usable".

## What was built
- `Agent.projectId` (optional, state stays version 2): `parseAgent` accepts a project id shaped like `isProjectId` on an agent of any kind and rejects anything else (one invalid agent still makes `state.json` fail closed, as before). `agents:add` takes `{ kind, projectId? }` (parser, preload, handler).
- `AgentController.add(kind, projectId?)` asks `folderOf(projectId)` (the project service's D9 re-check, injected as a dep): an unknown project or a missing/moved folder is `{ ok: false, error }` with nothing added and nothing created; otherwise a CLI agent takes the folder as its cwd with no picker, a site or OpenRouter agent only gets the id. `cwd` is stored on the agent so Codex claims keep working, but a restart takes the folder from the index: `restoreSpawn(agent, { project })` uses the verified folder and throws the readable reason when the lookup failed or was not given; `startPty` shows that text in the pane and starts nothing. `respawn` is async (lookup first), re-checks that the pty is not already there and the agent is still listed after the await (a close during the lookup starts no pty), `restore()` respawns all agents concurrently.
- Closing: the controller is registered with the project service in `index.ts` (`canClose()` never vetoes, `closeProject(id)` closes every agent of the project through `close(id)`: pty kill, `closeSite`, `closeChat`, record removal, persist). The project service is built before the controller so `restore()` can check folders.
- OpenRouter chats: `ConversationStore` takes a folder or a per-agent resolver; `index.ts` resolves a project agent to `<userData>/projects/<id>/chats/` (`projectChatsDir`, id checked by `isProjectId`) and any other agent to `shared/openrouter` as before.
- Sidebar: `sidebarNodes` lists a project's agents in its Agents section (with `selected`), the "No project" node lists only agents without `projectId`, an agent of an unknown project is shown nowhere. `project-tree.ts` gains the "+" with the kind menu (`data-project="add-agent"`, `agent-menu`), agent items (`.agent-item` inside `.project-agent`), close with a confirmation inside the sidebar (`agent-close-*`); T08's "Nothing here yet" stub stays only for Rooms (T11). The kinds list moved to `agent-options.ts` (shared by both menus).
- Codex claims (D27): `claimRollout({ skipExec })` skips a rollout whose `session_meta.payload.source` is `exec` or `originator` is `codex_exec`; `claimForAgents` passes it, the room's own locator (`codexRolloutLocator`) does not, because it needs the exec rollout of its turn. `vscode`/`codex-tui`/`Codex Desktop` and a rollout with neither field stay claimable.
- Stubs: the pty stub writes one `{ argv, cwd, pty: true, pid }` line to `AIAW_STUB_ARGV_LOG` at start (the print and info stubs already log to the same file, the smoke filters on `pty`), and its codex `session_meta` carries `originator: 'codex-tui'`, `source: 'cli'`.
- `FolderLookup` moved to `shared/projects.ts` (the controller and the service both use it).

## Decisions made alone
- A project agent stores its cwd (the project folder at creation) so the Codex claim, which reads `agent.cwd`, is unchanged; the index decides where the pty runs.
- `canClose` of the agents never vetoes: deleting a project is confirmed in the sidebar and closes its agents. The `SiteViews` registration of D20 is carried by the controller: a view is keyed by its agent id and `close(id)` already calls `closeSite`, so a second registration would only repeat it.
- The agents of a missing project are not listed (the node shows the missing note, as in T08) and a CLI agent is not started; a site agent has no folder, so nothing starts or stops for it. A site agent of a missing project that was selected before the restart keeps its view until the owner selects another agent (edge, not handled).
- Project agents offer select and close only; rename from the project node is not built (the No project list keeps F2 rename).
- Until T13 (`site-seats.ts` by project) the site seat of a room still takes the first agent of the kind in the app, project agents included.

## Known limit of the Codex claim
Two Codex agents of one folder are told apart only by order: the rollout of a pty agent appears with its first message, not at spawn. Agents are served oldest spawn first and each takes the earliest unclaimed rollout created after its own spawn, so if the later agent gets its first message in before the earlier one, the two sessions are swapped. Nothing in `session_meta` tells them apart (cwd, originator and source are equal), the same ambiguity as before projects; the exec rollouts of the room no longer add to it. The unit test pins uniqueness and the exec skip with the rollouts listed in reverse order.

## Red seen
Unit and integration tests written before the code (HEAD 9fda0d6 plus the tests), `npx vitest run` on the eight files:
```
     × skips a rollout of codex exec by its source or by its originator when asked to 6ms
     × keeps an optional project id on an agent of any kind and refuses one that is not an id 17ms
     × runs a CLI agent in the folder the project index gives, whatever its stored cwd says 14ms
     × refuses with the readable reason when the project folder is missing or moved, and starts nothing 7ms
     × refuses a project agent when no project answer is given at all 1ms
     × gives two agents of one project folder a rollout each and never the rollout of a room codex exec turn 1ms
     × leaves an agent without a rollout when the only rollout in its folder is an exec one 2ms
     × puts the chat of a project agent under the project storage folder and a loose one where it always was 10ms
     × takes an optional project id on add, and refuses one that is not an id 47ms
     × lists the agents of a project in its Agents section and keeps them out of the No project node 39ms
     × selects a project agent only while the room pane is closed, and shows an agent of an unknown project nowhere 3ms
     × logs its argv and its working directory when asked to 289ms
     × writes a codex rollout whose session_meta names an interactive origin, so a claim that skips exec takes it 365ms
     × runs a Claude Code pty in the project folder without asking for a folder, and stores the project id 196ms
     × does the same for Codex, and keeps the folder picker for an agent outside any project 30ms
     × gives site and OpenRouter agents the project id and no folder 26ms
     × refuses an unknown project and a project whose folder is gone, adds nothing and does not recreate the folder 131ms
     × runs in the folder the project index gives, not the one stored on the agent 1203ms
     × starts nothing for an agent whose project folder is gone, says why in its pane and keeps it listed 1110ms
     × refuses a restart when the project folder is gone, with the reason 1040ms
     × lets a delete go ahead, since closing the agents of a project never vetoes it 3ms
     × closes the pty, the site view and the chat of that project agents and no other agent 1052ms
⎯⎯⎯⎯⎯⎯ Failed Tests 22 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  8 failed (8)
      Tests  22 failed | 107 passed (129)
```
Mutations of the finished code, each run and restored (diffed against a saved copy):
```
## controller asks the picker even inside a project
exit=0
    Error: expect(locator).toHaveCount(expected) failed
    Expected: 1
    Received: 0
        34 × locator resolved to 0 elements
  1 failed
## project delete does not close its agents (index.ts registration)
exit=0
    - Expected  -  1
    + Received  + 10
  1 failed
## No project node lists project agents
exit=0
    Error: expect(locator).toHaveCount(expected) failed
    Expected: 0
    Received: 2
        33 × locator resolved to 2 elements
  1 failed
## chat folder ignores the project
exit=0
  ✘  1 [electron-smoke] › tests/full/projects-chat.spec.ts:14:5 › an OpenRouter chat of a project is stored under the project folder, not in the shared folder (1.7s)
    Expected: true
    Received: false
  1 failed
## respawn without the guard after the folder check (integration)
exit=0
     × starts no pty for an agent that was closed while its project folder was being checked 142ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: expected true to be false // Object.is equality
- Expected
+ Received
 Test Files  1 failed (1)
      Tests  1 failed | 10 passed (11)
```
Smoke added before the mutations: `tests/full/projects.spec.ts` (2 tests) and `tests/full/projects-chat.spec.ts` (1). The two-restarts-at-once test written along was green with the guard removed (the pty manager already ignores a duplicate id), so it was dropped.

## Checks
Fast tier of docs/PROJECT.md section 6 exit 0 (vitest 1352 tests at the coverage run, coverage 100.00 %, unittest 95), electron-smoke 76/76 exit 0 (machine load 28-41 from another repository's runs), neutrality_check against the T06 list exit 0, tasks/check.py 7 problems (baseline).

## Not covered here
- Rooms inside a project (08-room-run-context); the site seat by project (10-room-seats).
- The DOM of the project agent items has no unit test (renderer code); the smoke is its check.
