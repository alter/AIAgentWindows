// cli-args.test.ts
import { describe, expect, it } from 'vitest';
import { buildSpawn, type SpawnOptions } from '../../src/shared/cli-args';

const SESSION = '3f2b8c1e-9a4d-4e57-b6a0-1c2d3e4f5a6b';
const HOSTILE = '/tmp/a b"; touch /tmp/pwned; "';
const SHARED = '/Users/me/Library/Application Support/app/shared';
const SCRIPT = 'exec "$@"';

function options(overrides: Partial<SpawnOptions> = {}): SpawnOptions {
  return {
    cwd: '/work/project',
    sessionId: SESSION,
    sharedDir: SHARED,
    resume: false,
    platform: 'darwin',
    env: { SHELL: '/bin/bash', PATH: '/usr/bin', HOME: '/Users/me' },
    ...overrides,
  };
}

describe('buildSpawn on a POSIX host', () => {
  it('starts a new claude session with a fresh session id and the shared directory', () => {
    const spawn = buildSpawn('claude', options());
    expect(spawn.file).toBe('/bin/bash');
    expect(spawn.args).toEqual([
      '-l', '-i', '-c', SCRIPT, 'agent-shell',
      'claude', '--session-id', SESSION, '--add-dir', SHARED,
    ]);
    expect(spawn.cwd).toBe('/work/project');
  });

  it('resumes a claude session by id', () => {
    const spawn = buildSpawn('claude', options({ resume: true }));
    expect(spawn.args.slice(5)).toEqual(['claude', '--resume', SESSION, '--add-dir', SHARED]);
  });

  it('starts a new codex session without arguments', () => {
    const spawn = buildSpawn('codex', options({ sessionId: undefined }));
    expect(spawn.args.slice(5)).toEqual(['codex']);
  });

  it('resumes a codex session by id', () => {
    const spawn = buildSpawn('codex', options({ resume: true }));
    expect(spawn.args.slice(5)).toEqual(['codex', 'resume', SESSION]);
  });

  it('falls back to /bin/zsh without SHELL', () => {
    const spawn = buildSpawn('codex', options({ env: { PATH: '/usr/bin' } }));
    expect(spawn.file).toBe('/bin/zsh');
  });

  it('uses the binary override from the environment', () => {
    const claude = buildSpawn('claude', options({ env: { AIAW_CLAUDE_BIN: '/t/stub claude' } }));
    expect(claude.args[5]).toBe('/t/stub claude');
    const codex = buildSpawn('codex', options({ env: { AIAW_CODEX_BIN: '/t/stub-codex' } }));
    expect(codex.args[5]).toBe('/t/stub-codex');
  });

  it('keeps hostile path as one argument', () => {
    const spawn = buildSpawn('claude', options({ cwd: HOSTILE, sharedDir: HOSTILE }));
    expect(spawn.args[3]).toBe(SCRIPT);
    expect(spawn.cwd).toBe(HOSTILE);
    expect(spawn.args.filter((arg) => arg === HOSTILE)).toHaveLength(1);
    expect(spawn.args.filter((arg) => arg.includes('pwned'))).toEqual([HOSTILE]);
    const index = spawn.args.indexOf('--add-dir');
    expect(spawn.args[index + 1]).toBe(HOSTILE);
  });
});

describe('buildSpawn on Windows', () => {
  it('spawns the CLI directly', () => {
    const spawn = buildSpawn('claude', options({ platform: 'win32' }));
    expect(spawn.file).toBe('claude');
    expect(spawn.args).toEqual(['--session-id', SESSION, '--add-dir', SHARED]);
  });
});

describe('buildSpawn environment', () => {
  it('removes CLAUDE_CODE_CHILD_SESSION and keeps the rest', () => {
    const env = { CLAUDE_CODE_CHILD_SESSION: '1', PATH: '/usr/bin' };
    const spawn = buildSpawn('claude', options({ env }));
    expect(spawn.env).not.toHaveProperty('CLAUDE_CODE_CHILD_SESSION');
    expect(spawn.env.PATH).toBe('/usr/bin');
    expect(env.CLAUDE_CODE_CHILD_SESSION).toBe('1');
  });

  it('drops undefined environment values', () => {
    const spawn = buildSpawn('codex', options({ env: { A: undefined, B: 'b' } }));
    expect(spawn.env).toEqual({ B: 'b' });
  });
});

describe('buildSpawn validation', () => {
  it('rejects a malformed session id', () => {
    expect(() => buildSpawn('claude', options({ sessionId: 'x; rm -rf /' }))).toThrow();
    expect(() => buildSpawn('codex', options({ resume: true, sessionId: 'nope' }))).toThrow();
  });

  it('requires a session id for claude and for any resume', () => {
    expect(() => buildSpawn('claude', options({ sessionId: undefined }))).toThrow();
    expect(() => buildSpawn('codex', options({ resume: true, sessionId: undefined }))).toThrow();
  });

  it('rejects an empty cwd', () => {
    expect(() => buildSpawn('codex', options({ cwd: '' }))).toThrow();
  });
});
