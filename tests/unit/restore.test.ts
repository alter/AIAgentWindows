// restore.test.ts
import { describe, expect, it } from 'vitest';
import type { Agent } from '../../src/shared/agents';
import type { Rollout } from '../../src/shared/codex-claim';
import { claimForAgents, restoreSpawn, type RestoreContext } from '../../src/shared/restore';

const ID_A = '0199a1b2-c3d4-7e5f-8a6b-1c2d3e4f5a6b';
const ID_B = '0199a1b2-c3d4-7e5f-8a6b-2c2d3e4f5a6b';
const ID_C = '0199a1b2-c3d4-7e5f-8a6b-3c2d3e4f5a6b';
const SESSION = '0199a1b2-c3d4-7e5f-8a6b-9c2d3e4f5a6b';
const CTX: RestoreContext = {
  sharedDir: '/data/shared',
  platform: 'win32',
  env: { AIAW_CLAUDE_BIN: 'claude-bin', AIAW_CODEX_BIN: 'codex-bin' },
  claudeTranscriptExists: () => true,
};

function agent(partial: Partial<Agent> & Pick<Agent, 'id' | 'kind'>): Agent {
  return { title: partial.id, createdAt: 1000, ...partial };
}

function rollout(id: string, cwd: string, createdAtMs: number): Rollout {
  return {
    fileName: `rollout-2026-10-21T10-00-00-${id}.jsonl`,
    firstLine: JSON.stringify({ type: 'session_meta', payload: { id, cwd } }),
    createdAtMs,
  };
}

describe('restoreSpawn', () => {
  it('resumes a claude agent with its session id and the shared directory', () => {
    const spec = restoreSpawn(agent({ id: 'a', kind: 'claude', cwd: '/work/p', sessionId: SESSION }), CTX);
    expect(spec?.file).toBe('claude-bin');
    expect(spec?.args).toEqual(['--resume', SESSION, '--add-dir', '/data/shared']);
    expect(spec?.cwd).toBe('/work/p');
  });

  it('starts a claude agent with its own session id when the transcript does not exist', () => {
    const spec = restoreSpawn(agent({ id: 'a', kind: 'claude', cwd: '/work/p', sessionId: SESSION }), { ...CTX, claudeTranscriptExists: () => false });
    expect(spec?.args).toEqual(['--session-id', SESSION, '--add-dir', '/data/shared']);
  });

  it('asks about the transcript of the agent session only', () => {
    const asked: string[] = [];
    restoreSpawn(agent({ id: 'a', kind: 'claude', cwd: '/work/p', sessionId: SESSION }), { ...CTX, claudeTranscriptExists: (id) => asked.push(id) > 0 });
    restoreSpawn(agent({ id: 'b', kind: 'codex', cwd: '/work/p', sessionId: SESSION }), { ...CTX, claudeTranscriptExists: (id) => asked.push(id) > 0 });
    expect(asked).toEqual([SESSION]);
  });

  it('resumes a codex agent that has a claimed session id', () => {
    const spec = restoreSpawn(agent({ id: 'a', kind: 'codex', cwd: '/work/p', sessionId: SESSION }), CTX);
    expect(spec?.file).toBe('codex-bin');
    expect(spec?.args).toEqual(['resume', SESSION]);
  });

  it('starts a fresh codex when no session was claimed', () => {
    const spec = restoreSpawn(agent({ id: 'a', kind: 'codex', cwd: '/work/p' }), CTX);
    expect(spec?.args).toEqual([]);
    expect(spec?.cwd).toBe('/work/p');
  });

  it('spawns nothing for site agents, for a missing folder or for a claude agent without a session', () => {
    expect(restoreSpawn(agent({ id: 'a', kind: 'grok' }), CTX)).toBeNull();
    expect(restoreSpawn(agent({ id: 'a', kind: 'codex' }), CTX)).toBeNull();
    expect(restoreSpawn(agent({ id: 'a', kind: 'claude', cwd: '/work/p' }), CTX)).toBeNull();
  });

  it('keeps a hostile folder as the working directory, not as an argument', () => {
    const cwd = '/tmp/a b"; touch /tmp/pwned; "';
    const spec = restoreSpawn(agent({ id: 'a', kind: 'claude', cwd, sessionId: SESSION }), { ...CTX, platform: 'darwin', env: { SHELL: '/bin/zsh' } });
    expect(spec?.cwd).toBe(cwd);
    expect(spec?.args.some((arg) => arg.includes('pwned'))).toBe(false);
    expect(spec?.args).toContain('exec "$@"');
  });
});

describe('claimForAgents', () => {
  const bound = (item: Agent): number => item.createdAt;

  it('gives two codex agents in one folder one rollout each, oldest agent first', () => {
    const agents = [
      agent({ id: 'second', kind: 'codex', cwd: '/work/p', createdAt: 2000 }),
      agent({ id: 'first', kind: 'codex', cwd: '/work/p', createdAt: 1000 }),
    ];
    const claims = claimForAgents(agents, [rollout(ID_B, '/work/p', 2500), rollout(ID_A, '/work/p', 1500)], bound);
    expect(claims.get('first')).toBe(ID_A);
    expect(claims.get('second')).toBe(ID_B);
  });

  it('does not reuse a session id that another agent already holds', () => {
    const agents = [
      agent({ id: 'held', kind: 'codex', cwd: '/work/p', sessionId: ID_A, createdAt: 1000 }),
      agent({ id: 'open', kind: 'codex', cwd: '/work/p', createdAt: 1000 }),
    ];
    const claims = claimForAgents(agents, [rollout(ID_A, '/work/p', 1500)], bound);
    expect(claims.size).toBe(0);
  });

  it('ignores rollouts older than the agent, other folders, site agents and claude agents', () => {
    const agents = [
      agent({ id: 'codex', kind: 'codex', cwd: '/work/p', createdAt: 5000 }),
      agent({ id: 'claude', kind: 'claude', cwd: '/work/p', sessionId: SESSION, createdAt: 1000 }),
      agent({ id: 'site', kind: 'grok', createdAt: 1000 }),
    ];
    const claims = claimForAgents(agents, [rollout(ID_A, '/work/p', 4000), rollout(ID_C, '/work/other', 6000)], bound);
    expect(claims.size).toBe(0);
  });

  it('uses the caller-supplied lower bound per agent', () => {
    const agents = [agent({ id: 'late', kind: 'codex', cwd: '/work/p', createdAt: 1000 })];
    const claims = claimForAgents(agents, [rollout(ID_A, '/work/p', 1500)], () => 2000);
    expect(claims.size).toBe(0);
  });
});
