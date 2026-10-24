# NOTES: 20-projects (closed by T18 of docs/plans/projects.md)

Carried items. Each one is a known limit or an unverified point, not a defect closed here.

- (a) D27 known limit: two Codex agents in one folder are told apart only by the order of their first messages, so a swap is possible; a Codex Desktop or IDE session in the same folder stays claimable by an app agent.
- (b) `capture-auto-main` opens every site kind with a synthetic agent `capture-<kind>` on the mapped partition and runs the migration when `state.json` is absent.
- (c) The CLI introduction in a project room still says "you may search the web" although the web tools are removed from that profile.
- (d) The renderer room list does not refresh when a project is deleted.
- (e) Agents and rooms of a project cannot be renamed from the project node.
- (f) `src/renderer/project-tree.ts` has no unit test; it is covered by electron-smoke only.
- (g) The deny list is exactly D5, so `*.tfstate` does not match `terraform.tfstate.backup`.
- (h) Unverified offline, left to AC5 (human): Codex authentication under `--ignore-user-config`; Claude sign-in under `--restricted`; `CLAUDE.md` loading under `--restricted`; the `Read` deny rules against Grep and Glob; the worktree-gc canary; free OpenRouter models under `data_collection: deny`.
- (i) Owner-reversible defaults: no web tools for project-room CLIs; `data_collection: deny` on project-room OpenRouter requests; kinds descriptors and scenarios moved to `docs/plans/roles.md`.
- (j) T04 (01-file-store) is not behaviour-neutral by the plan; the neutral tasks of AC6 are T06 and T15 only.
- (k) T17 edited two lines of `tests/full/room.spec.ts` (selector `summary` -> `.room-entry-head`) because a room entry now holds a second `summary`.

Entry condition of `docs/plans/roles.md`: this plan closed (T18) and AC5, the owner's real project-room run, done by the owner. That plan stays `status: draft`.

## Post-close fix: agent menu placement

Root cause: `src/renderer/popup.ts` `place()` passed `window.innerWidth` to `placePopup` as the viewport width, so a popup opened in the sidebar was clamped to the window, not to the sidebar; the site `WebContentsView` is drawn above the renderer DOM right of the sidebar and covered the right part of the menu. Evidence: the new spec `tests/full/popup-sidebar.spec.ts` on HEAD 2799cb8 (default sidebar 260 px) failed on the project Agents "+" menu:

```
Error: expect(received).toBeLessThanOrEqual(expected)
Expected: <= 260
Received:    376.234375
> expect(box.x + box.width).toBeLessThanOrEqual(side.x + side.width);
1 failed
```

Fix: `popup.ts` `viewportWidth(popup)` is the right edge of the popup's enclosing `.sidebar` when it has one, else `window.innerWidth`; `placePopup` already clamps left to `viewport.width - margin - size.width`, so no helper in `src/shared` changed. The spec asserts geometry only (menu right edge <= sidebar right edge) for the Agents "+" menu and the project "..." menu; it passes after the fix together with `popup-placement.spec.ts`. The sidebar's own `.add-menu` (sidebar.ts, `showPopup` with a width, inside `.sidebar`) is covered by `popup-placement.spec.ts` and stays inside the window and the sidebar.

## Post-close fix: several OpenRouter agents

Owner's report: "only 1 OpenRouter agent can be added; several must be addable". Authorization recorded in the OpenRouter row of `docs/PROJECT.md`.

Checked first, no one-per-kind rule exists: `AgentController.add` (src/main/agent-controller.ts) creates `createOpenRouterAgent()` with a fresh `randomUUID()` and pushes it; `parseAgent` (src/shared/agents.ts) has no per-kind check; `content.ts renderChats` keys panes by agent id; conversations are `<agentId>.json` (shared or per project); Room rows use `nextParticipantId` (`openrouter`, `openrouter-2`) and `parseParticipants` limits only the site kinds. The owner's `state.json` (read-only look) held two OpenRouter agents of project `algo-trade` created 12 s apart, so both adds had worked. A scripted run (two and three agents in "No project", two in a project, restart, click between them) behaved correctly: separate model, separate conversation, persisted.

Root cause: `.projects` in `src/renderer/styles.css` has `max-height: 40vh; overflow-y: auto`, and `ProjectTree.render` never scrolled to the new selected agent, so with a project holding Claude, Codex, ChatGPT, Grok, DeepSeek the added OpenRouter rows lay below the visible part with no visible scrollbar. Evidence, the owner's state copied to a scratch profile at 1200x768: `.projects` visible 38..345 px, scrollHeight 421 vs clientHeight 307, agent rows DeepSeek 341..379, OpenRouter 379..417 and 417..455 (all below 345); the screenshot shows the list ending at Grok. The added agent was selected and its pane shown, but its sidebar row was out of sight, which reads as "only one can be added".

Red on HEAD eef4e28 (`tests/full/openrouter-many.spec.ts`, project test, selected row must lie inside `.projects`):

