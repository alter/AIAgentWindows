// room-layout.spec.ts
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { addParticipant, openSetup, rowIds, setupBox, setupIsOpen, table, tableRow, tableRows } from './room-table-helpers';

const root = path.resolve(__dirname, '..', '..');
const stubCli = path.join(root, 'tests', 'fixtures', 'stub-cli.mjs');
const TURN_BUDGET_MS = 5000;
const RUN_BASE_MS = 5000;
const PARTICIPANTS = ['claude', 'codex'];
const MARKUP = '<img src=x onerror="window.__pwned=1"><b>bold</b>';

interface Session {
  app: ElectronApplication;
  page: Page;
}

function newBase(): string {
  return mkdtempSync(path.join(tmpdir(), 'aiaw-layout-'));
}

async function launch(base: string): Promise<Session> {
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
  const page = await app.firstWindow();
  return { app, page };
}

function field(page: Page, name: string): Locator {
  return page.locator(`[data-room="${name}"]`);
}

function treeItems(page: Page): Locator {
  return page.locator('[data-room="tree"] [data-room-id]');
}

function titleInRecord(base: string): string | undefined {
  const dir = path.join(base, 'profile', 'shared', 'rooms');
  const names = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.json')) : [];
  expect(names).toHaveLength(1);
  const record = JSON.parse(readFileSync(path.join(dir, names[0] as string), 'utf8')) as { title?: string };
  return record.title;
}

async function finishOneRoom(page: Page): Promise<void> {
  await field(page, 'open').click();
  await expect(field(page, 'pane')).toBeVisible();
  await field(page, 'prompt').fill('layout question');
  await field(page, 'mode').selectOption('broadcast');
  await field(page, 'rounds').fill('1');
  await field(page, 'start').click();
  await expect(field(page, 'status')).toContainText('done', { timeout: (PARTICIPANTS.length + 1) * TURN_BUDGET_MS + RUN_BASE_MS });
  await expect(treeItems(page)).toHaveCount(1);
}

async function renameFromTree(page: Page, title: string, commit: boolean): Promise<void> {
  await treeItems(page).first().click({ button: 'right' });
  await field(page, 'rename').click();
  const input = field(page, 'rename-input');
  await expect(input).toBeFocused();
  await input.fill(title);
  await input.press(commit ? 'Enter' : 'Escape');
  await expect(input).toHaveCount(0);
}

test('a room renamed from the tree keeps its title after an app restart and opens from the tree', async () => {
  const base = newBase();
  const first = await launch(base);
  try {
    await finishOneRoom(first.page);
    await expect(treeItems(first.page).first()).toHaveText('layout question');
    await renameFromTree(first.page, 'Discarded name', false);
    await expect(treeItems(first.page).first()).toHaveText('layout question');
    expect(titleInRecord(base)).toBeUndefined();
    await renameFromTree(first.page, 'Kept name', true);
    await expect(treeItems(first.page).first()).toHaveText('Kept name');
    await expect.poll(() => titleInRecord(base)).toBe('Kept name');
  } finally {
    await first.app.close();
  }
  expect(titleInRecord(base)).toBe('Kept name');

  const second = await launch(base);
  const { page } = second;
  try {
    await expect(treeItems(page)).toHaveCount(1);
    await expect(treeItems(page).first()).toHaveText('Kept name');
    await treeItems(page).first().click();
    await expect(field(page, 'pane')).toBeVisible();
    await expect(treeItems(page).first()).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('.room-entry').first()).toBeVisible();
    await expect(field(page, 'start')).toHaveText('Continue');
  } finally {
    await second.app.close();
  }
});

