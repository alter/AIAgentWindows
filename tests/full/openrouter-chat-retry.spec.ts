// openrouter-chat-retry.spec.ts
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FAKE_LIMIT_MARKUP, FAKE_PROVIDER_NAME, PROVIDER_LIMITED_MODEL, startFakeOpenRouter, type FakeOpenRouter } from '../fixtures/openrouter-fake';

const root = path.resolve(__dirname, '..', '..');
const NEW_MODEL = 'acme/free-model:free';

let fake: FakeOpenRouter;
let base: string;

test.beforeEach(async () => {
  fake = await startFakeOpenRouter();
  base = mkdtempSync(path.join(tmpdir(), 'aiaw-or-retry-'));
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

function pane(page: Page): Locator {
  return page.locator('[data-or="pane"]:not([hidden])');
}

function messages(page: Page, role: 'user' | 'assistant'): Locator {
  return pane(page).locator(`[data-or="log"] [data-role="${role}"]`);
}

async function pickModel(page: Page, model: string): Promise<void> {
  await pane(page).locator('[data-row-field="model-filter"]').selectOption('free');
  await pane(page).locator('[data-row-field="model"]').selectOption(model);
}

async function boxHeight(node: Locator): Promise<number> {
  return node.evaluate((element) => element.getBoundingClientRect().height);
}

test('a failed reply is retried with the new model and the error text is shown as text', async () => {
  const { app, page } = await open();
  try {
    const account = page.getByRole('region', { name: 'OpenRouter' });
    await account.getByRole('button', { name: 'Paste key' }).click();
    await account.getByLabel('Key').fill(fake.key);
    await account.getByRole('button', { name: 'Save' }).click();
    await expect(account.getByText('Connected', { exact: true })).toBeVisible();
    await page.locator('.add-button').click();
    await page.locator('.menu-item[data-kind="openrouter"]').click();
    await expect(pane(page)).toBeVisible();
    const notice = pane(page).locator('[data-or="notice"]');
    expect(await boxHeight(notice)).toBe(0);
    expect(await boxHeight(account.locator('.or-notice'))).toBe(0);

    await pickModel(page, PROVIDER_LIMITED_MODEL);
    const input = pane(page).locator('[data-or="input"]');
    await input.fill('Question');
    await input.press('Enter');
    await expect(messages(page, 'assistant').first()).toHaveAttribute('data-status', 'failed');
    const error = messages(page, 'assistant').first().locator('.or-msg-error');
    await expect(error).toContainText(FAKE_PROVIDER_NAME);
    await expect(error).toContainText(FAKE_LIMIT_MARKUP);
    await expect(pane(page).locator('[data-or="log"] img, [data-or="log"] b')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    expect(fake.chatCalls).toHaveLength(1);

    await pickModel(page, NEW_MODEL);
    await expect(messages(page, 'assistant')).toHaveCount(0);
    await expect(messages(page, 'user')).toHaveCount(1);
    expect(await boxHeight(notice)).toBe(0);

    await pane(page).getByRole('button', { name: 'Retry' }).click();
    await expect(messages(page, 'assistant')).toHaveCount(1);
    await expect(messages(page, 'assistant').first()).toHaveAttribute('data-status', 'done');
    await expect(messages(page, 'assistant').first().locator('.or-msg-text')).toHaveText(`Reply from ${NEW_MODEL} number 2`);
    await expect(messages(page, 'user')).toHaveCount(1);
    await expect(pane(page).getByRole('button', { name: 'Retry' })).toHaveCount(0);
    expect(fake.chatCalls).toHaveLength(2);
    expect(fake.chatCalls[1]?.body?.model).toBe(NEW_MODEL);
    expect(fake.chatCalls[1]?.body?.messages).toEqual([{ role: 'user', content: 'Question' }]);
  } finally {
    await app.close();
  }
});
