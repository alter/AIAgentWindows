# Roles

Every role is a separate run with its own area, its own subtree and its own
right to write. **Overlap is forbidden:** two executors editing one file is the
source of half the breakage.

| Role | Owns | Writes to | Language |
|---|---|---|---|
| **ARCH** | layer boundaries, evidence about technologies, review of others' work | `docs/tech/`, `docs/EVIDENCE.md`, `docs/PROJECT.md` | — |
| **APP** | the Electron application: main, preload, renderer, adapters, pty | `src/`, `tests/`, build config | TypeScript |
| **QA** | acceptance against criteria recorded BEFORE the work | `tests/full/`, `scripts/` checks | TypeScript, Python |
| **HUMAN** | everything a machine cannot check | — | — |

## ARCH

Writes no product code. After every closed task it answers: has a new split
source of truth appeared; has the cost of adding a new agent type (a site, a
CLI, an API) gone up; can a remote page reach the pty, the file system or a key.

## QA

Never accepts work from whoever did it. The acceptance criteria are written in
`task.txt` **before** the work starts and are not tuned to the result.

## HUMAN — and this is not a formality

Tasks with this role are not executed by an agent and not simulated. Not because
it could not, but because it errs systematically in one direction: it reports
that the result looks good.

Where a person must judge:

- signing in to ChatGPT, Grok, DeepSeek, Claude and Codex accounts — credentials
  are entered only by the owner;
- the first acceptance of an end-to-end run by eye on each OS;
- verification on Windows 11 and Ubuntu 26.04, which the session cannot reach;
- accepting the terms-of-service risk of reading replies from the sites.
