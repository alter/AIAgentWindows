// popup-placement.spec.ts
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openSetup } from './room-table-helpers';

const root = path.resolve(__dirname, '..', '..');
const stubCli = path.join(root, 'tests', 'fixtures', 'stub-cli.mjs');
const WIDTH = 900;
const HEIGHT = 560;
const ROOM_ID = 'placement-a';

function newBase(): string {
  const base = mkdtempSync(path.join(tmpdir(), 'aiaw-placement-'));
  const rooms = path.join(base, 'profile', 'shared', 'rooms');
  mkdirSync(rooms, { recursive: true });
  const record = {
    version: 1,
    id: ROOM_ID,
    createdAt: 1000,
    updatedAt: 3000,
    status: 'done',
    config: {
      mode: 'relay',
      rounds: 1,
      participants: [{ id: 'claude', kind: 'claude', label: 'Claude Code' }],
      finalizerId: 'claude',
      turnTimeoutMs: 60000,
      debugSites: false,
    },
    entries: [{ authorId: 'owner', label: 'You', time: 1000, kind: 'prompt', text: 'Placement question' }],
    nonce: 'nonce1',
    title: 'Placement',
  };
  writeFileSync(path.join(rooms, `${ROOM_ID}.json`), JSON.stringify(record), 'utf8');
  writeFileSync(path.join(rooms, `${ROOM_ID}.md`), '# Placement\n', 'utf8');
  return base;
}

async function launch(base: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [root],
    env: {
      ...process.env,
      AIAW_USER_DATA: path.join(base, 'profile'),
      AIAW_ROOM_FAST: '1',
      AIAW_CLAUDE_BIN: stubCli,
      AIAW_CODEX_BIN: stubCli,
      AIAW_TEST_FOLDER: path.join(base, 'folder'),
      CLAUDE_CONFIG_DIR: path.join(base, 'claude'),
      CODEX_HOME: path.join(base, 'codex'),
    },
  });
  return { app, page: await app.firstWindow() };
}

async function resize(app: ElectronApplication, page: Page): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
  }, { width: WIDTH, height: HEIGHT });
  await expect.poll(() => page.evaluate(() => `${window.innerWidth}x${window.innerHeight}`)).toBe(`${WIDTH}x${HEIGHT}`);
}

async function expectInsideWindow(page: Page, menu: Locator): Promise<void> {
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  const view = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  if (box === null) throw new Error('no menu box');
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(view.width);
  expect(box.y + box.height).toBeLessThanOrEqual(view.height);
}

async function expectLastReachable(menu: Locator, last: Locator): Promise<void> {
  await last.focus();
  await expect(last).toBeFocused();
  await expect(last).toBeInViewport({ ratio: 1 });
  const inner = await last.boundingBox();
  const outer = await menu.boundingBox();
  if (inner === null || outer === null) throw new Error('no box');
  expect(inner.y).toBeGreaterThanOrEqual(outer.y - 1);
  expect(inner.y + inner.height).toBeLessThanOrEqual(outer.y + outer.height + 1);
}

async function contextAt(target: Locator, x: number, y: number): Promise<void> {
  await target.evaluate(
    (node, point) => node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y })),
    { x, y },
  );
}

test('every popup stays inside the window and its last item is reachable', async () => {
  const base = newBase();
  const { app, page } = await launch(base);
  try {
    await resize(app, page);

    await page.locator('.add-button').click();
    await page.locator('.menu-item[data-kind="claude"]').click();
    await expect(page.locator('.agent-item')).toHaveCount(1);

    await page.locator('.add-button').click();
    const plus = page.locator('.add-menu');
    await expectInsideWindow(page, plus);
    await expectLastReachable(plus, plus.locator('.menu-item').last());
    await page.keyboard.press('Escape');
    await expect(plus).toBeHidden();

    await contextAt(page.locator('.agent-item'), WIDTH - 4, HEIGHT - 4);
    const agentMenu = page.locator('.context-menu');
    await expectInsideWindow(page, agentMenu);
    await expectLastReachable(agentMenu, agentMenu.locator('.context-item').last());
    await page.keyboard.press('Escape');
    await expect(agentMenu).toBeHidden();

    await page.locator('[data-room="open"]').click();
    await expect(page.locator('[data-room="pane"]')).toBeVisible();

    await contextAt(page.locator(`[data-room="tree"] [data-room-id="${ROOM_ID}"]`), WIDTH - 4, HEIGHT - 4);
    const roomMenu = page.locator('.rooms-menu');
    await expectInsideWindow(page, roomMenu);
    await expectLastReachable(roomMenu, roomMenu.locator('.rooms-menu-item').last());
    await page.keyboard.press('Escape');
    await expect(roomMenu).toBeHidden();

    await openSetup(page);
    const trigger = page.locator('[data-room="add-participant"]');
    await trigger.evaluate((node) => node.scrollIntoView({ block: 'end' }));
    await trigger.click();
    const addMenu = page.locator('[data-room="add-menu"]');
    await expectInsideWindow(page, addMenu);
    await page.keyboard.press('End');
    await expectLastReachable(addMenu, addMenu.locator('[role="menuitem"]').last());
    await page.keyboard.press('Escape');
    await expect(addMenu).toBeHidden();
  } finally {
    await app.close();
  }
});
