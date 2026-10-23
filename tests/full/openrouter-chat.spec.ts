// openrouter-chat.spec.ts
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SSE_COMMENT, sseDelta, sseTail, startFakeOpenRouter, type FakeOpenRouter } from '../fixtures/openrouter-fake';

const root = path.resolve(__dirname, '..', '..');
const OWNER_MARKUP = '<img src=x onerror="window.__pwned=1"><b>mine</b>';
const REPLY_MARKUP = ['<img src=x onerror="window.__pwned=2">', '<b>bold</b> & <script>window.__pwned=3</script>'];

let fake: FakeOpenRouter;
let base: string;

test.beforeEach(async () => {
  fake = await startFakeOpenRouter();
  base = mkdtempSync(path.join(tmpdir(), 'aiaw-or-chat-'));
});

test.afterEach(async () => {
  await fake.close();
});

async function open(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [root],
    env: { ...process.env, AIAW_USER_DATA: path.join(base, 'profile'), AIAW_OPENROUTER_BASE: fake.base },
  });
  return { app, page: await app.firstWindow() };
}

function account(page: Page): Locator {
  return page.getByRole('region', { name: 'OpenRouter' });
}

async function signIn(page: Page): Promise<void> {
  await account(page).getByRole('button', { name: 'Paste key' }).click();
  await account(page).getByLabel('Key').fill(fake.key);
  await account(page).getByRole('button', { name: 'Save' }).click();
  await expect(account(page).getByText('Connected', { exact: true })).toBeVisible();
}

function pane(page: Page): Locator {
  return page.locator('[data-or="pane"]:not([hidden])');
}

function messages(page: Page, role: 'user' | 'assistant'): Locator {
  return pane(page).locator(`[data-or="log"] [data-role="${role}"]`);
}

async function createAgent(page: Page): Promise<void> {
  await page.locator('.add-button').click();
  await page.locator('.menu-item[data-kind="openrouter"]').click();
  await expect(pane(page)).toBeVisible();
}

async function pickModel(page: Page, filter: 'free' | 'paid', model: string): Promise<void> {
  await pane(page).locator('[data-row-field="model-filter"]').selectOption(filter);
  await pane(page).locator('[data-row-field="model"]').selectOption(model);
}

async function send(page: Page, text: string): Promise<void> {
  const input = pane(page).locator('[data-or="input"]');
  await input.fill(text);
  await input.press('Enter');
}

function storedAgentId(): string {
  const state = JSON.parse(readFileSync(path.join(base, 'profile', 'state.json'), 'utf8')) as { agents: { id: string; kind: string }[] };
  return state.agents.find((agent) => agent.kind === 'openrouter')?.id ?? '';
}

test('create the agent from +, chat twice, stop one reply, restart and find the conversation', async () => {
  const { app, page } = await open();
  try {
    await signIn(page);
    await createAgent(page);
    await expect(page.locator('.agent-item')).toHaveText('OpenRouter');
    await pickModel(page, 'free', 'acme/free-model:free');
    await expect(page.locator('.agent-item')).toHaveText('OpenRouter · Acme Free');
    await expect(pane(page).locator('[data-row-field="model"] option[value="acme/paid-model"]')).toHaveCount(0);

    const input = pane(page).locator('[data-or="input"]');
    await input.fill('First');
    await input.press('Shift+Enter');
    await input.pressSequentially('question');
    await expect(messages(page, 'user')).toHaveCount(0);
    await input.press('Enter');
    await expect(messages(page, 'assistant')).toHaveCount(1);
    await expect(messages(page, 'assistant').first()).toHaveAttribute('data-status', 'done');
    await expect(messages(page, 'assistant').first().locator('.or-msg-text')).toHaveText('Reply from acme/free-model:free number 1');
    expect(fake.chatCalls[0]?.body?.messages).toEqual([{ role: 'user', content: 'First\nquestion' }]);

    fake.chat = (call) => (call.n === 2 ? { stream: { parts: [SSE_COMMENT, sseDelta('Partial '), sseDelta('text')], hold: true } } : undefined);
    await send(page, 'Second question');
    await expect(messages(page, 'assistant').nth(1).locator('.or-msg-text')).toHaveText('Partial text');
    await expect(messages(page, 'assistant').nth(1)).toHaveAttribute('data-status', 'streaming');
    await expect(pane(page).locator('[data-or="stop"]')).toBeVisible();
    await expect(pane(page).locator('[data-or="send"]')).toBeHidden();
    await pane(page).locator('[data-or="stop"]').click();
    await expect(messages(page, 'assistant').nth(1)).toHaveAttribute('data-status', 'stopped');
    await expect(pane(page).locator('[data-or="send"]')).toBeVisible();
    await expect.poll(() => fake.chatClosed).toBe(1);
    expect(fake.chatCalls[1]?.body?.messages).toEqual([
      { role: 'user', content: 'First\nquestion' },
      { role: 'assistant', content: 'Reply from acme/free-model:free number 1' },
      { role: 'user', content: 'Second question' },
    ]);
    expect(existsSync(path.join(base, 'profile', 'shared', 'openrouter', `${storedAgentId()}.json`))).toBe(true);
  } finally {
    await app.close();
  }

  const again = await open();
  try {
    await expect(again.page.locator('.agent-item')).toHaveText('OpenRouter · Acme Free');
    await expect(messages(again.page, 'user')).toHaveCount(2);
    await expect(messages(again.page, 'assistant')).toHaveCount(2);
    await expect(messages(again.page, 'assistant').nth(0).locator('.or-msg-text')).toHaveText('Reply from acme/free-model:free number 1');
    await expect(messages(again.page, 'assistant').nth(1).locator('.or-msg-text')).toHaveText('Partial text');
    await expect(messages(again.page, 'assistant').nth(1)).toHaveAttribute('data-status', 'stopped');
    await expect(pane(again.page).locator('[data-row-field="model"]')).toHaveValue('acme/free-model:free');
    await send(again.page, 'Third question');
    await expect(messages(again.page, 'assistant')).toHaveCount(3);
    await expect(messages(again.page, 'assistant').nth(2)).toHaveAttribute('data-status', 'done');
    expect(fake.chatCalls[2]?.body?.messages?.map((message) => message.content)).toEqual([
      'First\nquestion',
      'Reply from acme/free-model:free number 1',
      'Second question',
      'Partial text',
      'Third question',
    ]);
  } finally {
    await again.app.close();
  }
});

test("markup in a streamed reply and in the owner's message is shown as text", async () => {
  fake.chat = () => ({ stream: { parts: [SSE_COMMENT, ...REPLY_MARKUP.map(sseDelta), ...sseTail(2, 2)] } });
  const { app, page } = await open();
  try {
    await signIn(page);
    await createAgent(page);
    await pickModel(page, 'free', 'acme/free-model:free');
    await send(page, OWNER_MARKUP);
    await expect(messages(page, 'assistant').first()).toHaveAttribute('data-status', 'done');
    await expect(messages(page, 'user').first().locator('.or-msg-text')).toHaveText(OWNER_MARKUP);
    await expect(messages(page, 'assistant').first().locator('.or-msg-text')).toHaveText(REPLY_MARKUP.join(''));
    await expect(pane(page).locator('[data-or="log"] img, [data-or="log"] b, [data-or="log"] script')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  } finally {
    await app.close();
  }
});
