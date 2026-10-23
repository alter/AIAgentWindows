// openrouter-account.spec.ts
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FAKE_MODEL_MARKUP, startFakeOpenRouter, type FakeOpenRouter } from '../fixtures/openrouter-fake';

const root = path.resolve(__dirname, '..', '..');
const stubCli = path.join(root, 'tests', 'fixtures', 'stub-cli.mjs');

function launch(userData: string, base: string): Promise<ElectronApplication> {
  return electron.launch({
    args: [root],
    env: {
      ...process.env,
      AIAW_USER_DATA: userData,
      AIAW_OPENROUTER_BASE: base,
      AIAW_CLAUDE_BIN: stubCli,
      AIAW_CODEX_BIN: stubCli,
      AIAW_TEST_FOLDER: userData,
    },
  });
}

function block(page: Page): ReturnType<Page['locator']> {
  return page.getByRole('region', { name: 'OpenRouter' });
}

async function names(page: Page): Promise<string[]> {
  return (await block(page).locator('.or-model-name').allTextContents()).sort();
}

function stateFile(userData: string): string {
  return readFileSync(path.join(userData, 'state.json'), 'utf8');
}

async function watchEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { aiaw: Record<string, (listener: (event: unknown) => void) => void>; __seen: string[] };
    w.__seen = [];
    for (const name of ['onAgentsChanged', 'onPtyData', 'onPtyExit', 'onSiteState', 'onRoomEvent', 'onRoomTerminalData', 'onOpenRouterChanged']) {
      const subscribe = w.aiaw[name];
      if (subscribe === undefined) throw new Error(`missing ${name}`);
      subscribe((event) => w.__seen.push(JSON.stringify(event)));
    }
  });
}

async function everythingTheRendererSaw(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const w = window as unknown as { aiaw: Record<string, (...args: unknown[]) => Promise<unknown>>; __seen: string[] };
    const results = [
      await w.aiaw['openrouterStatus']!(),
      await w.aiaw['openrouterModels']!(true),
      await w.aiaw['openrouterRefresh']!(),
      await w.aiaw['listAgents']!(),
    ];
    return JSON.stringify([results, w.__seen, document.documentElement.outerHTML, Object.keys(window), JSON.stringify(localStorage)]);
  });
}

let fake: FakeOpenRouter;

test.beforeEach(async () => {
  fake = await startFakeOpenRouter();
});

test.afterEach(async () => {
  await fake.close();
});

test('connect through the browser flow, show the free requests, never give the key to the renderer, disconnect, paste a key', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'aiaw-openrouter-'));
  let app = await launch(userData, fake.base);
  try {
    let page = await app.firstWindow();
    await expect(block(page).getByText('Not connected')).toBeVisible();
    await watchEvents(page);
    await block(page).getByRole('button', { name: 'Connect' }).click();
    await expect(block(page).getByText('Connected', { exact: true })).toBeVisible();
    await expect(block(page).getByText('Free requests left today: 47 of 50')).toBeVisible();
    expect(fake.auth).toHaveLength(1);
    expect(fake.auth[0]?.callbackUrl).toMatch(/^http:\/\/localhost:\d+\/callback$/);
    expect(fake.requests.find((request) => request.path === '/api/v1/key')?.headers.authorization).toBe(`Bearer ${fake.key}`);

    const seen = await everythingTheRendererSaw(page);
    expect(seen).not.toContain(fake.key);
    expect(seen).not.toContain('FAKE');
    const saved = stateFile(userData);
    expect(saved).not.toContain(fake.key);
    expect(saved).toContain('openrouterKey');

    await app.close();
    app = await launch(userData, fake.base);
    page = await app.firstWindow();
    await expect(block(page).getByText('Free requests left today: 47 of 50')).toBeVisible();

    await block(page).getByRole('button', { name: 'Disconnect' }).click();
    await expect(block(page).getByText('Not connected')).toBeVisible();
    expect(stateFile(userData)).not.toContain('openrouterKey');

    await block(page).getByRole('button', { name: 'Paste key' }).click();
    await block(page).getByLabel('Key').fill('sk-or-v1-wrong-key');
    await block(page).getByRole('button', { name: 'Save' }).click();
    await expect(block(page).getByRole('status')).toHaveText(/does not look like a key/);
    await block(page).getByRole('button', { name: 'Paste key' }).click();
    await block(page).getByLabel('Key').fill(fake.key);
    await block(page).getByRole('button', { name: 'Save' }).click();
    await expect(block(page).getByText('Free requests left today: 47 of 50')).toBeVisible();
    expect(stateFile(userData)).not.toContain(fake.key);
  } finally {
    await app.close();
  }
});

test('a model name with markup is shown as text', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'aiaw-openrouter-'));
  const app = await launch(userData, fake.base);
  try {
    const page = await app.firstWindow();
    await block(page).getByText('Models', { exact: true }).click();
    const name = block(page).locator('.or-model-name', { hasText: 'Evil' });
    await expect(name).toHaveText(FAKE_MODEL_MARKUP);
    expect(await block(page).locator('.or-models img, .or-models b, .or-models script').count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    await expect(block(page).getByText('Models (6)')).toBeVisible();
    await block(page).getByLabel('Show models').selectOption('free');
    await expect(block(page).getByText('Models (4)')).toBeVisible();
    await expect.poll(() => names(page)).toEqual(['Account Limited', 'Acme Free', 'Free Models Router', 'Provider Limited']);
    await block(page).getByLabel('Show models').selectOption('paid');
    await expect.poll(() => names(page)).toEqual(['Acme Paid', FAKE_MODEL_MARKUP].sort());
  } finally {
    await app.close();
  }
});
