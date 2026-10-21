// cli-turn.test.ts
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CliTurnError, runCliTurn, type CliTurnOptions } from '../../src/main/cli-turn';
import type { CliKind } from '../../src/shared/agents';
import { buildRoomTurnSpawn } from '../../src/shared/cli-args';

const STUB = path.resolve(__dirname, '..', 'fixtures', 'stub-cli.mjs');
const SESSION = '3f2b8c1e-9a4d-4e57-b6a0-1c2d3e4f5a6b';

let dir: string;
let log: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'aiaw-turn-'));
  log = path.join(dir, 'argv.log');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function env(extra: Record<string, string> = {}): Record<string, string | undefined> {
  return {
    PATH: process.env.PATH,
    AIAW_CLAUDE_BIN: STUB,
    AIAW_CODEX_BIN: STUB,
    CLAUDE_CONFIG_DIR: path.join(dir, 'claude-config'),
    CODEX_HOME: path.join(dir, 'codex-home'),
    AIAW_STUB_ARGV_LOG: log,
    AIAW_STUB_REPLY_DELAY_MS: '30',
    ...extra,
  };
}

function options(kind: CliKind, prompt: string, extra: Record<string, string> = {}, overrides: Partial<CliTurnOptions> = {}, session?: string, resume = false): CliTurnOptions {
  const spec = buildRoomTurnSpawn(kind, {
    cwd: dir,
    sessionId: kind === 'claude' ? SESSION : session,
    sharedDir: dir,
    resume,
    platform: 'win32',
    env: env(extra),
  });
  return { kind, spec, prompt, timeoutMs: 15_000, killGraceMs: 200, ...overrides };
}

async function invocations(): Promise<Array<{ argv: string[]; stdin: string; cwd: string; childSession: string }>> {
  const text = await readFile(log, 'utf8').catch(() => '');
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { argv: string[]; stdin: string; cwd: string; childSession: string });
}

function failureOf(promise: Promise<unknown>): Promise<CliTurnError> {
  return promise.then(
    () => {
      throw new Error('the turn was expected to fail');
    },
    (error: unknown) => error as CliTurnError,
  );
}

