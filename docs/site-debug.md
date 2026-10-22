# Site debug recording

For the owner. When a web participant (ChatGPT, Grok, DeepSeek) misbehaves in a Room, tick **Record site debug** next to the finalizer before Start. It is off by default.

## What is written

Per web turn, under `<userData>/debug/sites/<runId>/<site>-<turn>/` (the Room status line shows `Debug: <runId directory>` while the run is recorded; `<userData>` is the app's profile directory, `~/Library/Application Support/<app name>` on macOS):

| File | Content |
|---|---|
| `meta.json` | site, run id, turn id, start and finish time, the timing options of the turn (poll, settle, start grace, timeout, quiet, reply cap), outcome (`reply` or `failed`) with the error code, `finishedAtMs` (ms after submit), the trace fields of the turn |
| `prompt.txt` | the text sent to the page |
| `before.txt` | the conversation text of the page at submit |
| `snapshots/NNNN.json` | one file per poll whose page text or extractor decision differs from the poll before: `t` (ms since submit), `text`, `stop`, `accepting`, `reply`, `started`, `generating`, `drops`, `keyHits`, `anchorRank`, `hitsAtLineStart` |
| `polls.json` | the `t` of every poll, so a replay polls when the real turn polled |
| `events.jsonl` | one JSON object per line, `at` = ms since the recorder started: `ready` (phase `new-chat`, `prepare`, `composer`, with `ms`), `idle-wait`, `insert` (composer kind, chars), `submit` (path, `composerClearedMs`), `generating` (on/off), `first-growth`, `settle-start`, `finish`, `dom-failed`, `net-failed`, `net-skipped`, and the `net` lines below |
| `net/NNNN.txt` | response body of a `text/event-stream`, `application/x-ndjson` or `application/json` response on the site's own origin that took longer than 1 s, at most 2 MB each |
| `dom-end.html` | `outerHTML` of the conversation root (`<main>` or `<body>`) at the end of the turn, success or failure |

`net` events (`phase` = `request`, `response`, `finished`, `failed`, `body`, `body-failed`) carry the request id, the URL **path only** (no query, no fragment), method, mime type, status, length and duration. Only requests to the origin of the page at the start of the turn are recorded. The Network domain of the page's debugger is enabled for the turn only; the debugger stays attached, so the user-agent override keeps working. A streamed response may have no body to fetch: that is a `body-failed` event with the reason, not an error.

## What it holds and where it never goes

The recording holds your chat text, by design: the prompt, the page, the replies, the DOM. It stays under the profile. The trace line of `logs/sites.log` gets one extra field, `debugDir` (the path), and nothing else; the log stays free of text. Delete the `debug` directory when you are done. Recording is best-effort: when a file cannot be written the log gets one `recorder-failed` line with an error code and the turn continues.

## Replay

```
npm run build
npm run site-replay -- <userData>/debug/sites/<runId>/<site>-<turn>
```

It runs the generic adapter's decision code (`extractAnchoredReply`, the start rule, the generating and settle rules) over the recorded snapshots with the recorded timings, and prints one line per snapshot (`t`, text length, reply length, `started`, `generating`, `keyHits`, `anchorRank`) and a last line with the replayed outcome, the time it would have finished and the recorded outcome beside it. After changing the extractor, replay an old recording to see whether the same page now ends the turn, and when. Timeouts are replayed at the recorded timeout.

Replay works only for adapters that record page text (the generic adapter does).
