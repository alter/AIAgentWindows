// app-state.test.ts
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppStateStore, StateRefusedError } from '../../src/main/store/app-state';

const CHATGPT = '8182ddf2-1111-4111-8111-aaaaaaaaaaaa';
const GROK = '5dff1f45-2222-4222-8222-bbbbbbbbbbbb';
const DEEPSEEK = 'cfdc58b3-3333-4333-8333-cccccccccccc';

let dir: string;

function legacyText(): string {
  const agents = [
    { id: CHATGPT, kind: 'chatgpt', title: 'ChatGPT', createdAt: 1 },
    { id: GROK, kind: 'grok', title: 'Grok', createdAt: 2 },
    { id: DEEPSEEK, kind: 'deepseek', title: 'DeepSeek', createdAt: 3 },
  ];
  return JSON.stringify({ version: 1, agents, theme: 'light', sidebarWidth: 310, openrouterKey: 'AQIDBA==' });
}

async function stateOnDisk(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(dir, 'state.json'), 'utf8')) as Record<string, unknown>;
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'aiaw-app-state-'));
});

afterEach(async () => {
  await chmod(dir, 0o700);
  await rm(dir, { recursive: true, force: true });
});

describe('first start without state.json', () => {
  it('migrates agents.json into state.json once and leaves agents.json byte-identical', async () => {
    const text = legacyText();
    await writeFile(path.join(dir, 'agents.json'), text, 'utf8');
    const store = await AppStateStore.open(dir);
    const expected = {
      version: 2,
      agents: [],
      theme: 'light',
      sidebarWidth: 310,
      openrouterKey: 'AQIDBA==',
      partitions: { chatgpt: `persist:${CHATGPT}`, grok: `persist:${GROK}`, deepseek: `persist:${DEEPSEEK}` },
    };
    expect(store.read()).toEqual(expected);
    expect(store.failure()).toBeNull();
    expect(await stateOnDisk()).toEqual(expected);
    expect(await readFile(path.join(dir, 'agents.json'), 'utf8')).toBe(text);
  });

  it('starts empty and writes nothing when neither file exists', async () => {
    const store = await AppStateStore.open(dir);
    expect(store.read()).toEqual({ version: 2, agents: [] });
    expect(store.failure()).toBeNull();
    expect(await readdir(dir)).toEqual([]);
  });

  it('writes no state.json, shows the error and refuses every change while agents.json cannot be read, then migrates at the next start', async () => {
    const truncated = '{"version":1,"agents":[{"id":"';
    await writeFile(path.join(dir, 'agents.json'), truncated, 'utf8');
    const store = await AppStateStore.open(dir);
    expect(store.failure()).toContain(path.join(dir, 'agents.json'));
    expect(await readdir(dir)).toEqual(['agents.json']);
    await expect(store.update('theme', () => 'dark')).rejects.toBeInstanceOf(StateRefusedError);
    expect(await readdir(dir)).toEqual(['agents.json']);
    expect(await readFile(path.join(dir, 'agents.json'), 'utf8')).toBe(truncated);
    await writeFile(path.join(dir, 'agents.json'), legacyText(), 'utf8');
    const again = await AppStateStore.open(dir);
    expect(again.failure()).toBeNull();
    expect(again.read().partitions?.grok).toBe(`persist:${GROK}`);
  });

  it('does not create state.json and refuses changes when it cannot be written', async () => {
    await writeFile(path.join(dir, 'agents.json'), legacyText(), 'utf8');
    await chmod(dir, 0o500);
    const store = await AppStateStore.open(dir);
    expect(store.failure()).toContain(path.join(dir, 'state.json'));
    expect(store.read()).toEqual({ version: 2, agents: [] });
    await expect(store.update('theme', () => 'dark')).rejects.toBeInstanceOf(StateRefusedError);
    await chmod(dir, 0o700);
    expect((await readdir(dir)).filter((name) => name === 'state.json')).toEqual([]);
  });
});

