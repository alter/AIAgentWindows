// room.spec.ts
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
const stubCli = path.join(root, 'tests', 'fixtures', 'stub-cli.mjs');
const MARKUP = '<img src=x onerror="window.__pwned=1"><b>bold</b>';

interface Session {
  app: ElectronApplication;
  page: Page;
  base: string;
}

async function open(extraEnv: Record<string, string> = {}): Promise<Session> {
  const base = mkdtempSync(path.join(tmpdir(), 'aiaw-room-'));
  const app = await electron.launch({
    args: [root],
    env: {
      ...process.env,
      AIAW_USER_DATA: path.join(base, 'profile'),
      AIAW_ROOM_FAST: '1',
      AIAW_CLAUDE_BIN: stubCli,
      AIAW_CODEX_BIN: stubCli,
      AIAW_TEST_FOLDER: mkdtempSync(path.join(base, 'folder-')),
      CLAUDE_CONFIG_DIR: path.join(base, 'claude'),
      CODEX_HOME: path.join(base, 'codex'),
      ...extraEnv,
    },
  });
  const page = await app.firstWindow();
  await page.locator('[data-room="open"]').click();
  await expect(page.locator('[data-room="pane"]')).toBeVisible();
  return { app, page, base };
}

function field(page: Page, name: string): Locator {
  return page.locator(`[data-room="${name}"]`);
}

async function fill(page: Page, mode: 'broadcast' | 'relay', rounds: number, prompt: string): Promise<void> {
  await field(page, 'prompt').fill(prompt);
  for (const id of ['claude', 'codex']) await page.locator(`input[data-participant="${id}"]`).check();
  await field(page, 'mode').selectOption(mode);
  await field(page, 'rounds').fill(String(rounds));
}

async function run(page: Page, mode: 'broadcast' | 'relay', rounds: number, prompt: string): Promise<void> {
  await fill(page, mode, rounds, prompt);
  await field(page, 'start').click();
  await expect(field(page, 'status')).toContainText('done');
}

async function historyHeadings(page: Page): Promise<string[]> {
  const status = (await field(page, 'status').textContent()) ?? '';
  const file = status.split('History: ')[1]?.trim() ?? '';
  expect(file).toMatch(/\.md$/);
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => /^<<<entry-\w+ author="(.*)" time=\S+ kind=(\w+)>>>$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => `${match[1]} | ${match[2]}`);
}

test('a relay of two stub participants for 2 rounds writes the history in the relay order', async () => {
  const { app, page } = await open();
  try {
    await run(page, 'relay', 2, 'relay question');
    expect(await historyHeadings(page)).toEqual([
      'Owner | prompt',
      'Claude Code | reply',
      'Codex | reply',
      'Claude Code | reply',
      'Codex | reply',
    ]);
    await expect(page.locator('.room-entry.kind-reply')).toHaveCount(4);
  } finally {
    await app.close();
  }
});

test('a broadcast sends the prompt to every participant once', async () => {
  const { app, page } = await open();
  try {
    await run(page, 'broadcast', 1, 'broadcast question');
    const headings = await historyHeadings(page);
    expect(headings[0]).toBe('Owner | prompt');
    expect(headings.slice(1).sort()).toEqual(['Claude Code | reply', 'Codex | reply']);
  } finally {
    await app.close();
  }
});

test('Stop in the middle ends the run at the current step', async () => {
  const { app, page } = await open({ AIAW_STUB_REPLY_DELAY_MS: '1500' });
  try {
    await fill(page, 'relay', 3, 'long question');
    await field(page, 'start').click();
    await expect(page.locator('.room-entry.kind-reply')).toHaveCount(1);
    await field(page, 'stop').click();
    await expect(field(page, 'status')).toContainText('stopped');
    expect(await page.locator('.room-entry.kind-reply').count()).toBeLessThan(6);
    const headings = await historyHeadings(page);
    expect(headings.some((heading) => heading.startsWith('Room | error'))).toBe(true);
  } finally {
    await app.close();
  }
});

test('a carried result is pasted into the working session and not submitted', async () => {
  const { app, page } = await open({ AIAW_STUB_REPLY: 'CARRY-ME-PLEASE' });
  try {
    await page.locator('button[aria-haspopup="menu"]').click();
    await page.locator('.menu-item[data-kind="claude"]').click();
    await expect(page.locator('.agent-item')).toHaveCount(1);
    await expect(page.locator('.xterm-rows')).toContainText('STUB-CLI BANNER');
    await page.locator('[data-room="open"]').click();
    await run(page, 'relay', 1, 'carry question');
    await expect(field(page, 'carry-target').locator('option')).toHaveCount(1);
    await field(page, 'carry-final').click();
    await expect(field(page, 'message')).toContainText('not submitted');
    await page.locator('.agent-item').first().click();
    await expect(page.locator('.terminal-pane:not([hidden]) .xterm-rows')).toContainText('CARRY-ME-PLEASE');
    await expect(page.locator('.terminal-pane:not([hidden]) .xterm-rows')).not.toContainText('SUBMITTED:');
  } finally {
    await app.close();
  }
});

test('markup in a reply is shown as text', async () => {
  const { app, page } = await open({ AIAW_STUB_REPLY: MARKUP });
  try {
    await run(page, 'broadcast', 1, 'markup question');
    const reply = page.locator('.room-entry.kind-reply .room-entry-text').first();
    await expect(reply).toHaveText(MARKUP);
    await expect(page.locator('[data-room="feed"] img, [data-room="feed"] b')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  } finally {
    await app.close();
  }
});

test('a folder trust dialog pauses the run, shows the terminal, and Resume finishes the same step', async () => {
  const { app, page, base } = await open({ AIAW_STUB_DIALOG: 'trust' });
  try {
    await field(page, 'prompt').fill('trust question');
    await page.locator('input[data-participant="claude"]').check();
    await field(page, 'mode').selectOption('broadcast');
    await field(page, 'rounds').fill('1');
    await field(page, 'start').click();
    await expect(field(page, 'resume')).toBeVisible();
    await expect(field(page, 'pause-note')).toContainText('accept the folder once');
    await expect(field(page, 'terminals').locator('.xterm-rows')).toContainText('I trust this folder');
    await expect(page.locator('.room-entry.kind-reply')).toHaveCount(0);
    const folder = path.join(base, 'profile', 'shared', 'rooms', 'claude-1');
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, '.aiaw-stub-trusted'), '');
    await field(page, 'resume').click();
    await expect(field(page, 'status')).toContainText('done');
    await expect(page.locator('.room-entry.kind-reply')).toHaveCount(1);
    await expect(field(page, 'pause')).toBeHidden();
  } finally {
    await app.close();
  }
});
