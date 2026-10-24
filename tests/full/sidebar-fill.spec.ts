// sidebar-fill.spec.ts
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
const stubCli = path.join(root, 'tests', 'fixtures', 'stub-cli.mjs');

interface Geometry {
  windowHeight: number;
  projectsTop: number;
  projectsBottom: number;
  projectsHeight: number;
  projectsScroll: number;
  scrollbarWidth: number;
  noneTop: number;
  noneBottom: number;
  accountTop: number;
  themeBottom: number;
}

async function resize(app: ElectronApplication, height: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1100, size);
  }, height);
}

async function geometry(page: Page): Promise<Geometry> {
  return page.evaluate(() => {
    const box = (selector: string): { rect: DOMRect; node: HTMLElement } => {
      const node = document.querySelector<HTMLElement>(selector);
      if (node === null) throw new Error(`no ${selector}`);
      return { rect: node.getBoundingClientRect(), node };
    };
    const projects = box('.projects');
    return {
      windowHeight: window.innerHeight,
      projectsTop: projects.rect.top,
      projectsBottom: projects.rect.bottom,
      projectsHeight: projects.rect.height,
      projectsScroll: projects.node.scrollHeight - projects.node.clientHeight,
      scrollbarWidth: projects.node.offsetWidth - projects.node.clientWidth,
      noneTop: box('.no-project').rect.top,
      noneBottom: box('.no-project').rect.bottom,
      accountTop: box('.or-account').rect.top,
      themeBottom: box('.theme-switch').rect.bottom,
    };
  });
}

async function endsAreReachable(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const area = document.querySelector<HTMLElement>('.projects');
    const rows = area?.querySelectorAll('.agent-item');
    const last = rows?.item(rows.length - 1);
    const nodes = area?.querySelectorAll('.project-node');
    const lastNode = nodes?.item(nodes.length - 1);
    if (!area || !last || !lastNode) return false;
    const outer = area.getBoundingClientRect();
    area.scrollTop = area.scrollHeight;
    const nodeReached = lastNode.getBoundingClientRect().bottom <= outer.bottom + 1;
    last.scrollIntoView({ block: 'nearest' });
    const inner = last.getBoundingClientRect();
    return nodeReached && inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;
  });
}

test('the projects list fills the sidebar height, shows a scrollbar when it overflows and never overlaps the bottom block', async () => {
  test.setTimeout(120_000);
  const base = mkdtempSync(path.join(tmpdir(), 'aiaw-sidebar-fill-'));
  const folders = ['fill-one', 'fill-two'].map((name) => path.join(base, 'code', name));
  for (const folder of folders) {
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, 'README.md'), 'synthetic project\n');
  }
  const app = await electron.launch({
    args: [root],
    env: {
      ...process.env,
      AIAW_USER_DATA: path.join(base, 'profile'),
      AIAW_CLAUDE_BIN: stubCli,
      AIAW_CODEX_BIN: stubCli,
      AIAW_TEST_FOLDER: JSON.stringify(folders),
      CLAUDE_CONFIG_DIR: path.join(base, 'claude'),
      CODEX_HOME: path.join(base, 'codex'),
    },
  });
  try {
    const page = await app.firstWindow();
    for (let count = 1; count <= folders.length; count += 1) {
      await page.locator('[data-project="add"]').click();
      await page.locator('[data-project="add-existing"]').click();
      await page.locator('[data-project="create"]').click();
      await expect(page.locator('[data-project="tree"] [data-project-id]')).toHaveCount(count);
    }
    for (let count = 1; count <= 6; count += 1) {
      await page.locator('[data-project="add-agent"]').first().click();
      await page.locator('[data-project="agent-menu"] button[data-kind="codex"]').click();
      await expect(page.locator('.projects .agent-item')).toHaveCount(count);
    }

    await resize(app, 900);
    await expect.poll(async () => (await geometry(page)).windowHeight).toBe(900);
    const tall = await geometry(page);
    expect(tall.projectsScroll).toBeGreaterThan(0);
    expect(tall.projectsHeight).toBeGreaterThan(tall.windowHeight * 0.4 + 1);
    expect(tall.scrollbarWidth).toBeGreaterThan(0);

    await resize(app, 500);
    await expect.poll(async () => (await geometry(page)).windowHeight).toBe(500);
    const small = await geometry(page);
    expect(small.projectsScroll).toBeGreaterThan(0);
    expect(small.scrollbarWidth).toBeGreaterThan(0);
    expect(small.projectsBottom).toBeLessThanOrEqual(small.noneTop + 1);
    expect(small.noneBottom).toBeLessThanOrEqual(small.accountTop + 1);
    expect(small.themeBottom).toBeLessThanOrEqual(small.windowHeight + 1);
    expect(Math.abs(small.noneBottom - small.accountTop)).toBeLessThanOrEqual(1);
    expect(await endsAreReachable(page)).toBe(true);
  } finally {
    await app.close();
  }
});
