// openrouter-room.spec.ts
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startFakeOpenRouter, type ChatCall, type FakeOpenRouter } from '../fixtures/openrouter-fake';
import { addParticipant, openSetup, setParticipants, tableRow } from './room-table-helpers';

const root = path.resolve(__dirname, '..', '..');
const stubCli = path.join(root, 'tests', 'fixtures', 'stub-cli.mjs');
const MARKUP = '<img src=x onerror="window.__pwned=1"><b>bold</b>';
const TURN_BUDGET_MS = 5000;

let fake: FakeOpenRouter;

test.beforeEach(async () => {
  fake = await startFakeOpenRouter();
});

test.afterEach(async () => {
  await fake.close();
});

async function open(): Promise<{ app: ElectronApplication; page: Page }> {
  const base = mkdtempSync(path.join(tmpdir(), 'aiaw-or-room-'));
  const app = await electron.launch({
    args: [root],
    env: {
      ...process.env,
      AIAW_USER_DATA: path.join(base, 'profile'),
      AIAW_OPENROUTER_BASE: fake.base,
      AIAW_ROOM_FAST: '1',
      AIAW_CLAUDE_BIN: stubCli,
      AIAW_CODEX_BIN: stubCli,
      AIAW_TEST_FOLDER: mkdtempSync(path.join(base, 'folder-')),
      CLAUDE_CONFIG_DIR: path.join(base, 'claude'),
      CODEX_HOME: path.join(base, 'codex'),
    },
  });
  const page = await app.firstWindow();
  await page.locator('[data-room="open"]').click();
  await expect(page.locator('[data-room="pane"]')).toBeVisible();
  return { app, page };
}

function field(page: Page, name: string): Locator {
  return page.locator(`[data-room="${name}"]`);
}

function block(page: Page): Locator {
  return page.getByRole('region', { name: 'OpenRouter' });
}

async function signIn(page: Page): Promise<void> {
  await block(page).getByRole('button', { name: 'Paste key' }).click();
  await block(page).getByLabel('Key').fill(fake.key);
  await block(page).getByRole('button', { name: 'Save' }).click();
  await expect(block(page).getByText('Connected', { exact: true })).toBeVisible();
}

async function pick(page: Page, id: string, filter: 'free' | 'paid', model: string): Promise<void> {
  const row = tableRow(page, id);
  await row.locator('[data-row-field="model-filter"]').selectOption(filter);
  await row.locator('[data-row-field="model"]').selectOption(model);
}

async function history(page: Page): Promise<{ authors: string[]; text: string }> {
  const status = (await field(page, 'status').textContent()) ?? '';
  const file = status.split('History: ')[1]?.trim() ?? '';
  expect(file).toMatch(/\.md$/);
  const text = readFileSync(file, 'utf8');
  const authors = text
    .split('\n')
    .map((line) => /^<<<entry-\w+ author="(.*)" time=\S+ kind=(\w+)>>>$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => `${match[1]} | ${match[2]}`);
  return { authors, text };
}

function userText(call: ChatCall): string {
  return call.body?.messages?.find((message) => message.role === 'user')?.content ?? '';
}

