// capture-sanitize.test.ts
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { captureSites, summarizeCapture } from '../../src/main/capture-sites';
import { SANITIZE_POLICY, findLeaks, isClosedValue, sanitizePage, sanitizePageDetailed, sanitizeScript, type SanitizeStats } from '../../src/shared/capture-sanitize';
import type { PageRunner } from '../../src/main/site-adapters/types';

const SECRETS = [
  'ACME merger',
  'quarterly numbers',
  'owner@example.com',
  'private-token-value',
  'tooltip secret',
  'draft secret',
  'photo of secret',
  'confidential comment',
  'cookie-secret-value',
  'storage-token-value',
  'abc123def456abc123def456',
  '5f2c8e1a-1111-4222-8333-944455556666',
  'cdn.example.com',
  'Hidden secret title',
  'secret-class-word-ʘ',
];

const PAGE = `<!doctype html><html lang="en"><head><title>Hidden secret title</title>
<meta name="description" content="ACME merger"><style>.x{background:url(https://cdn.example.com/a.png)}</style>
<script>window.token = "private-token-value"</script></head>
<body class="dark">
<!-- confidential comment -->
<nav><a href="/c/5f2c8e1a-1111-4222-8333-944455556666" aria-label="Chat about ACME merger" class="item secret-class-word-ʘ">ACME merger notes</a>
<button aria-label="Send message" data-testid="send-button" class="btn primary">Send</button></nav>
<main>
<div data-message-author-role="user" data-message-id="5f2c8e1a-1111-4222-8333-944455556666" data-user-email="owner@example.com" class="msg user">Please summarise the quarterly numbers</div>
<div data-message-author-role="assistant" class="msg assistant markdown"><p>Reply about the ACME merger</p><pre><code>private-token-value</code></pre></div>
<img src="https://cdn.example.com/p.png" alt="photo of secret" title="tooltip secret">
<svg class="icon" viewBox="0 0 1 1"><title>tooltip secret</title><path d="M0 0L1 1"/></svg>
<textarea id="prompt-textarea" placeholder="Hidden secret title" aria-label="Message">draft secret</textarea>
<input type="text" value="owner@example.com" name="q" id="abc123def456abc123def456">
<input type="file" id="file" accept=".pdf,image/*">
<div contenteditable="true" role="textbox" id="ce" style="color:red" onclick="steal()"><p>draft secret</p></div>
<iframe src="https://cdn.example.com/frame" class="frame"></iframe>
<script>fetch('https://cdn.example.com/x')</script>
</main></body></html>`;

function openPage(): JSDOM {
  const dom = new JSDOM(PAGE, { runScripts: 'outside-only', url: 'https://chat.example.com/c/5f2c8e1a-1111-4222-8333-944455556666?token=storage-token-value' });
  dom.window.document.cookie = 'session=cookie-secret-value';
  dom.window.localStorage.setItem('auth', 'storage-token-value');
  return dom;
}

function expectNoSecrets(html: string): void {
  for (const secret of SECRETS) expect(html, secret).not.toContain(secret);
  expect(html).not.toMatch(/<script|<style|<!--|style=|onclick|content=/i);
}