describe('non-interactive CLI turn', () => {
  it('claude: sends the prompt on stdin, ends on the result message and returns its text and the session id', async () => {
    const result = await runCliTurn(options('claude', 'first question'));
    expect(result).toEqual({ reply: 'stub reply to: first question', sessionId: SESSION });
    const [call] = await invocations();
    expect(call?.stdin).toBe('first question');
    expect(call?.argv).toContain('-p');
    expect(call?.argv).not.toContain('first question');
    expect(call?.cwd).toBe(await realpath(dir));
  });

  it('claude: a resumed turn needs the session of the first turn and returns only its own reply', async () => {
    await runCliTurn(options('claude', 'one'));
    const second = await runCliTurn(options('claude', 'two', {}, {}, undefined, true));
    expect(second.reply).toBe('stub reply to: two');
    const calls = await invocations();
    expect(calls.map((call) => call.argv.includes('--resume'))).toEqual([false, true]);
  });

  it('claude: resuming a session that does not exist fails with the CLI error', async () => {
    const failure = await failureOf(runCliTurn(options('claude', 'x', {}, {}, undefined, true)));
    expect(failure.code).toBe('failed');
    expect(failure.message).toContain('No conversation found');
  });

  it('claude: is_error in the result is a failure, not a reply', async () => {
    const failure = await failureOf(runCliTurn(options('claude', 'x', { AIAW_STUB_CLAUDE_ERROR: '1' })));
    expect(failure.code).toBe('failed');
    expect(failure.message).toBe('stub claude failure');
  });

  it('claude: shell noise on stdout is skipped', async () => {
    const result = await runCliTurn(options('claude', 'noisy', { AIAW_STUB_NOISE: '1' }));
    expect(result.reply).toBe('stub reply to: noisy');
  });

  it('claude: the child never sees the variable that turns transcript saving off', async () => {
    await runCliTurn(options('claude', 'x'));
    expect((await invocations())[0]?.childSession).toBe('unset');
  });

  it('codex: returns the last agent message at turn.completed and the thread id', async () => {
    const result = await runCliTurn(options('codex', 'codex question'));
    expect(result.reply).toBe('stub reply to: codex question');
    expect(result.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('codex: resumes the thread of the first turn by id', async () => {
    const first = await runCliTurn(options('codex', 'one'));
    const second = await runCliTurn(options('codex', 'two', {}, {}, first.sessionId ?? '', true));
    expect(second.reply).toBe('stub reply to: two');
    expect(second.sessionId).toBe(first.sessionId);
    const calls = await invocations();
    expect(calls[1]?.argv).toContain('resume');
    expect(calls[1]?.argv).toContain(first.sessionId ?? 'missing');
  });

  it('codex: a thread that does not exist fails with the CLI error', async () => {
    const failure = await failureOf(runCliTurn(options('codex', 'x', {}, {}, SESSION, true)));
    expect(failure.code).toBe('failed');
    expect(failure.message).toContain('no rollout found');
  });

  it('codex: with no later message the last agent message of the turn is the reply', async () => {
    const result = await runCliTurn(options('codex', 'quiet', { AIAW_STUB_CODEX_NULL_REPLY: '1' }));
    expect(result.reply).toBe('working on it');
  });

  it('codex: turn.failed is a failure with its message', async () => {
    const failure = await failureOf(runCliTurn(options('codex', 'boom', { AIAW_STUB_CODEX_ERROR: '1' })));
    expect(failure.code).toBe('failed');
    expect(failure.message).toBe('stub failure');
  });

  it('a process that ends without a result is a failure that names the exit code', async () => {
    const claude = await failureOf(runCliTurn(options('claude', 'x', { AIAW_STUB_NO_RESULT: '1' })));
    expect(claude.code).toBe('failed');
    expect(claude.message).toMatch(/without a result/);
    const codex = await failureOf(runCliTurn(options('codex', 'x', { AIAW_STUB_NO_RESULT: '1' })));
    expect(codex.message).toMatch(/exit code 1/);
  });

  it('a process the CLI refuses to start reports its stderr', async () => {
    const spec = buildRoomTurnSpawn('codex', { cwd: dir, sharedDir: dir, resume: false, platform: 'win32', env: env() });
    const refused = { ...spec, args: [...spec.args, '--no-daemon'] };
    const failure = await failureOf(runCliTurn({ kind: 'codex', spec: refused, prompt: 'x', timeoutMs: 15_000, killGraceMs: 200 }));
    expect(failure.code).toBe('failed');
    expect(failure.message).toContain("unexpected argument '--no-daemon'");
  });

  it('a binary that does not exist is unavailable', async () => {
    const spec = buildRoomTurnSpawn('claude', { cwd: dir, sessionId: SESSION, sharedDir: dir, resume: false, platform: 'win32', env: env({ AIAW_CLAUDE_BIN: path.join(dir, 'no-such-binary') }) });
    const failure = await failureOf(runCliTurn({ kind: 'claude', spec, prompt: 'x', timeoutMs: 15_000 }));
    expect(failure.code).toBe('unavailable');
  });

  it('a turn that never ends times out with an error and the process is gone', async () => {
    const began = Date.now();
    const failure = await failureOf(runCliTurn(options('claude', 'never', { AIAW_STUB_HANG: '1' }, { timeoutMs: 600 })));
    expect(failure.code).toBe('timeout');
    expect(failure.message).toContain('did not end');
    expect(Date.now() - began).toBeLessThan(5000);
  });

  it('a stopped turn ends as aborted and the process is gone', async () => {
    const controller = new AbortController();
    const running = failureOf(runCliTurn(options('codex', 'long', { AIAW_STUB_HANG: '1' }, { signal: controller.signal })));
    setTimeout(() => controller.abort(), 300);
    expect((await running).code).toBe('aborted');
  });

  it('a turn that is stopped before it starts never spawns the CLI', async () => {
    const controller = new AbortController();
    controller.abort();
    const failure = await failureOf(runCliTurn(options('claude', 'x', {}, { signal: controller.signal })));
    expect(failure.code).toBe('aborted');
    expect(await invocations()).toEqual([]);
  });

  it('the prompt reaches the CLI as plain text, whatever it contains', async () => {
    const prompt = 'line one\nline \x1b[201~two $(touch /tmp/never) `x` "quoted" -- --flag';
    const result = await runCliTurn(options('claude', prompt));
    expect(result.reply).toBe(`stub reply to: ${prompt}`);
    expect((await invocations())[0]?.stdin).toBe(prompt);
  });

  it('a prompt of a megabyte is written whole and the child is not left waiting on stdin', async () => {
    const prompt = 'p'.repeat(1_000_000);
    const result = await runCliTurn(options('codex', prompt));
    expect(result.reply?.length).toBe(`stub reply to: ${prompt}`.length);
  });
});
