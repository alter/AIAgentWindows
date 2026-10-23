// room-sessions.test.ts
import { describe, expect, it } from 'vitest';
import { buildRoomTurnSpawn, buildSpawn, type SpawnOptions } from '../../src/shared/cli-args';

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
  return buildRoomTurnSpawn(kind, options(overrides)).args.slice(SCRIPT_END);
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
}

describe('room sessions start read-only', () => {
  it('starts claude in plan mode', () => {
    expect(valueAfter(cliArgs('claude'), '--permission-mode')).toBe('plan');
  });

  it('gives claude an allowlist of read tools and the two web tools, and nothing else', () => {
    const args = cliArgs('claude');
    const tools = (valueAfter(args, '--tools') ?? '').split(',');
    expect(tools.sort()).toEqual(['Glob', 'Grep', 'Read', 'WebFetch', 'WebSearch']);
  });

  it('approves only the two web tools for a turn nobody can answer a prompt in', () => {
    for (const resume of [false, true]) {
      const approved = (valueAfter(cliArgs('claude', { resume }), '--allowedTools') ?? '').split(',');
      expect(approved.sort()).toEqual(['WebFetch', 'WebSearch']);
    }
  });

  it('never approves or offers a tool that runs commands or writes files', () => {
    for (const resume of [false, true]) {
      const args = cliArgs('claude', { resume });
      const named = `${valueAfter(args, '--tools')},${valueAfter(args, '--allowedTools')}`;
      expect(named).not.toMatch(/Bash|PowerShell|Edit|Write|NotebookEdit|Agent|Monitor/);
    }
  });

  it('ignores the owner MCP servers: strict config with an empty server list', () => {
    const args = cliArgs('claude');
    expect(args).toContain('--strict-mcp-config');
    expect(JSON.parse(valueAfter(args, '--mcp-config') ?? 'null')).toEqual({ mcpServers: {} });
  });

  it('denies every MCP tool, because --tools does not touch them', () => {
    expect(valueAfter(cliArgs('claude'), '--disallowedTools')).toBe('mcp__*');
  });

  it('gives claude the shared directory and a fresh session id on the first turn', () => {
    const args = cliArgs('claude');
    expect(valueAfter(args, '--session-id')).toBe(SESSION);
    expect(args).not.toContain('--resume');
    expect(valueAfter(args, '--add-dir')).toBe(SHARED);
  });

  it('runs claude non-interactively with stream-json output and no prompt in the arguments', () => {
    const args = cliArgs('claude');
    expect(args[1]).toBe('-p');
    expect(valueAfter(args, '--output-format')).toBe('stream-json');
    expect(args).toContain('--verbose');
    expect(args).not.toContain('--no-session-persistence');
    expect(args.slice(-2)).toEqual(['--session-id', SESSION]);
  });

  it('keeps plan mode when a claude room session is resumed', () => {
    const args = cliArgs('claude', { resume: true });
    expect(valueAfter(args, '--resume')).toBe(SESSION);
    expect(args).not.toContain('--session-id');
    expect(valueAfter(args, '--permission-mode')).toBe('plan');
    expect(valueAfter(args, '--tools')).toBeDefined();
    expect(args).toContain('--strict-mcp-config');
    expect(args).toContain('-p');
  });

  it('starts codex with a read-only sandbox, as exec, with its JSON events and the prompt on stdin', () => {
    const args = cliArgs('codex', { sessionId: undefined });
    expect(args.slice(0, 2)).toEqual(['codex', 'exec']);
    expect(valueAfter(args, '--sandbox')).toBe('read-only');
    expect(args).toContain('--json');
    expect(args).toContain('--skip-git-repo-check');
    expect(args.at(-1)).toBe('-');
    expect(args).not.toContain('resume');
  });

  it('gives codex live web search through its config override, before resume, where exec accepts it', () => {
    for (const resume of [false, true]) {
      const args = cliArgs('codex', { resume });
      expect(args).not.toContain('--search');
      expect(valueAfter(args, '-c')).toBe('web_search="live"');
      if (resume) expect(args.indexOf('-c')).toBeLessThan(args.indexOf('resume'));
      expect(args.indexOf('-c')).toBeLessThan(args.length - 1);
      expect(valueAfter(args, '--sandbox')).toBe('read-only');
    }
  });

  it('gives codex exec no flag that exec does not accept: it has no approval flag and no daemon', () => {
    for (const resume of [false, true]) {
      const args = cliArgs('codex', { resume });
      expect(args).not.toContain('--ask-for-approval');
      expect(args).not.toContain('-a');
      expect(args).not.toContain('--no-daemon');
      expect(args).not.toContain('check_for_update_on_startup=false');
    }
  });

  it('keeps the read-only sandbox before resume, where exec accepts it, when a codex room session is resumed', () => {
    const args = cliArgs('codex', { resume: true });
    expect(args.slice(args.indexOf('resume'))).toEqual(['resume', SESSION, '-']);
    expect(args.indexOf('--sandbox')).toBeGreaterThan(-1);
    expect(args.indexOf('--sandbox')).toBeLessThan(args.indexOf('resume'));
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

  it('keeps every read-only and web flag when model and effort are set', () => {
    for (const resume of [false, true]) {
      const claude = cliArgs('claude', { resume, model: 'opus', effort: 'high' });
      expect(valueAfter(claude, '--permission-mode')).toBe('plan');
      expect((valueAfter(claude, '--tools') ?? '').split(',').sort()).toEqual(['Glob', 'Grep', 'Read', 'WebFetch', 'WebSearch']);
      expect((valueAfter(claude, '--allowedTools') ?? '').split(',').sort()).toEqual(['WebFetch', 'WebSearch']);
      expect(valueAfter(claude, '--disallowedTools')).toBe('mcp__*');
      expect(claude).toContain('--strict-mcp-config');
      const codex = cliArgs('codex', { resume, model: 'gpt-5.5', effort: 'low' });
      expect(valueAfter(codex, '--sandbox')).toBe('read-only');
      expect(codex).toContain('web_search="live"');
      expect(codex.at(-1)).toBe('-');
      expect(codex.indexOf('--sandbox')).toBeLessThan(codex.indexOf('-m'));
      expect(codex.join(' ')).not.toMatch(/dangerously|bypass|danger-full-access|workspace-write|--yolo|acceptEdits/i);
    }
  });

  it('passes the same flags on Windows without a login shell', () => {
    const spawn = buildRoomTurnSpawn('claude', options({ platform: 'win32' }));
    expect(valueAfter(spawn.args, '--permission-mode')).toBe('plan');
    expect(spawn.file).toBe('claude');
    expect(spawn.args[0]).toBe('-p');
  });

  it('goes through the login shell by default and runs the binary directly when asked not to', () => {
    const viaShell = buildRoomTurnSpawn('claude', options());
    expect(viaShell.file).toBe('/bin/bash');
    expect(viaShell.args.slice(0, 3)).toEqual(['-l', '-i', '-c']);
    const direct = buildRoomTurnSpawn('claude', options({ loginShell: false, env: { PATH: '/usr/bin', AIAW_CLAUDE_BIN: '/stub/claude' } }));
    expect(direct.file).toBe('/stub/claude');
    expect(direct.args).toEqual(viaShell.args.slice(SCRIPT_END + 1));
  });

  it('leaves working sessions without room flags', () => {
    const args = buildSpawn('claude', options()).args.join(' ');
    expect(args).not.toContain('--permission-mode');
    expect(buildSpawn('codex', options({ sessionId: undefined })).args.slice(SCRIPT_END)).toEqual(['codex']);
    expect(buildSpawn('codex', options({ sessionId: undefined })).args.join(' ')).not.toContain('check_for_update');
  });
});
