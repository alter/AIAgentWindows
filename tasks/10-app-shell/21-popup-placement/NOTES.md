# NOTES

## T01 red first (unit)
```
$ npx vitest run tests/unit/popup-place.test.ts   (before src/shared/popup-place.ts existed)
 FAIL  |unit| tests/unit/popup-place.test.ts [ tests/unit/popup-place.test.ts ]
Error: Cannot find module '../../src/shared/popup-place' imported from /Users/user/workflow/git/AIAgentWindows/tests/unit/popup-place.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```

## T01 reverse control (smoke, tests/full/popup-placement.spec.ts)
Helper changed to top = anchor bottom, no flip, no max-height (src/renderer/popup.ts, restored after):
```
  ✘  1 [electron-smoke] › tests/full/popup-placement.spec.ts:94:5 › every popup stays inside the window and its last item is reachable (785ms)
  1) [electron-smoke] › tests/full/popup-placement.spec.ts:94:5 › every popup stays inside the window and its last item is reachable 
    Error: expect(received).toBeLessThanOrEqual(expected)
    Expected: <= 900
    Received:    1036
      70 |   expect(box.x).toBeGreaterThanOrEqual(0);
      71 |   expect(box.y).toBeGreaterThanOrEqual(0);
    > 72 |   expect(box.x + box.width).toBeLessThanOrEqual(view.width);
         |                             ^
      73 |   expect(box.y + box.height).toBeLessThanOrEqual(view.height);
      74 | }
      75 |
```
Same, only for the Room Add participant menu (the owner's case; window 900 x 560, setup expanded, button scrolled to the bottom): the menu ends at 703.5 px in a 560 px window:
```
  ✘  1 [electron-smoke] › tests/full/popup-placement.spec.ts:94:5 › every popup stays inside the window and its last item is reachable (1.1s)
  1) [electron-smoke] › tests/full/popup-placement.spec.ts:94:5 › every popup stays inside the window and its last item is reachable 
    Error: expect(received).toBeLessThanOrEqual(expected)
    Expected: <= 560
    Received:    703.5
      71 |   expect(box.y).toBeGreaterThanOrEqual(0);
      72 |   expect(box.x + box.width).toBeLessThanOrEqual(view.width);
    > 73 |   expect(box.y + box.height).toBeLessThanOrEqual(view.height);
         |                              ^
```
Restored: the spec passes (1 passed).

## 2026-10-23 Summary

- One rule `placePopup` (src/shared/popup-place.ts) and one helper `showPopup`/`hidePopup` (src/renderer/popup.ts, position fixed, max-height, overflow-y auto, re-placed on resize) used by Add participant, the agents "+" menu, the agent context menu and the room context menu; the fixed CSS offsets are gone.
- Checks (coordinator, this run): fast tier 12 commands exit 0, vitest 1196/1196, coverage 100.00 %, electron-smoke 69/69; tasks/check.py 7 (baseline).
- Known limit: an open menu does not follow its button if the Room pane is scrolled under it (it is fixed to the window); it closes on the next click.
- Open: AC4 HUMAN — open Add participant at the bottom of the window.
