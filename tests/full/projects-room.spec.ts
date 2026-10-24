// projects-room.spec.ts
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
const stubCli = path.join(root, 'tests', 'fixtures', 'stub-cli.mjs');
const RUN_MS = 40_000;

interface Session {
  app: ElectronApplication;
  page: Page;
}

function listing(folder: string, base = folder): string[] {
  const entries: string[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    const info = statSync(full);
    entries.push(`${path.relative(base, full)}:${entry.isDirectory() ? 'dir' : info.size}:${info.mtimeMs}`);
    if (entry.isDirectory()) entries.push(...listing(full, base));
  }
  return entries.sort();
}

async function launch(base: string, folder: string, log: string): Promise<Session> {
  const app = await electron.launch({
    args: [root],
    env: {
      ...process.env,
      AIAW_USER_DATA: path.join(base, 'profile'),
      AIAW_ROOM_FAST: '1',
      AIAW_CLAUDE_BIN: stubCli,
      AIAW_CODEX_BIN: stubCli,
      AIAW_STUB_ARGV_LOG: log,
      AIAW_TEST_FOLDER: JSON.stringify([folder, null]),
      CLAUDE_CONFIG_DIR: path.join(base, 'claude'),
      CODEX_HOME: path.join(base, 'codex'),
    },
  });
  return { app, page: await app.firstWindow() };
}

function turnCwds(log: string): (string | undefined)[] {
  const lines = readFileSync(log, 'utf8').split('\n').filter((line) => line.length > 0);
  return lines.map((line) => (JSON.parse(line) as { cwd?: string; stdin?: string })).filter((call) => call.stdin !== undefined).map((call) => call.cwd);
}

function projectRooms(page: Page): Locator {
  return page.locator('[data-project="tree"] [data-project-id] [data-room-id]');
}

function looseRooms(page: Page): Locator {
  return page.locator('[data-room="tree"] [data-room-id]');
}

function field(page: Page, name: string): Locator {
  return page.locator(`[data-room="${name}"]`);
}

function recordsOf(userData: string): { dir: string; files: string[] }[] {
  const projects = path.join(userData, 'projects');
  const ids = existsSync(projects) ? readdirSync(projects) : [];
  return ids.map((id) => {
    const dir = path.join(projects, id, 'rooms');
    return { dir, files: existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.json')) : [] };
  });
}

test('a room made inside a project is kept under it, runs in the project folder and continues after a restart', async () => {
  test.setTimeout(240_000);
  const base = mkdtempSync(path.join(tmpdir(), 'aiaw-project-room-'));
  const folder = path.join(base, 'code', 'room-app');
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, 'README.md'), 'synthetic project\n');
  const real = realpathSync(folder);
  const before = listing(real);
  const log = path.join(base, 'argv.log');
  const userData = path.join(base, 'profile');

  const first = await launch(base, folder, log);
  try {
    const { page } = first;
    await page.locator('[data-project="add"]').click();
    await page.locator('[data-project="add-existing"]').click();
    const node = page.locator('[data-project="tree"] [data-project-id]');
    await expect(node).toHaveCount(1);
    await expect(projectRooms(page)).toHaveCount(0);
    await node.locator('[data-project="add-room"]').click();
    await expect(page.locator('[data-room="pane"]')).toBeVisible();
    await field(page, 'prompt').fill('first question');
    await field(page, 'mode').selectOption('relay');
    await field(page, 'rounds').fill('1');
    await field(page, 'start').click();
    await expect(field(page, 'status')).toContainText('done', { timeout: RUN_MS });
    await expect(projectRooms(page)).toHaveCount(1);
    await expect(looseRooms(page)).toHaveCount(0);
  } finally {
    await first.app.close();
  }
  const kept = recordsOf(userData).filter((item) => item.files.length > 0);
  expect(kept).toHaveLength(1);
  expect(kept[0]?.files).toHaveLength(1);
  const loose = path.join(userData, 'shared', 'rooms');
  expect(existsSync(loose) ? readdirSync(loose).filter((name) => name.endsWith('.json')) : []).toEqual([]);
  const calls = turnCwds(log);
  expect(calls.length).toBeGreaterThan(0);
  expect(calls).toEqual(calls.map(() => real));
  expect(listing(real)).toEqual(before);

  const second = await launch(base, folder, log);
  try {
    const { page } = second;
    await expect(projectRooms(page)).toHaveCount(1);
    await expect(looseRooms(page)).toHaveCount(0);
    await projectRooms(page).first().click();
    await expect(page.locator('[data-room="pane"]')).toBeVisible();
    await expect(field(page, 'start')).toHaveAttribute('data-room-action', 'continue');
    await field(page, 'prompt').fill('second question');
    await field(page, 'start').click();
    await expect(field(page, 'status')).toContainText('done', { timeout: RUN_MS });
    await expect(projectRooms(page)).toHaveCount(1);
    await projectRooms(page).first().hover();
    await page.locator('[data-project="delete-room"]').click();
    await expect(page.locator('[data-project="room-delete-confirm"]')).toBeVisible();
    await page.locator('[data-project="room-delete-yes"]').click();
    await expect(projectRooms(page)).toHaveCount(0);
  } finally {
    await second.app.close();
  }
  expect(recordsOf(userData).flatMap((item) => item.files)).toEqual([]);
  const more = turnCwds(log);
  expect(more.length).toBeGreaterThan(calls.length);
  expect(more).toEqual(more.map(() => real));
  expect(listing(real)).toEqual(before);
});
