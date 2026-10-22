// turn.ts
import { randomBytes } from 'node:crypto';
import type { SiteLogValue } from '../../shared/site-log';
import type { PageRunner, SiteAdapter } from './types';
import { SiteAdapterError } from './types';

export { SiteAdapterError };

export interface TurnOptions {
  timeoutMs: number;
  pollMs: number;
  settleMs: number;
  startGraceMs: number;
  signal?: AbortSignal;
  trace?: (fields: Record<string, SiteLogValue>) => void;
}

export const DEFAULT_TURN_OPTIONS: TurnOptions = {
  timeoutMs: 600000,
  pollMs: 500,
  settleMs: 1500,
  startGraceMs: 30000,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function throwIfAborted(options: TurnOptions): void {
  if (options.signal?.aborted) throw new SiteAdapterError('aborted', 'the turn was stopped');
}

async function waitUntilIdle(adapter: SiteAdapter, runner: PageRunner, options: TurnOptions): Promise<number> {
  if (adapter.isIdle === undefined) return 0;
  const begun = Date.now();
  for (;;) {
    throwIfAborted(options);
    if (await adapter.isIdle(runner)) return Date.now() - begun;
    if (Date.now() - begun >= options.timeoutMs) {
      throw new SiteAdapterError('timeout', `${adapter.site} was still busy after ${options.timeoutMs} ms, nothing was sent`);
    }
    await sleep(options.pollMs);
  }
}

async function converse(adapter: SiteAdapter, runner: PageRunner, prompt: string, options: TurnOptions): Promise<string> {
  await adapter.insertText(runner, prompt);
  const baseline = await adapter.lastReply(runner);
  await adapter.submit(runner);
  const started = Date.now();
  let answering = false;
  let sawGenerating = false;
  let idleSince: number | null = null;
  for (;;) {
    throwIfAborted(options);
    const now = Date.now();
    if (now - started >= options.timeoutMs) {
      throw new SiteAdapterError('timeout', `${adapter.site} did not finish within ${options.timeoutMs} ms`);
    }
    const generating = await adapter.isGenerating(runner);
    const reply = await adapter.lastReply(runner);
    const changed = reply !== baseline;
    if (generating) sawGenerating = true;
    if (generating || changed) answering = true;
    if (!answering && now - started >= options.startGraceMs) {
      throw new SiteAdapterError('no-response', `${adapter.site} did not start to answer`);
    }
    if (answering && !generating && reply !== null && (changed || sawGenerating)) {
      idleSince ??= now;
      if (now - idleSince >= options.settleMs) return reply;
    } else {
      idleSince = null;
    }
    await sleep(options.pollMs);
  }
}

export async function runAdapterTurn(
  adapter: SiteAdapter,
  runner: PageRunner,
  prompt: string,
  options: TurnOptions = DEFAULT_TURN_OPTIONS,
): Promise<string> {
  const begun = Date.now();
  const turn = randomBytes(3).toString('hex');
  let idleWaitMs = 0;
  const report = (fields: Record<string, SiteLogValue>): void => {
    options.trace?.({ turn, ms: Date.now() - begun, idleWaitMs, ...fields, ...adapter.trace?.() });
  };
  try {
    throwIfAborted(options);
    idleWaitMs = await waitUntilIdle(adapter, runner, options);
    const reply = await converse(adapter, runner, prompt, options);
    report({ outcome: 'reply', replyChars: reply.length });
    return reply;
  } catch (error) {
    report({ outcome: 'failed', code: error instanceof SiteAdapterError ? error.code : 'error', replyChars: 0 });
    throw error;
  }
}
