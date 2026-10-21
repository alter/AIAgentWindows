// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  projects: [{ name: 'electron-smoke', testDir: 'tests/full', testMatch: '**/*.spec.ts' }],
  globalSetup: './tests/full/global-setup.ts',
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
});