describe('capture sanitizer', () => {
  it('leaves no original text, cookie, storage value or url', () => {
    const dom = openPage();
    const html = sanitizePage(dom.window.document, 'chatgpt', SANITIZE_POLICY);
    expectNoSecrets(html);
    expect(findLeaks(html)).toEqual([]);
  });

  it('gives the same result when injected as a script string', async () => {
    const dom = openPage();
    const direct = sanitizePage(dom.window.document, 'grok', SANITIZE_POLICY);
    const raw = dom.window.eval(sanitizeScript('grok')) as string;
    const parsed = JSON.parse(raw) as { ok: boolean; html: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.html).toBe(direct);
    expectNoSecrets(parsed.html);
  });

  it('keeps the structure an adapter needs', () => {
    const html = sanitizePage(openPage().window.document, 'chatgpt', SANITIZE_POLICY);
    const out = new JSDOM(html).window.document;
    expect(out.documentElement.getAttribute('data-aiaw-site')).toBe('chatgpt');
    expect(out.querySelector('button[data-testid="send-button"][aria-label="Send message"].btn')).not.toBeNull();
    expect(out.querySelector('div[data-message-author-role="assistant"].msg.assistant.markdown > p')).not.toBeNull();
    expect(out.querySelector('div[data-message-author-role="user"]')).not.toBeNull();
    expect(out.querySelector('textarea[aria-label="Message"]')?.getAttribute('placeholder')).toBe('x');
    expect(out.querySelector('textarea')?.getAttribute('id')).toMatch(/^id-\d+$/);
    expect(out.querySelector('[contenteditable="true"][role="textbox"] > p')?.textContent).toBe('x');
    expect(out.querySelector('input[type="file"]')?.getAttribute('accept')).toBe('x');
    expect(out.querySelector('svg.icon')?.children.length).toBe(0);
    expect(out.querySelectorAll('iframe.frame').length).toBe(1);
    expect(out.querySelector('textarea')?.textContent).toBe('x');
  });

  it('keeps no value of a user-content attribute and only closed-set control labels', () => {
    const html = sanitizePage(openPage().window.document, 'deepseek', SANITIZE_POLICY);
    const out = new JSDOM(html).window.document;
    expect(out.querySelector('a')?.getAttribute('aria-label')).toBe('x');
    expect(out.querySelector('[data-user-email]')?.getAttribute('data-user-email')).toBe('x');
    expect(out.querySelector('[data-message-author-role="user"]')?.getAttribute('data-message-id')).toMatch(/^id-\d+$/);
    expect(html).not.toContain('5f2c8e1a');
    expect(out.querySelector('#abc123def456abc123def456')).toBeNull();
    expect(out.querySelector('textarea')?.getAttribute('aria-label')).toBe('Message');
  });

  it('replaces every text node, however nested', () => {
    const dom = new JSDOM('<body><div><span>one</span> two <b><i>three</i></b></div><p>   </p></body>');
    const html = sanitizePage(dom.window.document, 'x', SANITIZE_POLICY);
    const out = new JSDOM(html).window.document;
    expect(out.body.textContent?.replace(/\s+/g, '')).toBe('xxx');
    expect(findLeaks(html)).toEqual([]);
  });
});

const ATTACK_PAGE = `<body><div id="private-token-value" class="private-token-value" data-state="private-token-value" aria-current="private-token-value" data-testid="user-probe7f3" data-turn-id="Xk3PqZ9aLmNvBcRtYwQeU">x</div></body>`;
const ATTACK_VALUES = ['private-token-value', 'probe7f3', 'Xk3PqZ9aLmNvBcRtYwQeU'];

