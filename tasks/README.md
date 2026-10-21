# Task tree — <project>

One task is one directory with two required files and a validator. The tree is a
ledger of work, not a journal: it holds what must exist, split into executable
pieces.

## Key documents

- `PROTOCOL.md` — read first by every executor: what to check before an edit,
  how to work, reverse control, when a task is closed, when to stop.
- `GOAL.md` — the goal, the gates, signs of progress and signs of self-deception.
- `ROLES.md` — the roles, what each owns and where it writes; the HUMAN role.
- `DECISIONS.md` — cross-cutting decisions `D<n>`: decided / why / rejected.

## Phases

`NN-<slug>` in steps of 10, in dependency order. Every phase carries its own
`task.txt` and `labels.txt`; the phase's SCOPE lists its child tasks, one line
each.

<filled in by /task init>

## Task format

`task.txt`, sections in exactly this order, bodies indented by two spaces:

```
TASK: <short name, names the artefact>

GOAL
  What this produces and why it exists. Two or three lines. If it serves a gate,
  say which. Every number carries its source.

CONTEXT
  3–7 paths to read FOR THIS TASK. Never "read everything".

SCOPE
  + what is included
  − what is deliberately excluded, and where it lives instead

OUTCOME
  The artefact that exists when the task is closed: a path or a measurable number.

VERIFY (<role>)
  Numbered checks somebody else can run. At least one of them is reverse
  control: what must turn the check red.

ROLE
  Who does it.

DEPENDS
  Paths of tasks that must finish first, or (none).
```

`labels.txt` — one `key:value` pair per line.

Optional neighbours: `NOTES.md` (rationale, measurements, rejected alternatives;
dated headings), `VERIFY.md` (proof of verification — written only by the
verifier), `BLOCKED.md` (when `status:blocked`), `PLAN.md` (the current session's
execution plan, created by `/plan`) and any artefact — logs, screenshots,
measurement output.

The `−` lines in SCOPE matter as much as the `+` lines. An unwritten boundary is
a boundary somebody will cross.

## Labels

```
phase:      <from the phase list above>
role:       <from ROLES.md>
type:       feature | fix | research | decision | chore
priority:   P0 | P1 | P2 | P3
status:     todo | in_progress | review | done | blocked (with BLOCKED.md next to it)
verify:     pending | passed | failed
depends:    <path to a task>
milestone:  <from GOAL.md>
gate:       yes — only on tasks that measure the goal
format:     2 — the rules in "Format 2" below apply; absent means the original format
capability: <ledger row> — the task adds or changes this capability; check.py requires an included/available row in docs/PROJECT.md
attack:     pending | passed | failed — set by /attack, with ATTACK.md next to it
```

## Format 2

A task with `format:2` in `labels.txt` names every requirement so that a claim
of "done" can be checked line by line.

- Every `+` line in SCOPE starts with an id: `+ S1 …`, `+ S2 …`. Ids are unique
  within the task.
- Every numbered VERIFY item is a requirement too: item `1.` is `V1`.
- `VERIFY.md` carries a `## Requirement evidence` section with one line per id:

  ```
  - S1: src/parser.py:12 — the header loop
  - V2: `pytest -k body` exit 0
  ```

  The evidence is a `path:line` or a command with its exit code. "Done", "looks
  fine" or a paraphrase of the requirement is not evidence; `check.py` rejects an
  id without one.

### Splitting: by logical parts, not by size

A task is split when its parts are separable; the length of its description
says nothing either way. A part is separable when it has all three:

1. its own verifiable result — a check that goes red independently of the
   other parts;
2. its own write set — the functions, methods, files, config keys or migrations
   it changes — that does not overlap with any sibling;
3. a ready input — it needs only interfaces already fixed, never a sibling's
   half-written code.

If one of the three is missing the task is indivisible and stays whole; SCOPE
then carries `indivisible: <why>`. Two agents never work on the same unit:
different methods of one class may go to different tasks, one method may not.
A split runs as: a **contract** part (signatures, the DATA records) first, then
the **parts** in parallel, each depending on the contract, then an **assembly**
part that merges them and runs the fast tier. Children carry
`split:contract`, `split:part` or `split:assembly` in `labels.txt`.

### Sections added by format 2

Order: TASK, GOAL, CONTEXT, SCOPE, WRITE-SET, DATA, SECURITY, OUTCOME, VERIFY,
ROLE, DEPENDS.

- **WRITE-SET** — one unit per line: a file (`src/parser.py`), a symbol in it
  (`src/parser.py::Parser.headers`) or a directory (`tests/`). The default
  level is the file; a symbol is named when two tasks share a file.
  `scope_check.py` holds every commit of the task to this list.
