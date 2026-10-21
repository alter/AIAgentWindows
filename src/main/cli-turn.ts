// cli-turn.ts
import { spawn, type ChildProcess } from 'node:child_process';
import type { CliKind } from '../shared/agents';
import type { SpawnSpec } from '../shared/cli-args';
import { PrintReader } from '../shared/cli-print';
import { MAX_ERROR_CHARS, truncateText } from '../shared/room-model';

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
  spec: SpawnSpec;
  prompt: string;
  timeoutMs: number;
  killGraceMs?: number;
  signal?: AbortSignal;
}

export interface CliTurnResult {
  reply: string | null;
  sessionId: string | null;
}

const DEFAULT_KILL_GRACE_MS = 3000;
const STDERR_TAIL_CHARS = 2000;

function describeEnd(code: number | null, signal: NodeJS.Signals | null, detail: string): string {
  const how = code === null ? `signal ${signal ?? 'unknown'}` : `exit code ${code}`;
  const base = `the CLI ended without a result (${how})`;
  return detail.length > 0 ? `${base}: ${detail}` : base;
}

function stop(child: ChildProcess, graceMs: number): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }, graceMs).unref();
}

export function runCliTurn(options: CliTurnOptions): Promise<CliTurnResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new CliTurnError('aborted', 'the turn was stopped'));
      return;
    }
    const graceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
    const reader = new PrintReader(options.kind);
    let stderrTail = '';
    let settled = false;
    const child = spawn(options.spec.file, options.spec.args, {
      cwd: options.spec.cwd,
      env: options.spec.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const settle = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      action();
    };
    const fail = (error: CliTurnError): void => {
      settle(() => reject(error));
      stop(child, graceMs);
    };
    const onAbort = (): void => fail(new CliTurnError('aborted', 'the turn was stopped'));
    const timer = setTimeout(() => fail(new CliTurnError('timeout', `the turn did not end within ${options.timeoutMs} ms`)), options.timeoutMs);
    options.signal?.addEventListener('abort', onAbort, { once: true });

    child.on('error', (error) => fail(new CliTurnError('unavailable', `the CLI could not be started: ${error.message}`)));
    child.stdin.on('error', () => undefined);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      reader.feed(chunk);
      if (reader.outcome.state !== 'running') setTimeout(() => stop(child, graceMs), graceMs).unref();
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_CHARS);
    });
    child.on('close', (code, signal) => {
      reader.finish();
      const outcome = reader.outcome;
      if (outcome.state === 'done') settle(() => resolve({ reply: outcome.reply, sessionId: reader.sessionId }));
      else if (outcome.state === 'failed') settle(() => reject(new CliTurnError('failed', outcome.reason)));
      else {
        const detail = truncateText((reader.lastError ?? stderrTail).trim(), MAX_ERROR_CHARS);
        settle(() => reject(new CliTurnError('failed', describeEnd(code, signal, detail))));
      }
    });
    child.stdin.end(options.prompt);
  });
}
