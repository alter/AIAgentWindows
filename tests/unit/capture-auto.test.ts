// capture-auto.test.ts
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import {
  AUTO_SITES,
  autoExitCode,
  autoTiming,
  DEFAULT_AUTO_TIMING,
  captureAuto,
  formatAutoReport,
  type AutoOptions,
  type AutoPage,
  type AutoReport,
  type AutoTiming,
} from '../../src/main/capture-auto';
import {
  defaultUserData,
  holdsProfile,
  parseProcessList,
  profileInUse,
  systemProfileLockDeps,
  type ProfileLockDeps,
} from '../../src/main/profile-lock';
import { SITE_URLS, type SiteKind } from '../../src/shared/agents';
import type { Diagnostic } from '../../src/shared/capture-diagnostic';
import { sanitizeScript } from '../../src/shared/capture-sanitize';
import {
  conversationPathOf,
  discoverScript,
  parseDiscovery,
  parseProbe,
  pickConversationLink,
  probeScript,
} from '../../src/shared/conversation-link';
import { windowsVisible } from '../../src/shared/window-visibility';

const FIXTURES = path.resolve(__dirname, '..', 'fixtures', 'auto');
const page = (name: string): string => readFileSync(path.join(FIXTURES, name), 'utf8');
const TIMING: AutoTiming = { pollMs: 100, discoverMs: 2000, replyMs: 2000, stablePolls: 2, loginPolls: 3 };

function open(html: string, url: string): JSDOM {
  return new JSDOM(html, { url, runScripts: 'outside-only' });
}

function discover(kind: SiteKind, file: string) {
  const dom = open(page(file), SITE_URLS[kind]);
  const found = parseDiscovery(dom.window.eval(discoverScript()));
  expect(found).not.toBeNull();
  return found!;
}

describe('conversation link picker on fixture pages', () => {
  it('chatgpt: first same-origin /c/<id> in document order, query and fragment dropped', () => {
    const found = discover('chatgpt', 'chatgpt-home.html');
    expect(found.hrefs[0]).toBe('https://other.example/c/evil-chat-1');
    expect(pickConversationLink('chatgpt', found.origin, found.hrefs)).toBe('https://chatgpt.com/c/first-chat-1');
    expect(found.login).toBe(false);
  });

  it('grok: /chat/<id> or /c/<id>, whichever comes first', () => {
    const first = discover('grok', 'grok-home.html');
    expect(pickConversationLink('grok', first.origin, first.hrefs)).toBe('https://grok.com/chat/grok-first-1');
    const second = discover('grok', 'grok-home-c.html');
    expect(pickConversationLink('grok', second.origin, second.hrefs)).toBe('https://grok.com/c/grok-second-2/');
  });

  it('deepseek: /a/chat/s/<id> only', () => {
    const found = discover('deepseek', 'deepseek-home.html');
    expect(pickConversationLink('deepseek', found.origin, found.hrefs)).toBe('https://chat.deepseek.com/a/chat/s/ds-first-1');
  });

  it('finds nothing on an empty home and flags a signed-out page', () => {
    const empty = discover('chatgpt', 'empty-home.html');
    expect(pickConversationLink('chatgpt', empty.origin, empty.hrefs)).toBeNull();
    expect(empty.login).toBe(false);
    const out = discover('chatgpt', 'signed-out.html');
    expect(pickConversationLink('chatgpt', out.origin, out.hrefs)).toBeNull();
    expect(out.login).toBe(true);
  });

  it('flags a login path even without a form', () => {
    const dom = open('<body><p>x</p></body>', 'https://chatgpt.com/auth/login');
    expect(parseDiscovery(dom.window.eval(discoverScript()))?.login).toBe(true);
  });

  it('does not accept another site path, a foreign origin, a bad url or a non-http origin', () => {
    expect(pickConversationLink('chatgpt', 'https://chatgpt.com', ['https://chatgpt.com/a/chat/s/abcd1234'])).toBeNull();
    expect(pickConversationLink('deepseek', 'https://chat.deepseek.com', ['https://chat.deepseek.com/c/abcd1234'])).toBeNull();
    expect(pickConversationLink('chatgpt', 'https://chatgpt.com', ['https://evil.example/c/abcd1234'])).toBeNull();
    expect(pickConversationLink('chatgpt', 'https://chatgpt.com', ['not a url', 'data:text/html,x'])).toBeNull();
    expect(pickConversationLink('chatgpt', 'null', ['data:text/html,/c/abcd1234'])).toBeNull();
    expect(conversationPathOf('grok', '/c/new')).toBe(false);
  });

  it('stops collecting at the link cap', () => {
    const links = Array.from({ length: 600 }, (_, index) => `<a href="/x/${index}">x</a>`).join('');
    const dom = open(`<body>${links}</body>`, 'https://grok.com/');
    expect(parseDiscovery(dom.window.eval(discoverScript()))?.hrefs).toHaveLength(500);
  });

  it('reports a page-side failure as no result', () => {
    const dom = open('<body></body>', 'https://grok.com/');
    Object.defineProperty(dom.window.document, 'querySelectorAll', { value: () => { throw new Error('boom'); } });
    expect(dom.window.eval(discoverScript())).toBe('null');
    Object.defineProperty(dom.window.document, 'getElementsByTagName', { value: () => { throw new Error('boom'); } });
    expect(dom.window.eval(probeScript())).toBe('null');
  });
});

