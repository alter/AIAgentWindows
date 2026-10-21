// turn.ts
import type { PageRunner, SiteAdapter } from './types';
import { SiteAdapterError } from './types';

export { SiteAdapterError };

export interface TurnOptions {
  timeoutMs: number;
  pollMs: number;
  settleMs: number;
  startGraceMs: number;
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

export async function runAdapterTurn(
  adapter: SiteAdapter,
  runner: PageRunner,
  prompt: string,
  options: TurnOptions = DEFAULT_TURN_OPTIONS,
): Promise<string> {
  const baseline = await adapter.lastReply(runner);
  await adapter.insertText(runner, prompt);
  await adapter.submit(runner);
  const started = Date.now();
  let answering = false;
  let sawGenerating = false;
  let idleSince: number | null = null;
  for (;;) {
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
      if (now - idleSince >= options.settleMs) return reply ?? '';
    } else {
      idleSince = null;
    }
    await sleep(options.pollMs);
  }
}
