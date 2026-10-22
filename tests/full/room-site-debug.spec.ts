// room-site-debug.spec.ts
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
const stubCli = path.join(root, 'tests', 'fixtures', 'stub-cli.mjs');
const REPLY = 'DEBUG-SMOKE-REPLY from the local chat page';

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>debug chat</title></head>
<body>
<main id="log" style="white-space: pre-wrap"></main>
<textarea aria-label="Message"></textarea>
<script>
const ta = document.querySelector('textarea');
const log = document.getElementById('log');
const say = (role, text) => {
  const node = document.createElement('div');
  node.className = 'msg ' + role;
  node.textContent = text;
  log.appendChild(node);
};
ta.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey || ta.value === '') return;
  event.preventDefault();
  const text = ta.value;
  ta.value = '';
  say('user', text);
  setTimeout(() => say('assistant', ${JSON.stringify(REPLY)}), 60);
});
</script>
</body></html>`;

interface Session {
  app: ElectronApplication;
  page: Page;
  userData: string;
  server: Server;
}

async function launch(): Promise<Session> {
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/`;
  const base = mkdtempSync(path.join(tmpdir(), 'aiaw-debug-'));
  const userData = path.join(base, 'profile');
  const app = await electron.launch({
    args: [root],
    env: {
      ...process.env,
      AIAW_USER_DATA: userData,
      AIAW_ROOM_FAST: '1',
      AIAW_CLAUDE_BIN: stubCli,
      AIAW_CODEX_BIN: stubCli,
      AIAW_TEST_FOLDER: mkdtempSync(path.join(base, 'folder-')),
      CLAUDE_CONFIG_DIR: path.join(base, 'claude'),
      CODEX_HOME: path.join(base, 'codex'),
      AIAW_SITE_URL_DEEPSEEK: url,
    },
  });
  const page = await app.firstWindow();
  await page.locator('button[aria-haspopup="menu"]').click();
  await page.locator('.menu-item[data-kind="deepseek"]').click();
  await expect(page.locator('.agent-item')).toHaveCount(1);
  return { app, page, userData, server };
}

async function runRoom(page: Page, record: boolean): Promise<string> {
  await page.locator('[data-room="open"]').click();
  await expect(page.locator('[data-room="pane"]')).toBeVisible();
  await page.locator('[data-room="prompt"]').fill('debug recording question');
  await page.locator('input[data-participant="deepseek"]').check();
  await page.locator('[data-room="mode"]').selectOption('broadcast');
  await page.locator('[data-room="rounds"]').fill('1');
  const box = page.locator('input[data-room="debug-sites"]');
  await expect(box).not.toBeChecked();
  if (record) await box.check();
  await page.locator('[data-room="start"]').click();
  await expect(page.locator('[data-room="status"]')).toContainText('done', { timeout: 25000 });
  return (await page.locator('[data-room="status"]').textContent()) ?? '';
}

test('with the switch on, a web turn is recorded under the profile and the status line names the directory', async () => {
  const { app, page, userData, server } = await launch();
  try {
    const status = await runRoom(page, true);
    const shown = /Debug: (.+)$/.exec(status.trim())?.[1] ?? '';
    expect(shown.startsWith(path.join(userData, 'debug', 'sites'))).toBe(true);
    const turns = readdirSync(shown).filter((name) => name.startsWith('deepseek-'));
    expect(turns.length).toBeGreaterThanOrEqual(1);
    const dir = path.join(shown, turns[0] as string);
    const meta = JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    expect(meta).toMatchObject({ site: 'deepseek', outcome: 'reply' });
    expect(readdirSync(path.join(dir, 'snapshots')).length).toBeGreaterThanOrEqual(1);
    expect(readFileSync(path.join(dir, 'dom-end.html'), 'utf8')).toContain(REPLY);
    expect(readFileSync(path.join(dir, 'prompt.txt'), 'utf8')).toContain('debug recording question');
    const log = readFileSync(path.join(userData, 'logs', 'sites.log'), 'utf8');
    expect(log).toContain(`debugDir="${dir}"`);
    expect(log).not.toContain(REPLY);
    expect(log).not.toContain('debug recording question');
  } finally {
    await app.close().catch(() => undefined);
    server.close();
  }
});

test('with the switch off, no debug directory exists', async () => {
  const { app, page, userData, server } = await launch();
  try {
    const status = await runRoom(page, false);
    expect(status).not.toContain('Debug:');
    expect(existsSync(path.join(userData, 'debug'))).toBe(false);
  } finally {
    await app.close().catch(() => undefined);
    server.close();
  }
});
