// site-user-agent.test.ts
import { describe, expect, it } from 'vitest';
import { userAgentOverride } from '../../src/shared/site-policy';
import { applyOwnerUserAgent, type UserAgentContents } from '../../src/main/site-user-agent';

const OVERRIDE = userAgentOverride({ chromeVersion: '152.0.7977.130', platformVersion: '15.4.1', arch: 'arm64' });
const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true };

interface Sent {
  method: string;
  params: Record<string, unknown> | undefined;
  sessionId: string | undefined;
}

type MessageListener = (event: unknown, method: string, params: unknown, sessionId: string) => void;

class FakeContents implements UserAgentContents {
  attached = false;
  destroyed = false;
  sent: Sent[] = [];
  failMethods = new Set<string>();
  holdMethods = new Map<string, Promise<unknown>>();
  listeners: MessageListener[] = [];
  windowListener: ((window: { webContents: UserAgentContents }) => void) | null = null;
  debugger = {
    isAttached: () => this.attached,
    attach: () => {
      this.attached = true;
    },
    sendCommand: (method: string, params?: Record<string, unknown>, sessionId?: string) => {
      this.sent.push({ method, params, sessionId });
      const held = this.holdMethods.get(method);
      if (held !== undefined && sessionId !== undefined) return held;
      return this.failMethods.has(method) ? Promise.reject(new Error('detached')) : Promise.resolve({});
    },
    on: (_event: 'message', listener: MessageListener) => {
      this.listeners.push(listener);
    },
  };
  isDestroyed(): boolean {
    return this.destroyed;
  }
  on(_event: 'did-create-window', listener: (window: { webContents: UserAgentContents }) => void): void {
    this.windowListener = listener;
  }
  emit(method: string, params: unknown, sessionId = ''): void {
    for (const listener of this.listeners) listener({}, method, params, sessionId);
  }
  attachTarget(sessionId: string, type: string, parent = ''): void {
    this.emit('Target.attachedToTarget', { sessionId, targetInfo: { type, url: '' }, waitingForDebugger: true }, parent);
  }
  sentTo(sessionId: string): string[] {
    return this.sent.filter((item) => item.sessionId === sessionId).map((item) => item.method);
  }
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
}