describe('capture sanitizer attribute values', () => {
  it('keeps no token-shaped value that is not in the closed vocabulary', () => {
    const html = sanitizePage(new JSDOM(ATTACK_PAGE).window.document, 'chatgpt', SANITIZE_POLICY);
    for (const value of ATTACK_VALUES) expect(html, value).not.toContain(value);
    expect(findLeaks(html)).toEqual([]);
  });

  it('maps ids and references to the same placeholders so references still resolve', () => {
    const page = '<body><label for="user-handle-q9">a</label><input id="user-handle-q9" aria-describedby="hint-zz9 user-handle-q9"><p id="hint-zz9" data-message-id="Xk3PqZ9aLmNvBcRtYwQeU">b</p></body>';
    const html = sanitizePage(new JSDOM(page).window.document, 'grok', SANITIZE_POLICY);
    const out = new JSDOM(html).window.document;
    const input = out.querySelector('input');
    const target = input?.getAttribute('id') ?? '';
    expect(target).toMatch(/^id-\d+$/);
    expect(out.querySelector('label')?.getAttribute('for')).toBe(target);
    const [hint = '', again = ''] = (input?.getAttribute('aria-describedby') ?? '').split(' ');
    expect(again).toBe(target);
    expect(out.querySelector('p')?.getAttribute('id')).toBe(hint);
    expect(hint).not.toBe(target);
    expect(out.querySelector('p')?.getAttribute('data-message-id')).toMatch(/^id-\d+$/);
    expect(html).not.toContain('user-handle-q9');
    expect(findLeaks(html)).toEqual([]);
  });

  it('keeps values from the closed vocabulary that an adapter needs', () => {
    const page = '<body class="dark"><button data-state="open" aria-expanded="true" aria-current="page" data-testid="stop-button" role="button" type="submit" class="btn">x</button><div data-testid="conversation-turn-3" data-message-author-role="assistant">y</div></body>';
    const html = sanitizePage(new JSDOM(page).window.document, 'deepseek', SANITIZE_POLICY);
    const out = new JSDOM(html).window.document;
    expect(out.querySelector('button[data-state="open"][aria-expanded="true"][aria-current="page"][data-testid="stop-button"][role="button"][type="submit"].btn')).not.toBeNull();
    expect(out.querySelector('div[data-testid="conversation-turn-3"][data-message-author-role="assistant"]')).not.toBeNull();
    expect(findLeaks(html)).toEqual([]);
  });

  it.each([
    ['a free-word id', '<html><body><div id="private-token-value">x</div></body></html>'],
    ['a free-word class', '<html><body><div class="private-token-value">x</div></body></html>'],
    ['a free-word data-state', '<html><body><div data-state="private-token-value">x</div></body></html>'],
    ['a free-word aria value', '<html><body><div aria-current="private-token-value">x</div></body></html>'],
    ['a free-word test id', '<html><body><div data-testid="user-probe7f3">x</div></body></html>'],
    ['a base62 id value', '<html><body><div data-turn-id="Xk3PqZ9aLmNvBcRtYwQeU">x</div></body></html>'],
    ['a free-word reference', '<html><body><div aria-labelledby="id-1 private-token-value">x</div></body></html>'],
  ])('leak check flags %s without echoing it', (_name, html) => {
    const problems = findLeaks(html);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join('\n')).not.toMatch(/private|probe7f3|Xk3P/);
  });
});

const R2_PAGE = `<!doctype html><body>
  <div data-private-token-value="x" zq-probe7f3abc123 data-state="4111-1111-1111-1111" aria-valuenow="0142 7788 5512 9031" class="1234.5678.9012.3456">
  <private-token-value role="status">x</private-token-value></div></body>`;

