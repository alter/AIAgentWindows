# NOTES — turn profile, deny list, CLI isolation in a project room (2026-10-24)

T12 of docs/plans/projects.md. Not neutral: every behaviour below has a test that was red first (D5, D8, D22 TurnProfile part, D23, AC4 CLI, env and snapshot parts).

## What was built
- `src/shared/turn-profile.ts`: `TurnProfile { mode: 'plan', isolation: 'none' | 'project', denyRead[], tools, extraDirs[], name? }`; `freeRoomProfile(sharedDir)` is today's profile (five tools, `<shared>` as the one extra directory, no deny rules, no name); `projectRoomProfile(roomName)` is `Read,Grep,Glob`, the D5 deny rules, no extra directory, the room name cleaned into one argument (control characters to spaces, leading dashes cut, 80 characters); `roomProfile(isolated, sharedDir, roomName)` picks one.
- `src/shared/cli-args.ts`: `buildRoomTurnSpawn(kind, options, profile = freeRoomProfile(options.sharedDir))` builds the room argv from the profile only; `buildSpawn`, `buildInfoSpawn` and `InfoOptions` are untouched, `cwd` and `env` stay in `SpawnOptions`. Claude: `... --permission-mode plan [--restricted] --tools <tools> [--allowedTools <web tools>] --strict-mcp-config --mcp-config {"mcpServers":{}} --disallowedTools mcp__* [--settings {"permissions":{"deny":[...]}}] [-n <name>] [--model/--effort] [--add-dir <dir>]... --session-id|--resume <id>`. Codex: `exec [--ignore-user-config] --sandbox read-only -c web_search="live"|"disabled" [-c features.plugins=false] --skip-git-repo-check --json [-m/-c effort] [resume <id>] -`. `forbiddenRoomArg(args)` is the single refusal: any `--dangerously-*` argument, `--allow-dangerously-skip-permissions`, `--yolo`, an argument equal to `bypassPermissions`, a `--permission-mode` value other than `plan`; `buildRoomTurnSpawn` throws on it for every kind and profile, and on a profile mode other than `plan`. Every room turn env gets `GIT_OPTIONAL_LOCKS=0` (the pty agents do not).
- `src/shared/deny-list.ts`: the D5 list as name globs, directory names and one path suffix; `isDenied(relPath)` checks every path component (case-insensitive, `\\` and `./` read as separators and nothing), `denyReadRules()` gives `Read(**/<pattern>)` and `Read(**/<pattern>/**)` per name pattern and directory, `Read(**/.docker/config.json)` for the path.
- `RoomCwd.isolated` (`projectContext` true, `noProjectContext` false) picks the profile in `CliDriver.turn`; `TurnRequest.roomName` is the run's title or id, read at every turn.
- Room intro: one added sentence for CLI participants, "You discuss and plan only: never execute the project's plans." (the web and OpenRouter intros are unchanged).
- `tests/fixtures/stub-print.mjs` logs `GIT_OPTIONAL_LOCKS` of the stub's own environment.