describe('start with state.json', () => {
  it('never opens agents.json again', async () => {
    const seeded = JSON.stringify({ version: 2, agents: [], theme: 'dark' });
    await writeFile(path.join(dir, 'state.json'), seeded, 'utf8');
    await writeFile(path.join(dir, 'agents.json'), legacyText(), 'utf8');
    const store = await AppStateStore.open(dir);
    expect(store.failure()).toBeNull();
    expect(store.read()).toEqual({ version: 2, agents: [], theme: 'dark' });
    expect(await readFile(path.join(dir, 'state.json'), 'utf8')).toBe(seeded);
    await store.update('sidebarWidth', () => 280);
    expect(await readFile(path.join(dir, 'agents.json'), 'utf8')).toBe(legacyText());
    expect((await readdir(dir)).sort()).toEqual(['agents.json', 'state.json']);
  });

  it('keeps a truncated, a future-version and an invalid-agent state.json byte-identical and refuses every change with the path', async () => {
    const contents = [
      '{"version":2,"agents":[',
      JSON.stringify({ version: 3, agents: [] }),
      JSON.stringify({ version: 2, agents: [{ id: 'x' }], partitions: { grok: `persist:${GROK}` } }),
    ];
    for (const [index, content] of contents.entries()) {
      const folder = path.join(dir, `case-${index}`);
      await mkdir(folder);
      await writeFile(path.join(folder, 'state.json'), content, 'utf8');
      await writeFile(path.join(folder, 'agents.json'), legacyText(), 'utf8');
      const store = await AppStateStore.open(folder);
      expect(store.failure()).toContain(path.join(folder, 'state.json'));
      for (const attempt of [() => store.update('agents', () => []), () => store.update('theme', () => 'dark'), () => store.update('openrouterKey', () => 'AQIDBA==')]) {
        await expect(attempt()).rejects.toBeInstanceOf(StateRefusedError);
      }
      expect(await readFile(path.join(folder, 'state.json'), 'utf8')).toBe(content);
      expect((await readdir(folder)).sort()).toEqual(['agents.json', 'state.json']);
    }
  });

  it('keeps the partition map when another slice changes', async () => {
    await writeFile(path.join(dir, 'agents.json'), legacyText(), 'utf8');
    const store = await AppStateStore.open(dir);
    const agent = { id: 'a1', kind: 'claude' as const, title: 'Claude Code', cwd: '/w', createdAt: 1 };
    await store.update('agents', () => [agent]);
    await store.update('agents', (current) => current.map((item) => ({ ...item, title: 'Renamed' })));
    await store.update('theme', () => 'dark');
    await store.update('sidebarWidth', () => 260);
    await store.update('openrouterKey', () => 'AQIDBA==');
    const partitions = { chatgpt: `persist:${CHATGPT}`, grok: `persist:${GROK}`, deepseek: `persist:${DEEPSEEK}` };
    expect((await stateOnDisk())['partitions']).toEqual(partitions);
    expect(await stateOnDisk()).toMatchObject({ theme: 'dark', sidebarWidth: 260, openrouterKey: 'AQIDBA==', agents: [{ title: 'Renamed' }] });
    const reopened = await AppStateStore.open(dir);
    expect(reopened.read()).toEqual(store.read());
    expect(reopened.read().partitions).toEqual(partitions);
  });

  it('removes a slice set to undefined and applies parallel updates in order', async () => {
    const store = await AppStateStore.open(dir);
    await store.update('openrouterKey', () => 'AQIDBA==');
    await store.update('openrouterKey', () => undefined);
    expect('openrouterKey' in (await stateOnDisk())).toBe(false);
    await Promise.all([1, 2, 3, 4].map((width) => store.update('sidebarWidth', (current) => (current ?? 0) + width)));
    expect(store.read().sidebarWidth).toBe(10);
    expect((await stateOnDisk())['sidebarWidth']).toBe(10);
  });

  it('keeps the document unchanged when a write fails and lets the next update through', async () => {
    const store = await AppStateStore.open(dir);
    await store.update('theme', () => 'dark');
    await chmod(dir, 0o500);
    await expect(store.update('theme', () => 'light')).rejects.toThrow();
    expect(store.read().theme).toBe('dark');
    await chmod(dir, 0o700);
    await store.update('theme', () => 'light');
    expect((await stateOnDisk())['theme']).toBe('light');
  });
});
