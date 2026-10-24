// projects.spec.ts
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');

interface Session {
  app: ElectronApplication;
  page: Page;
}

interface World {
  base: string;
  userData: string;
  existing: string;
  parent: string;
}

function newWorld(): World {
  const base = mkdtempSync(path.join(tmpdir(), 'aiaw-projects-'));
  const existing = path.join(base, 'code', 'existing-app');
  const parent = path.join(base, 'code', 'parent');
  mkdirSync(path.join(existing, 'src'), { recursive: true });
  mkdirSync(parent, { recursive: true });
  writeFileSync(path.join(existing, 'README.md'), 'synthetic project\n');
  writeFileSync(path.join(existing, 'src', 'main.txt'), 'synthetic source\n');
  return { base, userData: path.join(base, 'profile'), existing, parent };
}

async function launch(world: World, answers: readonly (string | null)[]): Promise<Session> {
  const app = await electron.launch({
    args: [root],
    env: { ...process.env, AIAW_USER_DATA: world.userData, AIAW_TEST_FOLDER: JSON.stringify(answers) },
  });
  const page = await app.firstWindow();
  return { app, page };
}

function listing(folder: string, base = folder): string[] {
  const entries: string[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    const info = statSync(full);
    entries.push(`${path.relative(base, full)}:${entry.isDirectory() ? 'dir' : info.size}`);
    if (entry.isDirectory()) entries.push(...listing(full, base));
  }
  return entries.sort();
}

function node(page: Page, name: string): Locator {
  return page.locator('[data-project="tree"] [data-project-id]').filter({ has: page.locator('[data-project="node"]', { hasText: name }) });
}

function nodes(page: Page): Locator {
  return page.locator('[data-project="tree"] [data-project-id]');
}

function notice(page: Page): Locator {
  return page.locator('[data-project="notice"]');
}

async function addExisting(page: Page): Promise<void> {
  await page.locator('[data-project="add"]').click();
  await page.locator('[data-project="add-existing"]').click();
}

async function openNewFolder(page: Page): Promise<void> {
  await page.locator('[data-project="add"]').click();
  await page.locator('[data-project="add-new"]').click();
  await expect(page.locator('[data-project="new-form"]')).toBeVisible();
}

async function createNew(page: Page, name: string): Promise<void> {
  await page.locator('[data-project="name-input"]').fill(name);
  await page.locator('[data-project="create"]').click();
}

async function closeSession(session: Session): Promise<void> {
  await session.app.close();
}

test('creates projects from an existing and a new folder, refuses bad ones, keeps them over a restart and deletes without touching the code', async () => {
  test.setTimeout(120_000);
  const world = newWorld();
  const fresh = path.join(world.parent, 'fresh-app');
  const parentBefore = listing(world.parent);
  let session = await launch(world, [world.existing, world.existing, world.parent, world.parent]);
  try {
    let page = session.page;
    await expect(page.locator('[data-project="no-project"] [data-room="tree"]')).toBeVisible();
    await expect(page.locator('[data-project="no-project"] .add-button')).toBeVisible();
    await expect(nodes(page)).toHaveCount(0);

    await addExisting(page);
    await expect(nodes(page)).toHaveCount(1);
    await expect(node(page, 'existing-app')).toBeVisible();
    await expect(node(page, 'existing-app').locator('[data-project-section="rooms"]')).toBeVisible();
    await expect(node(page, 'existing-app').locator('[data-project-section="agents"]')).toBeVisible();

    await addExisting(page);
    await expect(notice(page)).toBeVisible();
    await expect(nodes(page)).toHaveCount(1);

    await openNewFolder(page);
    await createNew(page, 'fresh-app');
    await expect(node(page, 'fresh-app')).toBeVisible();
    await expect(nodes(page)).toHaveCount(2);
    expect(existsSync(path.join(fresh, '.git'))).toBe(true);

    const afterCreate = listing(world.parent);
    await openNewFolder(page);
    await createNew(page, '../x');
    await expect(notice(page)).toBeVisible();
    await page.locator('[data-project="create-cancel"]').click();
    await expect(nodes(page)).toHaveCount(2);
    expect(existsSync(path.join(world.parent, '..', 'x'))).toBe(false);
    expect(listing(world.parent)).toEqual(afterCreate);
    expect(afterCreate).not.toEqual(parentBefore);

    await closeSession(session);
    session = await launch(world, [world.existing]);
    page = session.page;
    await expect(nodes(page)).toHaveCount(2);
    await expect(node(page, 'existing-app')).toBeVisible();
    await expect(node(page, 'fresh-app')).toBeVisible();
    await expect(page.locator('[data-project="no-project"] [data-room="tree"]')).toBeVisible();

    const codeBefore = listing(world.existing);
    const freshBefore = listing(fresh);
    await node(page, 'existing-app').locator('[data-project="menu"]').click();
    await page.locator('[data-project="delete"]').click();
    await expect(page.locator('[data-project="delete-confirm"]')).toBeVisible();
    await page.locator('[data-project="delete-no"]').click();
    await expect(nodes(page)).toHaveCount(2);
    await node(page, 'existing-app').locator('[data-project="menu"]').click();
    await page.locator('[data-project="delete"]').click();
    await page.locator('[data-project="delete-yes"]').click();
    await expect(nodes(page)).toHaveCount(1);
    await expect(node(page, 'existing-app')).toHaveCount(0);
    expect(listing(world.existing)).toEqual(codeBefore);
    expect(listing(fresh)).toEqual(freshBefore);
    const state = JSON.parse(readFileSync(path.join(world.userData, 'state.json'), 'utf8')) as { projects?: { name: string }[] };
    expect(state.projects?.map((item) => item.name)).toEqual(['fresh-app']);
  } finally {
    await closeSession(session).catch(() => undefined);
  }
});

test('renames a project and shows one whose folder is gone as missing without recreating it', async () => {
  test.setTimeout(120_000);
  const world = newWorld();
  let session = await launch(world, [world.parent]);
  try {
    let page = session.page;
    await openNewFolder(page);
    await createNew(page, 'doomed-app');
    await expect(node(page, 'doomed-app')).toBeVisible();
    await node(page, 'doomed-app').locator('[data-project="menu"]').click();
    await page.locator('[data-project="rename"]').click();
    const input = page.locator('[data-project="rename-input"]');
    await input.fill('Renamed app');
    await input.press('Enter');
    await expect(node(page, 'Renamed app')).toBeVisible();
    await expect(nodes(page)).toHaveCount(1);

    await closeSession(session);
    rmSync(path.join(world.parent, 'doomed-app'), { recursive: true, force: true });
    session = await launch(world, [world.parent]);
    page = session.page;
    await expect(node(page, 'Renamed app')).toBeVisible();
    await expect(node(page, 'Renamed app')).toHaveAttribute('data-project-missing', 'true');
    await expect(node(page, 'Renamed app').locator('[data-project="missing"]')).toBeVisible();
    expect(existsSync(path.join(world.parent, 'doomed-app'))).toBe(false);
    await expect(page.locator('[data-project="no-project"] [data-room="tree"]')).toBeVisible();
  } finally {
    await closeSession(session).catch(() => undefined);
  }
});
