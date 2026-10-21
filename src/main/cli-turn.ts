// cli-turn.ts
import { readFile } from 'node:fs/promises';
import type { CliKind } from '../shared/agents';
import { bracketedPaste } from '../shared/terminal-input';
import { readClaudeTurn, readCodexTurn, type TurnSignal } from '../shared/turn-signal';

const ENTER = '\r';

export type CliTurnErrorCode = 'timeout' | 'failed' | 'unavailable' | 'aborted';

export class CliTurnError extends Error {
  constructor(
    readonly code: CliTurnErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CliTurnError';
  }
}

export interface CliTurnOptions {
  kind: CliKind;
  prompt: string;
  write(data: string): boolean;
  locate(): Promise<string | null>;
  timeoutMs: number;
  pollMs?: number;
  settleMs?: number;
  submitDelayMs?: number;
  signal?: AbortSignal;
  guard?(): Promise<void>;
}

const DEFAULT_POLL_MS = 250;
const DEFAULT_SETTLE_MS = 1500;
const DEFAULT_SUBMIT_DELAY_MS = 150;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readText(file: string | null): Promise<string> {
  if (file === null) return '';
  try {
    return await readFile(file, 'utf8');
  } catch {
    return '';
  }
}

async function send(options: CliTurnOptions): Promise<void> {
  await options.guard?.();
  if (!options.write(bracketedPaste(options.prompt))) throw new CliTurnError('unavailable', 'the session is not running');
  await sleep(options.submitDelayMs ?? DEFAULT_SUBMIT_DELAY_MS);
  await options.guard?.();
  if (!options.write(ENTER)) throw new CliTurnError('unavailable', 'the session ended before the prompt was submitted');
}

async function signalOf(options: CliTurnOptions, sentAtMs: number): Promise<TurnSignal> {
  const text = await readText(await options.locate());
  return options.kind === 'claude' ? readClaudeTurn(text, sentAtMs) : readCodexTurn(text, sentAtMs);
}

async function confirmed(options: CliTurnOptions, sentAtMs: number, signal: TurnSignal): Promise<TurnSignal> {
  if (options.kind !== 'claude' || signal.state !== 'done') return signal;
  await sleep(options.settleMs ?? DEFAULT_SETTLE_MS);
  const again = await signalOf(options, sentAtMs);
  return again.state === 'done' && again.continued ? { state: 'running' } : again;
}

function throwIfAborted(options: CliTurnOptions): void {
  if (options.signal?.aborted) throw new CliTurnError('aborted', 'the turn was stopped');
}

export async function runCliTurn(options: CliTurnOptions): Promise<string | null> {
  throwIfAborted(options);
  const sentAtMs = Date.now();
  const deadline = sentAtMs + options.timeoutMs;
  await send(options);
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  while (Date.now() < deadline) {
    throwIfAborted(options);
    const signal = await confirmed(options, sentAtMs, await signalOf(options, sentAtMs));
    if (signal.state === 'failed') throw new CliTurnError('failed', signal.reason);
    if (signal.state === 'done') return signal.reply;
    await sleep(pollMs);
  }
  throw new CliTurnError('timeout', `the turn did not end within ${options.timeoutMs} ms`);
}
