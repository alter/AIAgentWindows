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
      accountTop: box('.or-account').rect.top,
      themeBottom: box('.theme-switch').rect.bottom,
    };
  });
}

interface Layout {
  noneInside: boolean;
  noneAboveFirstProject: boolean;
  nestedScrollers: string[];
}

async function layout(page: Page): Promise<Layout> {
  return page.evaluate(() => {
    const area = document.querySelector<HTMLElement>('.projects');
    const none = document.querySelector<HTMLElement>('.no-project');
    const first = document.querySelector<HTMLElement>('.project-node');
    const scrollers = [...(none?.querySelectorAll<HTMLElement>('*') ?? [])].filter((node) => node.getClientRects().length > 0 && ['auto', 'scroll'].includes(getComputedStyle(node).overflowY));
    return {
      noneInside: area !== null && none !== null && area.contains(none),
      noneAboveFirstProject: none !== null && first !== null && none.getBoundingClientRect().top < first.getBoundingClientRect().top,
      nestedScrollers: scrollers.map((node) => `${node.tagName}.${node.className}`),
    };
  });
}

async function endsAreReachable(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const area = document.querySelector<HTMLElement>('.projects');
    const rows = area?.querySelectorAll('.no-project .agent-item');
    const last = rows?.item(rows.length - 1);
    const nodes = area?.querySelectorAll('.project-node');
    const lastNode = nodes?.item(nodes.length - 1);
    if (!area || !last || !lastNode) return false;
    const outer = area.getBoundingClientRect();
    area.scrollTop = area.scrollHeight;
    const nodeReached = lastNode.getBoundingClientRect().bottom <= outer.bottom + 1;
    area.scrollTop = 0;
    last.scrollIntoView({ block: 'nearest' });
    const inner = last.getBoundingClientRect();
    return nodeReached && inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;
  });
}

test('No project is the first node of the one scrolling projects list, which fills the sidebar height and never overlaps the bottom block', async () => {
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
      await expect(page.locator('.projects [data-project-id] .agent-item')).toHaveCount(count);
    }
    await expect(page.locator('[data-project="no-project-toggle"]')).toHaveAttribute('aria-expanded', 'false');
    await page.locator('[data-project="no-project-toggle"]').click();
    for (let count = 1; count <= 4; count += 1) {
      await page.locator('[data-project="no-project"] .add-button').click();
      await page.locator('.menu-item[data-kind="codex"]').click();
      await expect(page.locator('.no-project .agent-item')).toHaveCount(count);
    }

    await resize(app, 900);
    await expect.poll(async () => (await geometry(page)).windowHeight).toBe(900);
    const tall = await geometry(page);
    expect(tall.projectsScroll).toBeGreaterThan(0);
    expect(tall.projectsHeight).toBeGreaterThan(tall.windowHeight * 0.4 + 1);
    expect(tall.scrollbarWidth).toBeGreaterThan(0);
    expect(tall.projectsBottom).toBeLessThanOrEqual(tall.accountTop + 1);
    expect(await layout(page)).toEqual({ noneInside: true, noneAboveFirstProject: true, nestedScrollers: [] });

    await resize(app, 500);
    await expect.poll(async () => (await geometry(page)).windowHeight).toBe(500);
    const small = await geometry(page);
    expect(small.projectsScroll).toBeGreaterThan(0);
    expect(small.scrollbarWidth).toBeGreaterThan(0);
    expect(small.projectsBottom).toBeLessThanOrEqual(small.accountTop + 1);
    expect(small.themeBottom).toBeLessThanOrEqual(small.windowHeight + 1);
    expect(await layout(page)).toEqual({ noneInside: true, noneAboveFirstProject: true, nestedScrollers: [] });
    expect(await endsAreReachable(page)).toBe(true);
  } finally {
    await app.close();
  }
});
