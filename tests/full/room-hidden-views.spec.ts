// room-hidden-views.spec.ts
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
const stubCli = path.join(root, 'tests', 'fixtures', 'stub-cli.mjs');
const OWNER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const RAF_REPLY = 'FRAME-ONLY-REPLY drawn by a frame callback of the page';
const TRUSTED_REPLY = 'TRUSTED-ENTER-REPLY accepted by a real key press only';

function chatPage(mode: 'frames' | 'trusted'): string {
  const reply = mode === 'frames' ? RAF_REPLY : TRUSTED_REPLY;
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${mode} chat</title></head>
<body>
<main id="log" style="white-space: pre-wrap"></main>
<textarea aria-label="Message"></textarea>
${mode === 'frames' ? '<button type="button" id="send" disabled>Send</button>' : ''}
<script>
const ta = document.querySelector('textarea');
const send = document.getElementById('send');
const log = document.getElementById('log');
const say = (role, text) => {
  const node = document.createElement('div');
  node.className = 'msg ' + role;
  node.textContent = text;
  log.appendChild(node);
};
const afterFrames = (count, work) => {
  const tick = () => (count -= 1) <= 0 ? work() : requestAnimationFrame(tick);
  requestAnimationFrame(tick);
};
const submit = () => {
  const text = ta.value;
  if (text === '') return;
  ta.value = '';
  if (send) send.disabled = true;
  if (${JSON.stringify(mode)} === 'frames') {
    afterFrames(3, () => say('user', text));
    afterFrames(12, () => say('assistant', ${JSON.stringify(reply)}));
  } else {
    say('user', text);
    setTimeout(() => say('assistant', ${JSON.stringify(reply)}), 60);
  }
};
ta.addEventListener('input', () => { if (send) send.disabled = ta.value === ''; });
ta.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey) return;
  if (${JSON.stringify(mode)} === 'trusted' && !event.isTrusted) return;
  event.preventDefault();
  submit();
});
if (send) send.addEventListener('click', submit);
</script>
</body></html>`;
}

interface Site {
  server: Server;
  url: string;
}

async function serve(mode: 'frames' | 'trusted'): Promise<Site> {
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(chatPage(mode));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}/` };
}

async function launch(siteUrl: string): Promise<{ app: ElectronApplication; page: Page; userData: string }> {
  const base = mkdtempSync(path.join(tmpdir(), 'aiaw-hidden-'));
  const userData = path.join(base, 'profile');
  const app = await electron.launch({
    args: [root],
    env: {
      ...process.env,
      AIAW_USER_DATA: userData,
      AIAW_ROOM_FAST: '1',
      AIAW_CLAUDE_BIN: stubCli,
      AIAW_CODEX_BIN: stubCli,
      AIAW_TEST_FOLDER: mkdtempSync(path.join(base, 'folder-')),
      CLAUDE_CONFIG_DIR: path.join(base, 'claude'),
      CODEX_HOME: path.join(base, 'codex'),
      AIAW_SITE_URL_DEEPSEEK: siteUrl,
    },
  });
  const page = await app.firstWindow();
  await page.locator('button[aria-haspopup="menu"]').click();
  await page.locator('.menu-item[data-kind="deepseek"]').click();
  await expect(page.locator('.agent-item')).toHaveCount(1);
  await expect(page.locator('.nav-address')).toHaveText(siteUrl);
  return { app, page, userData };
}

async function runRoom(page: Page): Promise<void> {
  await page.locator('[data-room="open"]').click();
  await expect(page.locator('[data-room="pane"]')).toBeVisible();
  await page.locator('[data-room="prompt"]').fill('hidden view question');
  await page.locator('input[data-participant="deepseek"]').check();
  await page.locator('[data-room="mode"]').selectOption('broadcast');
  await page.locator('[data-room="rounds"]').fill('1');
  await page.locator('[data-room="start"]').click();
  await expect(page.locator('[data-room="status"]')).toContainText('done', { timeout: 25000 });
}

function siteLog(userData: string): string {
  try {
    return readFileSync(path.join(userData, 'logs', 'sites.log'), 'utf8');
  } catch {
    return '';
  }
}