describe('page answers', () => {
  it('probe sees the assistant markup of a conversation page and not an empty home', () => {
    const conversation = parseProbe(open(page('conversation.html'), 'https://chatgpt.com/c/first-chat-1').window.eval(probeScript()));
    expect(conversation?.reply).toBe(true);
    expect(conversation?.messageList).toBe(true);
    expect(conversation?.mainRegion).toBe(true);
    expect(conversation?.nodes).toBeGreaterThan(5);
    expect(conversation?.textChars).toBeGreaterThan(20);
    const home = parseProbe(open(page('empty-home.html'), 'https://chatgpt.com/').window.eval(probeScript()));
    expect(home?.reply).toBe(false);
    expect(home?.messageList).toBe(false);
  });

  it('counts a message list only in the main region, outside navigation, from text-bearing non-control children', () => {
    const probe = (html: string) => parseProbe(open(html, 'https://chat.deepseek.com/a/chat/s/ds-first-1').window.eval(probeScript()));
    const chats = '<a href="/a/chat/s/1">one</a><a href="/a/chat/s/2">two</a><a href="/a/chat/s/3">three</a>';
    expect(probe(`<body><nav><div>one</div><div>two</div><div>three</div></nav><main><p>hello</p></main></body>`)?.messageList).toBe(false);
    expect(probe(`<body><aside><div>a</div><div>b</div></aside><div role="main"><p>hello</p></div></body>`)?.messageList).toBe(false);
    expect(probe(`<body><main><div>${chats}</div></main></body>`)?.messageList).toBe(false);
    expect(probe('<body><main><button>a</button><button>b</button><div></div><div>  </div></main></body>')?.messageList).toBe(false);
    expect(probe('<body><main><div>question</div><div>answer</div></main></body>')).toMatchObject({ messageList: true, mainRegion: true });
    expect(probe('<body><section><article>question</article><article>answer</article></section></body>')).toMatchObject({ messageList: true, mainRegion: false });
    expect(probe('<body><div role="main"><div><div>x</div></div><div><div>question</div><div>answer</div></div></div></body>')?.messageList).toBe(true);
  });

  it('reports the viewport and a text length that changes when only text changes', () => {
    const dom = open('<body><main><p>one</p></main></body>', 'https://chat.deepseek.com/');
    const before = parseProbe(dom.window.eval(probeScript()));
    dom.window.document.querySelector('p')!.textContent = 'one more word';
    const after = parseProbe(dom.window.eval(probeScript()));
    expect(after?.nodes).toBe(before?.nodes);
    expect(after!.textChars).toBeGreaterThan(before!.textChars);
    expect(before?.width).toBeGreaterThan(0);
    expect(before?.height).toBeGreaterThan(0);
  });

  it('refuses answers of the wrong shape', () => {
    for (const raw of [undefined, 'null', 'not json', '[]', '{}', '{"origin":1}']) {
      expect(parseDiscovery(raw)).toBeNull();
      expect(parseProbe(raw)).toBeNull();
    }
    expect(parseDiscovery('{"origin":"o","url":"u","hrefs":[1],"login":false}')).toBeNull();
    expect(parseDiscovery('{"origin":"o","url":"u","hrefs":"x","login":false}')).toBeNull();
    const good = { url: 'u', nodes: 3, textChars: 4, reply: true, messageList: true, mainRegion: true, width: 5, height: 6 };
    expect(parseProbe(JSON.stringify(good))).toEqual(good);
    for (const [key, value] of [['nodes', '3'], ['textChars', null], ['reply', 1], ['messageList', 'yes'], ['mainRegion', null], ['width', '5'], ['height', undefined], ['url', 7]] as const) {
      expect(parseProbe(JSON.stringify({ ...good, [key]: value })), key).toBeNull();
    }
  });
});