describe('capture sanitizer closed names', () => {
  it('keeps no attribute name, element name or digit-group value from the page', () => {
    const html = sanitizePage(new JSDOM(R2_PAGE).window.document, 'probe', SANITIZE_POLICY);
    for (const leak of ['private-token-value', 'probe7f3', '4111', '0142', '1234.5678']) expect(html, leak).not.toContain(leak);
    expect(html).toContain('role="status"');
    expect(findLeaks(html)).toEqual([]);
  });

  it('rebuilds a custom element as a plain div and keeps its children', () => {
    const page = '<body><my-widget-9f3 data-testid="send-button"><button aria-label="Send">q</button></my-widget-9f3></body>';
    const html = sanitizePage(new JSDOM(page).window.document, 'probe', SANITIZE_POLICY);
    const out = new JSDOM(html).window.document;
    expect(html).not.toContain('widget');
    expect(out.querySelector('div[data-testid="send-button"] > button')).not.toBeNull();
    expect(findLeaks(html)).toEqual([]);
  });

  it('keeps data-* names made of closed words and drops the rest', () => {
    const page = '<body><div data-message-author-role="user" data-turn-id="abc" data-turn-9="a" data-Zq="a" data-state-="x">x</div></body>';
    const html = sanitizePage(new JSDOM(page).window.document, 'probe', SANITIZE_POLICY);
    expect(html).toContain('data-message-author-role="user"');
    expect(html).toMatch(/data-turn-id="id-\d+"/);
    expect(html).not.toContain('data-turn-9');
    expect(html).not.toContain('data-zq');
    expect(html).not.toContain('data-state-');
  });

  it('never calls a value with several digit groups closed', () => {
    const words = new Set(SANITIZE_POLICY.words);
    for (const value of ['4111-1111-1111-1111', '0142 7788', '12.34', 'turn-3-4']) expect(isClosedValue(value, words), value).toBe(false);
    for (const value of ['conversation-turn-3', '42', 'step-1']) expect(isClosedValue(value, words), value).toBe(true);
  });

  it('closes digit groups split over class tokens and numeric attributes of one element', () => {
    const page = '<body><div class="4111 1111 1111 1111 turn-3" data-state="4111 1111 1111 1111"><span tabindex="0142" aria-level="7788" aria-posinset="5512" aria-setsize="9031" aria-valuenow="42">x</span></div></body>';
    const html = sanitizePage(new JSDOM(page).window.document, 'probe', SANITIZE_POLICY);
    for (const leak of ['4111', '1111', '7788', '5512', '9031']) expect(html, leak).not.toContain(leak);
    const out = new JSDOM(html).window.document;
    for (const element of Array.from(out.querySelectorAll('*'))) {
      const values = Array.from(element.attributes).filter((a) => !a.name.startsWith('data-aiaw')).map((a) => a.value);
      const groups = values.join(' ').split(/[^A-Za-z0-9]+/).filter((part) => /^\d+$/.test(part));
      expect(groups.length, element.localName).toBeLessThanOrEqual(1);
    }
    expect(out.querySelector('div')?.getAttribute('class')).toBe('turn-3');
    expect(findLeaks(html)).toEqual([]);
  });

  it('drops class tokens without a closed word', () => {
    const html = sanitizePage(new JSDOM('<body><div class="4111 zq9 text-sm">x</div></body>').window.document, 'probe', SANITIZE_POLICY);
    expect(html).toContain('class="text-sm"');
    expect(html).not.toContain('4111');
  });

  it.each([
    ['digit-only class tokens in one element', '<html><body><div class="4111 1111 1111 1111">x</div></body></html>'],
    ['numeric attributes of one element', '<html><body><span tabindex="0142" aria-level="7788" aria-posinset="5512" aria-setsize="9031">x</span></body></html>'],
    ['a class number and an aria number', '<html><body><div class="turn-3" aria-level="7788">x</div></body></html>'],
  ])('leak check flags %s', (_name, html) => {
    expect(findLeaks(html).length).toBeGreaterThan(0);
  });

  it.each([
    ['an attribute name outside the closed set', '<html><body><div data-private-token-value="x">x</div></body></html>'],
    ['a bare attribute name', '<html><body><div zq-probe7f3abc123>x</div></body></html>'],
    ['a data name with digits', '<html><body><div data-turn-4111="x">x</div></body></html>'],
    ['an aria name outside the list', '<html><body><div aria-secret-note="x">x</div></body></html>'],
    ['a custom element name', '<html><body><private-token-value>x</private-token-value></body></html>'],
    ['digit groups in a value', '<html><body><div data-state="4111-1111-1111-1111">x</div></body></html>'],
    ['digit groups in a class', '<html><body><div class="1234.5678.9012.3456">x</div></body></html>'],
    ['digit groups in an aria value', '<html><body><div aria-valuenow="0142 7788 5512 9031">x</div></body></html>'],
  ])('leak check flags %s without echoing it', (_name, html) => {
    const problems = findLeaks(html);
    expect(problems.length).toBeGreaterThan(0);
    for (const word of ['private-token', 'probe7f3', '4111', '0142', '1234', 'secret']) expect(problems.join('\n')).not.toContain(word);
  });

  it('accepts what the sanitizer writes for a normal page', () => {
    expect(findLeaks(sanitizePage(openPage().window.document, 'chatgpt', SANITIZE_POLICY))).toEqual([]);
  });
});

