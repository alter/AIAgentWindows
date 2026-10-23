---
status: todo
created: 2026-10-23
---
# Agent identity — rename agents, products' own icons

## Goal
Owner, 2026-10-23: "мы умеем переименовывать комнаты, но не умеем переименовывать агентов, и иконок нет от агентов правильных, надо бы брать их официальные иконки и их использовать".

## Acceptance criteria
- [ ] AC1 Fast tier green: every command of docs/PROJECT.md §6 fast tier exits 0 (contrast_check 0 findings)
- [ ] AC2 Study: docs/tech/lobe-icons@<pinned version>.md lists the vendored files, their slugs, colour/mono variant, licence (MIT) and each brand's usage terms, each with a URL; tasks/check.py shows no item without a URL
- [ ] AC3 Rules: unit tests for title parse, `agent:rename` validation, icon map covering every AgentKind; seen red first
- [ ] AC4 Smoke: electron-smoke exit 0 — `an agent renamed from the sidebar keeps its title after a restart` (F2 and context menu, Escape cancels) and `markup in an agent title is shown as text`; every kind's item shows its vendored logo (img src ends with the file name); reverse control (title via innerHTML) red, output in NOTES.md — windows hidden
- [ ] AC6 "+" alignment: smoke asserts the Rooms and Agents "+" buttons have equal width and equal right edge (getBoundingClientRect), in both states of the Rooms tree
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
- Slugs: claudecode-color (Claude Code), codex-color (Codex), openai (ChatGPT), grok (Grok), deepseek-color (DeepSeek), openrouter-color (OpenRouter, vendored for the later tasks); the study confirms or corrects each.
- SVGs are shown through <img src> from bundled files (build copies the folder), never innerHTML.

## Out of scope
- Room participant labels
- OpenRouter agent wiring

## Tasks
- [ ] T00 Baseline: the coordinator's last verified run before T01 — verify: the Log line exists
- [ ] T01 Study: docs/tech/lobe-icons@<version>.md from the package and the brand pages — verify: AC2
- [ ] T02 Rename, icons and "+" alignment (S1–S5): agent title parse and `agent:rename` (red first), AgentController rename + persist, sidebar rename editor (F2, context menu), vendored SVGs + build copy + icon map, tiles from tokens; smoke tests/full/agent-identity.spec.ts with reverse control — verify: AC3 + fast tier + electron-smoke
- [ ] T03 Ledger and notes: docs/PROJECT.md shell row; NOTES.md; labels `status:review` — verify: tasks/check.py no new problem + fast tier

## Log
