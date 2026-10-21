# typescript-eslint@8.71.1

Pinned 2026-10-21 (published 2026-10-05). Peers: `eslint ^8.57 || ^9 || ^10`, `typescript >=4.8.4 <6.1.0` (so TypeScript 6.0.3, see `typescript@6.0.3.md`).

- Quick start installs `eslint @eslint/js typescript typescript-eslint`; the config is `defineConfig({ files: ['**/*.{js,ts}'], extends: [js.configs.recommended, tseslint.configs.recommended] })` with `import tseslint from 'typescript-eslint'` — https://github.com/typescript-eslint/typescript-eslint/blob/v8.71.1/docs/getting-started/Quickstart.mdx#L1-L50
- Type-aware rules need `languageOptions.parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname }` and the `*TypeChecked` configs; without it only syntactic rules run — https://github.com/typescript-eslint/typescript-eslint/blob/v8.71.1/docs/getting-started/Typed_Linting.mdx#L30-L82
- `tseslint.configs.recommendedTypeChecked` is the shared config with the recommended rules that additionally need type information; `projectService: true` asks TypeScript's service for each file's types — https://github.com/typescript-eslint/typescript-eslint/blob/v8.71.1/docs/getting-started/Typed_Linting.mdx#L45-L50
