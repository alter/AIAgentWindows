// room-archive.spec.ts
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
const stubCli = path.join(root, 'tests', 'fixtures', 'stub-cli.mjs');
const TURN_BUDGET_MS = 5000;
const RUN_BASE_MS = 5000;
const PARTICIPANTS = ['claude', 'codex'];

interface Session {
  app: ElectronApplication;
  page: Page;
}

interface RecordShape {
  status: string;
  entries: { label: string; kind: string; text: string }[];
}

function newBase(): string {
  return mkdtempSync(path.join(tmpdir(), 'aiaw-archive-'));
}

async function launch(base: string, extraEnv: Record<string, string> = {}): Promise<Session> {
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
      ...extraEnv,
    },
  });
  const page = await app.firstWindow();
  return { app, page };
}

async function openRoom(page: Page): Promise<void> {
  await page.locator('[data-room="open"]').click();
  await expect(page.locator('[data-room="pane"]')).toBeVisible();
}

function field(page: Page, name: string): Locator {
  return page.locator(`[data-room="${name}"]`);
}

function treeItems(page: Page): Locator {
  return page.locator('[data-room="tree"] [data-room-id]');
}

function finishedWithin(participants: number, rounds: number): { timeout: number } {
  return { timeout: (participants * rounds + 1) * TURN_BUDGET_MS + RUN_BASE_MS };
}

async function fill(page: Page, rounds: number, prompt: string): Promise<void> {
  await field(page, 'prompt').fill(prompt);
  await field(page, 'mode').selectOption('relay');
  await field(page, 'rounds').fill(String(rounds));
}

function roomFiles(base: string): { md: string; json: string } {
  const dir = path.join(base, 'profile', 'shared', 'rooms');
  const names = existsSync(dir) ? readdirSync(dir) : [];
  const json = names.filter((name) => name.endsWith('.json'));
  const md = names.filter((name) => name.endsWith('.md'));
  expect(json).toHaveLength(1);
  expect(md).toHaveLength(1);
  return { md: path.join(dir, md[0] as string), json: path.join(dir, json[0] as string) };
}

function readRecord(file: string): RecordShape {
  return JSON.parse(readFileSync(file, 'utf8')) as RecordShape;
}

function mdHeadings(file: string): string[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => /^<<<entry-\w+ author="(.*)" time=\S+ kind=(\w+)>>>$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => `${match[1]} | ${match[2]}`);
}

test('a finished room survives an app restart, is reopened from the list and continues after its old entries', async () => {
  const base = newBase();
  const first = await launch(base);
  try {
    await openRoom(first.page);
    await fill(first.page, 1, 'first question');
    await field(first.page, 'start').click();
    await expect(field(first.page, 'status')).toContainText('done', finishedWithin(PARTICIPANTS.length, 1));
  } finally {
    await first.app.close();
  }
  const files = roomFiles(base);
  const headingsBefore = mdHeadings(files.md);
  expect(headingsBefore.length).toBeGreaterThan(1);
  expect(readRecord(files.json).entries).toHaveLength(headingsBefore.length);

  const second = await launch(base);
  const { page } = second;
  try {
    await page.locator('.add-button').click();
    await page.locator('.menu-item[data-kind="claude"]').click();
    await expect(page.locator('.agent-item')).toHaveCount(1);
    await expect(treeItems(page)).toHaveCount(1);
    await treeItems(page).first().click();
    await expect(page.locator('[data-room="pane"]')).toBeVisible();
    await expect(treeItems(page).first()).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('.room-entry')).toHaveCount(headingsBefore.length);
    await expect(field(page, 'status')).toContainText('done');
    await expect(field(page, 'carry-target').locator('option')).toHaveCount(1);
    await expect(field(page, 'carry-final')).toBeEnabled();
    await expect(field(page, 'carry-history')).toBeEnabled();
    await expect(field(page, 'start')).toHaveText('Continue');

    await field(page, 'prompt').fill('second question');
    await field(page, 'start').click();
    await expect(page.locator('.room-entry')).not.toHaveCount(headingsBefore.length);
    await expect(field(page, 'status')).toContainText('done', finishedWithin(PARTICIPANTS.length, 1));
  } finally {
    await second.app.close();
  }
  const after = roomFiles(base);
  expect(after).toEqual(files);
  const headingsAfter = mdHeadings(after.md);
  expect(headingsAfter.slice(0, headingsBefore.length)).toEqual(headingsBefore);
  expect(headingsAfter.length).toBeGreaterThan(headingsBefore.length);
  const record = readRecord(after.json);
  expect(record.status).toBe('done');
  expect(record.entries.map((entry) => `${entry.label} | ${entry.kind}`)).toEqual(headingsAfter);
  const prompts = record.entries.filter((entry) => entry.kind === 'prompt').map((entry) => entry.text);
  expect(prompts).toEqual(['first question', 'second question']);
});

test('a run cut by closing the app mid-turn reopens as stopped with the replies written before the close', async () => {
  const base = newBase();
  const slow = { AIAW_STUB_REPLY_DELAY_MS: '2500' };
  const first = await launch(base, slow);
  try {
    await openRoom(first.page);
    await fill(first.page, 3, 'long question');
    await field(first.page, 'start').click();
    await expect(first.page.locator('.room-entry.kind-reply')).toHaveCount(1, { timeout: 15_000 });
  } finally {
    await first.app.close();
  }
  const files = roomFiles(base);
  const written = readRecord(files.json).entries.filter((entry) => entry.kind === 'reply').length;
  expect(written).toBeGreaterThanOrEqual(1);

  const second = await launch(base, slow);
  const { page } = second;
  try {
    await openRoom(page);
    await expect(field(page, 'status')).toContainText('stopped');
    await expect(page.locator('.room-entry.kind-reply')).toHaveCount(written);
    await expect(field(page, 'start')).toBeEnabled();
    await expect(field(page, 'start')).toHaveText('Continue');
  } finally {
    await second.app.close();
  }
  const record = readRecord(files.json);
  expect(record.status).toBe('stopped');
  expect(record.entries.filter((entry) => entry.kind === 'reply')).toHaveLength(written);
});
