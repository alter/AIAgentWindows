// smoke.spec.ts
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
const stubCli = path.join(root, 'tests', 'fixtures', 'stub-cli.mjs');
const sitePage = readFileSync(path.join(root, 'tests', 'fixtures', 'site-page.html'), 'utf8');

interface Fixture {
  server: Server;
  url: string;
  userAgents: string[];
  clientHints: string[];
}

function startFixtureServer(): Promise<Fixture> {
  const userAgents: string[] = [];
  const clientHints: string[] = [];
  const server = createServer((request, response) => {
    userAgents.push(String(request.headers['user-agent']));
    for (const [name, value] of Object.entries(request.headers)) {
      if (name.startsWith('sec-ch-ua')) clientHints.push(`${name}: ${String(value)}`);
    }
    response.setHeader('content-type', 'text/html; charset=utf-8');
    if (request.url === '/frame-parent') {
      const port = String(request.headers.host).split(':')[1] ?? '';
      response.end(`<!doctype html><iframe id="child" src="http://localhost:${port}/frame-child"></iframe>`);
      return;
    }
    response.end(request.url === '/away' ? '<!doctype html><h1>FIXTURE-SITE-AWAY</h1>' : sitePage);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}/`, userAgents, clientHints });
    });
  });
}

function launch(userData: string, folder: string, extraEnv: Record<string, string> = {}): Promise<ElectronApplication> {
  return electron.launch({
    args: [root],
    env: {
      ...process.env,
      AIAW_USER_DATA: userData,
      AIAW_CLAUDE_BIN: stubCli,
      AIAW_CODEX_BIN: stubCli,
      AIAW_TEST_FOLDER: folder,
      ...extraEnv,
    },
  });
}

async function addAgent(page: Page, kind: string): Promise<void> {
  await page.locator('button[aria-haspopup="menu"]').click();
  await page.locator(`.menu-item[data-kind="${kind}"]`).click();
}

test('a Claude Code agent shows the stub banner and is listed again after a relaunch', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'aiaw-userdata-'));
  const folder = mkdtempSync(path.join(tmpdir(), 'aiaw-folder-'));

  const first = await launch(userData, folder);
  const firstPage = await first.firstWindow();
  await addAgent(firstPage, 'claude');
  await expect(firstPage.locator('.agent-item')).toHaveCount(1);
  await expect(firstPage.locator('.xterm-rows')).toContainText('STUB-CLI BANNER');
  await first.close();

  const second = await launch(userData, folder);
  const secondPage = await second.firstWindow();
  await expect(secondPage.locator('.agent-item')).toHaveCount(1);
  await expect(secondPage.locator('.xterm-rows')).toContainText('STUB-CLI BANNER');
  await second.close();
});

test('in test mode the main window stays hidden', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'aiaw-userdata-'));
  const folder = mkdtempSync(path.join(tmpdir(), 'aiaw-folder-'));
  const visible = (app: ElectronApplication): Promise<boolean[]> =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => window.isVisible()));

  const hidden = await launch(userData, folder);
  const hiddenPage = await hidden.firstWindow();
  await expect(hiddenPage.locator('button[aria-haspopup="menu"]')).toBeAttached();
  expect(await visible(hidden)).toEqual([false]);
  if (process.platform === 'darwin') {
    expect(await hidden.evaluate(({ app }) => app.dock?.isVisible())).toBe(false);
  }
  await hidden.close();
});

test('switching between two terminal agents keeps the visible pane filling the whole content height', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'aiaw-userdata-'));
  const folder = mkdtempSync(path.join(tmpdir(), 'aiaw-folder-'));
  const app = await launch(userData, folder);
  try {
    const page = await app.firstWindow();
    await addAgent(page, 'claude');
    await expect(page.locator('.agent-item')).toHaveCount(1);
    await addAgent(page, 'codex');
    await expect(page.locator('.agent-item')).toHaveCount(2);
    const items = page.locator('.agent-item');
    const measureGap = (): Promise<{ gap: number; row: number }> =>
      page.evaluate(() => {
        const pane = Array.from(document.querySelectorAll<HTMLElement>('.terminal-pane')).find((node) => !node.hidden);
        const screen = pane?.querySelector<HTMLElement>('.xterm-screen');
        const rows = pane?.querySelector<HTMLElement>('.xterm-rows');
        if (!pane || !screen || !rows) return { gap: Number.POSITIVE_INFINITY, row: 1 };
        const host = pane?.querySelector<HTMLElement>('.terminal-host');
        const inner = host?.clientHeight ?? 0;
        const row = rows.firstElementChild?.getBoundingClientRect().height ?? 1;
        return { gap: inner - screen.getBoundingClientRect().height, row };
      });
    for (const index of [0, 1, 0, 1, 0]) {
      await items.nth(index).click();
      await expect(page.locator('.terminal-pane:not([hidden]) .xterm-rows')).toContainText('STUB-CLI BANNER');
      await expect
        .poll(async () => {
          const { gap, row } = await measureGap();
          return gap < row;
        })
        .toBe(true);
    }
  } finally {
    await app.close();
  }
});

test('the terminal text keeps a gap of at least 4 px from every edge of the pane for a Claude and a Codex agent', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'aiaw-userdata-'));
  const folder = mkdtempSync(path.join(tmpdir(), 'aiaw-folder-'));
  const app = await launch(userData, folder);
  try {
    const page = await app.firstWindow();
    for (const kind of ['claude', 'codex']) {
      await addAgent(page, kind);
      await expect(page.locator('.terminal-pane:not([hidden]) .xterm-rows')).toContainText('STUB-CLI BANNER');
      await expect
        .poll(() =>
          page.evaluate(() => {
            const pane = document.querySelector<HTMLElement>('.terminal-pane:not([hidden])');
            const screen = pane?.querySelector<HTMLElement>('.xterm-screen');
            if (!pane || !screen) return Number.NEGATIVE_INFINITY;
            const outer = pane.getBoundingClientRect();
            const inner = screen.getBoundingClientRect();
            return Math.min(inner.top - outer.top, inner.left - outer.left, outer.right - inner.right, outer.bottom - inner.bottom);
          }),
        )
        .toBeGreaterThanOrEqual(4);
    }
  } finally {
    await app.close();
  }
});

test('the area below the last terminal row is painted in the pane colour, not black, for a Claude and a Codex agent', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'aiaw-userdata-'));
  const folder = mkdtempSync(path.join(tmpdir(), 'aiaw-folder-'));
  const app = await launch(userData, folder);
  try {
    const page = await app.firstWindow();
    for (const kind of ['claude', 'codex']) {
      await addAgent(page, kind);
      await expect(page.locator('.terminal-pane:not([hidden]) .xterm-rows')).toContainText('STUB-CLI BANNER');
      await expect
        .poll(() =>
          page.evaluate(() => {
            const pane = document.querySelector<HTMLElement>('.terminal-pane:not([hidden])');
            const host = pane?.querySelector<HTMLElement>('.terminal-host');
            const screen = pane?.querySelector<HTMLElement>('.xterm-screen');
            if (!pane || !host || !screen) return 'missing';
            const hostBox = host.getBoundingClientRect();
            const screenBox = screen.getBoundingClientRect();
            const x = screenBox.left + screenBox.width / 2;
            const y = (screenBox.bottom + hostBox.bottom) / 2;
            const painted = document
              .elementsFromPoint(x, y)
              .map((element) => getComputedStyle(element).backgroundColor)
              .find((colour) => colour !== 'rgba(0, 0, 0, 0)');
            return painted === getComputedStyle(pane).backgroundColor ? 'same' : String(painted);
          }),
        )
        .toBe('same');
    }
  } finally {
    await app.close();
  }
});

test('closing an agent asks for confirmation in the app, removes it, and it stays gone after a relaunch', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'aiaw-userdata-'));
  const folder = mkdtempSync(path.join(tmpdir(), 'aiaw-folder-'));
  const first = await launch(userData, folder);
  try {
    const page = await first.firstWindow();
    await addAgent(page, 'claude');
    await expect(page.locator('.agent-item')).toHaveCount(1);
    await addAgent(page, 'codex');
    await expect(page.locator('.agent-item')).toHaveCount(2);
    await addAgent(page, 'grok');
    await expect(page.locator('.agent-item')).toHaveCount(3);

    await page.locator('.agent-list li').first().hover();
    await page.locator('.agent-close').first().click();
    await expect(page.locator('.close-confirm')).toBeVisible();
    await page.locator('.confirm-no').click();
    await expect(page.locator('.close-confirm')).toBeHidden();
    await expect(page.locator('.agent-item')).toHaveCount(3);

    await page.locator('.agent-list li').first().hover();
    await page.locator('.agent-close').first().click();
    await page.locator('.confirm-yes').click();
    await expect(page.locator('.agent-item')).toHaveCount(2);

    await page.locator('.agent-item').first().click({ button: 'right' });
    await page.locator('.context-item').click();
    await expect(page.locator('.close-confirm')).toBeVisible();
    await page.locator('.confirm-yes').click();
    await expect(page.locator('.agent-item')).toHaveCount(1);
  } finally {
    await first.close();
  }
  const second = await launch(userData, folder);
  try {
    const page = await second.firstWindow();
    await expect(page.locator('.agent-item')).toHaveCount(1);
    await expect(page.locator('.agent-item .agent-title')).toHaveText('Grok');
  } finally {
    await second.close();
  }
});

test('an exited CLI agent offers Restart and starts again in the same pane', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'aiaw-userdata-'));
  const folder = mkdtempSync(path.join(tmpdir(), 'aiaw-folder-'));
  const app = await launch(userData, folder);
  try {
    const page = await app.firstWindow();
    await addAgent(page, 'claude');
    const rows = page.locator('.terminal-pane:not([hidden]) .xterm-rows');
    await expect(rows).toContainText('STUB-CLI BANNER');
    await expect(page.locator('.restart-button')).toBeHidden();
    await page.locator('.terminal-pane:not([hidden]) .xterm').click();
    await page.keyboard.type('/exit');
    await page.keyboard.press('Enter');
    await expect(rows).toContainText('process exited with code 0');
    await expect(page.locator('.restart-button')).toBeVisible();
    await page.locator('.restart-button').click();
    await expect(page.locator('.restart-button')).toBeHidden();
    await expect
      .poll(async () => ((await rows.textContent()) ?? '').split('STUB-CLI BANNER').length - 1)
      .toBe(2);
  } finally {
    await app.close();
  }
});

test('a DeepSeek agent shows a visible view without the Electron token and Home returns to the start URL', async () => {
  const fixture = await startFixtureServer();
  const userData = mkdtempSync(path.join(tmpdir(), 'aiaw-userdata-'));
  const folder = mkdtempSync(path.join(tmpdir(), 'aiaw-folder-'));
  const app = await launch(userData, folder, { AIAW_SITE_URL_DEEPSEEK: fixture.url });
  try {
    const page = await app.firstWindow();
    await addAgent(page, 'deepseek');
    await expect(page.locator('.agent-item')).toHaveCount(1);
    await expect(page.locator('.nav-address')).toHaveText(fixture.url);

    const visibleViews = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]
        ?.contentView.children.filter((child) => (child as { getVisible?: () => boolean }).getVisible?.() === true)
        .map((child) => child.getBounds()),
    );
    expect(visibleViews).toHaveLength(1);
    expect(visibleViews?.[0]?.width).toBeGreaterThan(0);
    expect(visibleViews?.[0]?.height).toBeGreaterThan(0);

    expect(fixture.userAgents.length).toBeGreaterThan(0);
    for (const userAgent of fixture.userAgents) expect(userAgent).not.toContain('Electron/');

    await app.evaluate(({ webContents }, startUrl) => {
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === startUrl);
      void contents?.loadURL(`${startUrl}away`);
    }, fixture.url);
    await expect(page.locator('.nav-address')).toHaveText(`${fixture.url}away`);

    await page.locator('.nav-button[data-action="home"]').click();
    await expect(page.locator('.nav-address')).toHaveText(fixture.url);
  } finally {
    await app.close();
    fixture.server.close();
  }
});

const OWNER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

interface IdentityReport {
  ua: string;
  brands: string[];
  fullVersions: string[];
  platform: string;
  workerUa: string;
}

const IDENTITY_SCRIPT = `(async () => {
  const data = navigator.userAgentData;
  const high = await data.getHighEntropyValues(['fullVersionList', 'platformVersion']);
  const workerUa = await new Promise((resolve) => {
    const worker = new Worker(URL.createObjectURL(new Blob(['postMessage(navigator.userAgent)'])));
    worker.onmessage = (event) => resolve(event.data);
  });
  return {
    ua: navigator.userAgent,
    brands: data.brands.map((item) => item.brand + ' ' + item.version),
    fullVersions: high.fullVersionList.map((item) => item.brand + ' ' + item.version),
    platform: data.platform,
    workerUa,
  };
})()`;

function identityOf(app: ElectronApplication, url: string): Promise<IdentityReport> {
  return app.evaluate(
    ({ webContents }, [pageUrl, script]) => {
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === pageUrl);
      if (contents === undefined) throw new Error(`no page at ${pageUrl}`);
      return contents.executeJavaScript(script as string) as Promise<IdentityReport>;
    },
    [url, IDENTITY_SCRIPT],
  );
}

test('every site view and its popup present the owner user agent and consistent client hints', async () => {
  const fixture = await startFixtureServer();
  const userData = mkdtempSync(path.join(tmpdir(), 'aiaw-userdata-'));
  const folder = mkdtempSync(path.join(tmpdir(), 'aiaw-folder-'));
  const kinds = ['chatgpt', 'grok', 'deepseek'];
  const urlOf = (kind: string): string => `${fixture.url}${kind}`;
  const env = Object.fromEntries(kinds.map((kind) => [`AIAW_SITE_URL_${kind.toUpperCase()}`, urlOf(kind)]));
  const app = await launch(userData, folder, env);
  try {
    const page = await app.firstWindow();
    for (const [index, kind] of kinds.entries()) {
      await addAgent(page, kind);
      await expect(page.locator('.agent-item')).toHaveCount(index + 1);
      await expect(page.locator('.nav-address')).toHaveText(urlOf(kind));
      const report = await identityOf(app, urlOf(kind));
      expect(report.ua).toBe(OWNER_USER_AGENT);
      expect(report.workerUa).toBe(OWNER_USER_AGENT);
      expect(report.brands).toContain('Google Chrome 152');
      expect(report.brands).toContain('Chromium 152');
      expect(report.fullVersions.filter((item) => item.startsWith('Google Chrome ') || item.startsWith('Chromium '))).toHaveLength(2);
      expect(report.fullVersions.every((item) => !item.startsWith('Chromium ') || item.includes('152.0.'))).toBe(true);
      expect(report.fullVersions.some((item) => item.startsWith('Google Chrome 152.0.'))).toBe(true);
      expect(report.platform).toBe('macOS');
    }

    await app.evaluate(({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === url);
      void contents?.executeJavaScript(`window.open(${JSON.stringify(url + '-popup')})`);
    }, urlOf('grok'));
    await expect
      .poll(() => app.evaluate(({ webContents }, url) => webContents.getAllWebContents().some((item) => item.getURL() === url), urlOf('grok-popup')))
      .toBe(true);
    const popup = await identityOf(app, urlOf('grok-popup'));
    expect(popup.ua).toBe(OWNER_USER_AGENT);
    expect(popup.brands).toContain('Google Chrome 152');

    expect(fixture.userAgents.length).toBeGreaterThan(0);
    for (const userAgent of fixture.userAgents) expect(userAgent).toBe(OWNER_USER_AGENT);
    for (const hint of fixture.clientHints.filter((item) => item.startsWith('sec-ch-ua:'))) expect(hint).toContain('"Google Chrome";v="152"');
  } finally {
    await app.close();
    fixture.server.close();
  }
});

test('a storage-access check from a cross-origin iframe in a site view is not refused and is logged', async () => {
  const fixture = await startFixtureServer();
  const userData = mkdtempSync(path.join(tmpdir(), 'aiaw-userdata-'));
  const folder = mkdtempSync(path.join(tmpdir(), 'aiaw-folder-'));
  const app = await launch(userData, folder, { AIAW_SITE_URL_GROK: `${fixture.url}frame-parent` });
  try {
    const page = await app.firstWindow();
    await addAgent(page, 'grok');
    await expect(page.locator('.agent-item')).toHaveCount(1);

    await expect
      .poll(
        () =>
          app.evaluate(async ({ webContents }) => {
            const parent = webContents.getAllWebContents().find((item) => item.getURL().endsWith('/frame-parent'));
            const child = parent?.mainFrame.frames.find((frame) => frame.url.includes('localhost'));
            if (child === undefined) return 'no-frame';
            return child.executeJavaScript(
              "navigator.permissions.query({ name: 'storage-access' }).then((status) => status.state)",
            );
          }),
        { timeout: 15000 },
      )
      .toBe('granted');

    const logFile = path.join(userData, 'logs', 'sites.log');
    await expect
      .poll(() => {
        try {
          return readFileSync(logFile, 'utf8');
        } catch {
          return '';
        }
      })
      .toMatch(/ grok check permission="storage-access" origin="http:\/\/localhost:\d+\/?" allowed=true/);
  } finally {
    await app.close();
    fixture.server.close();
  }
});
