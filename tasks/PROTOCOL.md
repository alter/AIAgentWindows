# PROTOCOL — how an executor takes a task and when it may close it

Read BEFORE any task from the tree. Every rule here cost the project at least
one incident; new rules are added with a date and a reference to theirs.

## 1. What to read, in what order, and what not to read

1. This file.
2. `tasks/GOAL.md` — which gate the task belongs to.
3. The task's whole `task.txt`, **including the `−` lines in SCOPE**.
4. Every path from CONTEXT — opened and read, not "known from memory". If a line
   number does not match, find the right place by searching, record the
   correction in `NOTES.md`, and only then work.

Do not read "everything": the task names exactly the 3–7 files it needs.

## 2. What to check BEFORE the first edit

Every item is a command, not an opinion.

- The preconditions exist: secrets, owner's decisions, and tasks from DEPENDS at
  `status:done`. If not, the work does not start (§6).
- The check suite is green BEFORE the edit. Red before the edit is not yours to
  fix, but it is yours to record in `NOTES.md`.
- <Permanent machines and the owner's environments that must not be touched: list them.>

## 3. How to work

- Nothing is installed on the host; heavy work goes into a disposable container
  with an image pinned by tag or digest.
- Secrets never enter the repository and are never printed:
  `git diff --cached | grep -iE "token|secret|password|BEGIN .*PRIVATE" || echo clean`.
- An existing mechanism is reused, not rewritten. A task whose CONTEXT names a
  "reference" follows the shape of that reference.
- Checks are never tuned to the result. A changed threshold or expectation is its
  own commit with its own explanation.

## 4. Reverse control is not a suggestion

A check that has never been red proves nothing. Every VERIFY item that says
"reverse control" is executed and its red output is kept. A task without at
least one executed reverse control is not closed.

## 5. When a task is closed

`status:done` — when the artefact named in OUTCOME exists at the named path. An
artefact outside the repository is closed by **somebody other than the one who
made it**. `verify:passed` is set by another context (`/verify`). Before closing:
`python3 tasks/check.py` — zero problems.

## 6. When to stop, and what to write

The executor stops and **does not simulate** when a missing secret is needed; an
owner's decision is needed; a task in DEPENDS is not closed; the artefact
requires a person; or reverse control cannot be made red. A `BLOCKED.md` is
created (the shape is in the README) and `labels.txt` gets `status:blocked`.

## 7. Language

The tree and the notes follow the language of `README.md`; code, docstrings and
commit messages follow the existing code.

## 8. Cost

Anything that starts machines or spends money carries limits set by
configuration: concurrent, lifetime, and total per day. Cleanup by age is part
of the tool, not something for "later".
