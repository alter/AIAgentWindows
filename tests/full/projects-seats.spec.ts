// projects-seats.spec.ts
import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
const stubCli = path.join(root, 'tests', 'fixtures', 'stub-cli.mjs');

interface Site {
  server: Server;
  url: string;
}

async function startSite(): Promise<Site> {
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end('<!doctype html><title>fixture</title><p>fixture</p>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/` };
}

function node(page: Page, name: string): Locator {
  return page.locator('[data-project="tree"] [data-project-id]').filter({ has: page.locator('[data-project="node"]', { hasText: name }) });
}

function field(page: Page, name: string): Locator {
  return page.locator(`[data-room="${name}"]`);
}

async function addExisting(page: Page, count: number): Promise<void> {
  await page.locator('[data-project="add"]').click();
  await page.locator('[data-project="add-existing"]').click();
  await page.locator('[data-project="create"]').click();
  await expect(page.locator('[data-project="tree"] [data-project-id]')).toHaveCount(count);
}

function menuItem(page: Page, kind: string): Locator {
  return page.locator(`[data-room="add-menu"] [data-add="${kind}"]`);
}

async function openAddMenu(page: Page): Promise<void> {
  await field(page, 'add-participant').click();
  await expect(page.locator('[data-room="add-menu"]')).toBeVisible();
}

async function closeAddMenu(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-room="add-menu"]')).toBeHidden();
}

test('Add participant offers a site kind only when the room project has that agent, and opening another project room during a run names the running room', async () => {
  test.setTimeout(240_000);
  const site = await startSite();
  const base = mkdtempSync(path.join(tmpdir(), 'aiaw-project-seats-'));
  const folders = ['seat-alpha', 'seat-beta'].map((name) => path.join(base, 'code', name));
  for (const folder of folders) {
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, 'README.md'), 'synthetic project\n');
  }
  const app = await electron.launch({
    args: [root],
    env: {
      ...process.env,
      AIAW_USER_DATA: path.join(base, 'profile'),
      AIAW_ROOM_FAST: '1',
      AIAW_CLAUDE_BIN: stubCli,
      AIAW_CODEX_BIN: stubCli,
      AIAW_STUB_ARGV_LOG: path.join(base, 'argv.log'),
      AIAW_STUB_HANG: '1',
      AIAW_SITE_URL_CHATGPT: site.url,
      AIAW_TEST_FOLDER: JSON.stringify([...folders, null]),
      CLAUDE_CONFIG_DIR: path.join(base, 'claude'),
      CODEX_HOME: path.join(base, 'codex'),
    },
  });
  try {
    const page = await app.firstWindow();
    await addExisting(page, 1);
    await addExisting(page, 2);
    const alpha = node(page, 'seat-alpha');
    const beta = node(page, 'seat-beta');

    await alpha.locator('[data-project="add-room"]').click();
    await openAddMenu(page);
    await expect(menuItem(page, 'chatgpt')).toHaveAttribute('aria-disabled', 'true');
    await expect(menuItem(page, 'chatgpt')).toContainText('Add a ChatGPT agent to this project first');
    await expect(menuItem(page, 'claude')).not.toHaveAttribute('aria-disabled', 'true');
    await closeAddMenu(page);

    await alpha.locator('[data-project="add-agent"]').click();
    await page.locator('[data-project="agent-menu"] button[data-kind="chatgpt"]').click();
    await expect(alpha.locator('.agent-item')).toHaveCount(1);

    await alpha.locator('[data-project="add-room"]').click();
    await openAddMenu(page);
    await expect(menuItem(page, 'chatgpt')).not.toHaveAttribute('aria-disabled', 'true');
    await closeAddMenu(page);

    await beta.locator('[data-project="add-room"]').click();
    await openAddMenu(page);
    await expect(menuItem(page, 'chatgpt')).toHaveAttribute('aria-disabled', 'true');
    await closeAddMenu(page);

    await field(page, 'prompt').fill('hang question beta');
    await field(page, 'mode').selectOption('relay');
    await field(page, 'rounds').fill('1');
    await field(page, 'start').click();
    await expect(field(page, 'status')).toContainText(/running/i);
    await field(page, 'stop').click();
    await expect(field(page, 'status')).toContainText(/stopped/i);
    await expect(beta.locator('[data-room-id]')).toHaveCount(1);
    const betaRoom = (await beta.locator('[data-room-id]').first().getAttribute('data-room-id')) ?? '';
    expect(betaRoom).not.toBe('');

    await alpha.locator('[data-project="add-room"]').click();
    await field(page, 'prompt').fill('hang question alpha');
    await field(page, 'start').click();
    await expect(field(page, 'status')).toContainText(/running/i);
    const refused = await page.evaluate((id) => (window as unknown as { aiaw: { roomOpen(id: string): Promise<{ ok: boolean; error?: string }> } }).aiaw.roomOpen(id), betaRoom);
    expect(refused.ok).toBe(false);
    expect(refused.error).toContain('hang question alpha');
    await field(page, 'stop').click();
    await expect(field(page, 'status')).toContainText(/stopped/i);
  } finally {
    await app.close();
    site.server.close();
  }
});
