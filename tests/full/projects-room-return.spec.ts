// projects-room-return.spec.ts
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setParticipants } from './room-table-helpers';

const root = path.resolve(__dirname, '..', '..');
const stubCli = path.join(root, 'tests', 'fixtures', 'stub-cli.mjs');

function field(page: Page, name: string): Locator {
  return page.locator(`[data-room="${name}"]`);
}

interface Session {
  app: ElectronApplication;
  page: Page;
}

async function launch(base: string, folder: string, hang: boolean): Promise<Session> {
  const app = await electron.launch({
    args: [root],
    env: {
      ...process.env,
      AIAW_USER_DATA: path.join(base, 'profile'),
      AIAW_ROOM_FAST: '1',
      AIAW_CLAUDE_BIN: stubCli,
      AIAW_CODEX_BIN: stubCli,
      ...(hang ? { AIAW_STUB_HANG: '1' } : {}),
      AIAW_TEST_FOLDER: JSON.stringify([folder, null]),
      CLAUDE_CONFIG_DIR: path.join(base, 'claude'),
      CODEX_HOME: path.join(base, 'codex'),
    },
  });
  return { app, page: await app.firstWindow() };
}

function workspace(): { base: string; folder: string } {
  const base = mkdtempSync(path.join(tmpdir(), 'aiaw-room-return-'));
  const folder = path.join(base, 'code', 'return-app');
  mkdirSync(folder, { recursive: true });
  return { base, folder };
}

async function addProjectWithAgent(page: Page): Promise<Locator> {
  await page.locator('[data-project="add"]').click();
  await page.locator('[data-project="add-existing"]').click();
  await page.locator('[data-project="create"]').click();
  const node = page.locator('[data-project="tree"] [data-project-id]');
  await expect(node).toHaveCount(1);
  await node.locator('[data-project="add-agent"]').click();
  await page.locator('[data-project="agent-menu"] button[data-kind="openrouter"]').click();
  await expect(page.locator('[data-or="pane"]:not([hidden])')).toBeVisible();
  return node;
}

async function returnToRunningRoom(page: Page, node: Locator): Promise<void> {
  const room = node.locator('[data-room-id]');
  await expect(room).toHaveCount(1);
  await node.locator('.agent-item').click();
  await expect(field(page, 'pane')).toBeHidden();
  await room.click();
  await expect(field(page, 'pane')).toBeVisible();
  await expect(field(page, 'status')).toContainText('Running');
  await expect(field(page, 'stop')).toBeEnabled();
  await expect(field(page, 'start')).toBeDisabled();
  await field(page, 'stop').click();
  await expect(field(page, 'status')).not.toContainText('Running');
}

test('a new project room that is running is listed and can be returned to from an agent', async () => {
  test.setTimeout(120_000);
  const { base, folder } = workspace();
  const { app, page } = await launch(base, folder, true);
  try {
    const node = await addProjectWithAgent(page);
    await node.locator('[data-project="add-room"]').click();
    await expect(field(page, 'pane')).toBeVisible();
    await setParticipants(page, ['claude']);
    await field(page, 'prompt').fill('hang question one');
    await field(page, 'start').click();
    await expect(field(page, 'status')).toContainText('Running');
    await returnToRunningRoom(page, node);
  } finally {
    await app.close();
  }
});

test('a saved project room continued after a restart can be returned to from an agent while it runs', async () => {
  test.setTimeout(180_000);
  const { base, folder } = workspace();
  const first = await launch(base, folder, false);
  try {
    const node = await addProjectWithAgent(first.page);
    await node.locator('[data-project="add-room"]').click();
    await setParticipants(first.page, ['claude']);
    await field(first.page, 'prompt').fill('first question');
    await field(first.page, 'rounds').fill('1');
    await field(first.page, 'start').click();
    await expect(field(first.page, 'status')).toContainText('done', { timeout: 40_000 });
    await expect(node.locator('[data-room-id]')).toHaveCount(1);
  } finally {
    await first.app.close();
  }
  const second = await launch(base, folder, true);
  try {
    const { page } = second;
    const node = page.locator('[data-project="tree"] [data-project-id]');
    await node.locator('[data-room-id]').click();
    await expect(field(page, 'start')).toHaveAttribute('data-room-action', 'continue');
    await field(page, 'prompt').fill('hang question two');
    await field(page, 'start').click();
    await expect(field(page, 'status')).toContainText('Running');
    await returnToRunningRoom(page, node);
  } finally {
    await second.app.close();
  }
});
