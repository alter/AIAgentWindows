// site-user-agent.ts
import type { UserAgentOverride } from '../shared/site-policy';

type Params = Record<string, unknown>;

export interface UserAgentDebugger {
  isAttached(): boolean;
  attach(protocolVersion?: string): void;
  sendCommand(method: string, params?: Params, sessionId?: string): Promise<unknown>;
  on(event: 'message', listener: (event: unknown, method: string, params: unknown, sessionId: string) => void): unknown;
}

export interface UserAgentContents {
  debugger: UserAgentDebugger;
  isDestroyed(): boolean;
  on(event: 'did-create-window', listener: (window: { webContents: UserAgentContents }) => void): unknown;
}

const AUTO_ATTACH: Params = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true };
const OVERRIDE_TARGETS: ReadonlySet<string> = new Set(['page', 'iframe']);

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function attachedTarget(params: unknown): { sessionId: string; type: string } | null {
  if (typeof params !== 'object' || params === null) return null;
  const { sessionId, targetInfo } = params as { sessionId?: unknown; targetInfo?: { type?: unknown } };
  if (typeof sessionId !== 'string' || sessionId === '') return null;
  return { sessionId, type: typeof targetInfo?.type === 'string' ? targetInfo.type : '' };
}

function detachedSession(params: unknown): string | null {
  const sessionId = typeof params === 'object' && params !== null ? (params as { sessionId?: unknown }).sessionId : null;
  return typeof sessionId === 'string' ? sessionId : null;
}

function followFrames(contents: UserAgentContents, override: UserAgentOverride, onError: (message: string) => void): void {
  const cdp = contents.debugger;
  const live = new Set<string>();

  const attach = async ({ sessionId, type }: { sessionId: string; type: string }): Promise<void> => {
    if (live.has(sessionId)) return;
    live.add(sessionId);
    try {
      if (OVERRIDE_TARGETS.has(type)) {
        await cdp.sendCommand('Emulation.setUserAgentOverride', { ...override }, sessionId);
        await cdp.sendCommand('Target.setAutoAttach', AUTO_ATTACH, sessionId);
      }
    } catch (error) {
      onError(`${type} target: ${describeError(error)}`);
    }
    try {
      await cdp.sendCommand('Runtime.runIfWaitingForDebugger', undefined, sessionId);
    } catch (error) {
      onError(`${type} target: ${describeError(error)}`);
    }
  };

  cdp.on('message', (_event, method, params) => {
    if (method === 'Target.attachedToTarget') {
      const target = attachedTarget(params);
      if (target !== null) void attach(target);
      return;
    }
    if (method === 'Target.detachedFromTarget') {
      const sessionId = detachedSession(params);
      if (sessionId !== null) live.delete(sessionId);
    }
  });
}

export async function applyOwnerUserAgent(
  contents: UserAgentContents,
  override: UserAgentOverride,
  onError: (message: string) => void,
): Promise<void> {
  if (contents.isDestroyed()) return;
  contents.on('did-create-window', (window) => {
    void applyOwnerUserAgent(window.webContents, override, onError);
  });
  try {
    if (!contents.debugger.isAttached()) contents.debugger.attach('1.3');
    followFrames(contents, override, onError);
    const results = await Promise.allSettled([
      contents.debugger.sendCommand('Emulation.setUserAgentOverride', { ...override }),
      contents.debugger.sendCommand('Target.setAutoAttach', AUTO_ATTACH),
    ]);
    const refused = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (refused !== undefined) onError(describeError(refused.reason));
  } catch (error) {
    onError(describeError(error));
  }
}
