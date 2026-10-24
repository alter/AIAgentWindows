// popup-sidebar.spec.ts
import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
const stubCli = path.join(root, 'tests', 'fixtures', 'stub-cli.mjs');

async function expectInsideSidebar(page: Page, menu: Locator): Promise<void> {
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  const side = await page.locator('.sidebar').boundingBox();
  if (box === null || side === null) throw new Error('no box');
  expect(box.x).toBeGreaterThanOrEqual(side.x);
  expect(box.x + box.width).toBeLessThanOrEqual(side.x + side.width);
}

test('popups opened from a project row stay inside the sidebar, left of the site view', async () => {
  const base = mkdtempSync(path.join(tmpdir(), 'aiaw-popup-sidebar-'));
  const folder = path.join(base, 'code', 'sidebar-app');
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, 'README.md'), 'synthetic project\n');
  const app = await electron.launch({
    args: [root],
    env: {
      ...process.env,
      AIAW_USER_DATA: path.join(base, 'profile'),
      AIAW_CLAUDE_BIN: stubCli,
      AIAW_CODEX_BIN: stubCli,
      AIAW_TEST_FOLDER: JSON.stringify([folder]),
      CLAUDE_CONFIG_DIR: path.join(base, 'claude'),
      CODEX_HOME: path.join(base, 'codex'),
    },
  });
  try {
    const page = await app.firstWindow();
    await page.locator('[data-project="add"]').click();
    await page.locator('[data-project="add-existing"]').click();
    await expect(page.locator('[data-project="tree"] [data-project-id]')).toHaveCount(1);

    await page.locator('[data-project="add-agent"]').first().click();
    const agentMenu = page.locator('[data-project="agent-menu"]');
    await expectInsideSidebar(page, agentMenu);
    await page.keyboard.press('Escape');
    await expect(agentMenu).toBeHidden();

    await page.locator('[data-project="menu"]').first().click();
    const actions = page.locator('.projects-menu:not([data-project="agent-menu"])');
    await expectInsideSidebar(page, actions);
  } finally {
    await app.close();
  }
});