describe('capture sanitizer limits', () => {
  it('stops at the depth limit and marks the page as truncated', () => {
    const dom = new JSDOM('<body></body>');
    const { document } = dom.window;
    let node: Element = document.body;
    for (let depth = 0; depth < 450; depth += 1) {
      const next = document.createElement('div');
      node.appendChild(next);
      node = next;
    }
    const html = sanitizePage(document, 'x', SANITIZE_POLICY);
    expect(html).toContain('data-aiaw-truncated="true"');
    expect(findLeaks(html)).toEqual([]);
  });

  it('stops at the node limit', () => {
    const dom = new JSDOM('<body></body>');
    const { document } = dom.window;
    for (let index = 0; index < 120; index += 1) document.body.appendChild(document.createElement('i'));
    const html = sanitizePage(document, 'x', { ...SANITIZE_POLICY, maxNodes: 50 });
    expect(html).toContain('data-aiaw-truncated="true"');
    expect(html.match(/<i>/g)).toHaveLength(49);
    expect(sanitizePage(document, 'x', { ...SANITIZE_POLICY, maxNodes: 500 })).not.toContain('data-aiaw-truncated');
  });

  it('runs the page with the production node limit', () => {
    expect(SANITIZE_POLICY.maxNodes).toBe(60000);
    expect(sanitizeScript('x')).toContain('"maxNodes":60000');
  });

  it('rebuilds an element whose name cannot be recreated and drops a class with no safe token', () => {
    const dom = new JSDOM('<body><a$b>words</a$b><p class="café">x</p><p id="  " 9x="a" aria-labelledby="one two">y</p></body>');
    const html = sanitizePage(dom.window.document, 'x', SANITIZE_POLICY);
    expect(html).not.toContain('words');
    expect(html).not.toContain('class=');
    expect(html).not.toContain('9x');
    expect(html).toMatch(/aria-labelledby="id-\d+ id-\d+"/);
    expect(findLeaks(html)).toEqual([]);
  });

  it('handles a page without a body', () => {
    const dom = new JSDOM('<body><p>words</p></body>');
    const { document } = dom.window;
    document.documentElement.removeChild(document.body);
    const html = sanitizePage(document, 'x', SANITIZE_POLICY);
    expect(html).toContain('<body></body>');
  });
});

describe('capture leak check', () => {
  it.each([
    ['text outside placeholders', '<html><body><p>real words</p></body></html>'],
    ['a script element', '<html><body><script>1</script></body></html>'],
    ['an href', '<html><body><a href="https://a.b/c">x</a></body></html>'],
    ['an inline handler', '<html><body><a onclick="x">x</a></body></html>'],
    ['a free-text attribute value', '<html><body><div data-foo="two words">x</div></body></html>'],
    ['a free-text title', '<html><body><div title="secret">x</div></body></html>'],
    ['an unsafe class', '<html><body><div class="café">x</div></body></html>'],
    ['an unsafe id', '<html><body><div id="two words">x</div></body></html>'],
    ['a label outside the closed set', '<html><body><div aria-label="hello">x</div></body></html>'],
    ['a comment', '<html><body><!-- note --></body></html>'],
  ])('flags %s without echoing it', (_name, html) => {
    const problems = findLeaks(html);
    expect(problems.length).toBeGreaterThan(0);
    for (const word of ['real words', 'two words', 'secret', 'https://a.b/c', 'note']) {
      expect(problems.join('\n')).not.toContain(word);
    }
  });
});

function runnerFor(html: string | null, ok = true): PageRunner {
  return {
    run: () =>
      Promise.resolve(JSON.stringify(ok && html !== null ? { ok: true, html } : { ok: false, error: 'page-error' })),
  };
}

