# NOTES 14-agent-identity

## T02 red first (unit and integration, before any code)

Command: npx vitest run tests/unit/agent-title.test.ts tests/unit/agent-icons.test.ts tests/unit/ipc-validate.test.ts tests/integration/agent-controller.test.ts

```
RUN  v5.0.3 /Users/user/workflow/git/AIAgentWindows

 ❯ |unit| tests/unit/agent-title.test.ts (3 tests | 3 failed) 133ms
   ❯ parseAgentTitle (3)
     × trims and accepts one to eighty characters 8ms
     × refuses empty, blank, too long and non-string values 2ms
     × refuses control characters and line separators anywhere 120ms
 ❯ |unit| tests/unit/agent-icons.test.ts (4 tests | 4 failed) 14ms
   ❯ agent icon map (4)
     × names a vendored file for every agent kind 7ms
     × vendors each file byte for byte as the pinned lobe-icons 1.95.1 release has it 3ms
     × ships the licence and the source of every file 1ms
     × marks only the single-colour logos, which follow the palette 1ms
 ❯ |unit| tests/unit/ipc-validate.test.ts (26 tests | 1 failed) 38ms
   ❯ channel tables (3)
     × agent rename accepts a valid id and a clean title only 11ms
 ❯ |integration| tests/integration/agent-controller.test.ts (14 tests | 1 failed) 1668ms
   ❯ agent controller (14)
     × renames an agent, stores the title beside the agents and refuses a bad id or title 22ms

⎯⎯⎯⎯⎯⎯⎯
...
Test Files  4 failed (4)
      Tests  9 failed | 38 passed (47)
   Start at  18:41:27
   Duration  3.80s (transform 55%, tests 35%, import 7%, worker 3%)
```

Causes: parseAgentTitle, INVOKE_CHANNELS.renameAgent, AgentController.rename, AGENT_ICON_FILES and the vendored files did not exist. After the change the same command: 4 files, 47 tests passed.

## T02 reverse control: the title written with innerHTML

sidebar.ts changed to build the agent-title span with `innerHTML = agent.title`, then `npx playwright test --project=electron-smoke tests/full/agent-identity.spec.ts -g "markup in an agent title"`:

```
Running 1 test using 1 worker

  ✘  1 [electron-smoke] › tests/full/agent-identity.spec.ts:122:5 › markup in an agent title is shown as text (16.7s)


  1) [electron-smoke] › tests/full/agent-identity.spec.ts:122:5 › markup in an agent title is shown as text 

    Error: expect(locator).toHaveText(expected) failed

    Locator:  locator('.agent-item .agent-title')
    Expected: "<img src=x onerror=\"document.title=1\"><b>bold</b>"
    Received: "bold"
    Timeout:  15000ms

    Call log:
      - Expect "toHaveText" locator('.agent-item .agent-title') with timeout 15000ms
      - waiting for locator('.agent-item .agent-title')
        34 × locator resolved to <span class="agent-title">…</span>
           - unexpected value "bold"


      131 |     await renameBy(page, 0, 'f2', markup);
```

sidebar.ts restored (byte-identical to the copy taken before); the test is green again in the full smoke run.

## T02 reverse control: the "+" alignment

`.sidebar-header` padding put back to the old `8px 16px`, then `-g "one right edge"` (the owner's float: the Agents "+" sat 8 px left of the Rooms "+"):

```
Running 1 test using 1 worker

  ✘  1 [electron-smoke] › tests/full/agent-identity.spec.ts:180:5 › the Rooms and Agents + buttons have one size and one right edge in both states of the Rooms tree (15.4s)


  1) [electron-smoke] › tests/full/agent-identity.spec.ts:180:5 › the Rooms and Agents + buttons have one size and one right edge in both states of the Rooms tree 

    Error: expect(received).toBe(expected) // Object.is equality

    Expected: 243
    Received: 251

      196 |       expect(rooms.width).toBeGreaterThan(0);
      197 |       expect(rooms.width).toBe(agents.width);
    > 198 |       expect(rooms.right).toBe(agents.right);
          |                           ^
      199 |     };
      200 |     await expect(page.locator('[data-room="tree-toggle"]')).toHaveAttribute('aria-expanded', 'true');
```

styles.css restored; green again in the full smoke run.

## T02 decisions made on the way

- Channel name is `agent:rename` as the task's S1 says (the older agent channels are `agents:*`).
- parseAgentTitle lives in src/shared/agents.ts with its own control-character predicate (the Room one is in room-model.ts, which imports agents.ts, so importing it would make a cycle); the rule is the same: trim, 1..80 characters, no C0/C1 controls, U+2028, U+2029.
- The --kind-* palette tokens and their five non-text contrast pairs are removed: the tile is now var(--surface), whose pair with --text (non-text) already exists; no new colour pair.
- Dark is the default palette of styles.css (the light one is the media query), so the mono marks carry `filter: invert(1)` by default and `filter: none` under `prefers-color-scheme: light`.

## 2026-10-23 Summary

- Rename: context menu "Rename" and F2 on an agent item, Enter saves, Escape or blur cancels; `parseAgentTitle` (1..80 characters after trim, no C0/C1/U+2028/U+2029); `agent:rename` validated IPC; AgentController renames and persists to agents.json.
- Logos: lobe-icons 1.95.1 (docs/tech/lobe-icons@1.95.1.md) — claudecode-color, codex-color, openai, grok, deepseek-color, openrouter-color in src/renderer/assets/icons with LICENSE (MIT) and SOURCES.md, sha256 equal to the study; shown through `<img>` on a var(--surface) tile; the mono OpenAI and Grok marks get `filter: invert(1)` on the dark palette (white, the brands' own black/white marks), no other recolour. The five `--kind-*` colour tokens and their contrast pairs are gone.
- "+" alignment: cause — the headers had right insets 8 px apart (`.sidebar-header` 16 px, `.rooms` 8 px) and two separate button rules; now one rule for `.rooms-add, .add-button` (`flex: none`) and one `--sidebar-inset-end`. Smoke asserts equal width and right edge with the tree expanded, collapsed and with an overflowing list.
- Checks (coordinator, this run): fast tier 12 commands exit 0, contrast_check 0 findings, vitest 1000/1000, coverage 100.00 %, electron-smoke 57/57.
- Residual trademark risk for the owner (AC5): the Grok page asks for the logo "exactly as provided" from its own download, Anthropic supplies its own images, DeepSeek publishes no brand page; details with URLs in the study.
- Open: AC5 HUMAN — the owner looks at the logos in both themes.
