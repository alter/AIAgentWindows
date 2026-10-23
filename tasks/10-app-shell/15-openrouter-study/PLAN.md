---
status: done
created: 2026-10-23
---
# OpenRouter study — docs/tech/openrouter@2026-10-23.md

## Goal
The reference every OpenRouter build task designs against (working contract: a technology new to the project gets docs/tech/<name>@<version>.md before any task designs against it). Owner, 2026-10-23: OpenRouter, paid and free models, in Room and as a separate chat.

## Acceptance criteria
- [x] AC1 docs/tech/openrouter@2026-10-23.md covers S1–S7 of task.txt, every item with a URL; `python3 tasks/check.py` shows no new problem (baseline 7)
- [x] AC2 Reverse control: one URL removed in a scratch copy → the tree's tech check reports that item (output in NOTES.md)

## Decisions
- D1 Sign-in path to study first: PKCE with a localhost loopback callback (documented as allowed on any port) plus a paste-key fallback (research report 2026-10-23) (agent's decision).
- Branch: `room`. Commit per task, never push.

## Assumptions
- OpenRouter's API is unversioned; the doc is dated 2026-10-23 and quotes the pages as fetched that day.

## Tasks
- [x] T00 Baseline: tasks/check.py 7 problems on aed0565 — verify: the Log line exists
- [x] T01 Write the study from openrouter.ai/docs and the Electron 44.6.0 / Node 22 docs — verify: AC1, AC2

## Log
- 2026-10-23 coordinator: T00 baseline tasks/check.py 7 problems on aed0565
- 2026-10-23 T01 done: docs/tech/openrouter@2026-10-23.md written (S1-S7, 113 URL-bearing items), task.txt CONTEXT names it so tasks/check.py reads it (still 7 problems, none in it); reverse control in NOTES.md (8 problems with one URL cut)