describe('capture command', () => {
  it('writes one file per site and reports the sites that were not open', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'aiaw-capture-'));
    const clean = sanitizePage(openPage().window.document, 'chatgpt', SANITIZE_POLICY);
    const results = await captureSites([{ kind: 'chatgpt', runner: runnerFor(clean) }], dir);
    expect(readdirSync(dir)).toEqual(['chatgpt.html']);
    expect(readFileSync(path.join(dir, 'chatgpt.html'), 'utf8')).toBe(clean);
    expect(results).toEqual([{ site: 'chatgpt', ok: true, path: path.join(dir, 'chatgpt.html') }]);
    const message = summarizeCapture(results);
    expect(message).toContain('chatgpt: saved');
    expect(message).toContain('grok: not opened');
    expect(message).toContain('deepseek: not opened');
  });

  it('refuses to write a page that still carries text', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'aiaw-capture-'));
    const leaky = '<html><body><p>real private words</p></body></html>';
    const results = await captureSites([{ kind: 'grok', runner: runnerFor(leaky) }], dir);
    expect(readdirSync(dir)).toEqual([]);
    expect(results[0]?.ok).toBe(false);
    expect(JSON.stringify(results)).not.toContain('private');
  });

  it('reports a failing page and keeps going', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'aiaw-capture-'));
    const clean = sanitizePage(openPage().window.document, 'deepseek', SANITIZE_POLICY);
    const results = await captureSites(
      [
        { kind: 'grok', runner: runnerFor(null, false) },
        { kind: 'deepseek', runner: runnerFor(clean) },
      ],
      dir,
    );
    expect(results.map((r) => [r.site, r.ok])).toEqual([
      ['grok', false],
      ['deepseek', true],
    ]);
    expect(readdirSync(dir)).toEqual(['deepseek.html']);
  });
});

const STYLED_PAGE = `<!doctype html><html><head><title>t</title>
<style>
._5f3a9c, .hashed-c4f91a02 { color: red }
@media (min-width: 600px) { .ds-markdown-x { margin: 0 } @supports (display: grid) { .deep-rule-q { margin: 1px } } }
.md\\:flex { display: flex }
.w-\\[10px\\] { width: 10px }
a[href$=".pdf"] { color: blue }
.has-attr[data-x=".attr-only"] { color: blue }
</style></head><body>
<main>
<div class="_5f3a9c msg hashed-c4f91a02 acme-merger-notes">secret one</div>
<div class="ds-markdown-x deep-rule-q md:flex w-[10px] pdf attr-only has-attr">secret two</div>
<div class="unstyled-ʘ never-in-a-sheet">secret three</div>
</main></body></html>`;

function styledResult() {
  const dom = new JSDOM(STYLED_PAGE, { runScripts: 'outside-only', url: 'https://chat.example.com/c/5f2c8e1a-1111-4222-8333-944455556666' });
  return sanitizePageDetailed(dom.window.document, 'deepseek', SANITIZE_POLICY);
}

