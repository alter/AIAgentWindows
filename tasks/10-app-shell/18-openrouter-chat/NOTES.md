# NOTES 18-openrouter-chat

## T01 what was built
- Agent kind `openrouter` joins AGENT_KINDS; the five older kinds stay in ROOM_AGENT_KINDS (Room participants, Add participant menu), so Room tests and the Room's own OpenRouter row are unchanged. OPENROUTER_KIND moved to src/shared/agents.ts and is re-exported by room-model.ts; RoomKind is now AgentKind.
- Agent.openrouter holds model, modelName, effort ('' = default) and web; an old state file without it loads with empty settings. The title is `OpenRouter` until a model is picked, then `OpenRouter · <model name>` until the owner renames the agent.
- src/shared/openrouter-chat.ts: SSE parser, reply accumulator and outcome rules, conversation parse and limits (pure, in the coverage target). src/main/openrouter/chat.ts keeps the one request-body builder (`requestBody(request, stream)`), the error mapping (`failedStatus`) and the texts; chat-stream.ts streams beside it; chats.ts and conversation-store.ts own the per-agent file `<shared>/openrouter/<agentId>.json` (UUID checked before it becomes a path, atomic write, an unreadable or malformed file refused and never rewritten, closing the agent keeps it).
- The key never leaves the main process. Deltas reach the renderer on `openrouter:chat-delta` as `{ id, text }`; Send resolves with the final entry; Stop aborts the fetch; a 401 goes through OpenRouterService.keyRejected.
- SSE parser detail: a line that is not a comment, an empty line or one of the fields data, event, id, retry is reported as unreadable, so a 200 answer that is not SSE (a proxy page) becomes a failed reply instead of an empty one. This is also what makes the comment-line check observable by a test.
- Pane (src/renderer/openrouter-pane.ts) reuses OpenRouterCells (model filter, search, model, effort, web) from the Room row; all text via textContent.
- Icon: the mono `openrouter.svg` of @lobehub/icons-static-svg@1.95.1 (sha256 in docs/tech/lobe-icons@1.95.1.md and src/renderer/assets/icons/SOURCES.md), handled like openai.svg and grok.svg; openrouter-color.svg stays in the folder, not shown.
- tests/fixtures/openrouter-fake.ts got a streaming chat endpoint (comment lines, a data line split in two writes, finish and usage chunks, [DONE], scripted parts, hold open); `chatClosed` does not count a stream the server finished writing.

## WRITE-SET additions (not in task.txt at the start, needed by the work)
- src/shared/room-model.ts, src/shared/room-view.ts, src/shared/restore.ts: reconcile AgentKind with the Room kinds (ROOM_AGENT_KINDS), keep Room behaviour.
- src/renderer/assets/icons/ and docs/tech/lobe-icons@1.95.1.md: the vendored mono logo, as the coordinator decided.

