// room-delete.spec.ts
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
const stubCli = path.join(root, 'tests', 'fixtures', 'stub-cli.mjs');
const ROOMS = [
  { id: 'delete-a', title: 'Alpha', updatedAt: 3000 },
  { id: 'delete-b', title: 'Bravo', updatedAt: 2000 },
  { id: 'delete-c', title: 'Charlie', updatedAt: 1000 },
];

interface Session {
  app: ElectronApplication;
  page: Page;
}

function newBase(): string {
  const base = mkdtempSync(path.join(tmpdir(), 'aiaw-delete-'));
  const rooms = roomsDir(base);
  mkdirSync(rooms, { recursive: true });
  for (const item of ROOMS) {
    const entry = { authorId: 'owner', label: 'You', time: 1000, kind: 'prompt', text: `${item.title} question` };
    const record = {
      version: 1,
      id: item.id,
      createdAt: 1000,
      updatedAt: item.updatedAt,
      status: 'done',
      config: {
        mode: 'relay',
        rounds: 1,
        participants: [{ id: 'claude', kind: 'claude', label: 'Claude Code' }],
        finalizerId: 'claude',
        turnTimeoutMs: 60000,
        debugSites: false,
      },
      entries: [entry],
      nonce: 'nonce1',
      title: item.title,
    };
    writeFileSync(path.join(rooms, `${item.id}.json`), JSON.stringify(record), 'utf8');
    writeFileSync(path.join(rooms, `${item.id}.md`), `# ${item.title}\n`, 'utf8');
    mkdirSync(path.join(base, 'profile', 'debug', 'sites', item.id), { recursive: true });
    writeFileSync(path.join(base, 'profile', 'debug', 'sites', item.id, 'frames.jsonl'), '{}\n', 'utf8');
  }
  return base;
}

function roomsDir(base: string): string {
  return path.join(base, 'profile', 'shared', 'rooms');
}

function filesOf(base: string, id: string): string[] {
  return [path.join(roomsDir(base), `${id}.json`), path.join(roomsDir(base), `${id}.md`), path.join(base, 'profile', 'debug', 'sites', id)];
}

function trashed(base: string): string[] {
  const dir = path.join(base, 'profile', 'trash');
  return existsSync(dir) ? readdirSync(dir) : [];
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

function treeItem(page: Page, id: string): Locator {
  return page.locator(`[data-room="tree"] [data-room-id="${id}"]`);
}

function treeItems(page: Page): Locator {
  return page.locator('[data-room="tree"] [data-room-id]');
}

async function openPane(page: Page): Promise<void> {
  await field(page, 'open').click();
  await expect(field(page, 'pane')).toBeVisible();
  await expect(treeItems(page)).toHaveCount(ROOMS.length);
}

async function askByMenu(page: Page, id: string): Promise<void> {
  await treeItem(page, id).click({ button: 'right' });
  await field(page, 'delete').click();
  await expect(field(page, 'delete-confirm')).toBeVisible();
}

async function askByKey(page: Page, id: string, key: 'Delete' | 'Backspace'): Promise<void> {
  await treeItem(page, id).focus();
  await page.keyboard.press(key);
  await expect(field(page, 'delete-confirm')).toBeVisible();
}

function expectKept(base: string, id: string): void {
  for (const file of filesOf(base, id)) expect(existsSync(file)).toBe(true);
}

function expectGone(base: string, id: string): void {
  for (const file of filesOf(base, id)) expect(existsSync(file)).toBe(false);
  expect(trashed(base).filter((name) => name.includes(id))).toHaveLength(filesOf(base, id).length);
}

test('a room deleted from the context menu or the Delete key leaves the tree and the disk, and the open room is replaced', async () => {
  test.setTimeout(120_000);
  const base = newBase();
  const { app, page } = await launch(base);
  try {
    await openPane(page);
    await expect(field(page, 'title')).toHaveText('Alpha');

    await askByMenu(page, 'delete-c');
    await expect(field(page, 'delete-no')).toBeFocused();
    await field(page, 'delete-yes').click();
    await expect(field(page, 'delete-confirm')).toBeHidden();
    await expect(treeItem(page, 'delete-c')).toHaveCount(0);
    await expect(treeItems(page)).toHaveCount(2);
    await expect.poll(() => existsSync(filesOf(base, 'delete-c')[0] as string)).toBe(false);
    expectGone(base, 'delete-c');
    expectKept(base, 'delete-a');
    expectKept(base, 'delete-b');
    await expect(field(page, 'title')).toHaveText('Alpha');

    await askByKey(page, 'delete-a', 'Delete');
    await field(page, 'delete-yes').click();
    await expect(treeItem(page, 'delete-a')).toHaveCount(0);
    await expect(treeItems(page)).toHaveCount(1);
    expectGone(base, 'delete-a');
    expectKept(base, 'delete-b');
    await expect(field(page, 'title')).toHaveText('Bravo');
    await expect(treeItem(page, 'delete-b')).toHaveAttribute('aria-current', 'true');

    await askByKey(page, 'delete-b', 'Backspace');
    await field(page, 'delete-yes').click();
    await expect(treeItems(page)).toHaveCount(0);
    expectGone(base, 'delete-b');
    expect(readdirSync(roomsDir(base))).toEqual([]);
    await expect(page.locator('.room-entry')).toHaveCount(0);
    await expect(field(page, 'prompt')).toHaveValue('');
    await expect(field(page, 'title')).not.toHaveText('Bravo');
  } finally {
    await app.close();
  }
});

test('Cancel and Escape keep the room', async () => {
  const base = newBase();
  const { app, page } = await launch(base);
  try {
    await openPane(page);
    await askByMenu(page, 'delete-b');
    await field(page, 'delete-no').click();
    await expect(field(page, 'delete-confirm')).toBeHidden();
    await expect(treeItems(page)).toHaveCount(ROOMS.length);

    await askByKey(page, 'delete-b', 'Delete');
    await page.keyboard.press('Escape');
    await expect(field(page, 'delete-confirm')).toBeHidden();
    await expect(treeItem(page, 'delete-b')).toBeFocused();
    await expect(treeItems(page)).toHaveCount(ROOMS.length);

    for (const item of ROOMS) expectKept(base, item.id);
    expect(trashed(base)).toEqual([]);
    await expect(field(page, 'title')).toHaveText('Alpha');
  } finally {
    await app.close();
  }
});
