# GOAL — why this tree exists

## The goal

One desktop window in which the owner runs several Claude Code and Codex
sessions on their subscriptions and ChatGPT, Grok and DeepSeek on their free
accounts, and moves context between them by "Forward" and a shared directory
(`docs/PROJECT.md` §2).

## What hurts right now

Nothing is built (`git log`: only intake commits up to `3fd948f`). Every
mechanism in `docs/PROJECT.md` §3 is a claim from reasoning, not from a run.

## The gates — and only they measure the goal

**Gate 1 — `05-feasibility/01-evidence-table` (milestone M1).** Every claim the
ledger makes about how the product works has evidence: a command with its
output, the documentation of the pinned version, or an assumption that names
where it will be checked. Only this shows whether the product is buildable as
described before code is written against it.

## Milestones

| Milestone | What it means | Entry condition |
|---|---|---|
| **M1** | the design rests on evidence, not reasoning | now |

## Signs that we are getting closer

- A closed task removes uncertainty about one of the gate questions, rather than
  increasing the amount of work done.
- Every number in the documents came from a measurement and carries its source.
- Rejected decisions are recorded together with the reason.

## Signs that we are NOT getting closer

- "N tasks closed" reported as progress.
- Another review pass that rewords the ledger without adding evidence.
- A report ahead of its check: something declared done that does not reproduce
  from a clean state.
- A run that has never been red.
- Work on a later milestone before an earlier one.

## Stop condition

If the spike shows that the sites refuse an embedded browser (sign-in or bot
challenge that the owner cannot pass by hand), the web-agent half of the goal is
revised with the owner instead of worked around.
