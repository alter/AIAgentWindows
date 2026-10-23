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

