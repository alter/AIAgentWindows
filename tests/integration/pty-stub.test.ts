// pty-stub.test.ts
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSpawn } from '../../src/shared/cli-args';
import { PtyManager } from '../../src/main/pty-manager';

const STUB = path.resolve(__dirname, '..', 'fixtures', 'stub-cli.mjs');
const SESSION = '3f2b8c1e-9a4d-4e57-b6a0-1c2d3e4f5a6b';
const PASTE = '\x1b[200~first line\nsecond line\x1b[201~';

interface Exit {
  id: string;
  exitCode: number;
  signal: number | undefined;
}

const output = new Map<string, string>();
const exits: Exit[] = [];
const manager = new PtyManager({
  onData: (id, data) => output.set(id, (output.get(id) ?? '') + data),
  onExit: (id, exitCode, signal) => exits.push({ id, exitCode, signal }),
});

const ids: string[] = [];

function stubSpec(extraEnv: Record<string, string> = {}, resume = false) {
  return buildSpawn('claude', {
    cwd: process.cwd(),
    sessionId: SESSION,
    sharedDir: '/tmp/shared',
    resume,
    platform: 'win32',
    env: { PATH: process.env.PATH, AIAW_CLAUDE_BIN: STUB, ...extraEnv },
  });
}

function nextId(): string {
  const id = `stub-${ids.length + 1}`;
  ids.push(id);
  return id;
}

function startStub(extraEnv: Record<string, string> = {}): string {
  const id = nextId();
  manager.spawn(id, stubSpec(extraEnv), { cols: 100, rows: 30 });
  return id;
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function started(id: string): Promise<void> {
  await waitFor(() => (output.get(id) ?? '').includes('STUB-CLI BANNER'), 'the banner');
}

afterEach(async () => {
  manager.killAll();
  await waitFor(() => ids.every((id) => !manager.has(id)), 'cleanup');
});

describe('stub CLI in a node-pty terminal', () => {
  it('shows the banner with the argv it was started with', async () => {
    const id = startStub();
    await started(id);
    const text = output.get(id) ?? '';
    expect(text).toContain(`"--session-id","${SESSION}","--add-dir","/tmp/shared"`);
  });

  it('paste is not submitted', async () => {
    const id = startStub();
    await started(id);
    manager.write(id, PASTE);
    await waitFor(() => (output.get(id) ?? '').includes('second line'), 'the pasted text echo');
    expect(output.get(id)).toContain('first line');
    expect(output.get(id)).not.toContain('SUBMITTED');
  });

  it('typed Enter is submitted (control for the paste test)', async () => {
    const id = startStub();
    await started(id);
    manager.write(id, 'abc\r');
    await waitFor(() => (output.get(id) ?? '').includes('SUBMITTED:abc'), 'the submitted line');
  });

  it('does not pass CLAUDE_CODE_CHILD_SESSION to the child', async () => {
    const id = startStub({ CLAUDE_CODE_CHILD_SESSION: '1' });
    await started(id);
    expect(output.get(id)).toContain('CLAUDE_CODE_CHILD_SESSION=unset');
  });

  it('the stub reports the marker when it is passed (control for the env test)', async () => {
    const id = nextId();
    const spec = stubSpec();
    manager.spawn(id, { ...spec, env: { ...spec.env, CLAUDE_CODE_CHILD_SESSION: '1' } });
    await started(id);
    expect(output.get(id)).toContain('CLAUDE_CODE_CHILD_SESSION=set');
  });

  it('resize, write to unknown ids and duplicate ids are handled', async () => {
    const id = startStub();
    await started(id);
    expect(manager.resize(id, { cols: 120, rows: 40 })).toBe(true);
    expect(manager.resize('missing', { cols: 1, rows: 1 })).toBe(false);
    expect(manager.write('missing', 'x')).toBe(false);
    expect(manager.kill('missing')).toBe(false);
    expect(() => manager.spawn(id, stubSpec())).toThrow(/already exists/);
  });

  it('kill ends the process and forgets the session', async () => {
    const id = nextId();
    const pid = manager.spawn(id, stubSpec());
    await started(id);
    expect(manager.has(id)).toBe(true);
    expect(manager.kill(id)).toBe(true);
    await waitFor(() => exits.some((e) => e.id === id), 'the exit event');
    expect(manager.has(id)).toBe(false);
    expect(() => process.kill(pid, 0)).toThrow();
  });
});
