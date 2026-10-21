// isolated-runner.ts
import { SiteAdapterError, type PageRunner } from './types';

export const ADAPTER_WORLD_ID = 1001;

export interface DebuggerLike {
  isAttached(): boolean;
  attach(protocolVersion?: string): void;
  sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

export interface IsolatedContents {
  executeJavaScriptInIsolatedWorld(worldId: number, scripts: Array<{ code: string }>): Promise<unknown>;
  isDestroyed(): boolean;
  debugger?: DebuggerLike;
}

async function fileInputNode(cdp: DebuggerLike, selector: string): Promise<number> {
  const document = (await cdp.sendCommand('DOM.getDocument', { depth: 0 })) as { root: { nodeId: number } };
  const found = (await cdp.sendCommand('DOM.querySelector', { nodeId: document.root.nodeId, selector })) as {
    nodeId: number;
  };
  if (found.nodeId === 0) throw new SiteAdapterError('attach-unsupported', `no element matches ${selector}`);
  return found.nodeId;
}

export function createIsolatedRunner(contents: IsolatedContents): PageRunner {
  const runner: PageRunner = {
    run(code) {
      if (contents.isDestroyed()) return Promise.reject(new SiteAdapterError('page-gone', 'the page is closed'));
      return contents.executeJavaScriptInIsolatedWorld(ADAPTER_WORLD_ID, [{ code }]);
    },
  };
  const cdp = contents.debugger;
  if (cdp === undefined) return runner;
  runner.setInputFiles = async (selector, paths) => {
    if (contents.isDestroyed()) throw new SiteAdapterError('page-gone', 'the page is closed');
    if (!cdp.isAttached()) cdp.attach('1.3');
    const nodeId = await fileInputNode(cdp, selector);
    await cdp.sendCommand('DOM.setFileInputFiles', { nodeId, files: paths });
  };
  return runner;
}
