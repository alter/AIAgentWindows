// smoke.spec.ts
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
const stubCli = path.join(root, 'tests', 'fixtures', 'stub-cli.mjs');
const sitePage = readFileSync(path.join(root, 'tests', 'fixtures', 'site-page.html'), 'utf8');

interface Fixture {
  server: Server;
  url: string;
  userAgents: string[];
}

function startFixtureServer(): Promise<Fixture> {
  const userAgents: string[] = [];
  const server = createServer((request, response) => {
    userAgents.push(String(request.headers['user-agent']));
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(request.url === '/away' ? '<!doctype html><h1>FIXTURE-SITE-AWAY</h1>' : sitePage);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}/`, userAgents });
    });
  });
}

function launch(userData: string, folder: string, extraEnv: Record<string, string> = {}): Promise<ElectronApplication> {
  return electron.launch({
    args: [root],
    env: {
      ...process.env,
      AIAW_USER_DATA: userData,
      AIAW_CLAUDE_BIN: stubCli,
      AIAW_CODEX_BIN: stubCli,
      AIAW_TEST_FOLDER: folder,
      ...extraEnv,
    },
  });
}

async function addAgent(page: Page, kind: string): Promise<void> {
  await page.locator('button[aria-haspopup="menu"]').click();
  await page.locator(`.menu-item[data-kind="${kind}"]`).click();
}

test('a Claude Code agent shows the stub banner and is listed again after a relaunch', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'aiaw-userdata-'));
  const folder = mkdtempSync(path.join(tmpdir(), 'aiaw-folder-'));

  const first = await launch(userData, folder);
  const firstPage = await first.firstWindow();
  await addAgent(firstPage, 'claude');
  await expect(firstPage.locator('.agent-item')).toHaveCount(1);
  await expect(firstPage.locator('.xterm-rows')).toContainText('STUB-CLI BANNER');
  await first.close();

  const second = await launch(userData, folder);
  const secondPage = await second.firstWindow();
  await expect(secondPage.locator('.agent-item')).toHaveCount(1);
  await expect(secondPage.locator('.xterm-rows')).toContainText('STUB-CLI BANNER');
  await second.close();
});

test('a DeepSeek agent shows a visible view without the Electron token and Home returns to the start URL', async () => {
  const fixture = await startFixtureServer();
  const userData = mkdtempSync(path.join(tmpdir(), 'aiaw-userdata-'));
  const folder = mkdtempSync(path.join(tmpdir(), 'aiaw-folder-'));
  const app = await launch(userData, folder, { AIAW_SITE_URL_DEEPSEEK: fixture.url });
  try {
    const page = await app.firstWindow();
    await addAgent(page, 'deepseek');
    await expect(page.locator('.agent-item')).toHaveCount(1);
    await expect(page.locator('.nav-address')).toHaveText(fixture.url);

    const visibleViews = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]
        ?.contentView.children.filter((child) => (child as { getVisible?: () => boolean }).getVisible?.() === true)
        .map((child) => child.getBounds()),
    );
    expect(visibleViews).toHaveLength(1);
    expect(visibleViews?.[0]?.width).toBeGreaterThan(0);
    expect(visibleViews?.[0]?.height).toBeGreaterThan(0);

    expect(fixture.userAgents.length).toBeGreaterThan(0);
    for (const userAgent of fixture.userAgents) expect(userAgent).not.toContain('Electron/');

    await app.evaluate(({ webContents }, startUrl) => {
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === startUrl);
      void contents?.loadURL(`${startUrl}away`);
    }, fixture.url);
    await expect(page.locator('.nav-address')).toHaveText(`${fixture.url}away`);

    await page.locator('.nav-button[data-action="home"]').click();
    await expect(page.locator('.nav-address')).toHaveText(fixture.url);
  } finally {
    await app.close();
    fixture.server.close();
  }
});
