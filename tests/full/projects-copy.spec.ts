// projects-copy.spec.ts
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
const stubCli = path.join(root, 'tests', 'fixtures', 'stub-cli.mjs');

interface World {
  base: string;
  userData: string;
  loose: string;
  first: string;
  second: string;
  parent: string;
}

interface SavedState {
  agents: { kind: string; cwd?: string; projectId?: string }[];
  projects: { id: string; name: string }[];
}

function newWorld(): World {
  const base = mkdtempSync(path.join(tmpdir(), 'aiaw-projects-copy-'));
  const dirs = { loose: path.join(base, 'code', 'loose-app'), first: path.join(base, 'code', 'first-app'), second: path.join(base, 'code', 'second-app'), parent: path.join(base, 'code', 'parent') };
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
  return { base, userData: path.join(base, 'profile'), ...dirs };
}

async function launch(world: World, answers: readonly (string | null)[]): Promise<ElectronApplication> {
  return electron.launch({
    args: [root],
    env: {
      ...process.env,
      AIAW_USER_DATA: world.userData,
      AIAW_TEST_FOLDER: JSON.stringify(answers),
      AIAW_CLAUDE_BIN: stubCli,
      AIAW_CODEX_BIN: stubCli,
      AIAW_STUB_ARGV_LOG: path.join(world.base, 'argv.log'),
    },
  });
}

function node(page: Page, name: string): Locator {
  return page.locator('[data-project="tree"] [data-project-id]').filter({ has: page.locator('[data-project="node"]', { hasText: name }) });
}

function looseAgents(page: Page): Locator {
  return page.locator('[data-project="no-project"] .agent-item');
}

function saved(world: World): SavedState {
  return JSON.parse(readFileSync(path.join(world.userData, 'state.json'), 'utf8')) as SavedState;
}

function ptyCwds(world: World): string[] {
  const file = path.join(world.base, 'argv.log');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { cwd: string; pty?: true })
    .filter((line) => line.pty === true)
    .map((line) => line.cwd);
}

async function addLoose(page: Page, kind: string): Promise<void> {
  await page.locator('[data-project="no-project"] .add-button').click();
  await page.locator(`.menu-item[data-kind="${kind}"]`).click();
}

async function optionValues(page: Page): Promise<string[]> {
  return page.locator('[data-project="copy-from"] option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
}

async function openExisting(page: Page): Promise<void> {
  await page.locator('[data-project="add"]').click();
  await page.locator('[data-project="add-existing"]').click();
  await expect(page.locator('[data-project="new-form"]')).toBeVisible();
}

test('the select lists No project, Do not copy and the projects in order, and a new project gets the No project agents, which survive a restart', async () => {
  test.setTimeout(180_000);
  const world = newWorld();
  let app = await launch(world, [world.loose, world.first, world.second, world.parent]);
  try {
    let page = await app.firstWindow();
    await addLoose(page, 'claude');
    await addLoose(page, 'chatgpt');
    await expect(looseAgents(page)).toHaveCount(2);

    await openExisting(page);
    expect(await optionValues(page)).toEqual(['no-project', 'none']);
    await expect(page.locator('[data-project="copy-from"]')).toHaveValue('no-project');
    await page.locator('[data-project="create"]').click();
    await expect(node(page, 'first-app').locator('.agent-item')).toHaveCount(2);
    await expect(looseAgents(page)).toHaveCount(2);
    await expect.poll(() => ptyCwds(world)).toHaveLength(2);

    await openExisting(page);
    const [firstProject] = saved(world).projects;
    expect(await optionValues(page)).toEqual(['no-project', 'none', `project:${firstProject?.id}`]);
    await expect(page.locator('[data-project="copy-from"]')).toHaveValue('no-project');
    await page.locator('[data-project="copy-from"]').selectOption(`project:${firstProject?.id}`);
    await page.locator('[data-project="create"]').click();
    await expect(node(page, 'second-app').locator('.agent-item')).toHaveCount(2);
    await expect(node(page, 'first-app').locator('.agent-item')).toHaveCount(2);
    await expect(looseAgents(page)).toHaveCount(2);

    await page.locator('[data-project="add"]').click();
    await page.locator('[data-project="add-new"]').click();
    await expect(page.locator('[data-project="new-form"]')).toBeVisible();
    const ids = saved(world).projects.map((project) => `project:${project.id}`);
    expect(await optionValues(page)).toEqual(['no-project', 'none', ...ids]);
    await page.locator('[data-project="create-cancel"]').click();

    const before = saved(world);
    const projectIds = before.projects.map((project) => project.id);
    expect(before.agents.filter((agent) => agent.projectId === undefined).map((agent) => agent.kind)).toEqual(['claude', 'chatgpt']);
    for (const id of projectIds) expect(before.agents.filter((agent) => agent.projectId === id).map((agent) => agent.kind)).toEqual(['claude', 'chatgpt']);
    const firstFolder = before.agents.find((agent) => agent.projectId === projectIds[0] && agent.kind === 'claude')?.cwd;
    expect(firstFolder).toBeDefined();
    expect(before.agents.find((agent) => agent.projectId === undefined && agent.kind === 'claude')?.cwd).not.toBe(firstFolder);

    await app.close();
    app = await launch(world, [null]);
    page = await app.firstWindow();
    await expect(node(page, 'first-app').locator('.agent-item')).toHaveCount(2);
    await expect(node(page, 'second-app').locator('.agent-item')).toHaveCount(2);
    await expect(looseAgents(page)).toHaveCount(2);
    expect(saved(world).agents).toHaveLength(6);
  } finally {
    await app.close().catch(() => undefined);
  }
});

test('Do not copy creates an empty project and the new-folder form carries the same select', async () => {
  test.setTimeout(120_000);
  const world = newWorld();
  const app = await launch(world, [world.loose, world.parent]);
  try {
    const page = await app.firstWindow();
    await addLoose(page, 'claude');
    await expect(looseAgents(page)).toHaveCount(1);
    await page.locator('[data-project="add"]').click();
    await page.locator('[data-project="add-new"]').click();
    await expect(page.locator('[data-project="new-form"]')).toBeVisible();
    expect(await optionValues(page)).toEqual(['no-project', 'none']);
    await page.locator('[data-project="copy-from"]').selectOption('none');
    await page.locator('[data-project="name-input"]').fill('empty-app');
    await page.locator('[data-project="create"]').click();
    await expect(node(page, 'empty-app')).toBeVisible();
    await expect(node(page, 'empty-app').locator('.agent-item')).toHaveCount(0);
    await expect(looseAgents(page)).toHaveCount(1);
    expect(saved(world).agents).toHaveLength(1);
  } finally {
    await app.close().catch(() => undefined);
  }
});
