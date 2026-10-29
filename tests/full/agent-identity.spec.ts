// agent-identity.spec.ts
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
const stubCli = path.join(root, 'tests', 'fixtures', 'stub-cli.mjs');

const LOGO_FILES: Readonly<Record<string, string>> = {
  claude: 'claudecode-color.svg',
  codex: 'codex-color.svg',
  chatgpt: 'openai.svg',
  grok: 'grok.svg',
  deepseek: 'deepseek-color.svg',
};

interface Fixture {
  server: Server;
  url: string;
}

async function startFixture(): Promise<Fixture> {
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end('<!doctype html><title>fixture</title><p>fixture</p>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/` };
}

function launch(userData: string, siteUrl: string): Promise<ElectronApplication> {
  return electron.launch({
    args: [root],
    env: {
      ...process.env,
      AIAW_USER_DATA: userData,
      AIAW_CLAUDE_BIN: stubCli,
      AIAW_CODEX_BIN: stubCli,
      AIAW_TEST_FOLDER: userData,
      AIAW_SITE_URL_CHATGPT: siteUrl,
      AIAW_SITE_URL_GROK: siteUrl,
      AIAW_SITE_URL_DEEPSEEK: siteUrl,
    },
  });
}

async function addAgent(page: Page, kind: string): Promise<void> {
  await page.locator('.add-button').click();
  await page.locator(`.menu-item[data-kind="${kind}"]`).click();
}

function storedTitles(userData: string): string[] {
  const state = JSON.parse(readFileSync(path.join(userData, 'state.json'), 'utf8')) as { agents: { title: string }[] };
  return state.agents.map((agent) => agent.title);
}

async function renameBy(page: Page, index: number, via: 'f2' | 'menu', title: string): Promise<void> {
  const item = page.locator('.agent-item').nth(index);
  if (via === 'f2') {
    await item.focus();
    await page.keyboard.press('F2');
  } else {
    await item.click({ button: 'right' });
    await page.locator('.context-item[data-agent="rename"]').click();
  }
  const input = page.locator('.agent-rename');
  await expect(input).toBeFocused();
  await input.fill(title);
  await page.keyboard.press('Enter');
  await expect(input).toHaveCount(0);
}

test('an agent renamed from the sidebar keeps its title after a restart', async () => {
  const { server, url } = await startFixture();
  const userData = mkdtempSync(path.join(tmpdir(), 'aiaw-identity-'));
  let app = await launch(userData, url);
  try {
    let page = await app.firstWindow();
    await addAgent(page, 'grok');
    await expect(page.locator('.agent-item')).toHaveCount(1);
    await addAgent(page, 'claude');
    await expect(page.locator('.agent-item')).toHaveCount(2);
    const titles = page.locator('.agent-item .agent-title');
    await expect(titles).toHaveText(['Grok', /Claude Code/]);

    await renameBy(page, 0, 'f2', '  Research  ');
    await expect(titles.first()).toHaveText('Research');
    await expect(page.locator('.agent-close').first()).toHaveAttribute('aria-label', 'Close Research');
    await expect.poll(() => storedTitles(userData)[0]).toBe('Research');

    await page.locator('.agent-item').first().focus();
    await page.keyboard.press('F2');
    await page.locator('.agent-rename').fill('Discarded by Escape');
    await page.keyboard.press('Escape');
    await expect(page.locator('.agent-rename')).toHaveCount(0);
    await expect(titles.first()).toHaveText('Research');

    await page.locator('.agent-item').nth(1).click({ button: 'right' });
    await page.locator('.context-item[data-agent="rename"]').click();
    await page.locator('.agent-rename').fill('   ');
    await page.keyboard.press('Enter');
    await expect(titles.nth(1)).toContainText('Claude Code');

    await renameBy(page, 1, 'menu', 'Builder');
    await expect(titles.nth(1)).toHaveText('Builder');
    await expect.poll(() => storedTitles(userData)).toEqual(['Research', 'Builder']);

    await app.close();
    app = await launch(userData, url);
    page = await app.firstWindow();
    await expect(page.locator('.agent-item .agent-title')).toHaveText(['Research', 'Builder']);
    expect(storedTitles(userData)).toEqual(['Research', 'Builder']);
  } finally {
    await app.close();
    server.close();
  }
});

test('markup in an agent title is shown as text', async () => {
  const { server, url } = await startFixture();
  const userData = mkdtempSync(path.join(tmpdir(), 'aiaw-identity-'));
  const app = await launch(userData, url);
  const markup = '<img src=x onerror="document.title=1"><b>bold</b>';
  try {
    const page = await app.firstWindow();
    await addAgent(page, 'deepseek');
    await expect(page.locator('.agent-item')).toHaveCount(1);
    await renameBy(page, 0, 'f2', markup);
    const title = page.locator('.agent-item .agent-title');
    await expect(title).toHaveText(markup);
    await expect(page.locator('.agent-item .agent-title *')).toHaveCount(0);
    await expect(page.locator('.agent-item img')).toHaveCount(1);
    expect(await page.title()).toBe('AI Agent Windows');
    expect(storedTitles(userData)).toEqual([markup]);
  } finally {
    await app.close();
    server.close();
  }
});

test('every agent kind shows its vendored logo in the sidebar and in the add menu, mono marks follow the palette', async () => {
  const { server, url } = await startFixture();
  const userData = mkdtempSync(path.join(tmpdir(), 'aiaw-identity-'));
  const app = await launch(userData, url);
  try {
    const page = await app.firstWindow();
    const kinds = Object.keys(LOGO_FILES);
    for (const kind of kinds) {
      await addAgent(page, kind);
      await expect(page.locator('.agent-item')).toHaveCount(kinds.indexOf(kind) + 1);
    }
    await page.locator('.add-button').click();
    for (const [index, kind] of kinds.entries()) {
      const file = LOGO_FILES[kind] ?? '';
      for (const logo of [page.locator('.agent-item').nth(index).locator('img'), page.locator(`.menu-item[data-kind="${kind}"] img`)]) {
        await expect(logo).toHaveAttribute('src', new RegExp(`${file.replace('.', '\\.')}$`));
        await expect(logo).toHaveAttribute('alt', '');
        expect(await logo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
      }
      await expect(page.locator('.agent-item').nth(index)).toHaveAccessibleName(/^(Grok|ChatGPT|DeepSeek|Codex|Claude Code)/);
    }
    const filter = (kind: string): Promise<string> =>
      page.locator(`.menu-item[data-kind="${kind}"] img`).evaluate((image) => getComputedStyle(image).filter);
    await page.emulateMedia({ colorScheme: 'dark' });
    expect(await filter('chatgpt')).toBe('invert(1)');
    expect(await filter('grok')).toBe('invert(1)');
    expect(await filter('claude')).toBe('none');
    await page.emulateMedia({ colorScheme: 'light' });
    expect(await filter('chatgpt')).toBe('none');
    expect(await filter('grok')).toBe('none');
  } finally {
    await app.close();
    server.close();
  }
});

test('the Rooms and Agents + buttons have one size and one right edge in both states of the Rooms tree', async () => {
  const { server, url } = await startFixture();
  const userData = mkdtempSync(path.join(tmpdir(), 'aiaw-identity-'));
  const app = await launch(userData, url);
  try {
    const page = await app.firstWindow();
    const edges = (): Promise<{ rooms: { width: number; right: number }; agents: { width: number; right: number } }> =>
      page.evaluate(() => {
        const box = (selector: string): { width: number; right: number } => {
          const rect = document.querySelector(selector)?.getBoundingClientRect();
          return { width: rect?.width ?? -1, right: rect?.right ?? -1 };
        };
        return { rooms: box('[data-room="new"]'), agents: box('.add-button') };
      });
    const same = async (): Promise<void> => {
      const { rooms, agents } = await edges();
      expect(rooms.width).toBeGreaterThan(0);
      expect(rooms.width).toBe(agents.width);
      expect(rooms.right).toBe(agents.right);
    };
    await expect(page.locator('[data-room="tree-toggle"]')).toHaveAttribute('aria-expanded', 'true');
    await same();
    await page.evaluate(() => {
      const list = document.querySelector('.rooms-list');
      for (let index = 0; index < 60; index += 1) {
        const item = document.createElement('li');
        item.textContent = `Filler room ${index}`;
        item.style.padding = '6px 8px';
        list?.append(item);
      }
    });
    expect(await page.locator('.projects').evaluate((list) => list.scrollHeight > list.clientHeight)).toBe(true);
    await same();
    await page.locator('[data-room="tree-toggle"]').click();
    await expect(page.locator('[data-room="tree-toggle"]')).toHaveAttribute('aria-expanded', 'false');
    await same();
    await page.locator('[data-room="tree-toggle"]').click();
    await same();
  } finally {
    await app.close();
    server.close();
  }
});
