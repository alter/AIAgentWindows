// generic-adapter.test.ts
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { freshTrack, judgeGenerating, STREAM_QUIET_CAP_MS } from '../../src/main/site-adapters/decide';
import { createGenericAdapter } from '../../src/main/site-adapters/generic-adapter';
import { genericEnterScript } from '../../src/main/site-adapters/generic-scripts';
import { adapterFor } from '../../src/main/site-adapters/registry';
import { createStreamTracker } from '../../src/main/site-adapters/stream-state';
import { runAdapterTurn } from '../../src/main/site-adapters/turn';
import { SiteAdapterError, type PageRunner } from '../../src/main/site-adapters/types';
import { SITE_KINDS_WITH_ADAPTER } from '../../src/shared/agents';
import { SCRIPT_PROMPT, scriptedPage, type ScriptedFrame } from './helpers/scripted-page';

const FIXTURE = readFileSync(new URL('../fixtures/sites/composer.html', import.meta.url), 'utf8');
const MARKUP = '<img src=x onerror="window.pwned=1"><b>bold</b>\nsecond & line';
const FAST = { timeoutMs: 4000, pollMs: 10, settleMs: 30, startGraceMs: 600 };
const OPTIONS = { quietMs: 130, confirmMs: 300, confirmPollMs: 10, maxReplyChars: 1_000_000 };

type Page = { dom: JSDOM; runner: PageRunner; win: JSDOM['window'] & Record<string, number> };
const opened: JSDOM[] = [];

function openPage(search = '', visual = false): Page {
  const dom = new JSDOM(FIXTURE, { runScripts: 'dangerously', url: `https://fixture.test/${search}`, pretendToBeVisual: visual });
  opened.push(dom);
  const runner: PageRunner = { run: (code) => Promise.resolve(dom.window.eval(code)) };
  return { dom, runner, win: dom.window as Page['win'] };
}

