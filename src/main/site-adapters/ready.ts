// ready.ts
import { SiteAdapterError, type PageRunner, type SiteAdapter } from './types';

export interface ReadyOptions {
  timeoutMs: number;
  pollMs: number;
  signal?: AbortSignal;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitUntilReady(adapter: SiteAdapter, runner: PageRunner, options: ReadyOptions): Promise<void> {
  if (adapter.composerReady === undefined) return;
  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    if (options.signal?.aborted) throw new SiteAdapterError('aborted', 'the turn was stopped');
    if (await adapter.composerReady(runner)) return;
    if (Date.now() >= deadline) throw new SiteAdapterError('not-ready', `${adapter.site}: page not ready`);
    await sleep(options.pollMs);
  }
}