interface FakeSite {
  page: AutoPage;
  scripts: string[];
  loads: string[];
}

interface FakeOptions {
  home: string;
  conversation?: string;
  openConversation?: boolean;
  failLoad?: boolean;
  throwFirst?: number;
  grow?: boolean;
  sanitized?: string;
  sanitizedRaw?: string;
}

function fakeSite(kind: SiteKind, options: FakeOptions): FakeSite {
  let dom = open(page(options.home), SITE_URLS[kind]);
  const scripts: string[] = [];
  const loads: string[] = [];
  let thrown = 0;
  const probe = probeScript();
  const sanitize = sanitizeScript(kind);
  const runner = {
    run: async (code: string): Promise<unknown> => {
      scripts.push(code);
      if (thrown < (options.throwFirst ?? 0)) {
        thrown += 1;
        throw new Error('the page is loading');
      }
      if (code === sanitize && options.sanitizedRaw !== undefined) return options.sanitizedRaw;
      if (code === sanitize && options.sanitized !== undefined) return JSON.stringify({ ok: true, html: options.sanitized });
      if (code === probe && options.grow === true) {
        dom.window.document.body.appendChild(dom.window.document.createElement('div'));
      }
      return dom.window.eval(code);
    },
  };
  return {
    scripts,
    loads,
    page: {
      runner,
      load: async (url) => {
        loads.push(url);
        if (options.failLoad === true) throw new Error('ERR_ABORTED');
        if (options.openConversation !== false) dom = open(page(options.conversation ?? 'conversation.html'), url);
      },
    },
  };
}

function clock(): Pick<AutoOptions, 'sleep' | 'now'> {
  let time = 0;
  return {
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
  };
}

async function run(sites: Partial<Record<SiteKind, FakeSite | null>>, outDir: string): Promise<AutoReport[]> {
  return captureAuto({ sites: AUTO_SITES, open: (kind) => sites[kind]?.page ?? null, outDir, timing: TIMING, ...clock() });
}

function outDir(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), 'aiaw-auto-')), 'sites');
}

