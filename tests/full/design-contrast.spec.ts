// design-contrast.spec.ts
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
const stubCli = path.join(root, 'tests', 'fixtures', 'stub-cli.mjs');

function launch(userData: string, folder: string): Promise<ElectronApplication> {
  return electron.launch({
    args: [root],
    env: {
      ...process.env,
      AIAW_USER_DATA: userData,
      AIAW_CLAUDE_BIN: stubCli,
      AIAW_CODEX_BIN: stubCli,
      AIAW_TEST_FOLDER: folder,
    },
  });
}

function paintedBackgrounds(page: Page): Promise<{ token: string; body: string; terminal: string }> {
  return page.evaluate(() => {
    const resolve = (value: string): string => {
      const probe = document.createElement('span');
      probe.style.backgroundColor = value;
      document.body.append(probe);
      const colour = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return colour;
    };
    const token = getComputedStyle(document.documentElement).getPropertyValue('--content-bg').trim();
    const surface = document.querySelector<HTMLElement>('.terminal-pane:not([hidden]) .xterm-scrollable-element');
    return {
      token: resolve(token),
      body: getComputedStyle(document.body).backgroundColor,
      terminal: surface === null ? 'missing' : getComputedStyle(surface).backgroundColor,
    };
  });
}

test('the body and terminal backgrounds follow the system colour scheme live, light then dark', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'aiaw-userdata-'));
  const folder = mkdtempSync(path.join(tmpdir(), 'aiaw-folder-'));
  const app = await launch(userData, folder);
  try {
    const page = await app.firstWindow();
    await page.locator('button[aria-haspopup="menu"]').click();
    await page.locator('.menu-item[data-kind="claude"]').click();
    await expect(page.locator('.terminal-pane:not([hidden]) .xterm-rows')).toContainText('STUB-CLI BANNER');

    const seen: string[] = [];
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expect
        .poll(async () => {
          const painted = await paintedBackgrounds(page);
          return painted.body === painted.token && painted.terminal === painted.token;
        })
        .toBe(true);
      seen.push((await paintedBackgrounds(page)).token);
    }
    expect(seen[0]).not.toBe(seen[1]);
  } finally {
    await app.close();
  }
});
