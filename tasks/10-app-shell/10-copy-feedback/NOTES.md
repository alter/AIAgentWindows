# NOTES

## 2026-10-23 T01 reverse control

Dropped `button.setAttribute('aria-disabled', 'true')` in `setCopied` of src/renderer/room-feed.ts, rebuilt, ran `npx playwright test --project=electron-smoke -g "Copy rests"`: red. File restored and byte-compared (cmp) with the saved copy; green again before the restore.

```

    Error: expect(locator).toHaveAttribute(expected) failed

    Locator:  locator('[data-section="final"] details.room-entry.kind-final').locator('button[data-room="copy-final"]').first()
    Expected: "true"
    Received: ""
    Timeout:  15000ms

    Call log:
      - Expect "toHaveAttribute" locator('[data-section="final"] details.room-entry.kind-final').locator('button[data-room="copy-final"]').first() with timeout 15000ms
      - waiting for locator('[data-section="final"] details.room-entry.kind-final').locator('button[data-room="copy-final"]').first()
        10 × locator resolved to <button type="button" data-copied="" data-room="copy-final" class="room-button room-copy">Copied</button>
           - unexpected value "null"
        24 × locator resolved to <button type="button" data-room="copy-final" class="room-button room-copy">Copy</button>
           - unexpected value "null"


      503 |     await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(expected);
      504 |     for (const index of [0, 1]) {
    > 505 |       await expect(buttons.nth(index)).toHaveAttribute('aria-disabled', 'true');
          |                                        ^
      506 |       await expect(buttons.nth(index)).toHaveAttribute('data-copied', /.*/);
      507 |     }
      508 |     await expect(field(page, 'message')).toHaveText('');
        at /Users/user/workflow/git/AIAgentWindows/tests/full/room.spec.ts:505:40

    Error Context: test-results/room-the-final-s-Copy-rests-for-3-s-after-a-copy-electron-smoke/error-context.md

  1 failed
    [electron-smoke] › tests/full/room.spec.ts:492:5 › the final's Copy rests for 3 s after a copy ─
```

# NOTES — summary (2026-10-23)
- Built: RoomFeed owns the final's Copy buttons; a successful copy sets both to Copied with aria-disabled and data-copied for COPY_REST_MS (3000), clicks ignored, focus kept, then back; timer cleared on feed reset; room-pane writes no success line, a failed copy keeps its message; `.room-button[aria-disabled="true"]` shares the disabled look.
- Checks (coordinator, this run): `bash .claude/scratch/gates.sh` exit 0 — fast tier 12 commands exit 0, vitest 966/966, coverage 100.00 %, build exit 0, electron-smoke 50/50.
- Left for the owner: AC3.
