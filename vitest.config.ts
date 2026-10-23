// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      { test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] } },
      { test: { name: 'integration', include: ['tests/integration/**/*.test.ts'] } },
    ],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      include: ['src/shared/**', 'src/main/pty-manager.ts', 'src/main/state-file.ts', 'src/main/store/**'],
    },
  },
});
