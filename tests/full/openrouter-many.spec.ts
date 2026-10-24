// openrouter-many.spec.ts
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startFakeOpenRouter, type FakeOpenRouter } from '../fixtures/openrouter-fake';

const root = path.resolve(__dirname, '..', '..');

interface Session {
  app: ElectronApplication;
  page: Page;
}

async function launch(base: string, fake: FakeOpenRouter, folder: string): Promise<Session> {
  const app = await electron.launch({
    args: [root],
    env: { ...process.env, AIAW_USER_DATA: path.join(base, 'profile'), AIAW_OPENROUTER_BASE: fake.base, AIAW_TEST_FOLDER: JSON.stringify([folder, null]) },
  });
  return { app, page: await app.firstWindow() };
}

async function signIn(page: Page, fake: FakeOpenRouter): Promise<void> {
  const account = page.getByRole('region', { name: 'OpenRouter' });
  await account.getByRole('button', { name: 'Paste key' }).click();
  await account.getByLabel('Key').fill(fake.key);
  await account.getByRole('button', { name: 'Save' }).click();
  await expect(account.getByText('Connected', { exact: true })).toBeVisible();
}

function pane(page: Page): Locator {
  return page.locator('[data-or="pane"]:not([hidden])');
}

async function pickModel(page: Page, model: string): Promise<void> {
  await pane(page).locator('[data-row-field="model-filter"]').selectOption('all');
  await pane(page).locator('[data-row-field="model"]').selectOption(model);
}

async function ask(page: Page, text: string): Promise<void> {
  const input = pane(page).locator('[data-or="input"]');
  await input.fill(text);
  await input.press('Enter');
  await expect(pane(page).locator('[data-or="log"] [data-role="assistant"]')).toHaveAttribute('data-status', 'done');
}

async function selectedRowIsVisible(page: Page, area: '.projects' | '.agent-list'): Promise<boolean> {
  return page.evaluate((selector) => {
    const row = document.querySelector(`${selector} .agent-item.selected`);
    const area = document.querySelector(selector);
    if (row === null || area === null) return false;
    const inner = row.getBoundingClientRect();
    const outer = area.getBoundingClientRect();
    return inner.top >= outer.top && inner.bottom <= outer.bottom;
  }, area);
}

async function addInProject(page: Page, node: Locator): Promise<void> {
  await node.locator('[data-project="add-agent"]').click();
  await page.locator('[data-project="agent-menu"] button[data-kind="openrouter"]').click();
}

test('several OpenRouter agents outside a project each keep their own model and conversation after a restart', async () => {
  test.setTimeout(120_000);
  const fake = await startFakeOpenRouter();
  const base = mkdtempSync(path.join(tmpdir(), 'aiaw-or-many-'));
  const folder = path.join(base, 'code', 'many-app');
  mkdirSync(folder, { recursive: true });
  let session = await launch(base, fake, folder);
  try {
    await signIn(session.page, fake);
    const models = ['acme/free-model:free', 'acme/paid-model', 'openrouter/free'];
    for (const [index, model] of models.entries()) {
      await session.page.locator('button[title="Add agent"]').first().click();
      await session.page.locator('.menu-item[data-kind="openrouter"]').click();
      await expect(session.page.locator('[data-or="pane"]')).toHaveCount(index + 1);
      await expect.poll(() => selectedRowIsVisible(session.page, '.agent-list')).toBe(true);
      await pickModel(session.page, model);
      await ask(session.page, `question ${index}`);
    }
    await session.app.close();
    session = await launch(base, fake, folder);
    const state = JSON.parse(readFileSync(path.join(base, 'profile', 'state.json'), 'utf8')) as { agents: { id: string; kind: string; openrouter?: { model: string } }[] };
    expect(state.agents.map((agent) => agent.openrouter?.model)).toEqual(models);
    await expect(session.page.locator('[data-or="pane"]')).toHaveCount(models.length);
    for (const [index, agent] of state.agents.entries()) {
      const one = session.page.locator(`[data-or="pane"][data-agent-id="${agent.id}"]`);
      await session.page.locator(`.agent-item[data-agent-id="${agent.id}"], [data-agent-id="${agent.id}"]`).first().click();
      await expect(one.locator('[data-row-field="model"]')).toHaveValue(models[index] ?? '');
      await expect(one.locator('[data-or="log"] [data-role="user"]')).toHaveText(new RegExp(`question ${index}`));
      await expect(one.locator('[data-or="log"] [data-role="user"]')).toHaveCount(1);
    }
  } finally {
    await session.app.close().catch(() => undefined);
    await fake.close();
  }
});

test('an OpenRouter agent added to a project with a long agent list is brought into view', async () => {
  test.setTimeout(120_000);
  const fake = await startFakeOpenRouter();
  const base = mkdtempSync(path.join(tmpdir(), 'aiaw-or-many-'));
  const folder = path.join(base, 'code', 'many-app');
  mkdirSync(folder, { recursive: true });
  const session = await launch(base, fake, folder);
  try {
    const { page } = session;
    await signIn(page, fake);
    await page.locator('[data-project="add"]').click();
    await page.locator('[data-project="add-existing"]').click();
    const node = page.locator('[data-project="tree"] [data-project-id]');
    await expect(node).toHaveCount(1);
    for (let count = 1; count <= 7; count += 1) {
      await addInProject(page, node);
      await expect(page.locator('[data-or="pane"]')).toHaveCount(count);
      await expect.poll(() => selectedRowIsVisible(page, '.projects')).toBe(true);
    }
    await expect(page.locator('.projects .agent-item')).toHaveCount(7);
  } finally {
    await session.app.close();
    await fake.close();
  }
});