- **DATA** — one record per external input or output the task touches, as
  `key=value` pairs separated by `;`:
  `dir` (in/out), `type`, `range` or `size`, `null` (yes/no), `interpretable`
  (yes/no — can the value legitimately contain something an interpreter would
  execute: markup, SQL, shell, a URL scheme, an instruction to a model),
  `source` (the documentation of the version in use, a URL). A field that is
  `interpretable=no` is validated at the input and names that test in
  `validated=`. A field that is `interpretable=yes` is stored as is and every
  sink that consumes it must protect it.
- **SECURITY** — one line per sink this task adds or changes (HTML, push
  payload, deep link, email, CSV, SQL, shell, log, a model's prompt):
  `sink <name>: consumes <field>[, <field>]; protection=<what>; test=<path:line or path::test>`,
  or `(no sinks)`. Every consumed field must exist in some task's DATA; every
  `interpretable=yes` field needs `protection=` and `test=` here. That is how a
  sink added months later meets the decision taken at the input.
- **VERIFY tiers** — every item starts with `[fast]` or `[full]`; a heavy test
  (mutation, fuzzing, long integration) adds `heavy`: `[full, heavy]`. At most
  three `[fast, heavy]` items per task; `[full]` items run only in the full
  (night or milestone) run. One item is reverse control and names the mutation
  and the test that must go red:
  `reverse control: <the mutation> → <path::test or path:line>`.

### Example

```task.txt format:2
TASK: reminder text input

GOAL
  Users save a reminder text that is shown back to them later.

CONTEXT
  src/reminders/api.py
  docs/tech/fastapi@0.115.md

SCOPE
  + S1 accept and store the reminder text
  + S2 reject ids outside the int64 range
  − showing reminders in notifications — 30-notify/01-push
  indivisible: one endpoint and its validation share one invariant

WRITE-SET
  src/reminders/api.py::create_reminder
  tests/test_reminders.py

DATA
  reminder.text: dir=in; type=string; size=1..500 chars UTF-8; null=no; interpretable=yes; source=https://docs.python.org/3.12/library/stdtypes.html#str
  reminder.user_id: dir=in; type=int64; range=1..9223372036854775807; null=no; interpretable=no; validated=tests/test_reminders.py::test_user_id_bounds; source=https://www.postgresql.org/docs/16/datatype-numeric.html

SECURITY
  (no sinks)

OUTCOME
  POST /reminders stores the text; tests/test_reminders.py green.

VERIFY (DEV)
  1. [fast] tests/test_reminders.py passes
  2. [fast] reverse control: drop the int64 bound check → tests/test_reminders.py::test_user_id_bounds
  3. [full, heavy] mutation run over src/reminders/api.py, survivors listed

ROLE
  DEV

DEPENDS
  (none)
```

Tasks without `format:2` are validated by the original rules unchanged.

## Order of work

1. The executing role works (`status: todo → in_progress → done`).
2. **Another context**, which wrote neither the code nor its tests, sets
   `verify: passed` or `failed` (`/verify`).
3. Tasks with `gate:yes` are confirmed by a human; the next phase does not start
   until they pass.

## The `status:done` rule

`status:done` means **the OUTCOME artefact exists** at the named path, not that
"the work looks finished". An artefact outside the repository (a machine at a
provider, a phone in someone's hand, a signed build, another person's eyes) is
not closed by the context that did the work: it stays `in_progress` with a note
in `NOTES.md` saying what is missing and who can provide it.

## The `verify:passed` rule

Requires a `VERIFY.md` in the task directory. Words in a commit message are not
proof. Required parts:

- a `Verifier:` line naming the context and listing what it did **not** do — it
  authored neither the code nor its tests;
- `## How to reproduce` — at least one command from a clean state: a fresh
  checkout, an empty environment, not a single variable exported by hand;
- `## Reverse control` — what was broken on purpose and what red output it gave;
- `## What was not checked` — non-empty. A verification boundary always exists.

Every number in `VERIFY.md` carries its source — a path, a command, a log line.

## The stopping rule

The executor stops and **does not simulate** when a missing secret is needed; an
owner's decision is needed; a task in DEPENDS is not closed; the artefact
requires a person; or reverse control cannot be made red. A `BLOCKED.md` is
created in the task directory:

```
Blocked: <date>
Missing: <one line, concrete — a variable name, a task path, a question>
Done before stopping: <list, with paths>
What can be done without it: <or "nothing">
```

and `labels.txt` gets `status:blocked`. A stub instead of a secret, "hardcode it
for now", "let us assume that…" — that is not a way around a blocker, it is a
false `done` with delayed discovery.

## Validator

```bash
python3 tasks/check.py     # zero problems is a precondition for closing a task
```

## Language

The tree's language is whatever this file is written in; `check.py` accepts the
`VERIFY.md` and `BLOCKED.md` markers in English or Russian, so a tree kept in
another language keeps its own wording. Code, docstrings and commit messages
follow the existing code.
