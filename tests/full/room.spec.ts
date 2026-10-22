// room.spec.ts
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
const stubCli = path.join(root, 'tests', 'fixtures', 'stub-cli.mjs');
const TURN_BUDGET_MS = 5000;
const RUN_BASE_MS = 5000;
const PARTICIPANTS = ['claude', 'codex'];
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

function finishedWithin(participants: number, rounds: number): { timeout: number } {
  return { timeout: (participants * rounds + 1) * TURN_BUDGET_MS + RUN_BASE_MS };
}

async function fill(page: Page, mode: 'broadcast' | 'relay', rounds: number, prompt: string): Promise<void> {
  await field(page, 'prompt').fill(prompt);
  for (const id of PARTICIPANTS) await page.locator(`input[data-participant="${id}"]`).check();
  await field(page, 'mode').selectOption(mode);
  await field(page, 'rounds').fill(String(rounds));
}

async function run(page: Page, mode: 'broadcast' | 'relay', rounds: number, prompt: string): Promise<void> {
  await fill(page, mode, rounds, prompt);
  await field(page, 'start').click();
  await expect(field(page, 'status')).toContainText('done', finishedWithin(PARTICIPANTS.length, rounds));
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
    await expect(field(page, 'banner')).toHaveText('Done \u2014 final answer from Claude Code', finishedWithin(PARTICIPANTS.length, 2));
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
    await expect(field(page, 'status')).toContainText('done', finishedWithin(PARTICIPANTS.length, 1));
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
    setTimeout(() => say('assistant', 'LATE-REPLY from the late chat page'), 60);
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
    await expect(field(page, 'status')).toContainText('done', finishedWithin(1, 1));
    expect(await historyHeadings(page)).toEqual(['Owner | prompt', 'DeepSeek | reply', 'DeepSeek | final']);
    await expect(page.locator('.room-entry.kind-reply .room-entry-text').first()).toContainText('LATE-REPLY');
  } finally {
    await second.close();
    server.close();
  }
});

const SAME_ANSWER = ['SAME-ANSWER line one', 'SAME-ANSWER line two', 'SAME-ANSWER line three'];

const REMEMBERING_SITE = `<!doctype html>
<html><head><meta charset="utf-8"><title>remembering chat</title></head>
<body>
<main id="log" style="white-space: pre-wrap"></main>
<textarea aria-label="Message"></textarea>
<button type="button" id="send" disabled>Send</button>
<button type="button" id="stop" hidden>Stop</button>
<script>
const ta = document.querySelector('textarea');
const send = document.getElementById('send');
const stop = document.getElementById('stop');
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
  setTimeout(() => say('assistant', ${JSON.stringify(SAME_ANSWER.join('\n'))}), 60);
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
</script>
</body></html>`;

function firstReplyIn(historyFile: string): string {
  const match = /kind=reply>>>\n([\s\S]*?)\n<<<end-/.exec(readFileSync(historyFile, 'utf8'));
  return match?.[1] ?? '';
}

async function historyFileOf(page: Page): Promise<string> {
  const status = (await field(page, 'status').textContent()) ?? '';
  return status.split('History: ')[1]?.trim() ?? '';
}

test('a second run opens a new chat and its reply is complete although identical to the first', async () => {
  let loads = 0;
  const server = createServer((_request, response) => {
    loads += 1;
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(REMEMBERING_SITE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const { app, page } = await open({ AIAW_SITE_URL_DEEPSEEK: `http://127.0.0.1:${port}/` });
  try {
    await page.locator('button[aria-haspopup="menu"]').click();
    await page.locator('.menu-item[data-kind="deepseek"]').click();
    await page.locator('[data-room="open"]').click();
    await expect(page.locator('[data-room="pane"]')).toBeVisible();
    await field(page, 'prompt').fill('same question');
    await page.locator('input[data-participant="deepseek"]').check();
    await field(page, 'mode').selectOption('broadcast');
    await field(page, 'rounds').fill('1');
    await field(page, 'start').click();
    await expect(field(page, 'status')).toContainText('done', finishedWithin(1, 1));
    const firstFile = await historyFileOf(page);
    const loadsAfterFirst = loads;
    expect(firstReplyIn(firstFile)).toBe(SAME_ANSWER.join('\n'));
    await field(page, 'start').click();
    await expect(async () => {
      const file = await historyFileOf(page);
      expect(file).not.toBe('');
      expect(file).not.toBe(firstFile);
    }).toPass({ timeout: 10000 });
    await expect(field(page, 'status')).toContainText('done', finishedWithin(1, 1));
    const secondFile = await historyFileOf(page);
    expect(loads).toBeGreaterThan(loadsAfterFirst);
    expect(firstReplyIn(secondFile)).toBe(SAME_ANSWER.join('\n'));
  } finally {
    await app.close();
    server.close();
  }
});

test('the feed is grouped by round, entries are collapsed spoilers, the final is open and both Copy buttons put the whole final text into the clipboard', async () => {
  const { app, page } = await open();
  try {
    await run(page, 'relay', 2, 'spoiler question');
    const sections = page.locator('[data-room="feed"] [data-section]');
    expect(await sections.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-section')))).toEqual(['prompt', 'round-1', 'round-2', 'final']);
    const first = page.locator('[data-section="round-1"] details.room-entry').first();
    await expect(first).toHaveJSProperty('open', false);
    expect(await page.locator('[data-section="round-2"] details.room-entry').count()).toBe(2);
    await first.locator('summary').click();
    await expect(first).toHaveJSProperty('open', true);
    const others = page.locator('details.room-entry.kind-reply');
    expect(await others.evaluateAll((nodes) => nodes.map((node) => (node as HTMLDetailsElement).open))).toEqual([true, false, false, false]);
    const final = page.locator('[data-section="final"] details.room-entry.kind-final');
    await expect(final).toHaveJSProperty('open', true);
    const expected = (await final.locator('.room-entry-text').textContent()) ?? '';
    expect(expected.length).toBeGreaterThan(0);
    const buttons = final.locator('button[data-room="copy-final"]');
    await expect(buttons).toHaveCount(2);
    const order = await final.locator('*').evaluateAll((nodes) => nodes.map((node) => (node.matches('button[data-room="copy-final"]') ? 'b' : node.matches('.room-entry-text') ? 't' : '')).filter((x) => x !== ''));
    expect(order).toEqual(['b', 't', 'b']);
    for (const index of [0, 1]) {
      await app.evaluate(({ clipboard }) => clipboard.writeText('sentinel'));
      await buttons.nth(index).click();
      await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(expected);
    }
  } finally {
    await app.close();
  }
});

test('a new entry does not close or rebuild an entry the owner opened', async () => {
  const { app, page } = await open();
  try {
    await fill(page, 'relay', 2, 'open survives');
    await field(page, 'start').click();
    const first = page.locator('details.room-entry.kind-reply').first();
    await first.waitFor({ state: 'attached', timeout: finishedWithin(PARTICIPANTS.length, 2).timeout });
    await first.locator('summary').click();
    await first.evaluate((node) => node.setAttribute('data-mark', 'kept'));
    await expect(field(page, 'status')).toContainText('done', finishedWithin(PARTICIPANTS.length, 2));
    await expect(first).toHaveAttribute('data-mark', 'kept');
    await expect(first).toHaveJSProperty('open', true);
  } finally {
    await app.close();
  }
});