const IDENTITY_SCRIPT = `(async () => {
  const data = navigator.userAgentData;
  const high = await data.getHighEntropyValues(['fullVersionList']);
  return { ua: navigator.userAgent, brands: data.brands.map((item) => item.brand + ' ' + item.version), full: high.fullVersionList.map((item) => item.brand + ' ' + item.version) };
})()`;

function identityOf(app: ElectronApplication, url: string): Promise<{ ua: string; brands: string[]; full: string[] }> {
  return app.evaluate(
    ({ webContents }, [pageUrl, script]) => {
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === pageUrl);
      if (contents === undefined) throw new Error(`no page at ${pageUrl}`);
      return contents.executeJavaScript(script as string);
    },
    [url, IDENTITY_SCRIPT],
  );
}

test('a site that draws only inside animation frames answers while the Room covers its view', async () => {
  const site = await serve('frames');
  const { app, page, userData } = await launch(site.url);
  try {
    await runRoom(page);
    await expect(page.locator('.room-entry.kind-reply .room-entry-text').first()).toContainText('FRAME-ONLY-REPLY');
    const turns = siteLog(userData)
      .split('\n')
      .filter((line) => / deepseek turn /.test(line));
    expect(turns.length).toBeGreaterThan(0);
    const first = turns[0] ?? '';
    expect(Number(/ frames=(\d+)/.exec(first)?.[1] ?? '0')).toBeGreaterThan(0);
    expect(first).toMatch(/ textLenBefore=\d+ /);
    expect(Number(/ textLenAtEnd=(\d+)/.exec(first)?.[1] ?? '0')).toBeGreaterThan(0);
  } finally {
    await app.close();
    site.server.close();
  }
});

test('a parked view keeps the owner identity, the isolated world and the trusted Enter fallback', async () => {
  const site = await serve('trusted');
  const { app, page } = await launch(site.url);
  try {
    const before = await identityOf(app, site.url);
    expect(before.ua).toBe(OWNER_USER_AGENT);

    await runRoom(page);
    await expect(page.locator('.room-entry.kind-reply .room-entry-text').first()).toContainText('TRUSTED-ENTER-REPLY');

    const windows = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((window) => ({
        visible: window.isVisible(),
        focusable: window.isFocusable(),
        children: window.contentView.children.length,
      })),
    );
    expect(windows.some((window) => window.visible)).toBe(false);
    expect(windows.some((window) => !window.focusable && window.children === 1)).toBe(true);

    await page.locator('.agent-item').first().click();
    await expect
      .poll(() =>
        app.evaluate(
          ({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().startsWith('file:'))?.contentView.children.length,
        ),
      )
      .toBe(1);

    const after = await identityOf(app, site.url);
    expect(after.ua).toBe(OWNER_USER_AGENT);
    expect(after.brands).toContain('Google Chrome 152');
    expect(after.full.some((item) => item.startsWith('Google Chrome 152.0.'))).toBe(true);

    await app.evaluate(({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === url);
      void contents?.executeJavaScript(`window.open(${JSON.stringify(url + 'popup')})`);
    }, site.url);
    await expect
      .poll(() => app.evaluate(({ webContents }, url) => webContents.getAllWebContents().some((item) => item.getURL() === url), `${site.url}popup`))
      .toBe(true);
    const popup = await identityOf(app, `${site.url}popup`);
    expect(popup.ua).toBe(OWNER_USER_AGENT);
    expect(popup.brands).toContain('Google Chrome 152');
    const parentUrl = await app.evaluate(({ BrowserWindow, webContents }, url) => {
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === url);
      const window = contents === undefined ? null : BrowserWindow.fromWebContents(contents);
      return window?.getParentWindow()?.webContents.getURL() ?? 'no-parent';
    }, `${site.url}popup`);
    expect(parentUrl.startsWith('file:')).toBe(true);
  } finally {
    await app.close();
    site.server.close();
  }
});

test('closing the main window destroys the parking window so the app quits', async () => {
  const site = await serve('trusted');
  const { app, page } = await launch(site.url);
  try {
    await page.locator('[data-room="open"]').click();
    await expect(page.locator('[data-room="pane"]')).toBeVisible();
    const parked = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    expect(parked).toBe(2);
    const closed = app.waitForEvent('close', { timeout: 15000 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().startsWith('file:'))?.close());
    await closed;
  } finally {
    await app.close().catch(() => undefined);
    site.server.close();
  }
});