describe('unattended capture', () => {
  it('opens the first existing chat of each site, sends nothing and saves a sanitized page', async () => {
    const out = outDir();
    const sites = {
      chatgpt: fakeSite('chatgpt', { home: 'chatgpt-home.html' }),
      grok: fakeSite('grok', { home: 'grok-home.html' }),
      deepseek: fakeSite('deepseek', { home: 'deepseek-home.html' }),
    };
    const reports = await run(sites, out);
    expect(reports.map((report) => `${report.site}:${report.status}`)).toEqual(['chatgpt:saved', 'grok:saved', 'deepseek:saved']);
    expect(sites.chatgpt.loads).toEqual(['https://chatgpt.com/c/first-chat-1']);
    expect(sites.grok.loads).toEqual(['https://grok.com/chat/grok-first-1']);
    expect(sites.deepseek.loads).toEqual(['https://chat.deepseek.com/a/chat/s/ds-first-1']);
    for (const kind of AUTO_SITES) {
      const allowed = new Set([discoverScript(), probeScript(), sanitizeScript(kind)]);
      expect(sites[kind].scripts.every((script) => allowed.has(script)), kind).toBe(true);
      const saved = readFileSync(path.join(out, `${kind}.html`), 'utf8');
      expect(saved).not.toContain('must not be saved');
      expect(saved).toContain('data-message-author-role="assistant"');
    }
    expect(autoExitCode(reports)).toBe(0);
  });

  it('skips a site without an agent', async () => {
    const out = outDir();
    const reports = await run({ chatgpt: fakeSite('chatgpt', { home: 'chatgpt-home.html' }) }, out);
    expect(reports.map((report) => report.status)).toEqual(['saved', 'no-agent', 'no-agent']);
    expect(existsSync(path.join(out, 'grok.html'))).toBe(false);
    expect(autoExitCode(reports)).toBe(1);
  });

  it('reports a signed-out site without loading anything', async () => {
    const site = fakeSite('chatgpt', { home: 'signed-out.html' });
    const reports = await run({ chatgpt: site }, outDir());
    expect(reports[0]).toEqual({ site: 'chatgpt', status: 'not-signed-in' });
    expect(site.loads).toEqual([]);
  });

  it('reports a site with no existing chat after the wait, saving nothing', async () => {
    const out = outDir();
    const site = fakeSite('grok', { home: 'empty-home.html' });
    const reports = await run({ grok: site }, out);
    expect(reports[1]).toEqual({ site: 'grok', status: 'no-chat' });
    expect(site.loads).toEqual([]);
    expect(existsSync(path.join(out, 'grok.html'))).toBe(false);
  });

  it('reports a signed-out page seen only at the end of the wait as not signed in', async () => {
    const site = fakeSite('chatgpt', { home: 'signed-out.html' });
    const reports = await captureAuto({
      sites: ['chatgpt'],
      open: () => site.page,
      outDir: outDir(),
      timing: { ...TIMING, loginPolls: 1000 },
      ...clock(),
    });
    expect(reports[0]?.status).toBe('not-signed-in');
  });

  it('keeps asking while the page is still loading', async () => {
    const site = fakeSite('chatgpt', { home: 'chatgpt-home.html', throwFirst: 3 });
    const reports = await run({ chatgpt: site }, outDir());
    expect(reports[0]?.status).toBe('saved');
  });

  it('refuses to save a capture that fails the leak check', async () => {
    const out = outDir();
    const site = fakeSite('chatgpt', { home: 'chatgpt-home.html', sanitized: '<!doctype html>\n<html><body><div>private words</div></body></html>' });
    const reports = await run({ chatgpt: site }, out);
    expect(reports[0]?.status).toBe('leak-refused');
    expect(reports[0]?.detail).toContain('text outside placeholders');
    expect(existsSync(path.join(out, 'chatgpt.html'))).toBe(false);
  });

  it('fails when the conversation never opens', async () => {
    const reports = await run({ chatgpt: fakeSite('chatgpt', { home: 'chatgpt-home.html', openConversation: false }) }, outDir());
    expect(reports[0]).toMatchObject({ status: 'failed', detail: 'the conversation did not open' });
  });

  it('carries on after a load that aborts when the page did open', async () => {
    const site = fakeSite('chatgpt', { home: 'chatgpt-home.html', failLoad: true });
    const reports = await run({ chatgpt: site }, outDir());
    expect(reports[0]?.status).toBe('failed');
    expect(site.loads).toHaveLength(1);
  });

  it('fails when the conversation page keeps changing', async () => {
    const reports = await run({ chatgpt: fakeSite('chatgpt', { home: 'chatgpt-home.html', grow: true }) }, outDir());
    expect(reports[0]).toMatchObject({ status: 'failed', detail: 'the conversation page did not settle' });
  });

  it('saves a settled page without recognised reply markup and says so', async () => {
    const out = outDir();
    const site = fakeSite('chatgpt', { home: 'chatgpt-home.html', conversation: 'empty-home.html' });
    const reports = await run({ chatgpt: site }, out);
    expect(reports[0]?.status).toBe('saved');
    expect(reports[0]?.detail).toContain('no message list appeared');
    expect(existsSync(path.join(out, 'chatgpt.html'))).toBe(true);
  });

  it('waits for a reply that renders late', async () => {
    const out = outDir();
    const site = fakeSite('deepseek', { home: 'deepseek-home.html', conversation: 'empty-home.html' });
    let calls = 0;
    const original = site.page.runner.run;
    site.page.runner.run = async (code: string) => {
      if (code === probeScript() && (calls += 1) >= 6) {
        return JSON.stringify({ url: 'https://chat.deepseek.com/a/chat/s/ds-first-1', nodes: 9, textChars: 40, reply: true, messageList: true, mainRegion: true, width: 1340, height: 964 });
      }
      return original(code);
    };
    const reports = await run({ deepseek: site }, out);
    expect(reports[2]?.status).toBe('saved');
    expect(reports[2]?.detail).toBeUndefined();
  });

  it('writes a metadata-only diagnostic next to each capture', async () => {
    const out = outDir();
    const sites = {
      chatgpt: fakeSite('chatgpt', { home: 'chatgpt-home.html' }),
      grok: null,
      deepseek: fakeSite('deepseek', { home: 'deepseek-home.html', conversation: 'conversation-styled.html' }),
    };
    const reports = await run(sites, out);
    expect(reports.map((report) => report.status)).toEqual(['saved', 'no-agent', 'saved']);
    expect(existsSync(path.join(out, 'grok.diagnostic.json'))).toBe(false);
    const raw = readFileSync(path.join(out, 'deepseek.diagnostic.json'), 'utf8');
    const diagnostic = JSON.parse(raw) as Diagnostic;
    expect(diagnostic).toMatchObject({ site: 'deepseek', status: 'saved', landingPath: '/', conversationLinkFound: true, loadedPath: '/a/chat/s/:id', mainRegion: true });
    expect(diagnostic.wait).toMatchObject({ messageListSeen: true, replySeen: true, settled: true, timedOut: false });
    expect(diagnostic.viewport?.width).toBeGreaterThan(0);
    expect(diagnostic.stylesheets).toMatchObject({ total: 1, readable: 1, unreadable: 0, classNames: 2 });
    expect(diagnostic.classes).toMatchObject({ stylesheet: 3, dropped: 1 });
    expect(diagnostic.elements?.before['div']).toBe(2);
    for (const word of ['ds-first-1', 'must not be saved', 'never-styled-secret', 'deepseek.com', 'http']) expect(raw, word).not.toContain(word);
    const saved = readFileSync(path.join(out, 'deepseek.html'), 'utf8');
    expect(saved).toContain('ds-markdown-x');
    expect(saved).toContain('_5f3a9c');
    expect(saved).not.toContain('never-styled-secret');
  });

  it('writes the diagnostic of a site that had no chat, with no wait and no statistics', async () => {
    const out = outDir();
    await run({ grok: fakeSite('grok', { home: 'empty-home.html' }) }, out);
    expect(JSON.parse(readFileSync(path.join(out, 'grok.diagnostic.json'), 'utf8'))).toMatchObject({
      status: 'no-chat',
      landingPath: '/',
      conversationLinkFound: false,
      loadedPath: null,
      wait: null,
      elements: null,
    });
  });

  it('writes the diagnostic of a conversation that never opened, with the timeout reported', async () => {
    const out = outDir();
    await run({ chatgpt: fakeSite('chatgpt', { home: 'chatgpt-home.html', openConversation: false }) }, out);
    const diagnostic = JSON.parse(readFileSync(path.join(out, 'chatgpt.diagnostic.json'), 'utf8')) as Diagnostic;
    expect(diagnostic).toMatchObject({ status: 'failed', conversationLinkFound: true, viewport: null, mainRegion: null });
    expect(diagnostic.wait).toMatchObject({ messageListSeen: false, settled: false, timedOut: true });
    expect(diagnostic.wait?.polls).toBeGreaterThan(5);
  });

  it('reports a page that settles without a message list as a timeout in the diagnostic', async () => {
    const out = outDir();
    const reports = await run({ chatgpt: fakeSite('chatgpt', { home: 'chatgpt-home.html', conversation: 'empty-home.html' }) }, out);
    expect(reports[0]?.detail).toContain('no message list appeared');
    const diagnostic = JSON.parse(readFileSync(path.join(out, 'chatgpt.diagnostic.json'), 'utf8')) as Diagnostic;
    expect(diagnostic.wait).toMatchObject({ messageListSeen: false, settled: true, timedOut: true });
  });

  it('says so when the diagnostic cannot be written and still reports the capture', async () => {
    const out = outDir();
    mkdirSync(path.join(out, 'chatgpt.diagnostic.json'), { recursive: true });
    const reports = await run({ chatgpt: fakeSite('chatgpt', { home: 'chatgpt-home.html' }), grok: fakeSite('grok', { home: 'signed-out.html' }) }, out);
    expect(reports[0]).toMatchObject({ status: 'saved', detail: 'diagnostic not written' });
    expect(reports[1]).toEqual({ site: 'grok', status: 'not-signed-in' });
    expect(readFileSync(path.join(out, 'grok.diagnostic.json'), 'utf8')).toContain('"not-signed-in"');
  });

  it('waits for the message list and for the page to go quiet, then saves', async () => {
    const out = outDir();
    const site = fakeSite('deepseek', { home: 'deepseek-home.html', conversation: 'empty-home.html' });
    const url = 'https://chat.deepseek.com/a/chat/s/ds-first-1';
    const answers = [
      { messageList: false, nodes: 9, textChars: 10 },
      { messageList: false, nodes: 9, textChars: 10 },
      { messageList: false, nodes: 9, textChars: 10 },
      { messageList: true, nodes: 30, textChars: 400 },
      { messageList: true, nodes: 30, textChars: 450 },
      { messageList: true, nodes: 30, textChars: 450 },
      { messageList: true, nodes: 30, textChars: 450 },
    ];
    let calls = 0;
    const original = site.page.runner.run;
    site.page.runner.run = async (code: string) => {
      if (code !== probeScript()) return original(code);
      const answer = answers[Math.min(calls, answers.length - 1)]!;
      calls += 1;
      return JSON.stringify({ url, reply: true, mainRegion: true, width: 1340, height: 964, ...answer });
    };
    const reports = await run({ deepseek: site }, out);
    expect(reports[2]).toMatchObject({ status: 'saved' });
    expect(reports[2]?.detail).toBeUndefined();
    const diagnostic = JSON.parse(readFileSync(path.join(out, 'deepseek.diagnostic.json'), 'utf8')) as Diagnostic;
    expect(diagnostic.wait).toMatchObject({ polls: 7, settled: true, timedOut: false });
  });

  it('does not call a page quiet while only its text changes', async () => {
    const site = fakeSite('deepseek', { home: 'deepseek-home.html', conversation: 'conversation.html' });
    let chars = 100;
    const original = site.page.runner.run;
    site.page.runner.run = async (code: string) => {
      if (code !== probeScript()) return original(code);
      chars += 10;
      return JSON.stringify({ url: 'https://chat.deepseek.com/a/chat/s/ds-first-1', nodes: 30, textChars: chars, reply: true, messageList: true, mainRegion: true, width: 1340, height: 964 });
    };
    const reports = await run({ deepseek: site }, outDir());
    expect(reports[2]).toMatchObject({ status: 'failed', detail: 'the conversation page did not settle' });
  });

  it('notes a settled message list without recognised reply markup and a page that left the conversation', async () => {
    const site = fakeSite('deepseek', { home: 'deepseek-home.html', conversation: 'conversation.html' });
    let calls = 0;
    const original = site.page.runner.run;
    site.page.runner.run = async (code: string) => {
      if (code !== probeScript()) return original(code);
      calls += 1;
      const url = calls === 2 ? 'https://chat.deepseek.com/a/chat/s/other-chat' : 'https://chat.deepseek.com/a/chat/s/ds-first-1';
      return JSON.stringify({ url, nodes: 30, textChars: 400, reply: false, messageList: true, mainRegion: false, width: 1340, height: 964 });
    };
    const reports = await run({ deepseek: site }, outDir());
    expect(reports[2]).toMatchObject({ status: 'saved', detail: 'the message list settled but no reply markup was recognised' });
  });

  it('turns a page error or an unreadable page into a failed site and goes on with the next', async () => {
    const out = outDir();
    const unreadable = fakeSite('chatgpt', { home: 'chatgpt-home.html' });
    const original = unreadable.page.runner.run;
    unreadable.page.runner.run = async (code: string) => {
      if (code === sanitizeScript('chatgpt')) throw new Error('boom');
      return original(code);
    };
    const failing = fakeSite('grok', { home: 'grok-home.html', sanitizedRaw: JSON.stringify({ ok: false, error: 'page-error' }) });
    const good = fakeSite('deepseek', { home: 'deepseek-home.html' });
    const reports = await run({ chatgpt: unreadable, grok: failing, deepseek: good }, out);
    expect(reports.map((report) => `${report.status}:${report.detail ?? ''}`)).toEqual([
      'failed:the page could not be read',
      'failed:page-error',
      'saved:',
    ]);
  });

  it('turns an unexpected exception into a failed site', async () => {
    const site = fakeSite('chatgpt', { home: 'chatgpt-home.html' });
    const reports = await run({ chatgpt: site }, path.join(outDir(), 'x\0y'));
    expect(reports[0]?.status).toBe('failed');
    const fresh = fakeSite('grok', { home: 'grok-home.html' });
    const odd = await captureAuto({
      sites: ['grok'],
      open: () => ({ runner: fresh.page.runner, load: async () => { throw 'not an error'; } }),
      outDir: outDir(),
      timing: TIMING,
      ...clock(),
    });
    expect(odd[0]?.status).toBe('failed');
  });

  it('uses the real clock and default timing when none is given', async () => {
    const reports = await captureAuto({ sites: ['grok'], open: () => null, outDir: outDir() });
    expect(reports).toEqual([{ site: 'grok', status: 'no-agent' }]);
  });

  it('shortens the waits only in test mode', () => {
    expect(autoTiming({})).toBe(DEFAULT_AUTO_TIMING);
    expect(autoTiming({ AIAW_CAPTURE_AUTO_FAST: '1' })).toBe(DEFAULT_AUTO_TIMING);
    expect(autoTiming({ AIAW_USER_DATA: '/tmp/ud' })).toBe(DEFAULT_AUTO_TIMING);
    expect(autoTiming({ AIAW_USER_DATA: '/tmp/ud', AIAW_CAPTURE_AUTO_FAST: '1' }).discoverMs).toBeLessThan(DEFAULT_AUTO_TIMING.discoverMs);
  });

  it('formats one line per site and exits non-zero unless everything was saved', () => {
    const reports: AutoReport[] = [
      { site: 'chatgpt', status: 'saved', path: '/x/chatgpt.html', detail: 'note' },
      { site: 'grok', status: 'no-chat' },
      { site: 'deepseek', status: 'failed', detail: 'why' },
    ];
    expect(formatAutoReport(reports).split('\n')).toEqual([
      'chatgpt: saved, /x/chatgpt.html, note',
      'grok: no existing chat (nothing saved)',
      'deepseek: failed, why',
    ]);
    expect(autoExitCode(reports)).toBe(1);
    expect(autoExitCode([])).toBe(1);
    expect(autoExitCode([{ site: 'grok', status: 'saved', path: 'p' }])).toBe(0);
    expect(formatAutoReport([{ site: 'grok', status: 'not-signed-in' }, { site: 'chatgpt', status: 'leak-refused' }])).toContain('not signed in');
  });

  it('keeps every window hidden while the unattended capture runs', () => {
    expect(windowsVisible({ AIAW_CAPTURE_AUTO: '/tmp/out' })).toBe(false);
    expect(windowsVisible({ AIAW_CAPTURE_AUTO: '/tmp/out', AIAW_USER_DATA: '/tmp/ud', AIAW_SHOW_WINDOWS: '1' })).toBe(false);
    expect(windowsVisible({ AIAW_CAPTURE_AUTO: '' })).toBe(true);
  });
});

