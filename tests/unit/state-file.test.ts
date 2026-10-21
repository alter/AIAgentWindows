// state-file.test.ts
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyState, type AppState } from '../../src/shared/agents';
import { loadState, saveState } from '../../src/main/state-file';

const SAMPLE: AppState = {
  version: 1,
  agents: [
    { id: 'a1', kind: 'claude', title: 'Claude Code', cwd: '/tmp/a b"; touch /tmp/pwned; "', sessionId: '0b1c3a52-5f0e-4a39-9d5e-7a8c1f2e3d4b', createdAt: 1 },
    { id: 'a2', kind: 'grok', title: 'Grok', createdAt: 2 },
  ],
};

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'aiaw-state-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('state file', () => {
  it('returns an empty state when the file is missing', async () => {
    expect(await loadState(path.join(dir, 'agents.json'))).toEqual(emptyState());
  });

  it('returns an empty state when the file is invalid', async () => {
    const file = path.join(dir, 'agents.json');
    await writeFile(file, '{not json', 'utf8');
    expect(await loadState(file)).toEqual(emptyState());
  });

  it('round-trips a saved state and creates missing directories', async () => {
    const file = path.join(dir, 'nested', 'agents.json');
    await saveState(file, SAMPLE);
    expect(await loadState(file)).toEqual(SAMPLE);
  });

  it('replaces the previous content and leaves no temporary file behind', async () => {
    const file = path.join(dir, 'agents.json');
    await saveState(file, SAMPLE);
    await saveState(file, emptyState());
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(emptyState());
    expect(await readdir(dir)).toEqual(['agents.json']);
  });
});
