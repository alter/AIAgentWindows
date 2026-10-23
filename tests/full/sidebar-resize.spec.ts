// sidebar-resize.spec.ts
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
const stubCli = path.join(root, 'tests', 'fixtures', 'stub-cli.mjs');

function launch(userData: string, siteUrl: string): Promise<ElectronApplication> {
  return electron.launch({
    args: [root],
    env: {
      ...process.env,
      AIAW_USER_DATA: userData,
      AIAW_CLAUDE_BIN: stubCli,
      AIAW_CODEX_BIN: stubCli,
      AIAW_TEST_FOLDER: userData,
      AIAW_SITE_URL_DEEPSEEK: siteUrl,
    },
  });
}

function divider(page: Page): Locator {
  return page.getByRole('separator', { name: 'Sidebar width' });
}

function sidebarWidth(page: Page): Promise<number> {
  return page.locator('.sidebar').evaluate((node) => Math.round(node.getBoundingClientRect().width));
}

async function siteViewX(app: ElectronApplication): Promise<number | undefined> {
  const views = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((window) => window.webContents.getURL().startsWith('file:'))
      ?.contentView.children.filter((child) => (child as { getVisible?: () => boolean }).getVisible?.() === true)
      .map((child) => child.getBounds()),
  );
  return views?.[0]?.x;
}

function storedWidth(userData: string): unknown {
  return (JSON.parse(readFileSync(path.join(userData, 'state.json'), 'utf8')) as { sidebarWidth?: unknown }).sidebarWidth;
}

async function expectWidth(app: ElectronApplication, page: Page, width: number): Promise<void> {
  await expect.poll(() => sidebarWidth(page)).toBe(width);
  await expect(divider(page)).toHaveAttribute('aria-valuenow', String(width));
  await expect.poll(() => siteViewX(app)).toBe(width);
}

test('the divider moves by drag and keys and the width survives a restart', async () => {
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end('<!doctype html><title>fixture</title><p>fixture</p>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const siteUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const userData = mkdtempSync(path.join(tmpdir(), 'aiaw-sidebar-'));
  let app = await launch(userData, siteUrl);
  try {
    let page = await app.firstWindow();
    await page.locator('.add-button').click();
    await page.locator('.menu-item[data-kind="deepseek"]').click();
    await expect(page.locator('.agent-item')).toHaveCount(1);
    await expectWidth(app, page, 260);

    const box = await divider(page).boundingBox();
    if (box === null) throw new Error('no divider box');
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(350, y, { steps: 4 });
    await page.mouse.move(400, y, { steps: 4 });
    await page.mouse.up();
    await expectWidth(app, page, 400);

    await divider(page).focus();
    await page.keyboard.press('ArrowRight');
    await expectWidth(app, page, 416);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expectWidth(app, page, 384);
    await page.keyboard.press('Home');
    await expectWidth(app, page, 180);
    await page.keyboard.press('End');
    await expectWidth(app, page, 600);
    await page.keyboard.press('ArrowRight');
    await expectWidth(app, page, 600);

    await divider(page).dblclick();
    await expectWidth(app, page, 260);

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expectWidth(app, page, 308);
    await expect.poll(() => storedWidth(userData)).toBe(308);

    await app.close();
    app = await launch(userData, siteUrl);
    page = await app.firstWindow();
    await expect(page.locator('.agent-item')).toHaveCount(1);
    await expectWidth(app, page, 308);
  } finally {
    await app.close();
    server.close();
  }
});
