// room-layout.spec.ts
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
const stubCli = path.join(root, 'tests', 'fixtures', 'stub-cli.mjs');
const TURN_BUDGET_MS = 5000;
const RUN_BASE_MS = 5000;
const PARTICIPANTS = ['claude', 'codex'];
const MARKUP = '<img src=x onerror="window.__pwned=1"><b>bold</b>';

interface Session {
  app: ElectronApplication;
  page: Page;
}

function newBase(): string {
  return mkdtempSync(path.join(tmpdir(), 'aiaw-layout-'));
}

async function launch(base: string): Promise<Session> {
  const app = await electron.launch({
    args: [root],
    env: {
      ...process.env,
      AIAW_USER_DATA: path.join(base, 'profile'),
      AIAW_ROOM_FAST: '1',
      AIAW_CLAUDE_BIN: stubCli,
      AIAW_CODEX_BIN: stubCli,
      AIAW_TEST_FOLDER: path.join(base, 'folder'),
      CLAUDE_CONFIG_DIR: path.join(base, 'claude'),
      CODEX_HOME: path.join(base, 'codex'),
    },
  });
  const page = await app.firstWindow();
  return { app, page };
}

function field(page: Page, name: string): Locator {
  return page.locator(`[data-room="${name}"]`);
}

function treeItems(page: Page): Locator {
  return page.locator('[data-room="tree"] [data-room-id]');
}

function titleInRecord(base: string): string | undefined {
  const dir = path.join(base, 'profile', 'shared', 'rooms');
  const names = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.json')) : [];
  expect(names).toHaveLength(1);
  const record = JSON.parse(readFileSync(path.join(dir, names[0] as string), 'utf8')) as { title?: string };
  return record.title;
}

async function finishOneRoom(page: Page): Promise<void> {
  await field(page, 'open').click();
  await expect(field(page, 'pane')).toBeVisible();
  await field(page, 'prompt').fill('layout question');
  for (const id of PARTICIPANTS) await page.locator(`input[data-participant="${id}"]`).check();
  await field(page, 'mode').selectOption('broadcast');
  await field(page, 'rounds').fill('1');
  await field(page, 'start').click();
  await expect(field(page, 'status')).toContainText('done', { timeout: (PARTICIPANTS.length + 1) * TURN_BUDGET_MS + RUN_BASE_MS });
  await expect(treeItems(page)).toHaveCount(1);
}

async function renameFromTree(page: Page, title: string, commit: boolean): Promise<void> {
  await treeItems(page).first().click({ button: 'right' });
  await field(page, 'rename').click();
  const input = field(page, 'rename-input');
  await expect(input).toBeFocused();
  await input.fill(title);
  await input.press(commit ? 'Enter' : 'Escape');
  await expect(input).toHaveCount(0);
}

test('a room renamed from the tree keeps its title after an app restart and opens from the tree', async () => {
  const base = newBase();
  const first = await launch(base);
  try {
    await finishOneRoom(first.page);
    await expect(treeItems(first.page).first()).toHaveText('layout question');
    await renameFromTree(first.page, 'Discarded name', false);
    await expect(treeItems(first.page).first()).toHaveText('layout question');
    expect(titleInRecord(base)).toBeUndefined();
    await renameFromTree(first.page, 'Kept name', true);
    await expect(treeItems(first.page).first()).toHaveText('Kept name');
    await expect.poll(() => titleInRecord(base)).toBe('Kept name');
  } finally {
    await first.app.close();
  }
  expect(titleInRecord(base)).toBe('Kept name');

  const second = await launch(base);
  const { page } = second;
  try {
    await expect(treeItems(page)).toHaveCount(1);
    await expect(treeItems(page).first()).toHaveText('Kept name');
    await treeItems(page).first().click();
    await expect(field(page, 'pane')).toBeVisible();
    await expect(treeItems(page).first()).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('.room-entry').first()).toBeVisible();
    await expect(field(page, 'start')).toHaveText('Continue');
  } finally {
    await second.app.close();
  }
});

test('the header collapses the tree and reports it', async () => {
  const base = newBase();
  const { app, page } = await launch(base);
  try {
    await finishOneRoom(page);
    const toggle = field(page, 'tree-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(treeItems(page)).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(treeItems(page)).toHaveCount(1);
  } finally {
    await app.close();
  }
});

test('markup in a room title is shown as text', async () => {
  const base = newBase();
  const first = await launch(base);
  try {
    await finishOneRoom(first.page);
    await renameFromTree(first.page, MARKUP, true);
    await expect.poll(() => titleInRecord(base)).toBe(MARKUP);
    await expect(treeItems(first.page).first()).toHaveText(MARKUP);
    await expect(field(first.page, 'tree').locator('img, b')).toHaveCount(0);
    await treeItems(first.page).first().click();
    await expect(field(first.page, 'title')).toHaveText(MARKUP);
    await expect(first.page.locator('[data-room="pane"] h2 :is(img, b)')).toHaveCount(0);
    expect(await first.page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  } finally {
    await first.app.close();
  }
});
