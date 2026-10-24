// projects-map.spec.ts
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fakeModelsWithLimits, startFakeOpenRouter, type FakeOpenRouter } from '../fixtures/openrouter-fake';
import { openSetup, setParticipants, tableRow } from './room-table-helpers';

const root = path.resolve(__dirname, '..', '..');
const stubCli = path.join(root, 'tests', 'fixtures', 'stub-cli.mjs');
const RUN_MS = 40_000;

let fake: FakeOpenRouter;

test.beforeEach(async () => {
  fake = await startFakeOpenRouter();
  fake.models = fakeModelsWithLimits();
});

test.afterEach(async () => {
  await fake.close();
});

async function launch(base: string, folder: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [root],
    env: {
      ...process.env,
      AIAW_USER_DATA: path.join(base, 'profile'),
      AIAW_OPENROUTER_BASE: fake.base,
      AIAW_ROOM_FAST: '1',
      AIAW_CLAUDE_BIN: stubCli,
      AIAW_CODEX_BIN: stubCli,
      AIAW_TEST_FOLDER: JSON.stringify([folder, null]),
      CLAUDE_CONFIG_DIR: path.join(base, 'claude'),
      CODEX_HOME: path.join(base, 'codex'),
    },
  });
  return { app, page: await app.firstWindow() };
}

function field(page: Page, name: string): Locator {
  return page.locator(`[data-room="${name}"]`);
}

function block(page: Page): Locator {
  return page.getByRole('region', { name: 'OpenRouter' });
}

test('a project room names who gets the map, and every turn carries a Context sent disclosure; a room without a project names nobody', async () => {
  test.setTimeout(240_000);
  const base = mkdtempSync(path.join(tmpdir(), 'aiaw-project-map-'));
  const folder = path.join(base, 'code', 'map-app');
  mkdirSync(path.join(folder, 'src'), { recursive: true });
  writeFileSync(path.join(folder, 'CLAUDE.md'), 'map app notes\n');
  writeFileSync(path.join(folder, 'src', 'main.ts'), 'export {};\n');
  writeFileSync(path.join(folder, '.env'), 'PLANTED=smoke-canary-4411\n');
  const real = realpathSync(folder);
  const { app, page } = await launch(base, real);
  try {
    await block(page).getByRole('button', { name: 'Paste key' }).click();
    await block(page).getByLabel('Key').fill(fake.key);
    await block(page).getByRole('button', { name: 'Save' }).click();
    await expect(block(page).getByText('Connected', { exact: true })).toBeVisible();
    await page.locator('[data-project="add"]').click();
    await page.locator('[data-project="add-existing"]').click();
    await page.locator('[data-project="create"]').click();
    const node = page.locator('[data-project="tree"] [data-project-id]');
    await expect(node).toHaveCount(1);
    await node.locator('[data-project="add-room"]').click();
    await expect(page.locator('[data-room="pane"]')).toBeVisible();
    await openSetup(page);
    await setParticipants(page, ['claude', 'openrouter']);
    await expect(field(page, 'recipients')).toContainText('OpenRouter receive');
    await tableRow(page, 'openrouter').locator('[data-row-field="model-filter"]').selectOption('paid');
    await tableRow(page, 'openrouter').locator('[data-row-field="model"]').selectOption('acme/paid-model');
    await expect(field(page, 'recipients')).toBeVisible();
    await expect(field(page, 'recipients')).toContainText('Acme Paid');
    await expect(field(page, 'recipients')).toContainText('CLI');
    await field(page, 'prompt').fill('what does this project do');
    await field(page, 'mode').selectOption('relay');
    await field(page, 'rounds').fill('1');
    await field(page, 'start').click();
    await expect(field(page, 'status')).toContainText('done', { timeout: RUN_MS });
    const disclosures = page.locator('[data-room="feed"] [data-room="context-sent"]');
    await expect(disclosures).toHaveCount(3);
    const routerEntry = page.locator('[data-room="feed"] .room-entry[data-author="openrouter"][data-kind="reply"]');
    await routerEntry.locator('.room-entry-head').click();
    await routerEntry.locator('[data-room="context-sent"] summary').click();
    await expect(routerEntry.locator('[data-room="context-sent"]')).toContainText('project-map');
    await expect(routerEntry.locator('[data-room="context-sent"]')).toContainText(/hash [0-9a-f]{16}/);
    expect(fake.chatCalls.length).toBeGreaterThan(0);
    for (const call of fake.chatCalls) {
      expect(call.body?.provider).toEqual({ data_collection: 'deny' });
      expect(JSON.stringify(call.body)).not.toContain('smoke-canary-4411');
      expect(JSON.stringify(call.body)).toContain('src/main.ts');
    }
    await page.locator('[data-room="open"]').click();
    await page.locator('[data-room="new"]').first().click();
    await expect(field(page, 'recipients')).toBeHidden();
  } finally {
    await app.close();
  }
});