describe('capture sanitizer stylesheet classes', () => {
  it('keeps class tokens that are class selectors of the page stylesheets and drops the rest', () => {
    const { html, classes } = styledResult();
    const out = new JSDOM(html).window.document;
    const first = (out.querySelectorAll('main > div')[0] as Element).getAttribute('class');
    const second = (out.querySelectorAll('main > div')[1] as Element).getAttribute('class');
    expect(first).toBe('_5f3a9c msg hashed-c4f91a02');
    expect(second).toBe('ds-markdown-x deep-rule-q md:flex w-[10px] has-attr');
    expect(out.querySelectorAll('main > div')[2]?.hasAttribute('class')).toBe(false);
    expect(html).not.toMatch(/acme-merger-notes|never-in-a-sheet|attr-only|pdf|ʘ/);
    expect(html).not.toMatch(/secret|<style/);
    expect(classes).toEqual(['_5f3a9c', 'deep-rule-q', 'ds-markdown-x', 'has-attr', 'hashed-c4f91a02', 'md:flex', 'w-[10px]']);
  });

  it('passes the leak check with the declared classes and fails it without them', () => {
    const { html, classes } = styledResult();
    expect(findLeaks(html, classes)).toEqual([]);
    expect(findLeaks(html)).toEqual(['attribute class value']);
    expect(findLeaks(html, classes.filter((name) => name !== 'md:flex'))).toEqual(['attribute class value']);
  });

  it('refuses a declared class of an unsafe shape and a token that is not declared', () => {
    const html = '<!doctype html>\n<html data-aiaw-site="x"><body><div class="a<b"></div></body></html>\n';
    expect(findLeaks(html, ['a<b'])).toEqual(['attribute class value']);
    const long = 'a'.repeat(65);
    expect(findLeaks(`<!doctype html>\n<html><body><div class="${long}"></div></body></html>\n`, [long])).toEqual(['attribute class value']);
    expect(findLeaks('<!doctype html>\n<html><body><div class="9starts-with-digit"></div></body></html>\n', ['9starts-with-digit'])).toEqual(['attribute class value']);
    expect(findLeaks('<!doctype html>\n<html><body><div class="known"></div></body></html>\n', ['known'])).toEqual([]);
    expect(findLeaks('<!doctype html>\n<html><body><div class="msg other"></div></body></html>\n', ['known'])).toEqual(['attribute class value']);
  });

  it('keeps counting digit groups of closed words next to stylesheet classes', () => {
    const html = '<!doctype html>\n<html><body><div class="msg-1 msg-2 hashed-c4f91a02"></div></body></html>\n';
    expect(findLeaks(html, ['hashed-c4f91a02'])).toEqual(['digit groups']);
  });

  it('carries the declared classes and the statistics in the injected script answer', () => {
    const dom = new JSDOM(STYLED_PAGE, { runScripts: 'outside-only' });
    const parsed = JSON.parse(dom.window.eval(sanitizeScript('deepseek')) as string) as { ok: boolean; html: string; classes: string[]; stats: SanitizeStats };
    const direct = sanitizePageDetailed(new JSDOM(STYLED_PAGE).window.document, 'deepseek', SANITIZE_POLICY);
    expect(parsed.ok).toBe(true);
    expect(parsed.html).toBe(direct.html);
    expect(parsed.classes).toEqual(direct.classes);
    expect(parsed.stats).toEqual(direct.stats);
    expect(parsed.stats.classes.stylesheet).toBe(7);
  });

  it('counts elements before and after and class tokens by outcome, with no text in the numbers', () => {
    const { stats } = styledResult();
    expect(stats.classes).toEqual({ seen: 13, closed: 1, stylesheet: 7, dropped: 5 });
    expect(stats.stylesheets).toMatchObject({ total: 1, readable: 1, unreadable: 0 });
    expect(stats.stylesheets.classNames).toBe(7);
    expect(stats.elements.before).toMatchObject({ body: 1, main: 1, div: 3 });
    expect(stats.elements.after).toMatchObject({ main: 1, div: 3 });
    expect(JSON.stringify(stats)).not.toMatch(/secret|acme|merger/);
  });

  it('buckets elements with an unknown name as other and skips the head in the before count', () => {
    const dom = new JSDOM('<body><my-widget><x-y></x-y></my-widget><div></div></body>');
    const { stats } = sanitizePageDetailed(dom.window.document, 'x', SANITIZE_POLICY);
    expect(stats.elements.before).toEqual({ body: 1, other: 2, div: 1 });
    expect(stats.elements.after).toEqual({ body: 1, div: 3 });
  });

  it('counts a stylesheet that cannot be read and goes on with the others', () => {
    const dom = new JSDOM('<head><style>.readable-x{}</style><style>.other-y{}</style></head><body><div class="readable-x other-y"></div></body>');
    const sheets = dom.window.document.styleSheets;
    Object.defineProperty(sheets[1], 'cssRules', { get: () => { throw new Error('SecurityError'); } });
    const { stats, classes } = sanitizePageDetailed(dom.window.document, 'x', SANITIZE_POLICY);
    expect(stats.stylesheets).toMatchObject({ total: 2, readable: 1, unreadable: 1 });
    expect(classes).toEqual(['readable-x']);
  });

  it('stops collecting stylesheet classes at the cap', () => {
    const selectors = Array.from({ length: 50500 }, (_, index) => `.n${String(index)}`).join(',');
    const dom = new JSDOM(`<head><style>${selectors}{}</style></head><body><div class="n7 n50400"></div></body>`);
    const { stats, classes } = sanitizePageDetailed(dom.window.document, 'x', SANITIZE_POLICY);
    expect(stats.stylesheets.classNames).toBe(50000);
    expect(classes).toEqual(['n7']);
  });

  it('survives a document without a body', () => {
    const dom = new JSDOM('<html></html>');
    dom.window.document.documentElement.removeChild(dom.window.document.body);
    const { stats } = sanitizePageDetailed(dom.window.document, 'x', SANITIZE_POLICY);
    expect(stats.elements.before).toEqual({});
  });
});
