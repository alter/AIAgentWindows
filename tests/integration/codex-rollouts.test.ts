// codex-rollouts.test.ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { codexHome, listRollouts } from '../../src/main/codex-rollouts';

const ID = '0199a1b2-c3d4-7e5f-8a6b-1c2d3e4f5a6b';
let home: string;

beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'aiaw-codex-'));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

async function putRollout(day: Date, name: string, text: string): Promise<void> {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const dir = path.join(home, 'sessions', String(day.getFullYear()), pad(day.getMonth() + 1), pad(day.getDate()));
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), text);
}

describe('codex rollouts', () => {
  it('lists rollouts of the covered days with their first line only', async () => {
    const now = new Date();
    const meta = JSON.stringify({ type: 'session_meta', payload: { id: ID, cwd: '/work/p' } });
    await putRollout(now, `rollout-2026-10-21T10-00-00-${ID}.jsonl`, `${meta}\n{"second":"line"}\n`);
    await putRollout(now, 'notes.txt', 'not a rollout');
    const found = await listRollouts(home, now.getTime() - 1000);
    expect(found).toHaveLength(1);
    expect(found[0]?.firstLine).toBe(meta);
    expect(found[0]?.createdAtMs).toBeGreaterThan(now.getTime() - 60_000);
  });

  it('skips days outside the window and a missing sessions directory', async () => {
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await putRollout(old, `rollout-2026-10-11T10-00-00-${ID}.jsonl`, '{}\n');
    expect(await listRollouts(home, Date.now() - 1000)).toEqual([]);
    expect(await listRollouts(path.join(home, 'nowhere'), Date.now())).toEqual([]);
  });

  it('takes the home from CODEX_HOME or the default folder', () => {
    expect(codexHome({ CODEX_HOME: '/x/codex' })).toBe('/x/codex');
    expect(codexHome({})).toBe(path.join(os.homedir(), '.codex'));
  });
});
