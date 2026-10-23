# @types/node@22.20.5

Pinned 2026-10-21 (published 2026-10-01). Type definitions for the machine's Node v22; `tsconfig.json` lists `"types": ["node"]` so `npx tsc --noEmit` checks `node:*` imports in `src/main`, `scripts` and tests.

- Major 22 follows the Node 22 runtime of the machine (v22.22.0); vitest 5.0.3 accepts peer `@types/node ^22.0.0 || >=24.0.0` — https://www.npmjs.com/package/vitest/v/5.0.3?activeTab=dependencies
- Package page of the pinned version — https://www.npmjs.com/package/@types/node/v/22.20.5
- `fsPromises.rm(path, { recursive: true, force: true, maxRetries })` on the runtime v22.22.0: "If an `EBUSY`, `EMFILE`, `ENFILE`, `ENOTEMPTY`, or `EPERM` error is encountered, Node.js will retry the operation with a linear backoff wait of `retryDelay` milliseconds longer on each try"; default 0. Test teardowns that remove a folder a recorder wrote use `maxRetries: 3` after a gate run failed once with `ENOTEMPTY, rmdir …/run/fixture-jsdom` in tests/unit/site-replay.test.ts (2026-10-23) — https://github.com/nodejs/node/blob/v22.22.0/doc/api/fs.md
