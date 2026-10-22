// site-user-agent.test.ts
import { describe, expect, it } from 'vitest';
import { userAgentOverride } from '../../src/shared/site-policy';
import { applyOwnerUserAgent, type UserAgentContents } from '../../src/main/site-user-agent';

const OVERRIDE = userAgentOverride({ chromeVersion: '152.0.7977.130', platformVersion: '15.4.1', arch: 'arm64' });

interface Sent {
  method: string;
  params: Record<string, unknown> | undefined;
}

class FakeContents implements UserAgentContents {
  attached = false;
  destroyed = false;
  sent: Sent[] = [];
  failSend = false;
  windowListener: ((window: { webContents: UserAgentContents }) => void) | null = null;
  debugger = {
    isAttached: () => this.attached,
    attach: () => {
      this.attached = true;
    },
    sendCommand: (method: string, params?: Record<string, unknown>) => {
      this.sent.push({ method, params });
      return this.failSend ? Promise.reject(new Error('detached')) : Promise.resolve({});
    },
  };
  isDestroyed(): boolean {
    return this.destroyed;
  }
  on(_event: 'did-create-window', listener: (window: { webContents: UserAgentContents }) => void): void {
    this.windowListener = listener;
  }
}

describe('applyOwnerUserAgent', () => {
  it('attaches the debugger and sends the override with user agent and metadata', async () => {
    const contents = new FakeContents();
    await applyOwnerUserAgent(contents, OVERRIDE, () => undefined);
    expect(contents.attached).toBe(true);
    expect(contents.sent).toEqual([{ method: 'Emulation.setUserAgentOverride', params: { ...OVERRIDE } }]);
  });

  it('does not attach twice when the debugger is already attached', async () => {
    const contents = new FakeContents();
    contents.attached = true;
    let attaches = 0;
    contents.debugger.attach = () => {
      attaches += 1;
    };
    await applyOwnerUserAgent(contents, OVERRIDE, () => undefined);
    expect(attaches).toBe(0);
    expect(contents.sent).toHaveLength(1);
  });

  it('applies the same override to a popup window created later', async () => {
    const contents = new FakeContents();
    await applyOwnerUserAgent(contents, OVERRIDE, () => undefined);
    const popup = new FakeContents();
    contents.windowListener?.({ webContents: popup });
    await Promise.resolve();
    await Promise.resolve();
    expect(popup.sent.map((item) => item.method)).toEqual(['Emulation.setUserAgentOverride']);
  });

  it('reports a failed command and does not throw', async () => {
    const contents = new FakeContents();
    contents.failSend = true;
    const errors: string[] = [];
    await applyOwnerUserAgent(contents, OVERRIDE, (message) => errors.push(message));
    expect(errors).toEqual(['detached']);
  });

  it('does nothing for a destroyed page', async () => {
    const contents = new FakeContents();
    contents.destroyed = true;
    await applyOwnerUserAgent(contents, OVERRIDE, () => undefined);
    expect(contents.attached).toBe(false);
    expect(contents.sent).toEqual([]);
  });
});
