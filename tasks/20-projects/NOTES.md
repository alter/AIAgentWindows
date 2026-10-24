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
