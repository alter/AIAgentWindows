# NOTES

## 2026-10-23 T01 reverse control

Unit tests red first (`npx vitest run tests/unit/room-view.test.ts` before the helpers existed): 4 failed, 86 passed, e.g. `TypeError: setupOpenOnRoom is not a function`, `TypeError: setupDigest is not a function`.

Smoke reverse control: the line `this.setup.open = setupOpenAfterStart(this.setup.open, started.ok);` removed from `onStart` in src/renderer/room-pane.ts (scratch edit, restored afterwards), rebuilt, then `npx playwright test --project=electron-smoke -g "the setup closes on start and opens by click"` exit 1:

```
1) [electron-smoke] › tests/full/room-layout.spec.ts:298:5 › the setup closes on start and opens by click
    Error: expect(received).toBe(expected) // Object.is equality
    Expected: false
    Received: true
    Call Log:
    - Timeout 15000ms exceeded while waiting on the predicate
    > 310 |     await expect.poll(() => setupIsOpen(page)).toBe(false);
  1 failed
```

With the line restored the same test passes.

# NOTES — summary (2026-10-23)
- Built: `<details class="room-setup">` holds the participants table and the Mode / Rounds / Turn timeout / Record site debug fields; Start/Continue and Stop sit in their own row outside it. Closes on an accepted start or continue (`setupOpenAfterStart`), unchanged on a refused one; open for a new room, closed for a saved room with entries (`setupOpenOnRoom`); the summary digest (`setupDigest`) is textContent, refreshed on table, mode and rounds changes.
- Checks (coordinator, this run): `bash .claude/scratch/gates.sh` exit 0 — fast tier 12 commands exit 0, vitest 947/947, coverage 100.00 % (floor 100.00 %), build exit 0, electron-smoke 48/48.
- Left for the owner: AC4 (does the feed get the screen, is the setup easy to reopen).
