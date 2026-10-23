# NOTES — model and effort in the installed CLIs (2026-10-23)

Collected by the coordinator while 04-room-archive runs, for S1 of this task. Only `--help` output and the Codex model catalog were read; no prompt was sent. S1 still writes these into docs/tech with the version the owner has at that time.

- Installed versions: `claude --version` = 2.1.308 (docs/tech pins 2.1.306: the owner updated); `codex --version` = codex-cli 0.163.0.
- Claude Code 2.1.308 `--help`: `--model <model>` "Model for the current session. Provide an alias for the latest model (e.g. 'fable', 'opus', or 'sonnet') or a model's full name." `--effort <level>` "Effort level for the current session (low, medium, high, xhigh, max)". `--fallback-model <model>` exists. No command lists models. So the owner's rule holds: the alias `opus` follows the CLI to the latest Opus; the app keeps no list; suggestions can be the three documented aliases. Source: https://code.claude.com/docs/en/cli-reference
- Codex 0.163.0 `exec --help`: `-m, --model <MODEL>`; effort is a config key, passed as `-c model_reasoning_effort="<level>"` (the owner's `~/.codex/config.toml` has `model = "gpt-6-luna"`, `model_reasoning_effort = "low"`). Source: https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/core/config.schema.json
- Codex enumerates its models: `codex debug models` "Render the raw model catalog as JSON" (`{models: [{slug, display_name, visibility, default_reasoning_level, supported_reasoning_levels: [{effort, description}]}]}`); also cached in `~/.codex/models_cache.json`. On 2026-10-23 the models with `visibility: list` were gpt-6-luna, gpt-5.6-terra, gpt-5.6-luna; levels low, medium, high, xhigh, max, and `ultra` on gpt-5.6-terra only. So Codex suggestions and per-model effort levels can come from the CLI itself; validation of effort for Codex must accept the catalog's levels, not a fixed enum.
- Not checked: that `--effort` and `--model` are honoured with `-p` (the room's non-interactive turn); that `-c model_reasoning_effort` applies to `codex exec ... resume`.

## T01 findings (2026-10-23)

- Written to docs/tech/claude-code@2.1.306.md (section 2.1.308) and docs/tech/codex@0.163.0.md; EVIDENCE rows CC34-CC38, CX35-CX40.
- Claude: `--model`/`--effort` are single-value flags, parse with `-p` and `--resume`; `--model` beats the model restored on resume (documented); effort on resume is undocumented (CC38 open). An unsupported effort for a model falls back silently, so validate by shape. `--effort` docs also list `ultracode`, absent from `--help`. `--fallback-model` is not passed by the room (it would hide which model answered). `[1m]` suffix is a valid model value but outside the planned `[A-Za-z0-9._:-]` shape.
- Codex: `-m` is global on `exec`; effort is `model_reasoning_effort` (free string, the catalog gives each model's levels); source shows both reach a resumed thread (ThreadResumeParams.model, TurnStart effort), unconfirmed by a real turn (CX40 open). `codex debug models` may fetch online when the cache (300 s) is stale: the main-process reader in T04 keeps its 10 s timeout and an empty result on failure.

- T01 write set gains docs/EVIDENCE.md: every confirmed or open claim about the pinned CLIs is a row there (scripts/evidence_check.py is T01's verify command).

## T02 write set

tests/unit/room-archive.test.ts added to WRITE-SET of task.txt: PLAN T02 names it for the record round-trip of model and effort (old records without them still parse).

## T03 reverse control (AC3)

buildRoomTurnSpawn with the `--effort` argument dropped from `claudeChoice` (src/shared/cli-args.ts, restored afterwards) turns `room turn passes model and effort as separate arguments` red:

```
× room turn passes model and effort as separate arguments
AssertionError: expected '-p' to be 'high' // Object.is equality
Tests  1 failed | 18 passed (19)
```

The stub CLI already appended its argv per print turn to `AIAW_STUB_ARGV_LOG` (tests/fixtures/stub-print.mjs `logInvocation`), so T03 needed no fixture change. Drivers and folders were already keyed by participant id, so two claude instances never share a session.

## T03 write set

tests/unit/room-sessions.test.ts and tests/integration/room.test.ts added to WRITE-SET of task.txt: PLAN T03 names them (read-only flags with model/effort; two claude instances with their own sessions and argv per turn).

## T04 write set

Added to WRITE-SET of task.txt: src/shared/cli-models.ts (parsers), src/main/cli-models.ts (reader), src/shared/ipc.ts, src/preload/index.ts, src/main/ipc-handlers.ts, src/main/index.ts (the validated `room:models` channel and its wiring), tests/unit/cli-models.test.ts, tests/unit/ipc-validate.test.ts, tests/integration/cli-models.test.ts, tests/integration/room-wiring.test.ts, tests/fixtures/ (the stub CLI answers `--help` and `debug models`). `buildInfoSpawn` in cli-args.ts reuses the binary resolution and login-shell wrapper of the turn spawn; `MODEL_PATTERN` and `EFFORT_PATTERN` of room-model.ts are exported so suggestions are filtered by the same shape as validation.

- T05: src/renderer/styles.css added to WRITE-SET: the compact participant rows need their own rules.

## T06 reverse control (AC4)

tests/full/room-participants.spec.ts: two stub Claude instances (opus/high, sonnet/medium), relay 2 rounds, labels in schedule order in the history file, the stub's argv log per turn, the reopened room shows the same rows. With the `--effort` argument dropped from `claudeChoice` in src/shared/cli-args.ts (restored afterwards) it goes red:

```
✘ [electron-smoke] › tests/full/room-participants.spec.ts › two stub Claude instances relay for 2 rounds ...
Error: expect(received).toEqual(expected) // deep equality
-     "effort": "high",
+     "effort": "missing",
      "model": "opus",
(the same for all 5 turns: medium/sonnet -> missing)
```

## T06 write set

tests/full/room-participants.spec.ts added to WRITE-SET of task.txt: PLAN T06 names it (the dedicated AC4 smoke).

## Summary — what 03-room-participants built (2026-10-23)

- Participant = instance `{id, kind, label, model?, effort?}`; ids `<kind>`, then `<kind>-<n>`; model shape `[A-Za-z0-9._:[]-]{1,64}`, effort `[a-z]{1,16}`; sites stay one each, without model or effort; old configs and records parse unchanged.
- Spawn: claude `--model <m> --effort <e>`, codex `-m <m> -c model_reasoning_effort="<e>"` before `resume`; absent values add nothing; each instance has its own driver and session.
- Suggestions: `src/main/cli-models.ts` reads `claude --help` and `codex debug models` once per app run (execFile through the usual wrapper, 10 s timeout, bounded output); a failure leaves free text.
- UI: participant rows with model datalist and effort select; finalizer by instance label; rows come back with the room.
- Open for the owner's run (AC5): whether the model asked for answers (CC38 effort on resume, CX40 codex model/effort on a resumed thread).

