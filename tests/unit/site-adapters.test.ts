// site-adapters.test.ts
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { createSelectorAdapter } from '../../src/main/site-adapters/selector-adapter';
import { createIsolatedRunner } from '../../src/main/site-adapters/isolated-runner';
import { SiteAdapterError, runAdapterTurn } from '../../src/main/site-adapters/turn';
import type { PageRunner, SelectorSet } from '../../src/main/site-adapters/types';

const FIXTURE = readFileSync(new URL('../fixtures/sites/generic.html', import.meta.url), 'utf8');
const MARKUP = '<img src=x onerror="window.pwned=1"><b>bold</b>\nsecond & line';

const PROMPT_AREA: SelectorSet = {
  input: '#ta',
  submit: '#send',
  stop: '#stop',
  replies: '.msg.assistant',
  fileInput: '#file',
};
const PROMPT_EDITABLE: SelectorSet = { ...PROMPT_AREA, input: '#ce' };

function openPage(search = ''): { dom: JSDOM; runner: PageRunner } {
  const dom = new JSDOM(FIXTURE, { runScripts: 'dangerously', url: `https://fixture.test/${search}` });
  const runner: PageRunner = { run: (code) => Promise.resolve(dom.window.eval(code)) };
  return { dom, runner };
}

const FAST = { timeoutMs: 3000, pollMs: 10, settleMs: 40, startGraceMs: 500 };

describe('selector adapter', () => {
  it('inserts markup as literal text', async () => {
    const { dom, runner } = openPage();
    const area = createSelectorAdapter('fixture', PROMPT_AREA);
    await area.insertText(runner, MARKUP);
    const textarea = dom.window.document.querySelector<HTMLTextAreaElement>('#ta');
    expect(textarea?.value).toBe(MARKUP);

    const editable = createSelectorAdapter('fixture', PROMPT_EDITABLE);
    await editable.insertText(runner, MARKUP);
    const field = dom.window.document.querySelector('#ce');
    expect(field?.querySelector('img, b, script')).toBeNull();
    expect(field?.textContent).toContain('<img src=x onerror="window.pwned=1"><b>bold</b>');
    expect((dom.window as unknown as { pwned?: number }).pwned).toBeUndefined();
    expect(dom.window.document.querySelectorAll('img, b').length).toBe(0);
  });

  it('replaces what the input held before', async () => {
    const { dom, runner } = openPage();
    const adapter = createSelectorAdapter('fixture', PROMPT_EDITABLE);
    await adapter.insertText(runner, 'first');
    await adapter.insertText(runner, 'second');
    expect(dom.window.document.querySelector('#ce')?.textContent).toBe('second');
  });

  it('reports a missing input and an unavailable submit as typed errors', async () => {
    const { runner } = openPage();
    const missing = createSelectorAdapter('fixture', { ...PROMPT_AREA, input: '#nope' });
    await expect(missing.insertText(runner, 'x')).rejects.toMatchObject({ code: 'input-missing' });
    const adapter = createSelectorAdapter('fixture', PROMPT_AREA);
    await expect(adapter.submit(runner)).rejects.toMatchObject({ code: 'submit-unavailable' });
  });

  it('submits through the button and reads the generating state and the last reply', async () => {
    const { runner } = openPage();
    const adapter = createSelectorAdapter('fixture', PROMPT_AREA);
    expect(await adapter.lastReply(runner)).toBeNull();
    await adapter.insertText(runner, 'hello');
    await adapter.submit(runner);
    expect(await adapter.isGenerating(runner)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await adapter.isGenerating(runner)).toBe(false);
    expect(await adapter.lastReply(runner)).toBe('ECHO: hello');
  });

  it('submits with Enter when the site has no submit button selector', async () => {
    const { runner } = openPage();
    const adapter = createSelectorAdapter('fixture', { ...PROMPT_EDITABLE, submit: undefined });
    await adapter.insertText(runner, 'by enter');
    await adapter.submit(runner);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await adapter.lastReply(runner)).toBe('ECHO: by enter');
  });

  it('hands files to the runner for the file input selector', async () => {
    const { runner } = openPage();
    const calls: Array<[string, string[]]> = [];
    const adapter = createSelectorAdapter('fixture', PROMPT_AREA);
    await adapter.attachFile({ ...runner, setInputFiles: (s, p) => (calls.push([s, p]), Promise.resolve()) }, '/tmp/h.md');
    expect(calls).toEqual([['#file', ['/tmp/h.md']]]);
    await expect(adapter.attachFile(runner, '/tmp/h.md')).rejects.toMatchObject({ code: 'attach-unsupported' });
    const noInput = createSelectorAdapter('fixture', { ...PROMPT_AREA, fileInput: undefined });
    await expect(noInput.attachFile({ ...runner, setInputFiles: () => Promise.resolve() }, '/x')).rejects.toMatchObject({
      code: 'attach-unsupported',
    });
  });
});

describe('adapter turn', () => {
  it('inserts, submits, waits for the end of generation and returns the new reply', async () => {
    const { runner } = openPage();
    const adapter = createSelectorAdapter('fixture', PROMPT_EDITABLE);
    const first = await runAdapterTurn(adapter, runner, 'one', FAST);
    expect(first).toBe('ECHO: one');
    const second = await runAdapterTurn(adapter, runner, 'two\nlines', FAST);
    expect(second).toBe('ECHO: two\nlines');
  });

  it('finishes a repeated identical reply because generation was seen', async () => {
    const { runner } = openPage();
    const adapter = createSelectorAdapter('fixture', PROMPT_AREA);
    expect(await runAdapterTurn(adapter, runner, 'same', FAST)).toBe('ECHO: same');
    expect(await runAdapterTurn(adapter, runner, 'same', FAST)).toBe('ECHO: same');
  });

  it('times out with an error when the reply never comes', async () => {
    const { runner } = openPage('?stall=1');
    const adapter = createSelectorAdapter('fixture', PROMPT_AREA);
    const started = Date.now();
    const failure = runAdapterTurn(adapter, runner, 'stuck', { ...FAST, timeoutMs: 300 });
    await expect(failure).rejects.toBeInstanceOf(SiteAdapterError);
    await expect(failure).rejects.toMatchObject({ code: 'timeout' });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('fails when the page never starts to answer within the grace time', async () => {
    const { runner } = openPage();
    const adapter = createSelectorAdapter('fixture', { ...PROMPT_AREA, replies: '.msg.never', stop: '#never' });
    await expect(
      runAdapterTurn(adapter, runner, 'silent', { ...FAST, startGraceMs: 120, timeoutMs: 2000 }),
    ).rejects.toMatchObject({ code: 'no-response' });
  });
});

describe('isolated world runner', () => {
  it('runs code in one isolated world and returns the value', async () => {
    const seen: Array<{ world: number; code: string }> = [];
    const contents = {
      executeJavaScriptInIsolatedWorld: (world: number, scripts: Array<{ code: string }>) => {
        seen.push({ world, code: scripts[0]?.code ?? '' });
        return Promise.resolve('{"ok":true}');
      },
      isDestroyed: () => false,
    };
    const runner = createIsolatedRunner(contents);
    expect(await runner.run('1+1')).toBe('{"ok":true}');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.world).toBeGreaterThanOrEqual(1000);
    expect(seen[0]?.code).toBe('1+1');
  });

  it('refuses to run on a destroyed page', async () => {
    const contents = {
      executeJavaScriptInIsolatedWorld: () => Promise.resolve(null),
      isDestroyed: () => true,
    };
    await expect(createIsolatedRunner(contents).run('1')).rejects.toMatchObject({ code: 'page-gone' });
  });
});
