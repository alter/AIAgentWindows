# NOTES — project map builder and its file sources (2026-10-24)

T16 of docs/plans/projects.md. Pure builder, `GitRunner.listFiles`, the directory walk and the realpath checks; no provider wiring (T17).

## Red seen
New code: the four test files failed on missing modules / a missing method before the code was written (`Cannot find module '../../src/shared/project-map'`, `simple-ignore`, `projects/map-files`; `runner.listFiles is not a function`, 5 failed in git-runner.test.ts).

Hostile `.git/config` (`core.fsmonitor = <script writing "$@" to a marker>`; the test first runs plain `git ls-files` as a control and asserts the marker is written, so the test cannot pass by a script that never fires). `-c core.fsmonitor=false` removed from the runner's hardened argv in a scratch copy (original restored from `.claude/scratch/git.ts.orig`):
```
COMMAND: npx vitest run tests/integration/git-runner.test.ts   (git.ts without '-c', 'core.fsmonitor=false')
 × passes the hooks directory, the fsmonitor override and the two environment variables to every call, ...
 × keeps the module to one execFile call and one child_process import
 × runs init inside the folder with the hardened argv and environment
 × asks for tracked and untracked unignored files below the folder, NUL separated, through the hardened runner
 × never runs the core.fsmonitor command of the repository while listing files
AssertionError: expected [ '2 1792816005538645000' ] to deeply equal []
Tests  5 failed | 12 passed (17)
```
`core.hooksPath` fires for no command the runner uses (docs/tech/git@2.50.1.md), so it stays a defence the test does not try to prove.

Mutations on the finished code, each red, restored (script `.claude/scratch/mutate.py`):
- realpath containment / denied target of a resolved path not checked -> 4 tests (symlink to `.env`, folder replaced by a symlink out of the project, outside symlink, walk fixture).
- size cap of the bounded read removed -> `applies no .gitignore that is over its size cap`.
- walk skip list (`.git`, `node_modules`) removed -> walk fixture.
- deny list not applied (`isListablePath`) -> 7 tests.
- `--exclude-standard` removed -> argv test and the repository fixture (`ignored.log`).
- `-z` removed -> 8 tests; `-- .` removed -> argv test only (git limits `ls-files` to the cwd without it, docs/tech/git@2.50.1.md, so no behavioural test can see it; D11 keeps it explicit); output trimmed instead of raw -> `keeps names as they are`.
- folding removed -> 6 tests.
Survivors, equivalent by construction: filtering `listing.paths` with `isListablePath` before the disk is touched (the resolved path is checked again, so a `../x` candidate is dropped either way; the first filter only keeps hostile names away from `realpath`); the builder's own cap on a document's bytes beside `readBounded`'s (the builder is pure and enforces it without trusting the reader).

## Decisions made alone
- The walk, the realpath checks and the bounded read live in `projects/map-files.ts`, not in `git.ts`: `git.ts` stays the only place that runs `git` (D14) and gains `listFiles` alone. The plan line put them in git.ts; the module is in the coverage include (`src/main/projects/**`) and under the `projects-electron` arch rule already.
- `ls-files` is called with `-z` (names with spaces, quotes or non-ASCII stay literal) and a 16 MiB buffer; its output is not trimmed (`raw`), a failed listing (not a repository, no git, buffer) falls back to the walk with the reason in `fallbackReason`.
- Entries that are not regular files after `realpath` (directories, nested repositories printed as `dir/`, a submodule gitlink, a symlink to a directory, a missing tracked file) are dropped, so a submodule is not named in the map.
- Walk: skip list `.git` and `node_modules` by name, the deny list, and the top-level `.gitignore` through `shared/simple-ignore.ts` (plain names, `dir/`, anchored paths, `*`, `?`, `**`; no negation, no bracket classes, nothing below the root); the file is read through the same bounded reader and ignored when it is a symlink out of the project, over 64 KiB or not text; at most 100 000 entries visited, then `incomplete: true`; symlinked directories are never entered.
- Caps (`DEFAULT_MAP_LIMITS`, parameters of `buildProjectMap`, T17 passes its own from the budget): 48 KiB of text, 1500 listed entries, 12 KiB per document; the documents get at most half of the bytes, the tree the rest. Folding keeps the deepest directory level whose entries fit both caps; when even the top level does not fit it is cut with a line that says how many entries are missing.
- Documents are the root `README.md`, `CLAUDE.md`, `AGENTS.md` by exact name, in that order, only when they passed the path checks; one that cannot be read, is binary, is over the cap or does not fit the half budget is named in `omitted` and not included.
- A path is listable when it is relative, has no empty, `.` or `..` component, no control character, no backslash, no drive prefix and is not denied (`isListablePath`); control characters would let a name forge lines of the map.

## Not done here
No provider, no budget share, no recipients line, no hash of the map (T17). `collectProjectMap` is unused by the app until then.

## Gates
Fast tier of docs/PROJECT.md §6, electron-smoke 79/79, neutrality_check against 808c482 (1382 -> 1420 tests, no id lost), check.py, integrity-check and scope_check: see the Log line of T16.
