// room-participants.spec.ts
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { addParticipant, removeParticipant, rowIds } from './room-table-helpers';

const root = path.resolve(__dirname, '..', '..');
const stubCli = path.join(root, 'tests', 'fixtures', 'stub-cli.mjs');
const TURN_BUDGET_MS = 5000;
const RUN_BASE_MS = 5000;
const ROUNDS = 2;

interface Instance {
  id: string;
  label: string;
  model: string;
  effort: string;
}

const FIRST: Instance = { id: 'claude', label: 'Claude Code · opus · high', model: 'opus', effort: 'high' };
const SECOND: Instance = { id: 'claude-2', label: 'Claude Code · sonnet · medium', model: 'sonnet', effort: 'medium' };

interface Session {
  app: ElectronApplication;
  page: Page;
}

function launch(base: string): Promise<Session> {
  return electron
    .launch({
      args: [root],
      env: {
        ...process.env,
        AIAW_USER_DATA: path.join(base, 'profile'),
        AIAW_ROOM_FAST: '1',
        AIAW_CLAUDE_BIN: stubCli,
        AIAW_CODEX_BIN: stubCli,
        AIAW_STUB_ARGV_LOG: path.join(base, 'argv.log'),
        AIAW_TEST_FOLDER: path.join(base, 'folder'),
        CLAUDE_CONFIG_DIR: path.join(base, 'claude'),
        CODEX_HOME: path.join(base, 'codex'),
      },
    })
    .then(async (app) => {
      const page = await app.firstWindow();
      await page.locator('[data-room="open"]').click();
      await expect(page.locator('[data-room="pane"]')).toBeVisible();
      return { app, page };
    });
}

function field(page: Page, name: string): Locator {
  return page.locator(`[data-room="${name}"]`);
}

function row(page: Page, id: string): Locator {
  return page.locator(`[data-row="${id}"]`);
}

async function configure(page: Page, instance: Instance): Promise<void> {
  const target = row(page, instance.id);
  await target.locator('[data-row-field="model"]').fill(instance.model);
  await expect(target.locator(`[data-row-field="effort"] option[value="${instance.effort}"]`)).toHaveCount(1);
  await target.locator('[data-row-field="effort"]').selectOption(instance.effort);
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

function flagValue(argv: string[], flag: string): string {
  const at = argv.indexOf(flag);
  return at < 0 ? 'missing' : (argv[at + 1] ?? 'missing');
}

function turnArgs(base: string): { model: string; effort: string }[] {
  const file = path.join(base, 'argv.log');
  expect(existsSync(file)).toBe(true);
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as { argv: string[]; info?: boolean })
    .filter((entry) => entry.info !== true && entry.argv.includes('-p'))
    .map(({ argv }) => ({
      model: flagValue(argv, '--model'),
      effort: flagValue(argv, '--effort'),
    }));
}

test('two stub Claude instances relay for 2 rounds with their own labels, models and efforts, and the reopened room shows the same rows', async () => {
  const base = mkdtempSync(path.join(tmpdir(), 'aiaw-participants-'));
  const first = await launch(base);
  try {
    const { page } = first;
    await removeParticipant(page, 'codex');
    await addParticipant(page, 'claude');
    await expect(row(page, SECOND.id)).toBeVisible();
    expect(await rowIds(page)).toEqual([FIRST.id, SECOND.id]);
    await configure(page, FIRST);
    await configure(page, SECOND);
    await field(page, 'prompt').fill('two instances');
    await field(page, 'mode').selectOption('relay');
    await field(page, 'rounds').fill(String(ROUNDS));
    await field(page, 'start').click();
    await expect(field(page, 'status')).toContainText('done', { timeout: (3 * ROUNDS + 1) * TURN_BUDGET_MS + RUN_BASE_MS });

    const headings = await historyHeadings(page);
    const authors = headings.map((heading) => heading.split(' | ')[0]);
    expect(headings[0]).toBe('Owner | prompt');
    expect(authors.slice(1, 5)).toEqual([FIRST.label, SECOND.label, FIRST.label, SECOND.label]);

    const byLabel = new Map([FIRST, SECOND].map((item) => [item.label, { model: item.model, effort: item.effort }]));
    const expected = authors.slice(1).map((label) => byLabel.get(label ?? ''));
    expect(turnArgs(base)).toEqual(expected);
  } finally {
    await first.app.close();
  }

  const second = await launch(base);
  try {
    const { page } = second;
    for (const instance of [FIRST, SECOND]) {
      const target = row(page, instance.id);
      await expect(target).toBeVisible();
      await expect(target.locator('[data-row-field="model"]')).toHaveValue(instance.model);
      await expect(target.locator('[data-row-field="effort"]')).toHaveValue(instance.effort);
    }
  } finally {
    await second.app.close();
  }
});
