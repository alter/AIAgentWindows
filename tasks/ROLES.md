# Roles

Every role is a separate run with its own area, its own subtree and its own
right to write. **Overlap is forbidden:** two executors editing one file is the
source of half the breakage.

| Role | Owns | Writes to | Language |
|---|---|---|---|
| **ARCH** | layer boundaries, review of others' work | nothing, review only | — |
| **BACK** | <…> | <paths> | Python |
| **QA** | acceptance against criteria recorded BEFORE the work | <paths to the checks> | Python |
| **HUMAN** | everything a machine cannot check | — | — |

## ARCH

Writes no code. After every closed task it answers: has a new split source of
truth appeared; has the cost of adding <the unit of extension> gone up; by which
route does a change reach <the running systems>.

## QA

Never accepts work from whoever did it. The acceptance criteria are written in
`task.txt` **before** the work starts and are not tuned to the result.

## HUMAN — and this is not a formality

Tasks with this role are not executed by an agent and not simulated. Not because
it could not, but because it errs systematically in one direction: it reports
that the result looks good.

Where a person must judge:

- <a decision that is a promise to a customer rather than a setting>;
- <consent to an action touching live systems or money>;
- <the first acceptance of an end-to-end run by eye>.
