// room-sessions.test.ts
import { describe, expect, it } from 'vitest';
import { buildRoomSpawn, buildSpawn, type SpawnOptions } from '../../src/shared/cli-args';

const SESSION = '3f2b8c1e-9a4d-4e57-b6a0-1c2d3e4f5a6b';
const SHARED = '/Users/me/Library/Application Support/app/shared';
const SCRIPT_END = 5;

function options(overrides: Partial<SpawnOptions> = {}): SpawnOptions {
  return {
    cwd: '/work/project',
    sessionId: SESSION,
    sharedDir: SHARED,
    resume: false,
    platform: 'darwin',
    env: { SHELL: '/bin/bash', PATH: '/usr/bin' },
    ...overrides,
  };
}

function cliArgs(kind: 'claude' | 'codex', overrides: Partial<SpawnOptions> = {}): string[] {
  return buildRoomSpawn(kind, options(overrides)).args.slice(SCRIPT_END);
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
}

describe('room sessions start read-only', () => {
  it('starts claude in plan mode', () => {
    expect(valueAfter(cliArgs('claude'), '--permission-mode')).toBe('plan');
  });

  it('removes every tool that writes or leaves plan mode from claude', () => {
    const tools = (valueAfter(cliArgs('claude'), '--disallowedTools') ?? '').split(/\s+/);
    expect(tools).toEqual(expect.arrayContaining(['Bash', 'Edit', 'Write', 'NotebookEdit', 'ExitPlanMode']));
  });

  it('gives claude the shared directory and a fresh session id', () => {
    const args = cliArgs('claude');
    expect(valueAfter(args, '--session-id')).toBe(SESSION);
    expect(valueAfter(args, '--add-dir')).toBe(SHARED);
  });

  it('keeps plan mode when a claude room session is resumed', () => {
    const args = cliArgs('claude', { resume: true });
    expect(valueAfter(args, '--resume')).toBe(SESSION);
    expect(valueAfter(args, '--permission-mode')).toBe('plan');
    expect(args).toContain('--disallowedTools');
  });

  it('starts codex with a read-only sandbox, no approvals and no daemon', () => {
    const args = cliArgs('codex', { sessionId: undefined });
    expect(valueAfter(args, '--sandbox')).toBe('read-only');
    expect(valueAfter(args, '--ask-for-approval')).toBe('never');
    expect(args).toContain('--no-daemon');
  });

  it('starts codex with the update check off, so no update dialog takes the first Enter', () => {
    const args = cliArgs('codex', { sessionId: undefined });
    expect(valueAfter(args, '-c')).toBe('check_for_update_on_startup=false');
    const resumed = cliArgs('codex', { resume: true });
    expect(valueAfter(resumed, '-c')).toBe('check_for_update_on_startup=false');
    expect(resumed.indexOf('-c')).toBeLessThan(resumed.indexOf('resume'));
  });

  it('keeps the read-only sandbox when a codex room session is resumed', () => {
    const args = cliArgs('codex', { resume: true });
    expect(args.slice(args.indexOf('resume'))).toEqual(['resume', SESSION]);
    expect(valueAfter(args, '--sandbox')).toBe('read-only');
  });

  it('never carries a flag that lifts the restrictions', () => {
    for (const kind of ['claude', 'codex'] as const) {
      for (const resume of [false, true]) {
        const joined = cliArgs(kind, { resume }).join(' ');
        expect(joined).not.toMatch(/dangerously|bypass|danger-full-access|workspace-write|--yolo|acceptEdits/i);
      }
    }
  });

  it('passes the same flags on Windows without a login shell', () => {
    const spawn = buildRoomSpawn('claude', options({ platform: 'win32' }));
    expect(valueAfter(spawn.args, '--permission-mode')).toBe('plan');
    expect(spawn.args[0]).toBe('--permission-mode');
  });

  it('leaves working sessions without room flags', () => {
    const args = buildSpawn('claude', options()).args.join(' ');
    expect(args).not.toContain('--permission-mode');
    expect(buildSpawn('codex', options({ sessionId: undefined })).args.slice(SCRIPT_END)).toEqual(['codex']);
    expect(buildSpawn('codex', options({ sessionId: undefined })).args.join(' ')).not.toContain('check_for_update');
  });
});
