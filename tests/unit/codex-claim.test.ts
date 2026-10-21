// codex-claim.test.ts
import { describe, expect, it } from 'vitest';
import { claimRollout, rolloutId, type Rollout } from '../../src/shared/codex-claim';

const ID_A = '0199a1b2-c3d4-7e5f-8a6b-1c2d3e4f5a6b';
const ID_B = '0199a1b2-c3d4-7e5f-8a6b-2c2d3e4f5a6b';
const ID_C = '0199a1b2-c3d4-7e5f-8a6b-3c2d3e4f5a6b';
const SPAWN = 1_000_000;

function rollout(id: string, cwd: string | null, createdAtMs: number, extra: Partial<Rollout> = {}): Rollout {
  const meta = cwd === null ? '' : JSON.stringify({ type: 'session_meta', payload: { id, cwd } });
  return {
    fileName: `rollout-2026-10-21T10-00-00-${id}.jsonl`,
    firstLine: meta,
    createdAtMs,
    ...extra,
  };
}

describe('rolloutId', () => {
  it('reads the uuid at the end of the file name', () => {
    expect(rolloutId(`rollout-2026-10-21T10-00-00-${ID_A}.jsonl`)).toBe(ID_A);
  });

  it('rejects names that are not rollouts', () => {
    expect(rolloutId('session_index.jsonl')).toBeNull();
    expect(rolloutId(`rollout-2026-10-21T10-00-00-${ID_A}.txt`)).toBeNull();
    expect(rolloutId('rollout-2026-10-21T10-00-00-not-a-uuid.jsonl')).toBeNull();
  });
});

describe('claimRollout', () => {
  it('claims the rollout that appeared after the spawn in the same folder', () => {
    const claim = claimRollout({
      spawnedAtMs: SPAWN,
      cwd: '/work/p',
      claimed: new Set(),
      rollouts: [rollout(ID_A, '/work/p', SPAWN + 500)],
    });
    expect(claim).toBe(ID_A);
  });

  it('ignores a rollout older than the spawn', () => {
    const claim = claimRollout({
      spawnedAtMs: SPAWN,
      cwd: '/work/p',
      claimed: new Set(),
      rollouts: [rollout(ID_A, '/work/p', SPAWN - 1)],
    });
    expect(claim).toBeNull();
  });

  it('ignores a rollout of another folder', () => {
    const claim = claimRollout({
      spawnedAtMs: SPAWN,
      cwd: '/work/p',
      claimed: new Set(),
      rollouts: [rollout(ID_A, '/work/other', SPAWN + 500), rollout(ID_B, '/work/p/sub', SPAWN + 600)],
    });
    expect(claim).toBeNull();
  });

  it('ignores an already claimed rollout', () => {
    const claim = claimRollout({
      spawnedAtMs: SPAWN,
      cwd: '/work/p',
      claimed: new Set([ID_A]),
      rollouts: [rollout(ID_A, '/work/p', SPAWN + 500)],
    });
    expect(claim).toBeNull();
  });

  it('gives two windows in one folder one rollout each', () => {
    const rollouts = [rollout(ID_B, '/work/p', SPAWN + 5_000), rollout(ID_A, '/work/p', SPAWN + 1_000)];
    const claimed = new Set<string>();
    const first = claimRollout({ spawnedAtMs: SPAWN, cwd: '/work/p', claimed, rollouts });
    expect(first).toBe(ID_A);
    claimed.add(first as string);
    const second = claimRollout({ spawnedAtMs: SPAWN + 2_000, cwd: '/work/p', claimed, rollouts });
    expect(second).toBe(ID_B);
    claimed.add(second as string);
    expect(claimRollout({ spawnedAtMs: SPAWN, cwd: '/work/p', claimed, rollouts })).toBeNull();
  });

  it('does not hand the earlier window the rollout of the later one', () => {
    const rollouts = [rollout(ID_A, '/work/p', SPAWN + 1_000), rollout(ID_B, '/work/p', SPAWN + 5_000)];
    const later = claimRollout({ spawnedAtMs: SPAWN + 2_000, cwd: '/work/p', claimed: new Set([ID_A]), rollouts });
    expect(later).toBe(ID_B);
    const none = claimRollout({ spawnedAtMs: SPAWN + 6_000, cwd: '/work/p', claimed: new Set([ID_A, ID_B]), rollouts });
    expect(none).toBeNull();
  });

  it('skips rollouts whose first line is not a session_meta with a cwd', () => {
    const bad: Rollout[] = [
      rollout(ID_A, null, SPAWN + 100),
      rollout(ID_B, '/work/p', SPAWN + 200, { firstLine: 'not json' }),
      rollout(ID_C, '/work/p', SPAWN + 300, { firstLine: JSON.stringify({ type: 'response_item', payload: { cwd: '/work/p' } }) }),
      rollout(ID_C, '/work/p', SPAWN + 400, { firstLine: JSON.stringify({ type: 'session_meta', payload: { cwd: 7 } }) }),
      rollout(ID_C, '/work/p', SPAWN + 500, { firstLine: JSON.stringify({ type: 'session_meta' }) }),
      rollout(ID_C, '/work/p', SPAWN + 600, { firstLine: 'null' }),
    ];
    expect(claimRollout({ spawnedAtMs: SPAWN, cwd: '/work/p', claimed: new Set(), rollouts: bad })).toBeNull();
  });

  it('skips files that are not rollouts and ids that disagree with the meta', () => {
    const odd: Rollout[] = [
      { fileName: 'notes.jsonl', firstLine: JSON.stringify({ type: 'session_meta', payload: { cwd: '/work/p' } }), createdAtMs: SPAWN + 10 },
      rollout(ID_A, '/work/p', SPAWN + 20, {
        firstLine: JSON.stringify({ type: 'session_meta', payload: { id: ID_B, cwd: '/work/p' } }),
      }),
    ];
    expect(claimRollout({ spawnedAtMs: SPAWN, cwd: '/work/p', claimed: new Set(), rollouts: odd })).toBeNull();
  });

  it('claims a rollout whose meta carries no id by its file name', () => {
    const claim = claimRollout({
      spawnedAtMs: SPAWN,
      cwd: '/work/p',
      claimed: new Set(),
      rollouts: [rollout(ID_A, '/work/p', SPAWN + 20, { firstLine: JSON.stringify({ type: 'session_meta', payload: { cwd: '/work/p' } }) })],
    });
    expect(claim).toBe(ID_A);
  });

  it('keeps a hostile folder path as plain data', () => {
    const hostile = '/tmp/a b"; touch /tmp/pwned; "';
    const claim = claimRollout({
      spawnedAtMs: SPAWN,
      cwd: hostile,
      claimed: new Set(),
      rollouts: [rollout(ID_A, hostile, SPAWN + 1)],
    });
    expect(claim).toBe(ID_A);
  });
});
