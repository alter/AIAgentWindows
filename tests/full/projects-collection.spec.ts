// projects-collection.spec.ts
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NO_ENDPOINTS_MODEL, fakeModelsWithLimits, startFakeOpenRouter, type FakeOpenRouter } from '../fixtures/openrouter-fake';
import { openSetup, setParticipants, tableRow } from './room-table-helpers';

const root = path.resolve(__dirname, '..', '..');
const stubCli = path.join(root, 'tests', 'fixtures', 'stub-cli.mjs');
const RUN_MS = 60_000;

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

function projectRooms(page: Page): Locator {
  return page.locator('[data-project="tree"] [data-project-id] [data-room-id]');
}

function switchOf(page: Page, id: string): Locator {
  return tableRow(page, id).locator('[data-row-field="collection"]');
}

function warningOf(page: Page, id: string): Locator {
  return tableRow(page, id).locator('[data-row-field="collection-warning"]');
}

function refusedCalls(): number {
  return fake.chatCalls.filter((call) => call.body?.model === NO_ENDPOINTS_MODEL).length;
}

async function watchChips(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen = new Set<string>();
    (window as unknown as { __chips: Set<string> }).__chips = seen;
    const record = (): void => {
      for (const chip of document.querySelectorAll<HTMLElement>('.room-chip[data-participant]')) seen.add(`${chip.dataset['participant']}:${chip.dataset['state']}`);
    };
    new MutationObserver(record).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    record();
  });
}

async function chipsSeen(page: Page): Promise<string[]> {
  return page.evaluate(() => [...(window as unknown as { __chips: Set<string> }).__chips]);
}

test('the collection switch of an OpenRouter row, the skipped chip after a refusal, and a reopen', async () => {
  test.setTimeout(300_000);
  const base = mkdtempSync(path.join(tmpdir(), 'aiaw-project-collection-'));
  const folder = path.join(base, 'code', 'collect-app');
  mkdirSync(path.join(folder, 'src'), { recursive: true });
  writeFileSync(path.join(folder, 'src', 'main.ts'), 'export {};\n');
  const real = realpathSync(folder);

  const first = await launch(base, real);
  try {
    const { page } = first;
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
    await setParticipants(page, ['openrouter', 'openrouter']);
    await tableRow(page, 'openrouter').locator('[data-row-field="model-filter"]').selectOption('paid');
    await tableRow(page, 'openrouter').locator('[data-row-field="model"]').selectOption('acme/paid-model');
    await tableRow(page, 'openrouter-2').locator('[data-row-field="model-filter"]').selectOption('free');
    await tableRow(page, 'openrouter-2').locator('[data-row-field="model"]').selectOption(NO_ENDPOINTS_MODEL);

    await expect(switchOf(page, 'openrouter-2')).toBeVisible();
    await expect(switchOf(page, 'openrouter-2')).not.toBeChecked();
    await expect(warningOf(page, 'openrouter-2')).toBeHidden();
    await expect(field(page, 'recipients')).toHaveAttribute('data-collection', 'denied');
    await switchOf(page, 'openrouter-2').check();
    await expect(warningOf(page, 'openrouter-2')).toBeVisible();
    await expect(warningOf(page, 'openrouter-2')).toHaveAttribute('data-state', 'allowed');
    await expect(warningOf(page, 'openrouter')).toBeHidden();
    await expect(field(page, 'recipients')).toHaveAttribute('data-collection', 'allowed');
    await switchOf(page, 'openrouter-2').uncheck();
    await expect(warningOf(page, 'openrouter-2')).toBeHidden();
    await expect(field(page, 'recipients')).toHaveAttribute('data-collection', 'denied');

    await watchChips(page);
    await field(page, 'prompt').fill('first question');
    await field(page, 'mode').selectOption('relay');
    await field(page, 'rounds').fill('3');
    await field(page, 'start').click();
    await expect(field(page, 'feed').locator('.room-entry[data-kind="final"]')).toHaveCount(1, { timeout: RUN_MS });
    await expect(field(page, 'status')).toContainText('done', { timeout: RUN_MS });
    expect(refusedCalls()).toBe(1);
    await expect(field(page, 'feed').locator('.room-entry[data-author="openrouter-2"]')).toHaveCount(1);
    await expect(field(page, 'feed').locator('.room-entry[data-author="openrouter-2"]')).toHaveAttribute('data-kind', 'error');
    const seen = await chipsSeen(page);
    expect(seen).toContain('openrouter-2:error');
    expect(seen).toContain('openrouter-2:skipped');
    expect(seen).not.toContain('openrouter:skipped');

    await openSetup(page);
    await switchOf(page, 'openrouter-2').check();
    await field(page, 'prompt').fill('second question');
    await field(page, 'rounds').fill('1');
    await field(page, 'start').click();
    await expect(field(page, 'feed').locator('.room-entry[data-kind="final"]')).toHaveCount(2, { timeout: RUN_MS });
    await expect(field(page, 'feed').locator('.room-entry[data-author="openrouter-2"][data-kind="reply"]')).toHaveCount(1);
    expect(refusedCalls()).toBe(2);
    const refused = fake.chatCalls.filter((call) => call.body?.model === NO_ENDPOINTS_MODEL);
    expect(refused[0]?.body?.provider).toEqual({ data_collection: 'deny' });
    expect(refused[1]?.body).not.toHaveProperty('provider');
    const reply = field(page, 'feed').locator('.room-entry[data-author="openrouter-2"][data-kind="reply"]');
    await reply.locator('.room-entry-head').click();
    await expect(reply.locator('[data-room="context-sent"]')).toHaveAttribute('data-collection', 'allowed');
    const other = field(page, 'feed').locator('.room-entry[data-author="openrouter"][data-kind="reply"]').last();
    await other.locator('.room-entry-head').click();
    await expect(other.locator('[data-room="context-sent"]')).toHaveAttribute('data-collection', 'denied');
  } finally {
    await first.app.close();
  }

  const second = await launch(base, real);
  try {
    const { page } = second;
    await expect(projectRooms(page)).toHaveCount(1);
    await projectRooms(page).first().click();
    await expect(page.locator('[data-room="pane"]')).toBeVisible();
    await openSetup(page);
    await expect(switchOf(page, 'openrouter-2')).toBeChecked();
    await expect(warningOf(page, 'openrouter-2')).toBeVisible();
    await expect(switchOf(page, 'openrouter')).not.toBeChecked();
    await expect(field(page, 'recipients')).toHaveAttribute('data-collection', 'allowed');
    await page.locator('[data-room="open"]').click();
    await page.locator('[data-room="new"]').first().click();
    await openSetup(page);
    await setParticipants(page, ['openrouter']);
    await expect(switchOf(page, 'openrouter')).toBeHidden();
    await expect(warningOf(page, 'openrouter')).toBeHidden();
  } finally {
    await second.app.close();
  }
});
