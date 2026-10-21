T02: .npmrc (legacy-peer-deps=true) added to WRITE-SET because npm 10.9.4 crashes in arborist on the vitest 5.0.3 peer set; evidence in PLAN.md Assumptions.

T04 reverse control (AC2): a scratch copy of src/shared/cli-args.ts that builds the shell string as `cd ${cwd} && ${bin} ${args.join(' ')}` instead of passing `exec "$@"` with argv, run against a scratch copy of tests/unit/cli-args.test.ts: `npx vitest run` rc=1, 6 failed | 7 passed, including `keeps hostile path as one argument`. Scratch files deleted; real module green (13 passed).

## T05 reverse control
Stub CLI mutated so that Enter inside a bracketed paste submits (`char === '\r' || char === '\n'` instead of `char === '\r' && !inPaste`): `npx vitest run tests/integration/pty-stub.test.ts` -> 1 failed, 6 passed (`paste is not submitted`: expected output not to contain 'SUBMITTED'). Restored; 7 passed.