describe('applyOwnerUserAgent', () => {
  it('attaches the debugger, sends the override and turns auto-attach on', async () => {
    const contents = new FakeContents();
    await applyOwnerUserAgent(contents, OVERRIDE, () => undefined);
    expect(contents.attached).toBe(true);
    expect(contents.sent).toEqual([
      { method: 'Emulation.setUserAgentOverride', params: { ...OVERRIDE }, sessionId: undefined },
      { method: 'Target.setAutoAttach', params: AUTO_ATTACH, sessionId: undefined },
    ]);
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
  });

  it('applies the same override to a popup window created later', async () => {
    const contents = new FakeContents();
    await applyOwnerUserAgent(contents, OVERRIDE, () => undefined);
    const popup = new FakeContents();
    contents.windowListener?.({ webContents: popup });
    await settle();
    expect(popup.sent.map((item) => item.method)).toEqual(['Emulation.setUserAgentOverride', 'Target.setAutoAttach']);
  });

  it('reports a failed command once and does not throw', async () => {
    const contents = new FakeContents();
    contents.failMethods.add('Emulation.setUserAgentOverride');
    const errors: string[] = [];
    await applyOwnerUserAgent(contents, OVERRIDE, (message) => errors.push(message));
    expect(errors).toEqual(['detached']);
    expect(contents.sent.map((item) => item.method)).toContain('Target.setAutoAttach');
  });

  it('does nothing for a destroyed page', async () => {
    const contents = new FakeContents();
    contents.destroyed = true;
    await applyOwnerUserAgent(contents, OVERRIDE, () => undefined);
    expect(contents.attached).toBe(false);
    expect(contents.sent).toEqual([]);
  });

  it('override reaches every attached frame target', async () => {
    const contents = new FakeContents();
    await applyOwnerUserAgent(contents, OVERRIDE, () => undefined);
    contents.attachTarget('frame-1', 'iframe');
    contents.attachTarget('frame-2', 'iframe');
    contents.attachTarget('nested-1', 'iframe', 'frame-1');
    await settle();
    for (const sessionId of ['frame-1', 'frame-2', 'nested-1']) {
      expect(contents.sentTo(sessionId)).toEqual([
        'Emulation.setUserAgentOverride',
        'Target.setAutoAttach',
        'Runtime.runIfWaitingForDebugger',
      ]);
    }
    const override = contents.sent.find((item) => item.sessionId === 'frame-1' && item.method === 'Emulation.setUserAgentOverride');
    expect(override?.params).toEqual({ ...OVERRIDE });
    const nested = contents.sent.find((item) => item.sessionId === 'frame-1' && item.method === 'Target.setAutoAttach');
    expect(nested?.params).toEqual(AUTO_ATTACH);
  });

  it('resumes a target only after its override and nested auto-attach were answered', async () => {
    const contents = new FakeContents();
    await applyOwnerUserAgent(contents, OVERRIDE, () => undefined);
    let answer: (value: unknown) => void = () => undefined;
    contents.holdMethods.set('Emulation.setUserAgentOverride', new Promise((resolve) => (answer = resolve)));
    contents.attachTarget('frame-1', 'iframe');
    await settle();
    expect(contents.sentTo('frame-1')).toEqual(['Emulation.setUserAgentOverride']);
    answer({});
    await settle();
    expect(contents.sentTo('frame-1')).toEqual([
      'Emulation.setUserAgentOverride',
      'Target.setAutoAttach',
      'Runtime.runIfWaitingForDebugger',
    ]);
  });

  it('gets a page target the override and a worker target only its resume', async () => {
    const contents = new FakeContents();
    await applyOwnerUserAgent(contents, OVERRIDE, () => undefined);
    contents.attachTarget('page-1', 'page');
    contents.attachTarget('worker-1', 'worker');
    contents.attachTarget('service-1', 'service_worker');
    await settle();
    expect(contents.sentTo('page-1')).toContain('Emulation.setUserAgentOverride');
    expect(contents.sentTo('worker-1')).toEqual(['Runtime.runIfWaitingForDebugger']);
    expect(contents.sentTo('service-1')).toEqual(['Runtime.runIfWaitingForDebugger']);
  });

  it('resumes a target whose override is refused and reports the target type', async () => {
    const contents = new FakeContents();
    const errors: string[] = [];
    await applyOwnerUserAgent(contents, OVERRIDE, (message) => errors.push(message));
    contents.failMethods.add('Emulation.setUserAgentOverride');
    contents.attachTarget('frame-1', 'iframe');
    await settle();
    expect(contents.sentTo('frame-1')).toContain('Runtime.runIfWaitingForDebugger');
    expect(errors).toEqual(['iframe target: detached']);
  });

  it('ignores a repeated attach of the same session and forgets a detached one', async () => {
    const contents = new FakeContents();
    await applyOwnerUserAgent(contents, OVERRIDE, () => undefined);
    contents.attachTarget('frame-1', 'iframe');
    contents.attachTarget('frame-1', 'iframe');
    await settle();
    expect(contents.sentTo('frame-1').filter((method) => method === 'Runtime.runIfWaitingForDebugger')).toHaveLength(1);
    contents.emit('Target.detachedFromTarget', { sessionId: 'frame-1' });
    contents.attachTarget('frame-1', 'iframe');
    await settle();
    expect(contents.sentTo('frame-1').filter((method) => method === 'Runtime.runIfWaitingForDebugger')).toHaveLength(2);
  });

  it('ignores other debugger events and malformed attach events', async () => {
    const contents = new FakeContents();
    await applyOwnerUserAgent(contents, OVERRIDE, () => undefined);
    const before = contents.sent.length;
    contents.emit('Network.requestWillBeSent', { sessionId: 'x' });
    contents.emit('Target.attachedToTarget', { targetInfo: { type: 'iframe' } });
    contents.emit('Target.attachedToTarget', null);
    await settle();
    expect(contents.sent).toHaveLength(before);
  });
});
