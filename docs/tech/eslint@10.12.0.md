# eslint@10.12.0

Pinned 2026-10-21 (published 2026-10-02). Node `^20.19.0 || ^22.13.0 || >=24`; optional peer `jiti` (only for a TypeScript config file).

- Only flat config exists (`eslint.config.js|mjs|cjs|ts`); the eslintrc format is removed — https://github.com/eslint/eslint/blob/v10.12.0/docs/src/use/migrate-to-10.0.0.md#L116
- The config file is looked up from each linted file's directory upwards, not from the cwd (was a v9 flag) — https://github.com/eslint/eslint/blob/v10.12.0/docs/src/use/migrate-to-10.0.0.md#L100-L103
- `defineConfig` and `globalIgnores` come from `eslint/config`; `globalIgnores([...])` ignores paths for the whole run; default ignores are `**/node_modules/` and `.git/` — https://github.com/eslint/eslint/blob/v10.12.0/docs/src/use/configure/ignore.md#L22-L36
- By default ESLint matches `**/*.js`, `**/*.cjs`, `**/*.mjs`; other extensions (`.ts`) need a config object with `files` — https://github.com/eslint/eslint/blob/v10.12.0/docs/src/use/configure/configuration-files.md#L140
- `files`/`ignores` patterns are minimatch globs relative to the config file; an object with only `ignores` is a global ignore — https://github.com/eslint/eslint/blob/v10.12.0/docs/src/use/configure/configuration-files.md#L71-L92
- `eslint-env` comments are errors; `eslint:recommended` was updated in v10 (new rules in the recommended set) — https://github.com/eslint/eslint/blob/v10.12.0/docs/src/use/migrate-to-10.0.0.md#L88-L90 and https://github.com/eslint/eslint/blob/v10.12.0/docs/src/use/migrate-to-10.0.0.md#L157