test('the header collapses the tree and reports it', async () => {
  const base = newBase();
  const { app, page } = await launch(base);
  try {
    await finishOneRoom(page);
    const toggle = field(page, 'tree-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(treeItems(page)).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(treeItems(page)).toHaveCount(1);
  } finally {
    await app.close();
  }
});

test('markup in a room title is shown as text', async () => {
  const base = newBase();
  const first = await launch(base);
  try {
    await finishOneRoom(first.page);
    await renameFromTree(first.page, MARKUP, true);
    await expect.poll(() => titleInRecord(base)).toBe(MARKUP);
    await expect(treeItems(first.page).first()).toHaveText(MARKUP);
    await expect(field(first.page, 'tree').locator('img, b')).toHaveCount(0);
    await treeItems(first.page).first().click();
    await expect(field(first.page, 'title')).toHaveText(MARKUP);
    await expect(first.page.locator('[data-room="pane"] h2 :is(img, b)')).toHaveCount(0);
    expect(await first.page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  } finally {
    await first.app.close();
  }
});

function authorsInRecord(base: string): string[] {
  const dir = path.join(base, 'profile', 'shared', 'rooms');
  const names = readdirSync(dir).filter((name) => name.endsWith('.md'));
  expect(names).toHaveLength(1);
  return readFileSync(path.join(dir, names[0] as string), 'utf8')
    .split('\n')
    .map((line) => /^<<<entry-\w+ author="(.*)" time=\S+ kind=(\w+)>>>$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null && match[2] === 'reply')
    .map((match) => match[1] as string);
}

async function activeRowField(page: Page): Promise<string> {
  return page.evaluate(() => {
    const node = document.activeElement as HTMLElement | null;
    return `${node?.closest('tr')?.dataset['row'] ?? ''}:${node?.dataset['rowField'] ?? ''}`;
  });
}

test('three participant rows reordered with the buttons are relayed in the table order', async () => {
  const base = newBase();
  const { app, page } = await launch(base);
  try {
    await field(page, 'open').click();
    await expect(field(page, 'pane')).toBeVisible();
    await addParticipant(page, 'claude');
    await tableRow(page, 'claude-2').locator('[data-row-field="model"]').fill('sonnet');
    expect(await rowIds(page)).toEqual(['claude', 'codex', 'claude-2']);
    const up = (id: string): Locator => tableRow(page, id).locator('[data-row-field="up"]');
    const down = (id: string): Locator => tableRow(page, id).locator('[data-row-field="down"]');
    await expect(up('claude')).toBeDisabled();
    await expect(down('claude-2')).toBeDisabled();
    await up('claude-2').click();
    await up('claude-2').click();
    expect(await rowIds(page)).toEqual(['claude-2', 'claude', 'codex']);
    expect(await activeRowField(page)).toBe('claude-2:down');
    await expect(up('claude-2')).toBeDisabled();
    await down('claude-2').press('Enter');
    expect(await rowIds(page)).toEqual(['claude', 'claude-2', 'codex']);
    expect(await activeRowField(page)).toBe('claude-2:down');
    await down('claude-2').press('Space');
    expect(await rowIds(page)).toEqual(['claude', 'codex', 'claude-2']);
    await up('codex').click();
    await down('claude').click();
    expect(await rowIds(page)).toEqual(['codex', 'claude-2', 'claude']);
    await expect(tableRow(page, 'claude-2').locator('[data-row-field="model"]')).toHaveValue('sonnet');
    await field(page, 'prompt').fill('order question');
    await field(page, 'mode').selectOption('relay');
    await field(page, 'rounds').fill('1');
    await field(page, 'start').click();
    await expect(field(page, 'status')).toContainText('done', { timeout: (3 + 1) * TURN_BUDGET_MS + RUN_BASE_MS });
    expect(authorsInRecord(base)).toEqual(['Codex', 'Claude Code \u00b7 sonnet', 'Claude Code']);
  } finally {
    await app.close();
  }
});

test('the Add participant menu works from the keyboard and disables a site that is already a row', async () => {
  const { app, page } = await launch(newBase());
  try {
    await field(page, 'open').click();
    await expect(field(page, 'pane')).toBeVisible();
    const trigger = field(page, 'add-participant');
    const items = field(page, 'add-menu').locator('[role="menuitem"]');
    await trigger.focus();
    await page.keyboard.press('ArrowDown');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(items).toHaveCount(6);
    await expect(items.first()).toBeFocused();
    await page.keyboard.press('End');
    await expect(items.last()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(field(page, 'add-menu')).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.press('Enter');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(3)).toBeFocused();
    await page.keyboard.press('Enter');
    expect(await rowIds(page)).toEqual(['claude', 'codex', 'grok']);
    await expect(trigger).toBeFocused();
    await expect(tableRow(page, 'grok').locator('[data-row-field="model"]')).toHaveCount(0);
    await trigger.press('Enter');
    const grok = field(page, 'add-menu').locator('[data-add="grok"]');
    await expect(grok).toHaveAttribute('aria-disabled', 'true');
    await expect(grok).not.toHaveText('Grok');
    await grok.click({ force: true });
    expect(await rowIds(page)).toEqual(['claude', 'codex', 'grok']);
    await expect(field(page, 'add-menu').locator('[data-add="claude"]')).not.toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');
  } finally {
    await app.close();
  }
});

test('a table is read as a table: headers with scope, buttons named after the row, focus kept after a move and a removal', async () => {
  const { app, page } = await launch(newBase());
  try {
    await field(page, 'open').click();
    await expect(field(page, 'pane')).toBeVisible();
    await expect(table(page).locator('thead th[scope="col"]')).toHaveCount(7);
    await tableRow(page, 'claude').locator('[data-row-field="model"]').fill('opus');
    await expect(tableRow(page, 'claude').locator('[data-row-field="up"]')).toHaveAttribute('aria-label', /Claude Code · opus/);
    await expect(tableRow(page, 'claude').locator('[data-row-field="remove"]')).toHaveAttribute('aria-label', /Claude Code · opus/);
    await addParticipant(page, 'chatgpt');
    expect(await rowIds(page)).toEqual(['claude', 'codex', 'chatgpt']);
    await tableRow(page, 'codex').locator('[data-row-field="remove"]').focus();
    await page.keyboard.press('Enter');
    expect(await rowIds(page)).toEqual(['claude', 'chatgpt']);
    expect(await activeRowField(page)).toBe('chatgpt:remove');
    await page.keyboard.press('Enter');
    expect(await rowIds(page)).toEqual(['claude']);
    expect(await activeRowField(page)).toBe('claude:remove');
    await page.keyboard.press('Enter');
    await expect(tableRows(page)).toHaveCount(0);
    await expect(field(page, 'add-participant')).toBeFocused();
  } finally {
    await app.close();
  }
});

test('a final radio and the debug checkbox toggle by click and by Space', async () => {
  const base = newBase();
  const { app, page } = await launch(base);
  try {
    await field(page, 'open').click();
    await expect(field(page, 'pane')).toBeVisible();
    const finalRadio = (id: string): Locator => tableRow(page, id).locator('[data-row-field="final"]');
    await expect(finalRadio('claude')).toBeChecked();
    await finalRadio('codex').click();
    await expect(finalRadio('codex')).toBeChecked();
    await expect(finalRadio('claude')).not.toBeChecked();
    await finalRadio('claude').focus();
    await page.keyboard.press('Space');
    await expect(finalRadio('claude')).toBeChecked();
    await expect(finalRadio('codex')).not.toBeChecked();

    const debug = field(page, 'debug-sites');
    await expect(debug).not.toBeChecked();
    await debug.click();
    await expect(debug).toBeChecked();
    await debug.focus();
    await page.keyboard.press('Space');
    await expect(debug).not.toBeChecked();
    await page.keyboard.press('Space');
    await expect(debug).toBeChecked();
  } finally {
    await app.close();
  }
});

test('the setup closes on start and opens by click', async () => {
  const base = newBase();
  const { app, page } = await launch(base);
  try {
    await field(page, 'open').click();
    await expect(field(page, 'pane')).toBeVisible();
    expect(await setupIsOpen(page)).toBe(true);
    await expect(tableRows(page)).toHaveCount(PARTICIPANTS.length);
    await field(page, 'prompt').fill('setup question');
    await field(page, 'mode').selectOption('broadcast');
    await field(page, 'rounds').fill('1');
    await field(page, 'start').click();
    await expect.poll(() => setupIsOpen(page)).toBe(false);
    await expect(field(page, 'stop')).toBeEnabled();
    await expect(field(page, 'start')).toBeDisabled();
    await expect(table(page)).toBeHidden();
    await setupBox(page).locator('summary').click();
    await expect.poll(() => setupIsOpen(page)).toBe(true);
    await expect(table(page)).toBeVisible();
    await expect(field(page, 'rounds')).toBeDisabled();
    await setupBox(page).locator('summary').click();
    await expect.poll(() => setupIsOpen(page)).toBe(false);
    await expect(field(page, 'status')).toContainText('done', { timeout: (PARTICIPANTS.length + 1) * TURN_BUDGET_MS + RUN_BASE_MS });
    expect(await setupIsOpen(page)).toBe(false);
    await openSetup(page);
    await expect(field(page, 'rounds')).toBeEnabled();
  } finally {
    await app.close();
  }
});

test('a refused start leaves the setup as it was', async () => {
  const base = newBase();
  const { app, page } = await launch(base);
  try {
    await field(page, 'open').click();
    await expect(field(page, 'pane')).toBeVisible();
    await field(page, 'prompt').fill('');
    await field(page, 'start').click();
    await expect(field(page, 'message')).not.toHaveText('');
    expect(await setupIsOpen(page)).toBe(true);
  } finally {
    await app.close();
  }
});

test('a saved room with entries opens with the setup closed and a new room opens it', async () => {
  const base = newBase();
  const first = await launch(base);
  try {
    await finishOneRoom(first.page);
  } finally {
    await first.app.close();
  }
  const second = await launch(base);
  const { page } = second;
  try {
    await expect(treeItems(page)).toHaveCount(1);
    await treeItems(page).first().click();
    await expect(field(page, 'pane')).toBeVisible();
    await expect(page.locator('.room-entry').first()).toBeVisible();
    expect(await setupIsOpen(page)).toBe(false);
    await field(page, 'new').click();
    await expect.poll(() => setupIsOpen(page)).toBe(true);
  } finally {
    await second.app.close();
  }
});
