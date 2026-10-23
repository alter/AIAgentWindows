
## 2026-10-23 T01 reverse control and red-first output

Unit tests written before the code (npx vitest run tests/unit/site-layout.test.ts tests/unit/ipc-validate.test.ts tests/unit/state-file.test.ts): exit 1, 16 failed | 32 passed (48), e.g. state-file 'keeps theme and sidebar width side by side': expected [ 'light', undefined ] to deeply equal [ 'light', 280 ].

Reverse control: in src/main/site-views.ts bounds() the width argument replaced by the SIDEBAR_WIDTH constant (siteBounds(SIDEBAR_WIDTH, width ?? 0, height ?? 0)); npx playwright test --project=electron-smoke tests/full/sidebar-resize.spec.ts exit 1:

```
  ✘  1 [electron-smoke] › tests/full/sidebar-resize.spec.ts:54:5 › the divider moves by drag and keys and the width survives a restart (16.9s)
  1) [electron-smoke] › tests/full/sidebar-resize.spec.ts:54:5 › the divider moves by drag and keys and the width survives a restart 
    Error: expect(received).toBe(expected) // Object.is equality
    Expected: 400
    Received: 260
    Call Log:
    - Timeout 15000ms exceeded while waiting on the predicate
      49 |   await expect.poll(() => sidebarWidth(page)).toBe(width);
      50 |   await expect(divider(page)).toHaveAttribute('aria-valuenow', String(width));
    > 51 |   await expect.poll(() => siteViewX(app)).toBe(width);
         |                                           ^
      52 | }
      53 |
      54 | test('the divider moves by drag and keys and the width survives a restart', async () => {
        at expectWidth (/Users/user/workflow/git/AIAgentWindows/tests/full/sidebar-resize.spec.ts:51:43)
```

site-views.ts restored from a copy, cmp identical; the same spec exit 0 with the real code (1 passed).

## 2026-10-23 Summary

- Divider `src/renderer/sidebar-resizer.ts`: role="separator", pointer drag (reported to main every 50 ms while dragging, final value on release), ArrowLeft/ArrowRight 16 px, Home/End, double-click 260.
- Rules `src/shared/site-layout.ts`: `clampSidebarWidth` 180 .. min(600, half the window), `parseSidebarWidth` (missing or out of range → 260), `siteBounds(sidebarWidth, …)`.
- IPC `layout:get` / `layout:sidebar` (integer in range only); width stored in agents.json through AgentController next to the theme; site views relayout from it.
- Checks (coordinator, this run): fast tier 12 commands exit 0, vitest 991/991, coverage 100.00 %, electron-smoke 53/53.
- Side fix: the gate run failed once on tests/unit/site-replay.test.ts afterEach `rm` with ENOTEMPTY (macOS, recursive rm racing directory removal; no writer of ours outstanding — recorder queue is serial). Teardown of site-replay and site-recorder tests now passes `maxRetries: 3` (Node doc item in docs/tech/node@22.20.5.md). The flake cannot be made red on demand, so this fix has no reverse control.
- Open: AC4 HUMAN — the owner drags the divider with a site open.
