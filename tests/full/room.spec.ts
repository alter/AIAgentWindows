// room.spec.ts
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
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
      'Claude Code | final',
    ]);
    await expect(page.locator('.room-entry.kind-reply')).toHaveCount(4);
    await expect(page.locator('.room-entry.kind-final')).toHaveCount(1);
  } finally {
    await app.close();
  }
});

test('a 2-round relay shows each round, the final turn, per-participant chips and the finished banner', async () => {
  const { app, page } = await open();
  try {
    await fill(page, 'relay', 2, 'progress question');
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { __rounds: string[] }).__rounds = seen;
      const node = document.querySelector('[data-room="round"]');
      const note = (): void => {
        const text = node?.textContent ?? '';
        if (text !== '' && seen[seen.length - 1] !== text) seen.push(text);
      };
      new MutationObserver(note).observe(node as Node, { childList: true, characterData: true, subtree: true });
    });
    await field(page, 'start').click();
    await expect(field(page, 'banner')).toHaveText('Done \u2014 final answer from Claude Code');
    const rounds = await page.evaluate(() => (window as unknown as { __rounds: string[] }).__rounds);
    expect(rounds).toEqual(['Round 1 of 2', 'Round 2 of 2', 'Final: Claude Code']);
    await expect(field(page, 'remaining')).toHaveText('0 turns left');
    const chips = page.locator('[data-room="chips"] [data-participant]');
    await expect(chips).toHaveCount(1);
    await expect(chips.first()).toHaveAttribute('data-state', 'answered');
  } finally {
    await app.close();
  }
});

test('the finalizer lists the ticked participants, defaults to Claude Code and writes the final answer', async () => {
  const { app, page } = await open();
  try {
    await fill(page, 'relay', 1, 'finalizer question');
    const options = field(page, 'finalizer').locator('option');
    await expect(options).toHaveText(['Claude Code', 'Codex']);
    await expect(field(page, 'finalizer')).toHaveValue('claude');
    await field(page, 'finalizer').selectOption('codex');
    await page.locator('input[data-participant="claude"]').uncheck();
    await expect(options).toHaveText(['Codex']);
    await page.locator('input[data-participant="claude"]').check();
    await field(page, 'finalizer').selectOption('codex');
    await field(page, 'start').click();
    await expect(field(page, 'status')).toContainText('done');
    expect(await historyHeadings(page)).toEqual(['Owner | prompt', 'Claude Code | reply', 'Codex | reply', 'Codex | final']);
    await expect(page.locator('.room-entry.kind-final')).toHaveCount(1);
  } finally {
    await app.close();
  }
});

test('every settings label precedes its control and rounds stays enabled in both modes', async () => {
  const { app, page } = await open();
  try {
    for (const name of ['mode', 'rounds', 'timeout']) {
      const info = await field(page, name).evaluate((control) => {
        const label = control.closest('label');
        const text = label?.querySelector('span');
        return {
          labelled: label !== null && text !== null && text !== undefined,
          labelFirst: text ? Boolean(text.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING) : false,
          text: text?.textContent ?? '',
        };
      });
      expect(info.labelled, name).toBe(true);
      expect(info.labelFirst, name).toBe(true);
      if (name === 'timeout') expect(info.text).toMatch(/min/i);
    }
    for (const mode of ['broadcast', 'relay'] as const) {
      await field(page, 'mode').selectOption(mode);
      await expect(field(page, 'rounds')).toBeEnabled();
    }
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
    expect(headings.slice(1).sort()).toEqual(['Claude Code | final', 'Claude Code | reply', 'Codex | reply']);
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
    await expect(field(page, 'banner')).toHaveText('Stopped');
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

const LATE_SITE = `<!doctype html>
<html><head><meta charset="utf-8"><title>late chat</title></head>
<body>
<main id="log"></main>
<script>
setTimeout(() => {
  const ta = document.createElement('textarea');
  ta.setAttribute('aria-label', 'Message');
  const send = document.createElement('button');
  send.type = 'button';
  send.textContent = 'Send';
  send.disabled = true;
  const stop = document.createElement('button');
  stop.type = 'button';
  stop.textContent = 'Stop';
  stop.hidden = true;
  const log = document.getElementById('log');
  const say = (role, text) => {
    const node = document.createElement('div');
    node.className = 'msg ' + role;
    node.textContent = text;
    log.appendChild(node);
  };
  const submit = () => {
    const text = ta.value;
    if (text === '') return;
    ta.value = '';
    send.disabled = true;
    say('user', text);
    stop.hidden = false;
    const n = log.querySelectorAll('.assistant').length;
    setTimeout(() => say('assistant', n === 0 ? 'LATE-REPLY' : 'LATE-REPLY again ' + n), 60);
    setTimeout(() => { stop.hidden = true; }, 90);
  };
  ta.addEventListener('input', () => { send.disabled = ta.value === ''; });
  ta.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  });
  send.addEventListener('click', submit);
  document.body.append(ta, send, stop);
}, 1500);
</script>
</body></html>`;

test('a web participant whose view was never opened answers on its first turn', async () => {
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(LATE_SITE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const base = mkdtempSync(path.join(tmpdir(), 'aiaw-room-site-'));
  const profile = path.join(base, 'profile');
  const env = {
    ...process.env,
    AIAW_USER_DATA: profile,
    AIAW_ROOM_FAST: '1',
    AIAW_CLAUDE_BIN: stubCli,
    AIAW_CODEX_BIN: stubCli,
    AIAW_TEST_FOLDER: mkdtempSync(path.join(base, 'folder-')),
    CLAUDE_CONFIG_DIR: path.join(base, 'claude'),
    CODEX_HOME: path.join(base, 'codex'),
    AIAW_SITE_URL_DEEPSEEK: `http://127.0.0.1:${port}/`,
  };
  const first = await electron.launch({ args: [root], env });
  try {
    const page = await first.firstWindow();
    for (const kind of ['claude', 'deepseek']) {
      await page.locator('button[aria-haspopup="menu"]').click();
      await page.locator(`.menu-item[data-kind="${kind}"]`).click();
    }
    await expect(page.locator('.agent-item')).toHaveCount(2);
  } finally {
    await first.close();
  }
  const second = await electron.launch({ args: [root], env });
  try {
    const page = await second.firstWindow();
    await expect(page.locator('.agent-item')).toHaveCount(2);
    await page.locator('[data-room="open"]').click();
    await expect(page.locator('[data-room="pane"]')).toBeVisible();
    const views = await second.evaluate(({ webContents }) => webContents.getAllWebContents().map((item) => item.getURL()));
    expect(views.filter((url) => url.startsWith('http://127.0.0.1'))).toEqual([]);
    await field(page, 'prompt').fill('first turn question');
    await page.locator('input[data-participant="deepseek"]').check();
    await field(page, 'mode').selectOption('broadcast');
    await field(page, 'rounds').fill('1');
    await field(page, 'start').click();
    await expect(field(page, 'status')).toContainText('done');
    expect(await historyHeadings(page)).toEqual(['Owner | prompt', 'DeepSeek | reply', 'DeepSeek | final']);
    await expect(page.locator('.room-entry.kind-reply .room-entry-text').first()).toContainText('LATE-REPLY');
  } finally {
    await second.close();
    server.close();
  }
});
