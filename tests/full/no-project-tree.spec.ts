// no-project-tree.spec.ts
import { _electron as electron, expect, test, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
const SECTIONS = ['rooms', 'agents'] as const;

interface Edges {
  rowToggle: number;
  sectionToggle: number;
  title: number;
  add: number;
  inside: boolean;
}

async function edges(page: Page, nodeSelector: string, section: string): Promise<Edges> {
  return page.evaluate(
    ({ nodeSelector: nodeSel, section: name }) => {
      const node = document.querySelector(nodeSel);
      const part = node?.querySelector(`[data-project-section="${name}"]`) ?? null;
      const left = (target: Element | null | undefined): number => target?.getBoundingClientRect().left ?? -1;
      return {
        rowToggle: left(node?.querySelector('.project-row .project-toggle, .project-row [data-project="no-project-toggle"]')),
        sectionToggle: left(part?.querySelector('.project-section-toggle')),
        title: left(part?.querySelector('.project-section-title')),
        add: left(part?.querySelector('.project-agent-add')),
        inside: part !== null && node !== null && node.contains(part),
      };
    },
    { nodeSelector, section },
  );
}

test('the No project node nests its Rooms and Agents sections exactly like a project node', async () => {
  test.setTimeout(120_000);
  const base = mkdtempSync(path.join(tmpdir(), 'aiaw-no-project-tree-'));
  const folder = path.join(base, 'code', 'tree-app');
  mkdirSync(folder, { recursive: true });
  const app = await electron.launch({
    args: [root],
    env: { ...process.env, AIAW_USER_DATA: path.join(base, 'profile'), AIAW_TEST_FOLDER: JSON.stringify([folder, null]) },
  });
  try {
    const page = await app.firstWindow();
    await page.locator('[data-project="add"]').click();
    await page.locator('[data-project="add-existing"]').click();
    await expect(page.locator('[data-project="tree"] [data-project-id]')).toHaveCount(1);
    const project = '[data-project="tree"] [data-project-id]';
    const none = '[data-project="no-project"]';
    for (const section of SECTIONS) {
      const own = await edges(page, project, section);
      const loose = await edges(page, none, section);
      expect(loose.inside).toBe(true);
      expect(own.inside).toBe(true);
      expect(loose.sectionToggle).toBeGreaterThan(loose.rowToggle);
      expect(loose.sectionToggle - loose.rowToggle).toBe(own.sectionToggle - own.rowToggle);
      expect(loose.title - loose.sectionToggle).toBe(own.title - own.sectionToggle);
      expect(loose.add).toBeGreaterThan(loose.title);
    }
    for (const section of SECTIONS) {
      const part = page.locator(`${none} [data-project-section="${section}"]`);
      const toggle = part.locator('.project-section-toggle');
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(part.locator(section === 'rooms' ? '.rooms-list' : '.agent-list')).toBeHidden();
      await toggle.click();
      await expect(part.locator(section === 'rooms' ? '.rooms-list' : '.agent-list')).toBeVisible();
    }
    const parent = page.locator(`${none} [data-project="no-project-toggle"]`);
    await parent.click();
    for (const section of SECTIONS) await expect(page.locator(`${none} [data-project-section="${section}"]`)).toBeHidden();
    await parent.click();
    for (const section of SECTIONS) await expect(page.locator(`${none} [data-project-section="${section}"]`)).toBeVisible();
  } finally {
    await app.close();
  }
});