## Decisions made alone
- `-n` is passed on every Claude room turn of a project, a resumed one included (the title is the room's current title, so a rename between turns renames the session).
- The Codex flags are exactly the three of the plan's T03 Assumption (`--ignore-user-config`, `web_search="disabled"`, `features.plugins=false`); `--ignore-rules` is not passed (T03 left auth survival under it unverified).
- A free profile's web access is derived from the tools list: Codex gets `web_search="live"` only when `WebSearch` is among the tools.
- The deny list is exactly D5's: `*.tfstate` does not match `terraform.tfstate.backup`; widening it is the owner's call.
- The CLI intro still says "You may search the web" in a project room, where no web tool exists; the intro does not know the project (room-history.ts takes no profile), and the plan asks for the added sentence only.
- No Codex fallback was built: no test shows the flags rejected (the stub accepts them and the 0.164.0 help lists `--ignore-user-config` for `exec` and `exec resume`).

## For AC5 (owner's real run, not testable here)
- Codex auth survival under `--ignore-user-config` (help text only; if sign-in is lost, the plan's Codex fallback applies) and Claude sign-in under `--restricted` with `--permission-mode plan` and `--settings`.
- Whether `CLAUDE.md` and `@` imports load under `--restricted`, whether `Read` deny rules (and Grep/Glob) hold, and a Claude plan-mode participant answering as text.
- That a real Codex rollout of a project room shows `read-only` in `turn_context`.

## Red seen
New tests against HEAD a94faa1 `src/` (scratch copy of the archive plus the new test files, the two new pure modules and the stub change; `.claude/scratch/t12-red-head.txt`):
```
     × runs a Claude project room restricted, with three file tools, the deny rules and the room name, and no shared directory 3ms
     × resumes a Claude project room session with the same isolation 0ms
     × runs a Codex project room without the user config, plugins and web search, read-only, with no session name 0ms
     × puts every Codex project flag before resume on a continued turn 0ms
     × cleans the room name into one safe argument 1ms
     × keeps a hostile room name as one entry of the login-shell form 0ms
    ... (28 failed | 27 passed in cli-args.test.ts; 3 failed | 13 passed in room-projects.test.ts: profile, session name, GIT_OPTIONAL_LOCKS)
```
`deny-list.test.ts` has no HEAD counterpart (module absent: `Cannot find module '../../src/shared/deny-list'`), so its reds are the mutations below; room-history.test.ts: `expected 'You are Claude Code in a room where s…' to match /never execute the project's plans/i`.
The golden test "keeps the profile of a room outside any project exactly as it was" is green against HEAD's untouched `buildRoomTurnSpawn` (it is not among the 28 reds): today's argv is byte-identical. The snapshot test is green at HEAD too (T10 already removed `history.md`); its red is the first mutation below.

## Mutations of the finished code, each run in a fresh scratch copy (`.claude/scratch/t12-mutate.py`), the working tree untouched
```
## history.md-style write reinstated in CliDriver.turn | exit 1
     × writes nothing into the project folder during a project room run 320ms
     × leaves every entry of the project folder, .git and .claude included, as it was 524ms
      Tests  2 failed | 14 passed (16)
## --dangerously-skip-permissions added to the room profile argv, guard call removed | exit 1
     × keeps the profile of a room outside any project exactly as it was 3ms
     × claude free resume=false on win32 carries none of the bypass flags 1ms
     × claude free resume=false on darwin carries none of the bypass flags 0ms
     × claude free resume=true on win32 carries none of the bypass flags 0ms
    ... 6 more
      Tests  10 failed | 45 passed (55)
## --dangerously-skip-permissions added, guard kept | exit 1
     × room turn passes model and effort as separate arguments 2ms
     × passes nothing for absent values, so the CLI keeps its own default 0ms
     × keeps a hostile model as one argument entry in the login-shell form 0ms
     × keeps the profile of a room outside any project exactly as it was 0ms
    ... 16 more
      Tests  20 failed | 35 passed (55)
## hook-trust bypass added to the Codex project profile, guard removed | exit 1
     × codex project resume=false on win32 carries none of the bypass flags 3ms
     × codex project resume=false on darwin carries none of the bypass flags 0ms
     × codex project resume=true on win32 carries none of the bypass flags 0ms
     × codex project resume=true on darwin carries none of the bypass flags 0ms
    ... 2 more
      Tests  6 failed | 65 passed (71)
## project profile keeps the web tools | exit 1
     × runs a Claude project room restricted, with three file tools, the deny rules and the room name, and no shared directory 3ms
     × runs a Codex project room without the user config, plugins and web search, read-only, with no session name 1ms
     × puts every Codex project flag before resume on a continued turn 0ms
     × runs every CLI participant with its isolation profile in the project folder 472ms
      Tests  4 failed | 67 passed (71)
## project profile adds the shared directory | exit 1
     × runs a Claude project room restricted, with three file tools, the deny rules and the room name, and no shared directory 3ms
     × runs every CLI participant with its isolation profile in the project folder 525ms
      Tests  2 failed | 69 passed (71)
## Codex project turn without --ignore-user-config | exit 1
     × runs a Codex project room without the user config, plugins and web search, read-only, with no session name 3ms
     × puts every Codex project flag before resume on a continued turn 0ms
     × runs every CLI participant with its isolation profile in the project folder 573ms
      Tests  3 failed | 68 passed (71)
## Claude project turn without --restricted | exit 1
     × runs a Claude project room restricted, with three file tools, the deny rules and the room name, and no shared directory 3ms
     × resumes a Claude project room session with the same isolation 0ms
     × runs every CLI participant with its isolation profile in the project folder 472ms
      Tests  3 failed | 68 passed (71)
## room turn env without GIT_OPTIONAL_LOCKS | exit 1
     × claude on win32 with the free profile gets GIT_OPTIONAL_LOCKS=0 on top of the given environment 4ms
     × claude on darwin with the project profile gets GIT_OPTIONAL_LOCKS=0 on top of the given environment 1ms
     × codex on win32 with the project profile gets GIT_OPTIONAL_LOCKS=0 on top of the given environment 1ms
     × codex on darwin with the free profile gets GIT_OPTIONAL_LOCKS=0 on top of the given environment 0ms
    ... 1 more
      Tests  5 failed | 66 passed (71)
## room name not passed to the Claude session | exit 1
     × runs a Claude project room restricted, with three file tools, the deny rules and the room name, and no shared directory 3ms
     × cleans the room name into one safe argument 1ms
     × keeps a hostile room name as one entry of the login-shell form 1ms
     × names the Claude session after the room and tells the participants they only discuss 423ms
      Tests  4 failed | 67 passed (71)
## room intro without the discuss-only sentence | exit 1
     × tells a CLI participant to discuss and plan only, and a web participant nothing of the kind 3ms
     × names the Claude session after the room and tells the participants they only discuss 420ms
      Tests  2 failed | 78 passed (80)
## deny list without .npmrc | exit 1
     × denies .npmrc 3ms
      Tests  1 failed | 43 passed (44)
## isDenied ignores directory names | exit 1
     × denies .aws/config 3ms
     × denies .ssh/known_hosts 0ms
     × denies everything below a directory whose name matches 0ms
     × reads a path the way the filesystem does: separators, dot segments and case 0ms
      Tests  4 failed | 40 passed (44)
## isDenied only looks at the last path component | exit 1
     × denies everything below a directory whose name matches 3ms
      Tests  1 failed | 43 passed (44)
## isDenied is case sensitive | exit 1
     × denies config/Credentials 3ms
     × reads a path the way the filesystem does: separators, dot segments and case 0ms
      Tests  2 failed | 42 passed (44)
## denyReadRules without the recursive rule | exit 1
     × gives a Read rule for every pattern, directory and path of the list, recursive from any depth 3ms
      Tests  1 failed | 98 passed (99)
## room profile of a project room not chosen by the driver | exit 1
     × runs every CLI participant with its isolation profile in the project folder 474ms
     × names the Claude session after the room and tells the participants they only discuss 419ms
      Tests  2 failed | 14 passed (16)
```
The two bypass-flag cases are the plan's "seen red by adding `--dangerously-skip-permissions` to a profile": with the guard call removed the argv table and the smuggling test are red; with the guard kept, every Claude room turn throws.