## Tests seen red first
Unit test written before the modules exist (tests/unit/openrouter-chat.test.ts), first run:
```
❯ |unit| tests/unit/openrouter-chat.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |unit| tests/unit/openrouter-chat.test.ts [ tests/unit/openrouter-chat.test.ts ]
Error: Cannot find module '../../src/main/openrouter/chats' imported from /Users/user/workflow/git/AIAgentWindows/tests/unit/openrouter-chat.test.ts
 ❯ tests/unit/openrouter-chat.test.ts:6:1
      4| import path from 'node:path';
      5| import { afterEach, beforeEach, describe, expect, it } from 'vitest';
      6| import { OpenRouterChats } from '../../src/main/openrouter/chats';
       | ^
      7| import { ConversationStore } from '../../src/main/openrouter/conversat…
      8| import {

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  no tests
   Start at  21:08:27
   Duration  104ms (worker 95%, environment 5%)
```
Reverse control (comment-line check removed from lineEvents in src/shared/openrouter-chat.ts, restored afterwards, 27/27 green again):
```
RUN  v5.0.3 /Users/user/workflow/git/AIAgentWindows
 ❯ |unit| tests/unit/openrouter-chat.test.ts (27 tests | 1 failed) 82ms
   ❯ SSE parser (8)
     × comment lines are ignored 7ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |unit| tests/unit/openrouter-chat.test.ts > SSE parser > comment lines are ignored
AssertionError: expected [ { type: 'unreadable' }, …(4) ] to deeply equal [ Array(3) ]
- Expected
+ Received
@@ -1,9 +1,15 @@
  [
    {
+     "type": "unreadable",
+   },
+   {
      "text": "Hel",
      "type": "delta",
+   },
+   {
+     "type": "unreadable",
    },
    {
      "text": "lo",
      "type": "delta",
    },
 ❯ tests/unit/openrouter-chat.test.ts:58:20
     56|   it('comment lines are ignored', () => {
     57|     const { events } = feedAll([': OPENROUTER PROCESSING\n\n', delta('…
     58|     expect(events).toEqual([{ type: 'delta', text: 'Hel' }, { type: 'd…
       |                    ^
     59|   });
     60|
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
 Test Files  1 failed (1)
      Tests  1 failed | 26 passed (27)
   Start at  21:13:05
   Duration  234ms (tests 50%, transform 39%, import 9%, worker 1%)
```
Integration (tests/integration/openrouter-chat.test.ts) was green on its first run; to show it can fail, the abort signal was dropped from the fetch and the history was cut to the last user turn in a scratch edit, both restored afterwards:
```
❯ |integration| tests/integration/openrouter-chat.test.ts (16 tests | 4 failed) 15624ms
     × every request carries the stored conversation, with the effort and web search of the agent 101ms
     × Stop aborts the request, keeps the text written so far and sends it with the next request 5011ms
     × stopping before the first byte gives an empty stopped reply and a later failed reply is not sent again 5068ms
     × refuses a second message while a reply is being written, and shutdown stops it 5059ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |integration| tests/integration/openrouter-chat.test.ts > streaming against the fake server > every request carries the stored conversation, with the effort and web search of the agent
 FAIL  |integration| tests/integration/openrouter-chat.test.ts > streaming against the fake server > Stop aborts the request, keeps the text written so far and sends it with the next request
 FAIL  |integration| tests/integration/openrouter-chat.test.ts > streaming against the fake server > stopping before the first byte gives an empty stopped reply and a later failed reply is not sent again
 FAIL  |integration| tests/integration/openrouter-chat.test.ts > streaming against the fake server > refuses a second message while a reply is being written, and shutdown stops it
 Test Files  1 failed (1)
      Tests  4 failed | 12 passed (16)
```
Smoke: the first full run had 66 of 67 green; the new spec failed on `fake.chatClosed` (2, expected 1) because the fixture counted a stream the client closed right after [DONE]. Root cause: the fake marked the stream finished after an extra 5 ms delay that followed the last write; fixed in the fixture, not in the product.

## Checks of this run
See the T01 line in PLAN.md `## Log`.

## Not done here
- AGENTS.md map row and docs/PROJECT.md ledger row are T02 (coordinator).
- AC5 HUMAN: the owner chats with a free and a paid model.

## 2026-10-23 Summary

- Agent kind `openrouter` (AGENT_KINDS; Room participants keep ROOM_AGENT_KINDS), settings on the agent in agents.json, mono OpenRouter logo (openrouter.svg, lobe-icons 1.95.1).
- Main: chat-stream.ts (SSE parser: comments skipped, split chunks, [DONE], usage, mid-stream error, idle limit), chats.ts (one stream per agent, Stop aborts), conversation-store.ts (`<shared>/openrouter/<agentId>.json`, atomic, size cap, unreadable refused); request body and error mapping shared with 17's chat.ts.
- Renderer: openrouter-pane.ts — messages and streamed deltas by textContent, Enter / Shift+Enter, Stop, Copy through main, Room row controls reused.
- Checks (coordinator, this run): fast tier 12 commands exit 0, vitest 1162/1162, coverage 100.00 %, electron-smoke 67/67; tasks/check.py 7 (baseline).
- Open: AC5 HUMAN — chat with a free and a paid model.
