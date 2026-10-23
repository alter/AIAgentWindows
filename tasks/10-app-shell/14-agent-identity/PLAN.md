---
status: paused
created: 2026-10-23
---
# Agent identity — rename agents, products' own icons

## Goal
Owner, 2026-10-23: "мы умеем переименовывать комнаты, но не умеем переименовывать агентов, и иконок нет от агентов правильных, надо бы брать их официальные иконки и их использовать".

## Acceptance criteria
- [x] AC1 Fast tier green: every command of docs/PROJECT.md §6 fast tier exits 0 (contrast_check 0 findings)
- [x] AC2 Study: docs/tech/lobe-icons@<pinned version>.md lists the vendored files, their slugs, colour/mono variant, licence (MIT) and each brand's usage terms, each with a URL; tasks/check.py shows no item without a URL
- [x] AC3 Rules: unit tests for title parse, `agent:rename` validation, icon map covering every AgentKind; seen red first
- [x] AC4 Smoke: electron-smoke exit 0 — `an agent renamed from the sidebar keeps its title after a restart` (F2 and context menu, Escape cancels) and `markup in an agent title is shown as text`; every kind's item shows its vendored logo (img src ends with the file name); reverse control (title via innerHTML) red, output in NOTES.md — windows hidden
- [x] AC6 "+" alignment: smoke asserts the Rooms and Agents "+" buttons have equal width and equal right edge (getBoundingClientRect), in both states of the Rooms tree
- [ ] AC5 HUMAN (excluded from /run): the owner looks at the logos in both themes

## Stack
As tasks/10-app-shell/06-room-layout/PLAN.md. Icons: @lobehub/icons-static-svg, one pinned version, files copied into src/renderer/assets/icons/ (no runtime npm dependency).

## Decisions
- D1 Source: lobe-icons (MIT), the only set with all of Claude Code, Codex, OpenAI/ChatGPT, Grok, DeepSeek, OpenRouter; simple-icons lacks OpenAI and Grok (research report 2026-10-23, URLs in the study) (agent's decision).
- D2 Vendored SVG files at one pinned version with their source URLs, not a live npm dependency (agent's decision: freezes the marks shipped).
- D3 Brand terms followed: marks used as provided, colour variants where they exist, OpenAI and Grok mono marks drawn in the text colour of the palette (their official marks are black/white), no stretching (openai.com/brand, x.ai/legal/brand-guidelines, openrouter.ai/brand).
- D4 Rename like rooms: context menu Rename and F2, Enter saves, Escape cancels (owner's room pattern, 06-room-layout).
- Branch: `room`. Commit per task, never push.

## Assumptions
- Pin is 1.95.1 (published 2026-09-21), not 1.97.0: 1.97.0 is two days old, 1.95.1 is the newest version at least two weeks old; the six files are byte-identical in 1.98.0. Study file is docs/tech/lobe-icons@1.95.1.md; task.txt WRITE-SET updated. All six slugs confirmed, no correction.
- Slugs: claudecode-color (Claude Code), codex-color (Codex), openai (ChatGPT), grok (Grok), deepseek-color (DeepSeek), openrouter-color (OpenRouter, vendored for the later tasks); the study confirms or corrects each.
- SVGs are shown through <img src> from bundled files (build copies the folder), never innerHTML.
- T02 (coordinator's decisions): six files vendored exactly as downloaded (sha256 checked against the study by tests/unit/agent-icons.test.ts) with LICENSE and SOURCES.md; scripts/build.mjs copies src/renderer/assets; shown through <img src alt=""> only, the item button keeps the agent title as its name; mono marks (openai.svg, grok.svg) get `filter: invert(1)` on the dark palette and `none` on the light one (no other recolour), fixed 18 px square, object-fit contain.
- T02 "+" alignment: one shared rule for `.rooms-add` and `.add-button` (28 px, flex: none, padding 0) and one `--sidebar-inset-end` (8 px) used by `.rooms` and `.sidebar-header`, so both right edges coincide; the smoke asserts it in both Rooms-tree states and with the rooms list overflowing.
- T02 declared for integrity-check: `src/renderer/contrast-pairs.json` loses five `--on-fill`/`--kind-*` non-text pairs because the `--kind-*` tokens are gone (the icon tile is `--surface`, whose `--text` non-text pair already exists); no pair added, contrast_check 0 findings.
- T02 channel is `agent:rename` as the task's S1 says (older agent channels are `agents:*`); `parseAgentTitle` sits in src/shared/agents.ts with its own control predicate because room-model.ts imports agents.ts (a cycle otherwise).

## Out of scope
- Room participant labels
- OpenRouter agent wiring

## Tasks
- [x] T00 Baseline: the coordinator's last verified run before T01 — verify: the Log line exists
- [x] T01 Study: docs/tech/lobe-icons@<version>.md from the package and the brand pages — verify: AC2
- [x] T02 Rename, icons and "+" alignment (S1–S5): agent title parse and `agent:rename` (red first), AgentController rename + persist, sidebar rename editor (F2, context menu), vendored SVGs + build copy + icon map, tiles from tokens; smoke tests/full/agent-identity.spec.ts with reverse control — verify: AC3 + fast tier + electron-smoke
- [x] T03 Ledger and notes: docs/PROJECT.md shell row; NOTES.md; labels `status:review` — verify: tasks/check.py no new problem + fast tier

## Log
- 2026-10-23 coordinator: T00 baseline = verification run on e90c681 (13-sidebar-resize): fast tier 12 commands exit 0, contrast_check 0 findings, vitest 991/991, coverage 100.00 %, electron-smoke 53/53; tasks/check.py baseline 7 problems
- 2026-10-23 T01 done: docs/tech/lobe-icons@1.95.1.md (MIT, six slugs confirmed, variant/fill/viewBox/sha256, brand terms with URLs); tasks/check.py still 7 problems (baseline)
- 2026-10-23 T02 done: agent:rename (parseAgentTitle, controller, sidebar F2/context menu), six vendored lobe-icons 1.95.1 files + LICENSE/SOURCES shown via <img>, tile from --surface, shared "+" rule with one inset; vitest 1000/1000, coverage 100.00 %, fast tier 12 commands exit 0, contrast 0 findings, build ok, electron-smoke 57/57 (53 + 4 new, close-agent smoke selector made specific), reverse controls (innerHTML title, old header padding) red then green, integrity 0 findings
- 2026-10-23 coordinator: T01 verified (sha256 of three files re-fetched from unpkg 1.95.1 match) and T02 verified (diff reviewed; fast tier 12 exit 0, contrast 0 findings, vitest 1000/1000, coverage 100.00 %, electron-smoke 57/57) — this run
- 2026-10-23 T03 done: ledger row "Slack-like shell" extended (rename, logos, "+" alignment), NOTES summary, labels status:review; tasks/check.py 7 problems (baseline); paused on AC5 HUMAN
