// generic-adapter.test.ts
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';
import { createGenericAdapter } from '../../src/main/site-adapters/generic-adapter';
import { adapterFor } from '../../src/main/site-adapters/registry';
import { runAdapterTurn } from '../../src/main/site-adapters/turn';
import { SiteAdapterError, type PageRunner } from '../../src/main/site-adapters/types';
import { SITE_KINDS_WITH_ADAPTER } from '../../src/shared/agents';

const FIXTURE = readFileSync(new URL('../fixtures/sites/composer.html', import.meta.url), 'utf8');
const MARKUP = '<img src=x onerror="window.pwned=1"><b>bold</b>\nsecond & line';
const FAST = { timeoutMs: 4000, pollMs: 10, settleMs: 30, startGraceMs: 600 };
const OPTIONS = { quietMs: 130, submitCheckMs: 40, maxReplyChars: 1_000_000 };

type Page = { dom: JSDOM; runner: PageRunner; win: JSDOM['window'] & Record<string, number> };
const opened: JSDOM[] = [];

function openPage(search = ''): Page {
  const dom = new JSDOM(FIXTURE, { runScripts: 'dangerously', url: `https://fixture.test/${search}` });
  opened.push(dom);
  const runner: PageRunner = { run: (code) => Promise.resolve(dom.window.eval(code)) };
  return { dom, runner, win: dom.window as Page['win'] };
}

afterEach(() => {
  for (const dom of opened.splice(0)) dom.window.close();
});

function log(page: Page): string[] {
  return Array.from(page.dom.window.document.querySelectorAll('#log .msg')).map((node) => node.textContent ?? '');
}

describe('generic adapter: insert', () => {
  it.each([['?composer=textarea'], ['?composer=editable'], ['?composer=editable&exec=1'], ['?composer=editable&badexec=1']])(
    'inserts markup as literal text into the visible composer %s',
    async (search) => {
      const page = openPage(search);
      const adapter = createGenericAdapter('fixture', OPTIONS);
      await adapter.insertText(page.runner, MARKUP);
      const doc = page.dom.window.document;
      const held = search.includes('editable')
        ? Array.from(doc.querySelectorAll('#ce p')).map((row) => row.textContent).join('\n')
        : doc.querySelector<HTMLTextAreaElement>('#ta')?.value;
      expect(held).toBe(MARKUP);
      expect(doc.querySelectorAll('img, b, script[src]').length).toBe(0);
      expect(page.win['pwned']).toBeUndefined();
      expect(doc.querySelector<HTMLTextAreaElement>('#decoy')?.value).toBe('');
    },
  );

  it('replaces what the composer held before', async () => {
    const page = openPage('?composer=editable');
    const adapter = createGenericAdapter('fixture', OPTIONS);
    await adapter.insertText(page.runner, 'first\nsecond');
    await adapter.insertText(page.runner, 'third');
    expect(page.dom.window.document.querySelector('#ce')?.textContent).toBe('third');
  });

  it('reports a page without a visible composer', async () => {
    const page = openPage();
    page.dom.window.document.querySelector('#ta')?.setAttribute('hidden', '');
    const adapter = createGenericAdapter('fixture', OPTIONS);
    await expect(adapter.insertText(page.runner, 'x')).rejects.toMatchObject({ code: 'input-missing' });
  });
});

describe('generic adapter: composer readiness', () => {
  it('is ready when a visible composer exists and not ready when it is absent or hidden', async () => {
    const adapter = createGenericAdapter('fixture', OPTIONS);
    const page = openPage();
    expect(await adapter.composerReady?.(page.runner)).toBe(true);
    page.dom.window.document.querySelector('#ta')?.setAttribute('hidden', '');
    expect(await adapter.composerReady?.(page.runner)).toBe(false);
    page.dom.window.document.body.replaceChildren();
    expect(await adapter.composerReady?.(page.runner)).toBe(false);
  });

  it('is not ready while the page cannot run scripts yet', async () => {
    const adapter = createGenericAdapter('fixture', OPTIONS);
    const runner: PageRunner = { run: () => Promise.reject(new Error('Script failed to execute')) };
    expect(await adapter.composerReady?.(runner)).toBe(false);
  });

  it('does not hide a closed page', async () => {
    const adapter = createGenericAdapter('fixture', OPTIONS);
    const runner: PageRunner = { run: () => Promise.reject(new SiteAdapterError('page-gone', 'the page is closed')) };
    await expect(adapter.composerReady?.(runner)).rejects.toMatchObject({ code: 'page-gone' });
  });
});

describe('generic adapter: submit', () => {
  it('presses Enter on the composer and clicks nothing else', async () => {
    const page = openPage();
    const adapter = createGenericAdapter('fixture', OPTIONS);
    await adapter.insertText(page.runner, 'hello');
    await adapter.submit(page.runner);
    expect(page.win['submissions']).toBe(1);
    expect(page.win['attachClicks']).toBe(0);
    expect(page.win['micClicks']).toBe(0);
  });

  it('falls back to the send button next to the composer when Enter does nothing', async () => {
    const page = openPage('?noenter=1');
    const adapter = createGenericAdapter('fixture', OPTIONS);
    await adapter.insertText(page.runner, 'hello');
    await adapter.submit(page.runner);
    expect(page.win['submissions']).toBe(1);
    expect(page.win['attachClicks']).toBe(0);
    expect(page.win['micClicks']).toBe(0);
  });

  it('does not click the button again when the page was only slow to accept Enter', async () => {
    const page = openPage();
    const adapter = createGenericAdapter('fixture', { ...OPTIONS, submitCheckMs: 5 });
    await adapter.insertText(page.runner, 'once');
    await adapter.submit(page.runner);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(page.win['submissions']).toBe(1);
  });

  it('fails with a typed error when neither Enter nor an enabled button submits', async () => {
    const page = openPage('?noenter=1&sendoff=1');
    const adapter = createGenericAdapter('fixture', OPTIONS);
    await adapter.insertText(page.runner, 'hello');
    await expect(adapter.submit(page.runner)).rejects.toMatchObject({ code: 'submit-unavailable' });
    expect(page.win['submissions']).toBe(0);
    expect(page.win['attachClicks']).toBe(0);
  });
});

