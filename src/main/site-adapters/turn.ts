// turn.ts
import { randomBytes } from 'node:crypto';
import type { SiteLogValue } from '../../shared/site-log';
import { freshLoop, stepLoop, timedOut } from './decide';
import type { PageRunner, PollProbe, SiteAdapter, StreamSource } from './types';
import { SiteAdapterError } from './types';

export { SiteAdapterError };

export interface PollSample {
  t: number;
  generating: boolean;
  reply: string | null;
  text?: string;
  stop?: boolean;
  accepting?: boolean;
  started?: boolean;
  drops?: PollProbe['drops'];
  keyHits?: number;
  anchorRank?: number;
  hitsAtLineStart?: number;
}

export interface TurnTap {
  event(name: string, fields?: Readonly<Record<string, SiteLogValue>>): void;
  before(text: string): void;
  poll(sample: PollSample): void;
}

export interface TurnOptions {
  turnId?: string;
  tap?: TurnTap;
  stream?: StreamSource & { markSubmit(at: number): void };
  timeoutMs: number;
  pollMs: number;
  settleMs: number;
  startGraceMs: number;
  signal?: AbortSignal;
  trace?: (fields: Record<string, SiteLogValue>) => void;
  diagnose?: (fields: Record<string, SiteLogValue>) => void;
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

function sampleOf(t: number, generating: boolean, reply: string | null, probe: PollProbe | null): PollSample {
  if (probe === null) return { t, generating, reply };
  const { text, stop, accepting, started, drops, keyHits, anchorRank, hitsAtLineStart } = probe;
  return { t, generating, reply, text, stop, accepting, started, drops, keyHits, anchorRank, hitsAtLineStart };
}

async function converse(adapter: SiteAdapter, runner: PageRunner, prompt: string, options: TurnOptions): Promise<string> {
  const tap = options.tap;
  await adapter.insertText(runner, prompt);
  const inserted = adapter.trace?.();
  tap?.event('insert', { composer: String(inserted?.['composer'] ?? 'none'), chars: Number(inserted?.['inserted'] ?? 0) });
  const baseline = await adapter.lastReply(runner);
  adapter.watchStream?.(options.stream ?? null);
  options.stream?.markSubmit(Date.now());
  await adapter.submit(runner);
  const started = Date.now();
  const submitted = adapter.trace?.();
  tap?.event('submit', { path: String(submitted?.['submit'] ?? 'none'), composerClearedMs: Number(submitted?.['composerClearedMs'] ?? -1) });
  let loop = freshLoop();
  let wasGenerating = false;
  let announcedGrowth = false;
  let announcedBefore = false;
  for (;;) {
    throwIfAborted(options);
    const now = Date.now();
    if (timedOut(now, started, options.timeoutMs)) {
      throw new SiteAdapterError('timeout', `${adapter.site} did not finish within ${options.timeoutMs} ms`);
    }
    const generating = await adapter.isGenerating(runner);
    const reply = await adapter.lastReply(runner);
    if (tap !== undefined) {
      const probe = adapter.probe?.() ?? null;
      if (probe !== null && !announcedBefore) {
        announcedBefore = true;
        tap.before(probe.before);
      }
      tap.poll(sampleOf(now - started, generating, reply, probe));
      if (generating !== wasGenerating) tap.event('generating', { on: generating, t: now - started });
      wasGenerating = generating;
    }
    const step = stepLoop(loop, { now, started, generating, reply, baseline, echoSeen: adapter.echoSeen?.() === true }, options);
    if (tap !== undefined && !announcedGrowth && step.state.answering) {
      announcedGrowth = true;
      tap.event('first-growth', { t: now - started });
    }
    if (tap !== undefined && loop.idleSince === null && step.state.idleSince !== null) tap.event('settle-start', { t: now - started });
    loop = step.state;
    if (step.verdict === 'no-response') throw new SiteAdapterError('no-response', `${adapter.site} did not start to answer`);
    if (step.verdict === 'done' && reply !== null) return reply;
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
  const turn = options.turnId ?? randomBytes(3).toString('hex');
  let idleWaitMs = 0;
  const report = (fields: Record<string, SiteLogValue>): void => {
    options.trace?.({ turn, ms: Date.now() - begun, idleWaitMs, ...fields, ...adapter.trace?.() });
  };
  try {
    throwIfAborted(options);
    idleWaitMs = await waitUntilIdle(adapter, runner, options);
    options.tap?.event('idle-wait', { ms: idleWaitMs });
    const reply = await converse(adapter, runner, prompt, options);
    options.tap?.event('finish', { outcome: 'reply', replyChars: reply.length });
    report({ outcome: 'reply', replyChars: reply.length });
    return reply;
  } catch (error) {
    const code = error instanceof SiteAdapterError ? error.code : 'error';
    options.tap?.event('finish', { outcome: 'failed', code, replyChars: 0 });
    report({ outcome: 'failed', code, replyChars: 0 });
    if (code === 'timeout' || code === 'no-response') {
      const lines = adapter.lineReport?.();
      if (lines) options.diagnose?.({ turn, code, ...lines });
    }
    throw error;
  }
}
