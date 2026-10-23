// theme-switch.spec.ts
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
const stubCli = path.join(root, 'tests', 'fixtures', 'stub-cli.mjs');

function launch(userData: string): Promise<ElectronApplication> {
  return electron.launch({
    args: [root],
    env: {
      ...process.env,
      AIAW_USER_DATA: userData,
      AIAW_CLAUDE_BIN: stubCli,
      AIAW_CODEX_BIN: stubCli,
      AIAW_TEST_FOLDER: userData,
    },
  });
}

function themeSource(app: ElectronApplication): Promise<string> {
  return app.evaluate(({ nativeTheme }) => nativeTheme.themeSource);
}

function pageIsDark(page: Page): Promise<boolean> {
  return page.evaluate(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
}

function radio(page: Page, choice: string): ReturnType<Page['locator']> {
  return page.getByRole('radiogroup', { name: 'Theme' }).locator(`input[type="radio"][value="${choice}"]`);
}

test('the chosen theme applies and survives a restart', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'aiaw-theme-'));
  let app = await launch(userData);
  try {
    let page = await app.firstWindow();
    await page.emulateMedia({ colorScheme: null });
    await expect(radio(page, 'system')).toBeChecked();
    expect(await themeSource(app)).toBe('system');

    await radio(page, 'light').click();
    await expect(radio(page, 'light')).toBeChecked();
    await expect.poll(() => themeSource(app)).toBe('light');
    await expect.poll(() => pageIsDark(page)).toBe(false);

    await page.keyboard.press('ArrowRight');
    await expect(radio(page, 'dark')).toBeChecked();
    await expect.poll(() => themeSource(app)).toBe('dark');
    await expect.poll(() => pageIsDark(page)).toBe(true);

    await app.close();
    app = await launch(userData);
    page = await app.firstWindow();
    await expect(radio(page, 'dark')).toBeChecked();
    expect(await themeSource(app)).toBe('dark');
    await page.emulateMedia({ colorScheme: null });
    await expect.poll(() => pageIsDark(page)).toBe(true);
  } finally {
    await app.close();
  }
});
