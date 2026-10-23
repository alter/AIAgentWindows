# NOTES

## 2026-10-23 reverse control (AC2)

`tasks/check.py` only reads a tech doc that a task names in CONTEXT, so `task.txt` of this task now lists `docs/tech/openrouter@2026-10-23.md` (one line added; the file is in this task's WRITE-SET). Without it the doc would not be checked at all.

Scratch copy `.claude/scratch/openrouter-rc/` (tasks/ and docs/ copied, removed afterwards). In the copy, the URL was cut from line 20 (the "Code lifetime" item) of `docs/tech/openrouter@2026-10-23.md`:

```
$ python3 .claude/scratch/openrouter-rc/tasks/check.py | grep -n "openrouter\|problems"
2:problems: 8
10:  • 10-app-shell/15-openrouter-study: docs/tech/openrouter@2026-10-23.md:20 is an item without a URL
```

Real tree, same command: `problems: 7` (baseline), no line about openrouter.

## 2026-10-23 findings that differ from the first pass

- `:online` and the `web` plugin are both deprecated; the replacement is the `openrouter:web_search` server tool (`tools: [{type: "openrouter:web_search"}]`), not the plugin.
- Probe: POST /api/v1/auth/keys with a junk code answers 400 "Invalid code"; the docs say 403.
- `GET /api/v1/credits` needs a management key; the balance of an exchanged key is not readable. `GET /api/v1/key` carries `free_model_daily_requests {used, limit, remaining}` and `is_free_tier`.
- No key was available: authenticated paths (exchange success, streaming, `reasoning.max_tokens`) are unverified and listed in the doc.
