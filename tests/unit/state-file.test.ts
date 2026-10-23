// state-file.test.ts
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyState, type AppState } from '../../src/shared/agents';
import { loadState, saveState, stateFailure } from '../../src/main/state-file';
import { FailClosedError } from '../../src/main/store/json-file';

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

  it('round-trips a stored theme choice', async () => {
    const file = path.join(dir, 'agents.json');
    await saveState(file, { ...SAMPLE, theme: 'dark' });
    expect((await loadState(file)).theme).toBe('dark');
  });

  it('loads a file written before the theme existed without a theme', async () => {
    const file = path.join(dir, 'agents.json');
    await writeFile(file, JSON.stringify({ version: 1, agents: [] }), 'utf8');
    expect(await loadState(file)).toEqual(emptyState());
  });

  it('round-trips a stored sidebar width', async () => {
    const file = path.join(dir, 'agents.json');
    await saveState(file, { ...SAMPLE, sidebarWidth: 340 });
    expect((await loadState(file)).sidebarWidth).toBe(340);
  });

  it('loads a file written before the sidebar width existed without a width', async () => {
    const file = path.join(dir, 'agents.json');
    await writeFile(file, JSON.stringify({ version: 1, agents: [], theme: 'dark' }), 'utf8');
    expect((await loadState(file)).sidebarWidth).toBeUndefined();
  });

  it('reads an out of range or non-integer stored sidebar width as 260', async () => {
    const file = path.join(dir, 'agents.json');
    for (const sidebarWidth of [50, 5000, 300.5, '300', null]) {
      await writeFile(file, JSON.stringify({ version: 1, agents: [], sidebarWidth }), 'utf8');
      expect((await loadState(file)).sidebarWidth).toBe(260);
    }
  });

  it('keeps theme and sidebar width side by side', async () => {
    const file = path.join(dir, 'agents.json');
    await writeFile(file, JSON.stringify({ version: 1, agents: [], theme: 'light', sidebarWidth: 280 }), 'utf8');
    const state = await loadState(file);
    expect([state.theme, state.sidebarWidth]).toEqual(['light', 280]);
  });

  it('reads an unknown stored theme as system', async () => {
    const file = path.join(dir, 'agents.json');
    await writeFile(file, JSON.stringify({ version: 1, agents: [], theme: 'neon' }), 'utf8');
    expect((await loadState(file)).theme).toBe('system');
  });
  it('round-trips a stored key ciphertext and drops anything that is not base64 or is too long', async () => {
    const file = path.join(dir, 'agents.json');
    await saveState(file, { ...SAMPLE, openrouterKey: 'AQIDBA==' });
    expect((await loadState(file)).openrouterKey).toBe('AQIDBA==');
    for (const openrouterKey of ['sk-or-v1-plain key', '', 7, null, 'A'.repeat(4097)]) {
      await writeFile(file, JSON.stringify({ version: 1, agents: [], openrouterKey }), 'utf8');
      expect((await loadState(file)).openrouterKey).toBeUndefined();
    }
  });
});

describe('state file fails closed', () => {
  it('keeps a truncated file and a future-version file byte-identical when a save is attempted', async () => {
    for (const content of ['{"version":1,"agents":[', JSON.stringify({ version: 3, agents: [] })]) {
      const file = path.join(dir, `agents-${content.length}.json`);
      await writeFile(file, content, 'utf8');
      expect(await loadState(file)).toEqual(emptyState());
      expect(stateFailure(file)).not.toBeNull();
      await expect(saveState(file, SAMPLE)).rejects.toBeInstanceOf(FailClosedError);
      expect(await readFile(file, 'utf8')).toBe(content);
    }
  });

  it('reports no failure for a missing file and for one that loaded', async () => {
    const file = path.join(dir, 'fresh.json');
    expect(stateFailure(file)).toBeNull();
    await saveState(file, SAMPLE);
    await loadState(file);
    expect(stateFailure(file)).toBeNull();
  });

  it('rejects a file that is not an object', async () => {
    const file = path.join(dir, 'array.json');
    await writeFile(file, '[]', 'utf8');
    await loadState(file);
    expect(stateFailure(file)).toContain('not an object');
  });
});