function withTrustedEnter(page: Page): { runner: PageRunner; sent: () => number } {
  let count = 0;
  const runner: PageRunner = {
    ...page.runner,
    sendEnter: () => {
      count += 1;
      (page.dom.window as unknown as { trustedKey: boolean }).trustedKey = true;
      const target = page.dom.window.document.activeElement ?? page.dom.window.document.body;
      target.dispatchEvent(new page.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      return Promise.resolve();
    },
  };
  return { runner, sent: () => count };
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
    const adapter = createGenericAdapter('fixture', { ...OPTIONS, confirmMs: 5 });
    await adapter.insertText(page.runner, 'once');
    await adapter.submit(page.runner);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(page.win['submissions']).toBe(1);
  });

  it('fails as not-submitted when neither Enter, an enabled button nor a trusted Enter submits', async () => {
    const page = openPage('?noenter=1&sendoff=1');
    const adapter = createGenericAdapter('fixture', OPTIONS);
    await adapter.insertText(page.runner, 'hello');
    await expect(adapter.submit(page.runner)).rejects.toMatchObject({ code: 'not-submitted' });
    expect(page.win['submissions']).toBe(0);
    expect(page.win['attachClicks']).toBe(0);
  });

  it('presses a trusted Enter on the focused composer when the page ignores both a synthetic Enter and the send button', async () => {
    const page = openPage('?trustedonly=1');
    const trusted = withTrustedEnter(page);
    const adapter = createGenericAdapter('fixture', OPTIONS);
    await adapter.insertText(trusted.runner, 'hello');
    await adapter.submit(trusted.runner);
    expect(trusted.sent()).toBe(1);
    expect(page.win['submissions']).toBe(1);
    expect(adapter.trace?.()).toMatchObject({ submit: 'trusted' });
  });

  it('fails as not-submitted when even a trusted Enter leaves the composer full', async () => {
    const page = openPage('?noenter=1&sendoff=1');
    const trusted = withTrustedEnter(page);
    const adapter = createGenericAdapter('fixture', OPTIONS);
    await adapter.insertText(trusted.runner, 'hello');
    await expect(adapter.submit(trusted.runner)).rejects.toMatchObject({ code: 'not-submitted' });
    expect(trusted.sent()).toBe(1);
  });

  it('never presses the trusted Enter or the button after a confirmed submission', async () => {
    const page = openPage();
    const trusted = withTrustedEnter(page);
    const adapter = createGenericAdapter('fixture', OPTIONS);
    await adapter.insertText(trusted.runner, 'hello');
    await adapter.submit(trusted.runner);
    expect(trusted.sent()).toBe(0);
    expect(page.win['submissions']).toBe(1);
  });

  it('submits through the composer it filled when a second composer sits elsewhere on the page', async () => {
    const page = openPage('?second=1');
    const adapter = createGenericAdapter('fixture', OPTIONS);
    await adapter.insertText(page.runner, 'hello');
    expect(page.dom.window.document.querySelector<HTMLTextAreaElement>('#extra-ta')?.value).toBe('');
    expect(page.dom.window.document.querySelector<HTMLTextAreaElement>('#ta')?.value).toBe('hello');
    await adapter.submit(page.runner);
    expect(page.win['submissions']).toBe(1);
    expect(adapter.trace?.()).toMatchObject({ visibleComposers: 2 });
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

  it('keeps the site\'s fixed labels, the echoed prompt and entry markers out of the reply', async () => {
    const prompt = [
      'You are DeepSeek in a room where several AI agents take turns.',
      '<<<entry-abc123 author="Owner" time=2026-10-22T02:49:00.000Z kind=prompt>>>',
      'Compare the two designs.',
      '<<<end-abc123>>>',
    ].join('\n');
    const reply = encodeURIComponent('First answer line|Second answer line');
    for (const variant of ['', '&oneline=1']) {
      const page = openPage(`?labels=1&reply=${reply}${variant}`);
      const adapter = createGenericAdapter('fixture', OPTIONS);
      expect(await runAdapterTurn(adapter, page.runner, prompt, FAST)).toBe('First answer line\nSecond answer line');
    }
  });

  it('answers a second turn with the same fixed labels on the page', async () => {
    const page = openPage(`?labels=1&reply=${encodeURIComponent('Only this answer remains')}`);
    const adapter = createGenericAdapter('fixture', OPTIONS);
    expect(await runAdapterTurn(adapter, page.runner, 'one', FAST)).toBe('Only this answer remains');
    expect(await runAdapterTurn(adapter, page.runner, 'two', FAST)).toBe('Only this answer remains');
  });

  it('returns an identical repeated answer when the prompt carries the earlier answer and no stop button was seen', async () => {
    const page = openPage(`?labels=1&nostop=1&reply=${encodeURIComponent('Same answer, repeated verbatim')}`);
    const adapter = createGenericAdapter('fixture', OPTIONS);
    expect(await runAdapterTurn(adapter, page.runner, 'first question', FAST)).toBe('Same answer, repeated verbatim');
    const history = 'Earlier in the room:\nSame answer, repeated verbatim\nContinue the discussion.';
    expect(await runAdapterTurn(adapter, page.runner, history, FAST)).toBe('Same answer, repeated verbatim');
    expect(await runAdapterTurn(adapter, page.runner, history, FAST)).toBe('Same answer, repeated verbatim');
  });

  it('a reply leaves out buttons and screen-reader labels', async () => {
    const page = openPage('?chrome=1');
    const adapter = createGenericAdapter('fixture', OPTIONS);
    const reply = await runAdapterTurn(adapter, page.runner, 'Tell me about rivers', FAST);
    expect(reply).toBe('Rivers carve valleys over long stretches of time.\nCall flow() to start the water.');
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

  it('fails with no-response when the page never shows the prompt', async () => {
    const page = openPage('?noecho=1&silent=1');
    const adapter = createGenericAdapter('fixture', OPTIONS);
    await expect(runAdapterTurn(adapter, page.runner, 'hi there', { ...FAST, startGraceMs: 250 })).rejects.toMatchObject({
      code: 'no-response',
    });
  });

  it('keeps waiting past the start grace once the echo of the prompt is on the page and times out only at the turn timeout', async () => {
    const page = openPage('?silent=1');
    const adapter = createGenericAdapter('fixture', OPTIONS);
    const begun = Date.now();
    await expect(runAdapterTurn(adapter, page.runner, 'hi', { ...FAST, startGraceMs: 150, timeoutMs: 700 })).rejects.toMatchObject({
      code: 'timeout',
    });
    expect(Date.now() - begun).toBeGreaterThanOrEqual(650);
  });

  it('returns the reply of a page that starts answering after the start grace but has shown the echo', async () => {
    const page = openPage(`?nostop=1&think=700&reply=${STREAMED_URL}`);
    const adapter = createGenericAdapter('fixture', OPTIONS);
    expect(await runAdapterTurn(adapter, page.runner, 'question', { ...FAST, startGraceMs: 250, timeoutMs: 8000 })).toBe(STREAMED);
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

const STREAMED_URL = encodeURIComponent('First streamed answer line|Second streamed answer line');
const STREAMED = 'First streamed answer line\nSecond streamed answer line';

describe('generic adapter: slow starts, busy pages, locked composers', () => {
  it('waits out a silent thinking phase on a page whose labels change on submit and has no stop button', async () => {
    const page = openPage(`?nostop=1&sidebar=1&think=350&reply=${STREAMED_URL}`);
    const adapter = createGenericAdapter('fixture', OPTIONS);
    expect(await runAdapterTurn(adapter, page.runner, 'question', FAST)).toBe(STREAMED);
  });

  it('does not take a short unknown text that appears on submit for the start of an answer', async () => {
    const page = openPage(`?nostop=1&tag=Queued&think=350&reply=${STREAMED_URL}`);
    const adapter = createGenericAdapter('fixture', OPTIONS);
    expect(await runAdapterTurn(adapter, page.runner, 'question', FAST)).toContain(STREAMED);
  });

  it('does not take a label that appears on submit for the start of an answer', async () => {
    const page = openPage('?sidebar=1&silent=1');
    const adapter = createGenericAdapter('fixture', OPTIONS);
    await expect(runAdapterTurn(adapter, page.runner, 'hi', { ...FAST, startGraceMs: 150, timeoutMs: 700 })).rejects.toMatchObject({
      code: 'timeout',
    });
  });

  it('waits until a generation that is still running has been quiet before inserting', async () => {
    const page = openPage('?nostop=1&busy=600');
    const adapter = createGenericAdapter('fixture', { ...OPTIONS, quietMs: 400 });
    const traces: Array<Record<string, unknown>> = [];
    const reply = await runAdapterTurn(adapter, page.runner, 'next question', { ...FAST, timeoutMs: 8000, trace: (fields) => traces.push(fields) });
    expect(reply).toBe('ECHO: next question part-2 part-3');
    expect(page.win['ignored']).toBe(0);
    expect(page.win['submissions']).toBe(1);
    expect(Number(traces[0]?.['idleWaitMs'])).toBeGreaterThanOrEqual(500);
  });

  it('does not wait again for a page that has not changed since its last turn ended', async () => {
    const page = openPage('?nostop=1');
    const adapter = createGenericAdapter('fixture', { ...OPTIONS, quietMs: 600 });
    const traces: Array<Record<string, unknown>> = [];
    const options = { ...FAST, timeoutMs: 8000, trace: (fields: Record<string, unknown>) => traces.push(fields) };
    await runAdapterTurn(adapter, page.runner, 'one', options);
    await runAdapterTurn(adapter, page.runner, 'two', options);
    expect(Number(traces[0]?.['idleWaitMs'])).toBeGreaterThanOrEqual(500);
    expect(Number(traces[1]?.['idleWaitMs'])).toBeLessThan(200);
  });

  it('fails with a timeout when the page never gets quiet', async () => {
    const page = openPage('?nostop=1&busy=100000');
    const adapter = createGenericAdapter('fixture', OPTIONS);
    await expect(runAdapterTurn(adapter, page.runner, 'hi', { ...FAST, timeoutMs: 400 })).rejects.toMatchObject({ code: 'timeout' });
    expect(page.win['submissions']).toBe(0);
  });

  it('stops waiting for a quiet page when the turn is stopped', async () => {
    const page = openPage('?nostop=1&busy=100000');
    const adapter = createGenericAdapter('fixture', OPTIONS);
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 100);
    await expect(runAdapterTurn(adapter, page.runner, 'hi', { ...FAST, signal: stop.signal })).rejects.toMatchObject({ code: 'aborted' });
  });

  it('does not finish in a quiet gap while the composer is locked', async () => {
    const page = openPage(`?nostop=1&lock=1&gap=400&reply=${STREAMED_URL}`);
    const adapter = createGenericAdapter('fixture', OPTIONS);
    expect(await runAdapterTurn(adapter, page.runner, 'question', FAST)).toBe(STREAMED);
  });

  it('keeps the composer lock out of the idle check of the next turn', async () => {
    const page = openPage(`?nostop=1&lock=1&reply=${STREAMED_URL}`);
    const adapter = createGenericAdapter('fixture', OPTIONS);
    expect(await runAdapterTurn(adapter, page.runner, 'one', FAST)).toBe(STREAMED);
    expect(await runAdapterTurn(adapter, page.runner, 'two', FAST)).toBe(STREAMED);
  });
});

describe('generic adapter: turn trace', () => {
  async function traced(search: string, prompt: string, options = FAST) {
    const page = openPage(search);
    const adapter = createGenericAdapter('fixture', OPTIONS);
    const traces: Array<Record<string, unknown>> = [];
    const outcome = await runAdapterTurn(adapter, page.runner, prompt, { ...options, trace: (fields) => traces.push(fields) }).then(
      (reply) => reply,
      (error: unknown) => error,
    );
    return { traces, outcome };
  }

  it('reports one line of numbers and names per turn, with no page text', async () => {
    const { traces, outcome } = await traced('', 'secret prompt text');
    expect(outcome).toBe('ECHO: secret prompt text part-2 part-3');
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      outcome: 'reply',
      composer: 'textarea',
      inserted: 18,
      submit: 'enter',
      stopSeen: true,
      replyChars: 'ECHO: secret prompt text part-2 part-3'.length,
      droppedEcho: 1,
    });
    expect(Number(traces[0]?.['firstGrowthMs'])).toBeGreaterThan(0);
    expect(Number(traces[0]?.['ms'])).toBeGreaterThan(0);
    expect(typeof traces[0]?.['turn']).toBe('string');
    const text = JSON.stringify(traces);
    expect(text).not.toContain('secret');
    expect(text).not.toContain('ECHO');
  });

  it('names the composer kind and the submit path', async () => {
    const { traces } = await traced('?composer=editable&noenter=1&exec=1&nostop=1', 'x y z');
    expect(traces[0]).toMatchObject({ composer: 'editable', submit: 'button', stopSeen: false });
  });

  it('counts the lines dropped as labels', async () => {
    const { traces } = await traced(`?sidebar=1&nostop=1&reply=${STREAMED_URL}`, 'question');
    expect(traces[0]).toMatchObject({ outcome: 'reply', droppedLabel: 2 });
  });

  it('reports a failed turn with its error code and no first growth', async () => {
    const { traces, outcome } = await traced('?noecho=1&silent=1', 'hi', { ...FAST, startGraceMs: 250 });
    expect(outcome).toMatchObject({ code: 'no-response' });
    expect(traces[0]).toMatchObject({ outcome: 'failed', code: 'no-response', firstGrowthMs: -1, replyChars: 0 });
  });

  it('counts the animation frames of the page and the lengths of the conversation text, never the text', async () => {
    const page = openPage('?nostop=1', true);
    const adapter = createGenericAdapter('fixture', OPTIONS);
    const traces: Array<Record<string, unknown>> = [];
    await runAdapterTurn(adapter, page.runner, 'private words', { ...FAST, trace: (fields) => traces.push(fields) });
    expect(Number(traces[0]?.['frames'])).toBeGreaterThan(0);
    const before = Number(traces[0]?.['textLenBefore']);
    const atEnd = Number(traces[0]?.['textLenAtEnd']);
    expect(before).toBeGreaterThanOrEqual(0);
    expect(atEnd).toBeGreaterThan(before);
    expect(JSON.stringify(traces)).not.toContain('private');
  });

  it('reports frames 0 for a page that never draws a frame', async () => {
    const page = openPage('?nostop=1');
    const adapter = createGenericAdapter('fixture', OPTIONS);
    const traces: Array<Record<string, unknown>> = [];
    await runAdapterTurn(adapter, page.runner, 'x', { ...FAST, trace: (fields) => traces.push(fields) });
    expect(traces[0]?.['frames']).toBe(0);
    const failing = await traced('?noecho=1&silent=1', 'x', { ...FAST, startGraceMs: 100 });
    expect(failing.traces[0]?.['frames']).toBe(0);
  });
});

describe('generic adapter: the reply is anchored on the echo of the prompt', () => {
  const FIRST = 'First streamed answer line that is long enough';
  const URL_REPLY = encodeURIComponent(`${FIRST}|Second streamed answer line`);

  it('does not take a sidebar title written after the submit for the answer', async () => {
    const page = openPage(`?nomain=1&nostop=1&title=1&think=500&reply=${URL_REPLY}`);
    const adapter = createGenericAdapter('fixture', OPTIONS);
    expect(await runAdapterTurn(adapter, page.runner, 'question about sculptors', { ...FAST, timeoutMs: 8000 })).toBe(
      `${FIRST}\nSecond streamed answer line`,
    );
  });

  it('reads nothing while the page has no echo of the prompt, whatever else changes', async () => {
    const page = openPage('?nomain=1&nostop=1&title=1&silent=1&noecho=1');
    const adapter = createGenericAdapter('fixture', OPTIONS);
    await expect(runAdapterTurn(adapter, page.runner, 'question about sculptors', { ...FAST, startGraceMs: 400 })).rejects.toMatchObject({
      code: 'no-response',
    });
  });

  it('reports whether the echo was found and how many composers are visible', async () => {
    const page = openPage('?second=1');
    const adapter = createGenericAdapter('fixture', OPTIONS);
    const traces: Array<Record<string, unknown>> = [];
    await runAdapterTurn(adapter, page.runner, 'question', { ...FAST, trace: (fields) => traces.push(fields) });
    expect(traces[0]).toMatchObject({ echoFound: true, visibleComposers: 2, submit: 'enter' });
    expect(Number(traces[0]?.['composerClearedMs'])).toBeGreaterThanOrEqual(0);
  });

  it('reports a submission that was never confirmed as not-submitted with no cleared time', async () => {
    const page = openPage('?noenter=1&sendoff=1');
    const adapter = createGenericAdapter('fixture', OPTIONS);
    const traces: Array<Record<string, unknown>> = [];
    await expect(runAdapterTurn(adapter, page.runner, 'question', { ...FAST, trace: (fields) => traces.push(fields) })).rejects.toMatchObject({
      code: 'not-submitted',
    });
    expect(traces[0]).toMatchObject({ outcome: 'failed', code: 'not-submitted', composerClearedMs: -1, echoFound: false });
  });
});

describe('generic adapter: a question navigator after the composer repeats every user message', () => {
  const ROOM_PROMPT = 'Room so far, continue the discussion with a new point.\nKeep it short and concrete.';

  async function twoRounds(search: string) {
    const page = openPage(search);
    const adapter = createGenericAdapter('fixture', OPTIONS);
    const traces: Array<Record<string, unknown>> = [];
    const options = { ...FAST, timeoutMs: 5000, trace: (fields: Record<string, unknown>) => traces.push(fields) };
    const first = await runAdapterTurn(adapter, page.runner, ROOM_PROMPT, options);
    const second = await runAdapterTurn(adapter, page.runner, ROOM_PROMPT, options).then(
      (reply) => reply,
      (error: unknown) => error,
    );
    return { first, second, traces };
  }

  it.each([
    ['full', 5, 2],
    ['ellipsis', 3, 0],
  ])('reads the newest reply in the second round when the navigator holds the prompt (%s)', async (kind, hits, rank) => {
    const { first, second, traces } = await twoRounds(`?nomain=1&nostop=1&numbered=1&nav=${kind}`);
    expect(first).toContain('ECHO 1:');
    expect(second).toContain('ECHO 2:');
    expect(second).toBe(`ECHO 2: ${ROOM_PROMPT.replace(/\s+/g, ' ')} part-2 part-3`);
    expect(traces[1]).toMatchObject({ outcome: 'reply', echoFound: true, keyHits: hits, anchorRank: rank });
  });
});

describe('generic adapter: the echo sits mid-line behind a file card and a navigator follows', () => {
  const ROOM_PROMPT = 'Room so far, continue the discussion with a new point.\nKeep it short and concrete.';

  async function twoRounds(search: string) {
    const page = openPage(search);
    const adapter = createGenericAdapter('fixture', OPTIONS);
    const traces: Array<Record<string, unknown>> = [];
    const options = { ...FAST, timeoutMs: 5000, trace: (fields: Record<string, unknown>) => traces.push(fields) };
    const first = await runAdapterTurn(adapter, page.runner, ROOM_PROMPT, options);
    const second = await runAdapterTurn(adapter, page.runner, ROOM_PROMPT, options).then(
      (reply) => reply,
      (error: unknown) => error,
    );
    return { first, second, traces };
  }

  it.each([
    ['full', 3],
    ['ellipsis', 1],
  ])('reads the newest reply in the second round (navigator %s)', async (kind, hits) => {
    const { first, second, traces } = await twoRounds(`?nomain=1&nostop=1&plain=1&card=1&nav=${kind}`);
    expect(first).toBe('Reply 1 on the design, its first half and its second half');
    expect(second).toBe('Reply 2 on the design, its first half and its second half');
    expect(traces[0]).toMatchObject({ outcome: 'reply', hitsAtLineStart: 0 });
    expect(traces[1]).toMatchObject({ outcome: 'reply', echoFound: true });
    expect(traces[1]).toMatchObject({ keyHits: hits });
  });
});

describe('generic adapter: a failed turn writes one record about the lines, never their text', () => {
  const SEEN_TEXT = 'Welcome. Ask me anything.';

  async function failed(search: string, prompt: string, options: Record<string, number>) {
    const page = openPage(search);
    const adapter = createGenericAdapter('fixture', OPTIONS);
    const records: Array<Record<string, unknown>> = [];
    const error = await runAdapterTurn(adapter, page.runner, prompt, {
      ...FAST,
      ...options,
      diagnose: (fields) => records.push(fields),
    }).then(
      () => null,
      (caught: unknown) => caught,
    );
    return { error, records };
  }

  it('on no-response lists length and flags per line and the line-start hits', async () => {
    const { error, records } = await failed('?noecho=1&silent=1', 'secret prompt words here', { startGraceMs: 150 });
    expect(error).toMatchObject({ code: 'no-response' });
    expect(records).toHaveLength(1);
    const record = records[0] ?? {};
    expect(record).toMatchObject({ code: 'no-response', hitsAtLineStart: 0 });
    expect(String(record['entries'])).toMatch(/^\d+:\d{4}(,\d+:\d{4})*$/);
    expect(Number(record['lines'])).toBe(Number(record['listed']));
    expect(JSON.stringify(record)).not.toContain('secret');
    expect(JSON.stringify(record)).not.toContain('Welcome');
    expect(JSON.stringify(record)).not.toContain(SEEN_TEXT);
  });

  it('on timeout flags the echo line as key and echo and the old line as seen', async () => {
    const { error, records } = await failed('?stall=1&nostop=1', 'secret prompt words here', { timeoutMs: 600 });
    expect(error).toMatchObject({ code: 'timeout' });
    expect(records).toHaveLength(1);
    const entries = String(records[0]?.['entries']).split(',');
    expect(entries.some((entry) => entry.endsWith(':1100') || entry.endsWith(':2100'))).toBe(true);
    expect(entries.some((entry) => entry.endsWith('1'))).toBe(true);
    expect(JSON.stringify(records)).not.toContain('secret');
  });

  it('writes no record for a reply or for another failure', async () => {
    const page = openPage('?nostop=1');
    const adapter = createGenericAdapter('fixture', OPTIONS);
    const records: Array<Record<string, unknown>> = [];
    await runAdapterTurn(adapter, page.runner, 'question', { ...FAST, diagnose: (fields) => records.push(fields) });
    const refused = openPage('?noenter=1&sendoff=1');
    await expect(
      runAdapterTurn(createGenericAdapter('fixture', OPTIONS), refused.runner, 'question', { ...FAST, diagnose: (fields) => records.push(fields) }),
    ).rejects.toMatchObject({ code: 'not-submitted' });
    expect(records).toEqual([]);
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

describe('judgeGenerating with the network stream', () => {
  const read = { stop: false, text: 'page', accepting: true };
  const started = { ...freshTrack(), started: true, changedAt: 1000 };
  const open = { state: 'open', endedAt: null } as const;
  const ended = { state: 'ended', endedAt: 1000 } as const;

  it('without a stream keeps the quiet rule', () => {
    expect(judgeGenerating(started, read, 1000 + 4999, 5000).generating).toBe(true);
    expect(judgeGenerating(started, read, 1000 + 5000, 5000)).toEqual({ generating: false, settledText: 'page' });
    expect(judgeGenerating(freshTrack(), read, 10, 5000).generating).toBe(false);
  });

  it('is generating while a stream is open, before the text started and while the text is still', () => {
    expect(judgeGenerating(freshTrack(), read, 10, 5000, open)).toEqual({ generating: true, settledText: null });
    expect(judgeGenerating(started, read, 1000 + 60000, 5000, open)).toEqual({ generating: true, settledText: null });
  });

  it('lets the quiet rule decide again when a stream stays open for a very long time without any text change', () => {
    expect(judgeGenerating(started, read, 1000 + STREAM_QUIET_CAP_MS - 1, 5000, open).generating).toBe(true);
    expect(judgeGenerating(started, read, 1000 + STREAM_QUIET_CAP_MS, 5000, open)).toEqual({ generating: false, settledText: 'page' });
    expect(judgeGenerating(freshTrack(), read, STREAM_QUIET_CAP_MS * 2, 5000, open).generating).toBe(true);
  });

  it('is not generating once the stream ended and the text started, even when the text moved a moment ago', () => {
    expect(judgeGenerating(started, read, 1001, 5000, ended)).toEqual({ generating: false, settledText: 'page' });
  });

  it('still waits after the end of the stream for a stop button or a composer that is not ready', () => {
    expect(judgeGenerating(started, { ...read, stop: true }, 2000, 5000, ended).generating).toBe(true);
    expect(judgeGenerating(started, { ...read, accepting: false }, 2000, 5000, ended).generating).toBe(true);
  });

  it('does not take the end of a stream for the end of an answer that never started', () => {
    expect(judgeGenerating(freshTrack(), read, 2000, 5000, ended).generating).toBe(false);
  });

  it('falls back to the quiet rule after a failed stream', () => {
    const failed = { state: 'failed', endedAt: null } as const;
    expect(judgeGenerating(started, read, 1100, 5000, failed).generating).toBe(true);
    expect(judgeGenerating(started, read, 6000, 5000, failed).generating).toBe(false);
  });
});

describe('generic adapter: a turn judged with the network stream', () => {
  const FIRST = 'First part of the scripted answer arrives';
  const SECOND = 'Second part of the scripted answer arrives';
  const NO_STOP: readonly ScriptedFrame[] = [
    { from: 0, lines: [], stop: false },
    { from: 100, lines: [FIRST], stop: false },
    { from: 200, lines: [FIRST, SECOND], stop: false },
  ];
  const REQUEST = { phase: 'request', id: 'a', method: 'POST', resourceType: 'Fetch' };
  const RESPONSE = { phase: 'response', id: 'a', mime: 'text/event-stream' };

  afterEach(() => {
    vi.useRealTimers();
  });

  async function run(quietMs: number, script: ReadonlyArray<[number, Record<string, string>]>, stream = true) {
    vi.useFakeTimers();
    const tracker = createStreamTracker();
    const page = scriptedPage(SCRIPT_PROMPT, NO_STOP);
    const adapter = createGenericAdapter('fixture', { ...OPTIONS, quietMs });
    const traces: Array<Record<string, unknown>> = [];
    let begun = 0;
    const runner: PageRunner = {
      run(code) {
        if (code === genericEnterScript()) {
          begun = Date.now();
          for (const [delay, fields] of script) setTimeout(() => tracker.feed(fields, Date.now()), delay);
        }
        return page.runner.run(code);
      },
    };
    let settled = false;
    let outcome: unknown = null;
    const running = runAdapterTurn(adapter, runner, SCRIPT_PROMPT, { ...FAST, trace: (fields) => traces.push(fields), ...(stream ? { stream: tracker } : {}) })
      .then(
        (reply) => {
          outcome = reply;
        },
        (error: unknown) => {
          outcome = error;
        },
      )
      .finally(() => {
        settled = true;
      });
    while (!settled) await vi.advanceTimersByTimeAsync(5);
    await running;
    return { outcome, elapsed: Date.now() - begun, trace: traces[0] };
  }

  it('finishes about the settle time after the end of the stream instead of waiting for the quiet time', async () => {
    const made = await run(3000, [[60, REQUEST], [70, RESPONSE], [260, { phase: 'finished', id: 'a' }]]);
    expect(made.outcome).toBe(`${FIRST}\n${SECOND}`);
    expect(made.elapsed).toBeGreaterThanOrEqual(260 + FAST.settleMs);
    expect(made.elapsed).toBeLessThan(260 + FAST.settleMs + 60);
    expect(made.trace).toMatchObject({ stream: 'ended' });
    expect(Number(made.trace?.['streamEndMs'])).toBeGreaterThanOrEqual(250);
    expect(Number(made.trace?.['streamEndMs'])).toBeLessThanOrEqual(280);
  });

  it('keeps waiting past the quiet time while the stream is open', async () => {
    const made = await run(130, [[60, REQUEST], [70, RESPONSE], [900, { phase: 'finished', id: 'a' }]]);
    expect(made.outcome).toBe(`${FIRST}\n${SECOND}`);
    expect(made.elapsed).toBeGreaterThanOrEqual(900 + FAST.settleMs);
    expect(made.elapsed).toBeLessThan(900 + FAST.settleMs + 60);
  });

  it('uses the quiet rule when no stream was seen, and says so in the trace', async () => {
    const made = await run(130, []);
    expect(made.outcome).toBe(`${FIRST}\n${SECOND}`);
    expect(made.elapsed).toBeGreaterThanOrEqual(200 + 130);
    expect(made.elapsed).toBeLessThan(200 + 130 + 2 * FAST.settleMs + 60);
    expect(made.trace).toMatchObject({ stream: 'none', streamEndMs: -1 });
  });

  it('uses the quiet rule when the turn is given no stream source at all', async () => {
    const made = await run(130, [[60, REQUEST], [70, RESPONSE], [900, { phase: 'finished', id: 'a' }]], false);
    expect(made.elapsed).toBeLessThan(600);
    expect(made.trace).toMatchObject({ stream: 'none', streamEndMs: -1 });
  });

  it('falls back to the quiet rule when the stream failed', async () => {
    const made = await run(130, [[60, REQUEST], [70, RESPONSE], [100, { phase: 'failed', id: 'a' }]]);
    expect(made.outcome).toBe(`${FIRST}\n${SECOND}`);
    expect(made.elapsed).toBeGreaterThanOrEqual(200 + 130);
    expect(made.trace).toMatchObject({ stream: 'failed', streamEndMs: -1 });
  });
});