function deps(overrides: Partial<ProfileLockDeps>): ProfileLockDeps {
  return { processes: async () => [], readLink: async () => null, isAlive: () => false, ownPid: 100, ...overrides };
}

const PROFILE = '/Users/me/Library/Application Support/ai-agent-windows';

describe('profile in use', () => {
  it('knows the default profile of each platform', () => {
    expect(defaultUserData('darwin', {}, '/Users/me')).toBe(PROFILE);
    expect(defaultUserData('win32', { APPDATA: 'C:\\Roaming' }, 'C:\\Users\\me')).toBe(path.join('C:\\Roaming', 'ai-agent-windows'));
    expect(defaultUserData('win32', {}, '/h')).toBe(path.join('/h', 'AppData', 'Roaming', 'ai-agent-windows'));
    expect(defaultUserData('linux', { XDG_CONFIG_HOME: '/cfg' }, '/h')).toBe('/cfg/ai-agent-windows');
    expect(defaultUserData('linux', {}, '/h')).toBe('/h/.config/ai-agent-windows');
  });

  it('reads ps output and matches the exact profile directory, not its neighbours', () => {
    const rows = parseProcessList(
      ` 12 1 /x/Electron --user-data-dir=${PROFILE} --app-path=/a\n 13 12 /x/Electron --user-data-dir=${PROFILE}\n 14 1 /x/Electron --user-data-dir=${PROFILE}-2 --app-path=/a\ngarbage\n`,
    );
    expect(rows.map((row) => row.pid)).toEqual([12, 13, 14]);
    expect(rows.map((row) => holdsProfile(row, PROFILE, 100))).toEqual([true, true, false]);
    expect(holdsProfile({ pid: 100, ppid: 1, command: `--user-data-dir=${PROFILE}` }, PROFILE, 100)).toBe(false);
    expect(holdsProfile({ pid: 5, ppid: 1, command: 'node' }, PROFILE, 100)).toBe(false);
  });

  it('refuses while another process holds the profile', async () => {
    const reason = await profileInUse(PROFILE, deps({ processes: async () => [{ pid: 12, ppid: 1, command: `E --user-data-dir=${PROFILE} --x` }] }));
    expect(reason).toContain('process 12');
  });

  it('refuses when the process list cannot be read', async () => {
    const reason = await profileInUse(PROFILE, deps({ processes: async () => { throw new Error('no ps'); } }));
    expect(reason).toContain('cannot be read');
  });

  it('refuses while the singleton lock names a live process, ignores a stale or own one', async () => {
    const live = deps({ readLink: async () => 'host-4242', isAlive: (pid) => pid === 4242 });
    expect(await profileInUse(PROFILE, live)).toContain('process 4242');
    expect(await profileInUse(PROFILE, deps({ readLink: async () => 'host-4242' }))).toBeNull();
    expect(await profileInUse(PROFILE, deps({ readLink: async () => 'host-100', isAlive: () => true }))).toBeNull();
    expect(await profileInUse(PROFILE, deps({ readLink: async () => 'garbage', isAlive: () => true }))).toBeNull();
    expect(await profileInUse(PROFILE, deps({}))).toBeNull();
  });

  it('sees a real process started with the profile flag, and nothing once it is gone', async () => {
    const base = mkdtempSync(path.join(tmpdir(), 'aiaw lock '));
    const profile = path.join(base, 'ai-agent-windows');
    mkdirSync(profile);
    const system = systemProfileLockDeps();
    expect(await profileInUse(profile, system)).toBeNull();
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)', '--', `--user-data-dir=${profile}`], { stdio: 'ignore' });
    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await profileInUse(profile, system)).toContain(`process ${child.pid}`);
    } finally {
      child.kill();
    }
    await new Promise((resolve) => child.once('exit', resolve));
    expect(await profileInUse(profile, system)).toBeNull();
  });

  it('reads the singleton lock link and tells live from dead processes', async () => {
    const base = mkdtempSync(path.join(tmpdir(), 'aiaw-lock-'));
    symlinkSync(`host-${process.pid}`, path.join(base, 'SingletonLock'));
    const system = systemProfileLockDeps();
    expect(await system.readLink(path.join(base, 'SingletonLock'))).toBe(`host-${process.pid}`);
    expect(await system.readLink(path.join(base, 'missing'))).toBeNull();
    expect(system.isAlive(process.pid)).toBe(true);
    expect(system.isAlive(2147483646)).toBe(false);
    expect(system.isAlive(1)).toBe(true);
    expect(system.ownPid).toBe(process.pid);
  });
});
