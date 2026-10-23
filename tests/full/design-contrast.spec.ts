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
    await page.locator('.add-button').click();
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

test('a click on the head of a Room feed entry opens it and the head draws an arrow that turns when open', async () => {
  const base = mkdtempSync(path.join(tmpdir(), 'aiaw-contrast-room-'));
  const app = await electron.launch({
    args: [root],
    env: {
      ...process.env,
      AIAW_USER_DATA: path.join(base, 'profile'),
      AIAW_ROOM_FAST: '1',
      AIAW_CLAUDE_BIN: stubCli,
      AIAW_CODEX_BIN: stubCli,
      AIAW_TEST_FOLDER: mkdtempSync(path.join(base, 'folder-')),
      CLAUDE_CONFIG_DIR: path.join(base, 'claude'),
      CODEX_HOME: path.join(base, 'codex'),
    },
  });
  try {
    const page = await app.firstWindow();
    await page.locator('[data-room="open"]').click();
    await expect(page.locator('[data-room="pane"]')).toBeVisible();
    await page.locator('[data-room="prompt"]').fill('arrow question');
    await page.locator('[data-room="mode"]').selectOption('broadcast');
    await page.locator('[data-room="rounds"]').fill('1');
    await page.locator('[data-room="start"]').click();
    await expect(page.locator('[data-room="status"]')).toContainText('done', { timeout: 40000 });

    const entry = page.locator('details.room-entry.kind-reply').first();
    const head = entry.locator('summary.room-entry-head');
    const text = entry.locator('.room-entry-text');
    const arrow = (): Promise<{ drawn: boolean; transform: string }> =>
      head.evaluate((node) => {
        const style = getComputedStyle(node, '::before');
        return { drawn: style.content !== 'none' && style.content !== 'normal', transform: style.transform };
      });
    await expect(entry).toHaveJSProperty('open', false);
    await expect(text).toBeHidden();
    const closed = await arrow();
    expect(closed.drawn).toBe(true);
    await head.click();
    await expect(entry).toHaveJSProperty('open', true);
    await expect(text).toBeVisible();
    const open = await arrow();
    expect(open.drawn).toBe(true);
    expect(open.transform).not.toBe(closed.transform);
    await head.click();
    await expect(entry).toHaveJSProperty('open', false);
    expect((await arrow()).transform).toBe(closed.transform);
  } finally {
    await app.close();
  }
});
