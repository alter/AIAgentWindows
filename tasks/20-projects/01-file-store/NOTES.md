# NOTES — file store (2026-10-24)

Fail-closed and exclusive-temp tests were green only after being seen red:
```
     × never rewrites a truncated file, an oversize file, a future version or an unreadable path 7ms
     × keeps a truncated file and a future-version file byte-identical when a save is attempted 4ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |unit| tests/unit/json-file.test.ts > JsonFile > never rewrites a truncated file, an oversize file, a future version or an unreadable path
 FAIL  |unit| tests/unit/state-file.test.ts > state file fails closed > keeps a truncated file and a future-version file byte-identical when a save is attempted
      Tests  2 failed | 16 passed (18)
     × refuses a planted symlink at the temp path and writes nothing through it 9ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |unit| tests/unit/atomic-file.test.ts > writeAtomic > refuses a planted symlink at the temp path and writes nothing through it
      Tests  1 failed | 5 passed (6)
FAIL: test_delete_calls_outside_the_store_are_refused (tests.scripts.test_arch_check.ArchCheckTest.test_delete_calls_outside_the_store_are_refused)
FAIL: test_store_imports_electron (tests.scripts.test_arch_check.ArchCheckTest.test_store_imports_electron)
Ran 22 tests in 0.139s
FAILED (failures=2)
```

Not neutral by plan: the fail-closed read of state-file.ts and the sweep are behaviour. Existing state-file assertions are unchanged; three tests added.