test('two OpenRouter rows pick free models, relay on the fake server and see the history in order', async () => {
  const { app, page } = await open();
  try {
    await page.locator('[data-room="add-participant"]').click();
    const item = page.locator('[data-room="add-menu"] [data-add="openrouter"]');
    await expect(item).toHaveAttribute('aria-disabled', 'true');
    await item.dispatchEvent('click');
    await expect(page.locator('[data-room="participants"] tbody tr[data-row="openrouter"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await signIn(page);

    await setParticipants(page, ['openrouter', 'openrouter']);
    await expect(tableRow(page, 'openrouter-2')).toBeVisible();
    await openSetup(page);
    await pick(page, 'openrouter', 'free', 'acme/free-model:free');
    await expect(tableRow(page, 'openrouter').locator('[data-row-field="model"] option[value="acme/paid-model"]')).toHaveCount(0);
    await pick(page, 'openrouter-2', 'free', 'openrouter/free');
    for (const id of ['openrouter', 'openrouter-2']) await expect(tableRow(page, id).locator('[data-row-field="web"]')).not.toBeChecked();

    await field(page, 'prompt').fill('Question one');
    await field(page, 'mode').selectOption('relay');
    await field(page, 'rounds').fill('1');
    await field(page, 'start').click();
    await expect(field(page, 'status')).toContainText('done', { timeout: 4 * TURN_BUDGET_MS });

    const { authors } = await history(page);
    expect(authors).toEqual([
      'Owner | prompt',
      'OpenRouter · Acme Free | reply',
      'OpenRouter · Free Models Router | reply',
      'OpenRouter · Acme Free | final',
    ]);
    expect(fake.chatCalls.map((call) => call.body?.model)).toEqual(['acme/free-model:free', 'openrouter/free', 'acme/free-model:free']);
    expect(userText(fake.chatCalls[0] as ChatCall)).not.toContain('Reply from');
    expect(userText(fake.chatCalls[1] as ChatCall)).toContain('Reply from acme/free-model:free number 1');
    expect(userText(fake.chatCalls[2] as ChatCall)).toContain('Reply from openrouter/free number 2');
    for (const call of fake.chatCalls) {
      expect(call.body).not.toHaveProperty('tools');
      expect(call.body).not.toHaveProperty('reasoning');
      expect(call.headers.authorization).toBe(`Bearer ${fake.key}`);
    }
    const seen = await page.evaluate(() => document.documentElement.outerHTML);
    expect(seen).not.toContain(fake.key);
  } finally {
    await app.close();
  }
});

test('a paid model offers its efforts and starts with web search on, and the request carries both', async () => {
  const { app, page } = await open();
  try {
    await signIn(page);
    await setParticipants(page, ['openrouter']);
    await openSetup(page);
    const row = tableRow(page, 'openrouter');
    await pick(page, 'openrouter', 'paid', 'acme/paid-model');
    await expect(row.locator('[data-row-field="web"]')).toBeChecked();
    await expect(row.locator('[data-row-field="effort"] option')).toHaveText(['Default', 'high', 'medium', 'low']);
    await pick(page, 'openrouter', 'free', 'acme/free-model:free');
    await expect(row.locator('[data-row-field="web"]')).not.toBeChecked();
    await expect(row.locator('[data-row-field="effort"]')).toBeHidden();
    await pick(page, 'openrouter', 'paid', 'acme/paid-model');
    await row.locator('[data-row-field="effort"]').selectOption('medium');

    await field(page, 'prompt').fill('Paid question');
    await field(page, 'mode').selectOption('broadcast');
    await field(page, 'rounds').fill('1');
    await field(page, 'start').click();
    await expect(field(page, 'status')).toContainText('done', { timeout: 3 * TURN_BUDGET_MS });
    expect(fake.chatCalls.length).toBeGreaterThan(0);
    for (const call of fake.chatCalls) {
      expect(call.body?.reasoning).toEqual({ effort: 'medium' });
      expect(call.body?.tools?.map((tool) => tool.type)).toEqual(['openrouter:web_search']);
    }
  } finally {
    await app.close();
  }
});

test('markup in an OpenRouter reply is shown as text', async () => {
  fake.chat = () => ({ body: { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: MARKUP } }] } });
  const { app, page } = await open();
  try {
    await signIn(page);
    await setParticipants(page, ['openrouter']);
    await openSetup(page);
    await pick(page, 'openrouter', 'free', 'acme/free-model:free');
    await field(page, 'prompt').fill('markup question');
    await field(page, 'mode').selectOption('broadcast');
    await field(page, 'rounds').fill('1');
    await field(page, 'start').click();
    await expect(field(page, 'status')).toContainText('done', { timeout: 3 * TURN_BUDGET_MS });
    const reply = page.locator('.room-entry.kind-reply .room-entry-text').first();
    await expect(reply).toHaveText(MARKUP);
    await expect(page.locator('[data-room="feed"] img, [data-room="feed"] b')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    const { text } = await history(page);
    expect(text).toContain(MARKUP);
  } finally {
    await app.close();
  }
});

test('an OpenRouter row opened again from the saved room keeps its model, effort and web flag', async () => {
  const { app, page } = await open();
  try {
    await signIn(page);
    await setParticipants(page, ['openrouter']);
    await openSetup(page);
    await pick(page, 'openrouter', 'paid', 'acme/paid-model');
    await tableRow(page, 'openrouter').locator('[data-row-field="effort"]').selectOption('low');
    await tableRow(page, 'openrouter').locator('[data-row-field="web"]').uncheck();
    await field(page, 'prompt').fill('keep my settings');
    await field(page, 'mode').selectOption('broadcast');
    await field(page, 'rounds').fill('1');
    await field(page, 'start').click();
    await expect(field(page, 'status')).toContainText('done', { timeout: 3 * TURN_BUDGET_MS });
    expect(fake.chatCalls[0]?.body?.reasoning).toEqual({ effort: 'low' });
    expect(fake.chatCalls[0]?.body).not.toHaveProperty('tools');
    await openSetup(page);
    await addParticipant(page, 'claude');
    await expect(tableRow(page, 'claude')).toBeVisible();
    await page.locator('[data-room="tree"] [data-room-id]').first().click();
    await openSetup(page);
    await expect(tableRow(page, 'claude')).toHaveCount(0);
    const row = tableRow(page, 'openrouter');
    await expect(row.locator('[data-row-field="model"]')).toHaveValue('acme/paid-model');
    await expect(row.locator('[data-row-field="effort"]')).toHaveValue('low');
    await expect(row.locator('[data-row-field="web"]')).not.toBeChecked();
  } finally {
    await app.close();
  }
});