describe('generic adapter: turn', () => {
  it.each([
    ['textarea with a stop button', '?composer=textarea'],
    ['contenteditable with a stop button', '?composer=editable'],
    ['textarea without a stop button', '?composer=textarea&nostop=1'],
    ['contenteditable submitted by the button', '?composer=editable&noenter=1&exec=1'],
  ])('reads the whole streamed reply of a %s', async (_name, search) => {
    const page = openPage(search);
    const adapter = createGenericAdapter('fixture', OPTIONS);
    const reply = await runAdapterTurn(adapter, page.runner, 'one\ntwo', FAST);
    expect(reply).toBe('ECHO: one two part-2 part-3');
    expect(log(page)).toHaveLength(3);
  });

  it('takes the text after the prompt only: no sidebar, no footer, no earlier messages', async () => {
    const page = openPage();
    const adapter = createGenericAdapter('fixture', OPTIONS);
    const first = await runAdapterTurn(adapter, page.runner, 'alpha', FAST);
    const second = await runAdapterTurn(adapter, page.runner, 'beta', FAST);
    expect(first).toBe('ECHO: alpha part-2 part-3');
    expect(second).toBe('ECHO: beta part-2 part-3');
    for (const reply of [first, second]) {
      expect(reply).not.toContain('Chat ');
      expect(reply).not.toContain('mistakes');
      expect(reply).not.toContain('Welcome');
    }
  });

  it('finishes a repeated identical prompt, whose text is also inside the earlier reply', async () => {
    const page = openPage();
    const adapter = createGenericAdapter('fixture', OPTIONS);
    expect(await runAdapterTurn(adapter, page.runner, 'same', FAST)).toBe('ECHO: same part-2 part-3');
    expect(await runAdapterTurn(adapter, page.runner, 'same', FAST)).toBe('ECHO: same part-2 part-3');
  });

  it('returns reply markup as text', async () => {
    const page = openPage();
    const adapter = createGenericAdapter('fixture', OPTIONS);
    const reply = await runAdapterTurn(adapter, page.runner, '<b>x</b> & y', FAST);
    expect(reply).toBe('ECHO: <b>x</b> & y part-2 part-3');
  });

  it('never returns more than the reply limit', async () => {
    const page = openPage();
    const adapter = createGenericAdapter('fixture', { ...OPTIONS, maxReplyChars: 12 });
    expect(await runAdapterTurn(adapter, page.runner, 'limit', FAST)).toBe('ECHO: limit ');
  });

  it('fails with no-response when the page never answers', async () => {
    const page = openPage('?silent=1');
    const adapter = createGenericAdapter('fixture', OPTIONS);
    await expect(runAdapterTurn(adapter, page.runner, 'hi', { ...FAST, startGraceMs: 250 })).rejects.toMatchObject({
      code: 'no-response',
    });
  });

  it('times out when the reply keeps growing', async () => {
    const page = openPage('?stall=1&nostop=1');
    const adapter = createGenericAdapter('fixture', OPTIONS);
    await expect(runAdapterTurn(adapter, page.runner, 'hi', { ...FAST, timeoutMs: 500 })).rejects.toMatchObject({
      code: 'timeout',
    });
  });

  it('waits while a stop button is shown even when the text is still', async () => {
    const page = openPage('?stall=1');
    page.dom.window.document.querySelector('#stop')?.removeAttribute('hidden');
    const adapter = createGenericAdapter('fixture', OPTIONS);
    await adapter.insertText(page.runner, 'x');
    await adapter.submit(page.runner);
    expect(await adapter.isGenerating(page.runner)).toBe(true);
  });

  it('reads nothing before a prompt was submitted', async () => {
    const page = openPage();
    const adapter = createGenericAdapter('fixture', OPTIONS);
    expect(await adapter.lastReply(page.runner)).toBeNull();
    expect(await adapter.isGenerating(page.runner)).toBe(false);
  });
});

describe('generic adapter: files and registry', () => {
  it('hands the file to the page-wide file input', async () => {
    const page = openPage();
    const calls: Array<[string, string[]]> = [];
    const adapter = createGenericAdapter('fixture', OPTIONS);
    await adapter.attachFile({ ...page.runner, setInputFiles: (s, p) => (calls.push([s, p]), Promise.resolve()) }, '/tmp/h.md');
    expect(calls).toEqual([['input[type="file"]', ['/tmp/h.md']]]);
    await expect(adapter.attachFile(page.runner, '/tmp/h.md')).rejects.toMatchObject({ code: 'attach-unsupported' });
  });

  it('the registry gives every web site its own adapter instance', () => {
    expect([...SITE_KINDS_WITH_ADAPTER].sort()).toEqual(['chatgpt', 'deepseek', 'grok']);
    for (const kind of SITE_KINDS_WITH_ADAPTER) {
      const first = adapterFor(kind);
      expect(first?.site).toBe(kind);
      expect(adapterFor(kind)).not.toBe(first);
    }
  });
});
