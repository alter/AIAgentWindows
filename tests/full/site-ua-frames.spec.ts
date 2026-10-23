// site-ua-frames.spec.ts
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OWNER_USER_AGENT } from '../../src/shared/site-policy';
import { startUaFramesServer } from '../fixtures/ua-frames/server';

const root = path.resolve(__dirname, '..', '..');
const stubCli = path.join(root, 'tests', 'fixtures', 'stub-cli.mjs');

interface Identity {
  ua: string;
  brands: string[];
  full: string[];
}

const IDENTITY_SCRIPT = `(async () => {
  const data = navigator.userAgentData;
  const high = await data.getHighEntropyValues(['fullVersionList']);
  return { ua: navigator.userAgent, brands: data.brands.map((item) => item.brand + ' ' + item.version), full: high.fullVersionList.map((item) => item.brand + ' ' + item.version) };
})()`;

function launch(topUrl: string): Promise<ElectronApplication> {
  const base = mkdtempSync(path.join(tmpdir(), 'aiaw-uaframes-'));
  return electron.launch({
    args: [root],
    env: {
      ...process.env,
      AIAW_USER_DATA: path.join(base, 'profile'),
      AIAW_CLAUDE_BIN: stubCli,
      AIAW_CODEX_BIN: stubCli,
      AIAW_TEST_FOLDER: mkdtempSync(path.join(base, 'folder-')),
      AIAW_SITE_URL_GROK: topUrl,
    },
  });
}

interface FrameReport {
  top: { processId: number; identity: Identity };
  child: { processId: number; identity: Identity };
}

function reportFrames(app: ElectronApplication, topUrl: string, childUrl: string): Promise<FrameReport | null> {
  return app.evaluate(
    async ({ webContents }, [pageUrl, frameUrl, script]) => {
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === pageUrl);
      const child = contents?.mainFrame.framesInSubtree.find((frame) => frame.url === frameUrl);
      if (contents === undefined || child === undefined) return null;
      const main = contents.mainFrame;
      return {
        top: { processId: main.processId, identity: (await main.executeJavaScript(script as string)) as Identity },
        child: { processId: child.processId, identity: (await child.executeJavaScript(script as string)) as Identity },
      };
    },
    [topUrl, childUrl, IDENTITY_SCRIPT],
  );
}

test('a cross-site iframe in its own process reports the owner identity like the top frame', async () => {
  const fixture = await startUaFramesServer();
  const app = await launch(fixture.topUrl);
  try {
    const page = await app.firstWindow();
    await page.locator('button[aria-haspopup="menu"]').click();
    await page.locator('.menu-item[data-kind="grok"]').click();
    await expect(page.locator('.agent-item')).toHaveCount(1);

    await expect.poll(() => reportFrames(app, fixture.topUrl, fixture.childUrl)).not.toBeNull();
    const report = await reportFrames(app, fixture.topUrl, fixture.childUrl);
    if (report === null) throw new Error('frames are gone');

    expect(report.child.processId).not.toBe(report.top.processId);
    expect(report.top.identity.ua).toBe(OWNER_USER_AGENT);
    expect(report.child.identity.ua).toBe(report.top.identity.ua);
    expect(report.child.identity.ua).not.toContain('Electron/');
    expect(report.top.identity.brands).toContain('Google Chrome 152');
    expect(report.child.identity.brands).toEqual(report.top.identity.brands);
    expect(report.child.identity.full).toEqual(report.top.identity.full);

    await expect.poll(() => fixture.probes.get('child')?.length ?? 0).toBeGreaterThan(0);
    for (const userAgent of fixture.probes.get('child') ?? []) expect(userAgent).toBe(OWNER_USER_AGENT);
  } finally {
    await app.close();
    fixture.server.close();
  }
});
