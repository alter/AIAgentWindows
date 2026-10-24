// projects-chat.spec.ts
import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startFakeOpenRouter } from '../fixtures/openrouter-fake';

const root = path.resolve(__dirname, '..', '..');

function pane(page: Page): Locator {
  return page.locator('[data-or="pane"]:not([hidden])');
}

test('an OpenRouter chat of a project is stored under the project folder, not in the shared folder', async () => {
  test.setTimeout(120_000);
  const fake = await startFakeOpenRouter();
  const base = mkdtempSync(path.join(tmpdir(), 'aiaw-project-chat-'));
  const folder = path.join(base, 'code', 'chat-app');
  mkdirSync(folder, { recursive: true });
  const userData = path.join(base, 'profile');
  const app = await electron.launch({
    args: [root],
    env: { ...process.env, AIAW_USER_DATA: userData, AIAW_OPENROUTER_BASE: fake.base, AIAW_TEST_FOLDER: JSON.stringify([folder, null]) },
  });
  try {
    const page = await app.firstWindow();
    const account = page.getByRole('region', { name: 'OpenRouter' });
    await account.getByRole('button', { name: 'Paste key' }).click();
    await account.getByLabel('Key').fill(fake.key);
    await account.getByRole('button', { name: 'Save' }).click();
    await expect(account.getByText('Connected', { exact: true })).toBeVisible();

    await page.locator('[data-project="add"]').click();
    await page.locator('[data-project="add-existing"]').click();
    const node = page.locator('[data-project="tree"] [data-project-id]');
    await expect(node).toHaveCount(1);
    await node.locator('[data-project="add-agent"]').click();
    await page.locator('[data-project="agent-menu"] button[data-kind="openrouter"]').click();
    await expect(pane(page)).toBeVisible();
    await pane(page).locator('[data-row-field="model-filter"]').selectOption('free');
    await pane(page).locator('[data-row-field="model"]').selectOption('acme/free-model:free');
    const input = pane(page).locator('[data-or="input"]');
    await input.fill('Hello from a project');
    await input.press('Enter');
    await expect(pane(page).locator('[data-or="log"] [data-role="assistant"]')).toHaveAttribute('data-status', 'done');

    const state = JSON.parse(readFileSync(path.join(userData, 'state.json'), 'utf8')) as { agents: { id: string; projectId?: string }[] };
    const agent = state.agents[0];
    expect(agent?.projectId).toBeTruthy();
    expect(existsSync(path.join(userData, 'projects', agent?.projectId ?? '', 'chats', `${agent?.id}.json`))).toBe(true);
    const shared = path.join(userData, 'shared', 'openrouter');
    expect(existsSync(shared) ? readdirSync(shared) : []).toEqual([]);
  } finally {
    await app.close();
    await fake.close();
  }
});