```
Error: expect(received).toBe(expected) // Object.is equality
Expected: true
Received: false
Call Log:
- Timeout 15000ms exceeded while waiting on the predicate
> await expect.poll(() => selectedRowIsVisible(page, '.projects')).toBe(true);
1 failed
```

Fix: `ProjectTree.revealSelected()` and `Sidebar.revealSelected()` call `scrollIntoView({ block: 'nearest' })` on the selected agent row when the selected id changed since the last render (renames and other re-renders do not move the scroll). The first spec (three OpenRouter agents in "No project", each with its own model and question, restart, own log per agent) was green on HEAD: it documents the requirement, it caught nothing.

## Post-close fix: returning to a running room

Owner's report: project room, Start, select an agent, click the room again: nothing happens.

Root cause, three parts, each with evidence. (1) `src/renderer/project-tree.ts` `roomItem` (and `room-tree.ts` `item`) set `aria-disabled` and ignore the click on every room row while the rooms section is `busy`, the running room included; T13 meant to block opening a different room. Playwright on 656763f, saved room continued after a restart, agent clicked, room row clicked: `locator resolved to <button class="rooms-item" aria-disabled="true" ... data-room-id="room-20261024-111847-c819a9">`, `element is not enabled` 58 times, timeout. (2) `RoomService.open` (src/main/room-service.ts) returned `The room "<name>" is running: stop it first.` for any id while a run is on, so even a click that got through was refused for the same room. Integration test `opens the running room itself and returns its live snapshot, while another room stays refused` on 656763f: `AssertionError: expected false to be true`. (3) A new room is not in the tree until `finished`: `RoomPane.apply` refreshed the list only on `finished` and the record appears after the first appended entry, so the row to return to did not exist while the first run was going. Playwright on 656763f, new room: `expect(locator('[data-project="tree"] [data-project-id]').locator('[data-room-id]')).toHaveCount(1)` received 0 for 15 s.

T13's tests asserted refusing a room of another project (`refuses to open a room of another project while a room runs and names the running room`), never the running room itself, so none was wrong and none changed.

Fix: `TreeItem.blocked` (shared/sidebar-tree.ts) is `busy && !row.current` for room rows and false for agents; both room renderers use it for `aria-disabled` and the click guard (add, rename, delete stay disabled for the whole section while busy); `RoomService.open` refuses only when the id differs from the running room and for the running room returns the live snapshot untouched (the form is read from its record); `RoomPane.apply` refreshes the list on every event until the running room is listed. Specs: `tests/full/projects-room-return.spec.ts` (new room, and saved room continued after a restart: agent, then the room row, pane visible, status Running, Stop enabled, Start disabled), the integration test above, and a unit test of `blocked`.

## Post-close fix: No project node nesting

Owner's report: under "No project" the "# Rooms" and "Agents" sections sit at the same left edge as the node itself, while a project's sections are nested.

Root cause: a project node builds its sections in `ProjectTree.section` (`div.project-section` with `padding-left: 16px`, a chevron `.project-section-toggle`, `.project-section-title`, a plain `.project-agent-add`, `ul.project-section-list`), but the "No project" body held the older top-level blocks: `RoomTree` drew `section.rooms` with `.rooms-header` and `.rooms-toggle`, and `Sidebar` drew `.sidebar-header` with no chevron plus `ul.agent-list`; `.no-project-body` had no indent and the loose Agents section was not collapsible (`sidebarSections` marked it `collapsible: false`). Evidence on 1b5c1a1: `tests/full/no-project-tree.spec.ts` failed at `expect(loose.inside).toBe(true)` (no `[data-project-section]` inside the No project node, Received: false); screenshot of the owner's state: "# Rooms" and "Agents" of No project had bold titles, blue "+" buttons and no chevron on Agents.

Fix: reuse the project section CSS rather than a second copy. `RoomTree` and the Agents header in `Sidebar` carry the same classes and `data-project-section` attribute as a project section (`project-section`, `-head`, `-toggle`, `-title`, `-list`, `project-agent-add`), `.no-project-body` gets the 8 px inset of `.projects`, the duplicated `.rooms-*` header, toggle, add and `.sidebar-header` rules were deleted, `.agent-list` and `.rooms-list` keep only scrolling. The class names the other specs select (`.add-button`, `.rooms-list`, `[data-room=...]`) stay. The loose Agents section got its own chevron and collapse (`collapsibleKey` accepts `agents`, `sidebarSections` marks it collapsible) so the chevron column matches; collapse state stays in renderer memory as before. The disabled "+" keeps the dashed outline (`.project-agent-add:disabled`).

Existing unit assertions encoded the old rule and were adapted explicitly in `tests/unit/sidebar-tree.test.ts`: `sections[1]?.collapsible` is now `true`, and `refuses to collapse the agents list or an unknown key` became `refuses to collapse an unknown key`; a new test covers collapsing the loose Agents section. The spec asserts relative geometry only (section toggle and title offsets from the node's own chevron equal a project's, sections are descendants of the node) and that collapsing a section or the node hides the children.
