// cli-turn.test.ts
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { claudeTranscriptPath } from '../../src/main/claude-transcripts';
import { CliTurnError, runCliTurn, type CliTurnOptions } from '../../src/main/cli-turn';
import { codexRolloutLocator } from '../../src/main/codex-rollouts';
import { PtyManager } from '../../src/main/pty-manager';
import type { CliKind } from '../../src/shared/agents';
import { buildSpawn } from '../../src/shared/cli-args';

const STUB = path.resolve(__dirname, '..', 'fixtures', 'stub-cli.mjs');
const SESSION = '3f2b8c1e-9a4d-4e57-b6a0-1c2d3e4f5a6b';

const output = new Map<string, string>();
const manager = new PtyManager({
  onData: (id, data) => output.set(id, (output.get(id) ?? '') + data),
  onExit: () => undefined,
});

let dir: string;
let counter = 0;
const ids: string[] = [];

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'aiaw-turn-'));
});

afterEach(async () => {
  manager.killAll();
  const deadline = Date.now() + 5000;
  while (ids.some((id) => manager.has(id)) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  await rm(dir, { recursive: true, force: true });
});

interface Started {
  id: string;
  env: Record<string, string | undefined>;
  spawnedAtMs: number;
}

async function start(kind: CliKind, extra: Record<string, string> = {}): Promise<Started> {
  counter += 1;
  const id = `turn-${counter}`;
  ids.push(id);
  const env = {
    PATH: process.env.PATH,
    AIAW_CLAUDE_BIN: STUB,
    AIAW_CODEX_BIN: STUB,
    CLAUDE_CONFIG_DIR: path.join(dir, 'claude-config'),
    CODEX_HOME: path.join(dir, 'codex-home'),
    AIAW_STUB_TRANSCRIPT: kind,
    AIAW_STUB_REPLY_DELAY_MS: '60',
    ...extra,
  };
  const spawnedAtMs = Date.now();
  const spec = buildSpawn(kind, { cwd: dir, sessionId: SESSION, sharedDir: dir, resume: false, platform: 'win32', env });
  manager.spawn(id, spec, { cols: 100, rows: 30 });
  const deadline = Date.now() + 10_000;
  while (!(output.get(id) ?? '').includes('STUB-CLI BANNER')) {
    if (Date.now() > deadline) throw new Error('the stub did not start');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return { id, env, spawnedAtMs };
}

function turnOptions(kind: CliKind, started: Started, prompt: string, overrides: Partial<CliTurnOptions> = {}): CliTurnOptions {
  const locate =
    kind === 'claude'
      ? async () => claudeTranscriptPath(started.env, SESSION)
      : codexRolloutLocator(started.env, { cwd: dir, spawnedAtMs: started.spawnedAtMs, claimed: new Set() });
  return {
    kind,
    prompt,
    write: (data) => manager.write(started.id, data),
    locate,
    timeoutMs: 15_000,
    pollMs: 25,
    settleMs: 50,
    submitDelayMs: 40,
    ...overrides,
  };
}

describe('CLI turn driver', () => {
  it('claude: submits the prompt, ends on the end_turn text record and returns the reply', async () => {
    const started = await start('claude');
    const reply = await runCliTurn(turnOptions('claude', started, 'first question'));
    expect(reply).toBe('stub reply to: first question');
    expect(output.get(started.id)).toContain('SUBMITTED:first question');
  });

  it('claude: a thinking-only end_turn record does not end the turn early', async () => {
    const started = await start('claude', { AIAW_STUB_THINKING_FIRST: '1' });
    const reply = await runCliTurn(turnOptions('claude', started, 'think first'));
    expect(reply).toBe('stub reply to: think first');
  });

  it('claude: the second turn returns only the second reply', async () => {
    const started = await start('claude');
    await runCliTurn(turnOptions('claude', started, 'one'));
    const reply = await runCliTurn(turnOptions('claude', started, 'two'));
    expect(reply).toBe('stub reply to: two');
  });

  it('codex: ends on task_complete and returns last_agent_message', async () => {
    const started = await start('codex');
    const reply = await runCliTurn(turnOptions('codex', started, 'codex question'));
    expect(reply).toBe('stub reply to: codex question');
  });

  it('codex: a null last_agent_message falls back to the final_answer item', async () => {
    const started = await start('codex', { AIAW_STUB_CODEX_NULL_REPLY: '1' });
    const reply = await runCliTurn(turnOptions('codex', started, 'fallback'));
    expect(reply).toBe('stub reply to: fallback');
  });

  it('codex: a turn with an error is a failure, not a reply', async () => {
    const started = await start('codex', { AIAW_STUB_CODEX_ERROR: '1' });
    const failure = await runCliTurn(turnOptions('codex', started, 'boom')).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CliTurnError);
    expect((failure as CliTurnError).code).toBe('failed');
  });

  it('a turn that never ends times out with an error', async () => {
    const started = await start('claude', { AIAW_STUB_HANG: '1' });
    const began = Date.now();
    const failure = await runCliTurn(turnOptions('claude', started, 'never', { timeoutMs: 800 })).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CliTurnError);
    expect((failure as CliTurnError).code).toBe('timeout');
    expect(Date.now() - began).toBeLessThan(5000);
  });

  it('a session that is gone is reported as unavailable', async () => {
    const started = await start('claude');
    const failure = await runCliTurn(turnOptions('claude', started, 'x', { write: () => false })).catch((error: unknown) => error);
    expect((failure as CliTurnError).code).toBe('unavailable');
  });

  it('the prompt is sent as one bracketed paste with escapes stripped', async () => {
    const started = await start('claude');
    const reply = await runCliTurn(turnOptions('claude', started, 'line one\nline \x1b[201~two'));
    expect(reply).toContain('line one');
    expect(output.get(started.id)?.match(/SUBMITTED:/g)).toHaveLength(1);
  });
});
