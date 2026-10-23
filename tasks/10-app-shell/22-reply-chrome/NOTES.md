# NOTES

## T01 red first (before the rule), tests/unit/generic-adapter.test.ts
```
 FAIL  |unit| tests/unit/generic-adapter.test.ts > generic adapter: turn > a reply leaves out buttons and screen-reader labels
AssertionError: expected 'Assistant\nWorked for 56s\nScreen rea…' to be 'Rivers carve valleys over long stretc…' // Object.is equality

- Expected
+ Received

+ Assistant
+ Worked for 56s
+ Screen reader only note
  Rivers carve valleys over long stretches of time.
  Call flow() to start the water.
+ Share this answer with others
+ How deep can a valley get?Which river is the longest?

 ❯ tests/unit/generic-adapter.test.ts:262:19
    260|     const adapter = createGenericAdapter('fixture', OPTIONS);
    261|     const reply = await runAdapterTurn(adapter, page.runner, 'Tell me …
    262|     expect(reply).toBe('Rivers carve valleys over long stretches of ti…
       |                   ^
    263|   });
    264|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
```

## T01 reverse control (BUTTON removed from SKIP_TAGS), restored afterwards, test green
```
 FAIL  |unit| tests/unit/generic-adapter.test.ts > generic adapter: turn > a reply leaves out buttons and screen-reader labels
AssertionError: expected 'Worked for 56s\nRivers carve valleys …' to be 'Rivers carve valleys over long stretc…' // Object.is equality

- Expected
+ Received

+ Worked for 56s
  Rivers carve valleys over long stretches of time.
  Call flow() to start the water.
+ How deep can a valley get?Which river is the longest?

 ❯ tests/unit/generic-adapter.test.ts:262:19
    260|     const adapter = createGenericAdapter('fixture', OPTIONS);
    261|     const reply = await runAdapterTurn(adapter, page.runner, 'Tell me …
    262|     expect(reply).toBe('Rivers carve valleys over long stretches of ti…
       |                   ^
    263|   });
    264|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
```

## T01 results
AC2 vitest generic-adapter + site-adapters: 88 passed. Fast tier: all exit 0, vitest 1197/1197, coverage 100.00 %. build exit 0. electron-smoke 69 passed. tasks/check.py 7 problems (baseline).

## 2026-10-24 Summary

- The generic reply reader skips button, role=button, data-no-copy="true" and sr-only labels (generic-scripts.ts pageChrome); Grok-shaped synthetic fixture in composer.html (?chrome=1).
- Checks (coordinator, this run): fast tier 12 commands exit 0, vitest 1197/1197, coverage 100.00 %, electron-smoke 69/69; tasks/check.py 7 (baseline).
- Open: AC4 HUMAN — a room with Grok shows no "Worked for" or suggestions.
