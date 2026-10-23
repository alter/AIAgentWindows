// state-v2.spec.ts
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
const OLD_AGENT = '5dff1f45-2222-4222-8222-bbbbbbbbbbbb';

interface Fixture {
  server: Server;
  url: string;
  requests: string[];
}

async function startFixture(): Promise<Fixture> {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? '/');
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.setHeader('set-cookie', 'aiaw-fixture=1; Max-Age=3600; Path=/');
    response.end('<!doctype html><title>fixture</title><p>fixture</p><script>localStorage.setItem("aiaw-fixture", "1")</script>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, requests };
}

function launch(userData: string, siteUrl: string): Promise<ElectronApplication> {
  return electron.launch({
    args: [root],
    env: { ...process.env, AIAW_USER_DATA: userData, AIAW_SITE_URL_GROK: siteUrl, AIAW_SITE_URL_CHATGPT: siteUrl, AIAW_SITE_URL_DEEPSEEK: siteUrl },
  });
}

async function addAgent(page: Page, kind: string): Promise<void> {
  await page.locator('.add-button').click();
  await page.locator(`.menu-item[data-kind="${kind}"]`).click();
}

function snapshot(folder: string, base = folder): string[] {
  if (!existsSync(folder)) return [];
  const entries: string[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) entries.push(...snapshot(full, base));
    else {
      const info = statSync(full);
      entries.push(`${path.relative(base, full)}:${info.size}:${info.mtimeMs}`);
    }
  }
  return entries.sort();
}

test('a site agent opens on the partition of the version-1 agent of its kind and the old file stays as it was', async () => {
  test.setTimeout(90_000);
  const { server, url, requests } = await startFixture();
  const userData = mkdtempSync(path.join(tmpdir(), 'aiaw-state-v2-'));
  const legacy = JSON.stringify({ version: 1, agents: [{ id: OLD_AGENT, kind: 'grok', title: 'Grok', createdAt: 1 }], theme: 'dark', sidebarWidth: 300 });
  writeFileSync(path.join(userData, 'agents.json'), legacy);
  const partition = path.join(userData, 'Partitions', OLD_AGENT);
  mkdirSync(partition, { recursive: true });
  writeFileSync(path.join(partition, 'seed.txt'), 'synthetic login marker');
  const before = snapshot(partition);
  let app = await launch(userData, url);
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.agent-item')).toHaveCount(0);
    await expect.poll(() => existsSync(path.join(userData, 'state.json'))).toBe(true);
    const state = JSON.parse(readFileSync(path.join(userData, 'state.json'), 'utf8')) as Record<string, unknown>;
    expect(state).toMatchObject({
      version: 2,
      agents: [],
      theme: 'dark',
      sidebarWidth: 300,
      partitions: { chatgpt: 'persist:chatgpt', grok: `persist:${OLD_AGENT}`, deepseek: 'persist:deepseek' },
    });
    expect(readFileSync(path.join(userData, 'agents.json'), 'utf8')).toBe(legacy);
    expect(snapshot(partition)).toEqual(before);

    await addAgent(page, 'grok');
    await expect(page.locator('.agent-item')).toHaveCount(1);
    await expect.poll(() => requests.length).toBeGreaterThan(0);
    await app.close();
    app = await launch(userData, url);
    await app.firstWindow();
    await app.close();

    const after = snapshot(partition);
    expect(after).not.toEqual(before);
    expect(after.filter((entry) => !entry.startsWith('seed.txt:')).length).toBeGreaterThan(0);
    expect(readdirSync(path.join(userData, 'Partitions'))).toEqual([OLD_AGENT]);
    expect(readFileSync(path.join(userData, 'agents.json'), 'utf8')).toBe(legacy);
  } finally {
    await app.close().catch(() => undefined);
    server.close();
  }
});

test('an unreadable state.json shows the error with its path when an agent is added and stays byte-identical', async () => {
  const { server, url } = await startFixture();
  const userData = mkdtempSync(path.join(tmpdir(), 'aiaw-state-v2-'));
  const truncated = '{"version":2,"agents":[{"id":"';
  const file = path.join(userData, 'state.json');
  writeFileSync(file, truncated);
  const app = await launch(userData, url);
  try {
    const page = await app.firstWindow();
    await addAgent(page, 'grok');
    const notice = page.locator('[data-sidebar="notice"]');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(file);
    await expect(page.locator('.agent-item')).toHaveCount(0);
    await app.close();
    expect(readFileSync(file, 'utf8')).toBe(truncated);
    expect(readdirSync(userData).filter((name) => name.startsWith('state.json')).sort()).toEqual(['state.json']);
  } finally {
    await app.close().catch(() => undefined);
    server.close();
  }
});
