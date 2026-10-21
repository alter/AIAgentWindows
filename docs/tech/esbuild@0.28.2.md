# esbuild@0.28.2

Pinned 2026-10-21 (published 2026-08-08, Node `>=18`).

- JS API `build(options)` returns a `Promise<BuildResult>`; `buildSync` exists; options used by `scripts/build.mjs`: `entryPoints`, `bundle`, `outdir`/`outfile`, `platform` (`'browser' | 'node' | 'neutral'`), `format` (`'iife' | 'cjs' | 'esm'`), `target`, `external`, `packages`, `loader`, `define`, `sourcemap`, `metafile`, `logLevel` — https://github.com/evanw/esbuild/blob/v0.28.2/lib/shared/types.ts#L1-L3 and https://github.com/evanw/esbuild/blob/v0.28.2/lib/shared/types.ts#L117-L168
- `external: string[]` leaves a module as a runtime `require` (used for `electron` and `node-pty`, a native addon that cannot be bundled); `packages: 'external'` externalises every bare import — https://github.com/evanw/esbuild/blob/v0.28.2/lib/shared/types.ts#L131-L134
- `entryPoints` accepts `string[]`, `{ in, out }[]` or a `Record<string, string>` — https://github.com/evanw/esbuild/blob/v0.28.2/lib/shared/types.ts#L168
- esbuild transpiles TypeScript but does not type-check it; `npx tsc --noEmit` stays the type gate (loader `ts`/`tsx` in the `Loader` union) — https://github.com/evanw/esbuild/blob/v0.28.2/lib/shared/types.ts#L3
- 0.28.2 fixes tree shaking of imports used only by a TypeScript `import Alias = Base.Type` — https://github.com/evanw/esbuild/blob/v0.28.2/CHANGELOG.md#L3-L11
