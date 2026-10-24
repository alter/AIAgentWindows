// projects-plan.spec.ts
import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
const stubCli = path.join(root, 'tests', 'fixtures', 'stub-cli.mjs');
const RUN_MS = 40_000;

function field(page: Page, name: string): Locator {
  return page.locator(`[data-room="${name}"]`);
}

test('Save plan writes the final text into docs/plans of the project, asks before replacing and puts the old file in the Trash', async () => {
  test.setTimeout(240_000);
  const base = mkdtempSync(path.join(tmpdir(), 'aiaw-save-plan-'));
  const folder = path.join(base, 'code', 'plan-app');
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, 'README.md'), 'synthetic project\n');
  const real = realpathSync(folder);
  const profile = path.join(base, 'profile');
  const app = await electron.launch({
    args: [root],
    env: {
      ...process.env,
      AIAW_USER_DATA: profile,
      AIAW_ROOM_FAST: '1',
      AIAW_CLAUDE_BIN: stubCli,
      AIAW_CODEX_BIN: stubCli,
      AIAW_TEST_FOLDER: JSON.stringify([folder, null]),
      CLAUDE_CONFIG_DIR: path.join(base, 'claude'),
      CODEX_HOME: path.join(base, 'codex'),
    },
  });
  try {
    const page = await app.firstWindow();
    await page.locator('[data-room="open"]').click();
    await field(page, 'prompt').fill('A question outside any project');
    await field(page, 'mode').selectOption('relay');
    await field(page, 'rounds').fill('1');
    await field(page, 'start').click();
    await expect(field(page, 'status')).toContainText('done', { timeout: RUN_MS });
    const looseFinal = page.locator('[data-section="final"] details.room-entry.kind-final');
    await expect(looseFinal.locator('button[data-room="copy-final"]')).toHaveCount(2);
    await expect(looseFinal.locator('button[data-room="save-plan"]')).toHaveCount(0);

    await page.locator('[data-project="add"]').click();
    await page.locator('[data-project="add-existing"]').click();
    await page.locator('[data-project="create"]').click();
    await page.locator('[data-project="tree"] [data-project-id] [data-project="add-room"]').click();
    await field(page, 'prompt').fill('Plan the import feature');
    await field(page, 'mode').selectOption('relay');
    await field(page, 'rounds').fill('1');
    await field(page, 'start').click();
    await expect(field(page, 'status')).toContainText('done', { timeout: RUN_MS });
    const final = page.locator('[data-section="final"] details.room-entry.kind-final');
    const expected = (await final.locator('.room-entry-text').textContent()) ?? '';
    expect(expected.length).toBeGreaterThan(0);
    const save = final.locator('button[data-room="save-plan"]');
    await expect(save).toHaveCount(1);

    await save.click();
    await expect(field(page, 'plan-note')).toContainText('Saved to');
    const plans = path.join(real, 'docs', 'plans');
    const files = readdirSync(plans);
    expect(files).toHaveLength(1);
    const saved = path.join(plans, files[0] ?? '');
    expect(files[0]).toMatch(/^[\p{L}\p{N}-]+\.md$/u);
    expect(readFileSync(saved, 'utf8')).toBe(expected);
    expect(readdirSync(real).sort()).toEqual(['README.md', 'docs']);
    expect(readdirSync(path.join(real, 'docs'))).toEqual(['plans']);

    writeFileSync(saved, 'edited by hand');
    await save.click();
    await expect(field(page, 'plan-confirm')).toBeVisible();
    await field(page, 'plan-cancel').click();
    await expect(field(page, 'plan-confirm')).toBeHidden();
    expect(readFileSync(saved, 'utf8')).toBe('edited by hand');
    expect(existsSync(path.join(profile, 'trash'))).toBe(false);

    await save.click();
    await expect(field(page, 'plan-confirm')).toBeVisible();
    await field(page, 'plan-replace').click();
    await expect(field(page, 'plan-note')).toContainText('Saved to');
    await expect(field(page, 'plan-confirm')).toBeHidden();
    expect(readFileSync(saved, 'utf8')).toBe(expected);
    const trashed = readdirSync(path.join(profile, 'trash'));
    expect(trashed).toHaveLength(1);
    expect(readFileSync(path.join(profile, 'trash', trashed[0] ?? ''), 'utf8')).toBe('edited by hand');
    expect(readdirSync(plans)).toEqual(files);
  } finally {
    await app.close();
  }
});
