// site-user-agent.ts
import type { UserAgentOverride } from '../shared/site-policy';
import type { DebuggerLike } from './site-adapters/isolated-runner';

export interface UserAgentContents {
  debugger: DebuggerLike;
  isDestroyed(): boolean;
  on(event: 'did-create-window', listener: (window: { webContents: UserAgentContents }) => void): unknown;
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
    await contents.debugger.sendCommand('Emulation.setUserAgentOverride', { ...override });
  } catch (error) {
    onError(error instanceof Error ? error.message : String(error));
  }
}
