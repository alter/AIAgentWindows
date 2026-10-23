// state-v2-controller.test.ts
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentController } from '../../src/main/agent-controller';
import { StateRefusedError } from '../../src/main/store/app-state';
import { openStore } from '../unit/helpers/app-state';

const CHATGPT = '8182ddf2-1111-4111-8111-aaaaaaaaaaaa';
const GROK = '5dff1f45-2222-4222-8222-bbbbbbbbbbbb';

let dir: string;
let controllers: AgentController[];
const pickFolder = vi.fn<() => Promise<string | null>>();

async function build(folder: string): Promise<AgentController> {
  const controller = new AgentController({
    store: await openStore(folder),
    sharedDir: path.join(folder, 'shared'),
    platform: 'darwin',
    env: {},
    pickFolder,
    emit: () => undefined,
  });
  controllers.push(controller);
  return controller;
}

async function stateOnDisk(folder: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(folder, 'state.json'), 'utf8')) as Record<string, unknown>;
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'aiaw-state-v2-'));
  controllers = [];
  pickFolder.mockReset();
  pickFolder.mockResolvedValue(dir);
});

afterEach(async () => {
  for (const controller of controllers) controller.shutdown();
  await rm(dir, { recursive: true, force: true });
});

describe('controller on a migrated state', () => {
  const legacy = JSON.stringify({
    version: 1,
    agents: [
      { id: CHATGPT, kind: 'chatgpt', title: 'ChatGPT', createdAt: 1 },
      { id: GROK, kind: 'grok', title: 'Grok', createdAt: 2 },
    ],
    theme: 'dark',
    sidebarWidth: 330,
    openrouterKey: 'AQIDBA==',
  });
  const partitions = { chatgpt: `persist:${CHATGPT}`, grok: `persist:${GROK}`, deepseek: 'persist:deepseek' };

  it('starts with no agents, the settings and the key of the old file, and an agent rename, a theme change and a key write keep the partition map', async () => {
    await writeFile(path.join(dir, 'agents.json'), legacy, 'utf8');
    const controller = await build(dir);
    expect(controller.snapshot().agents).toEqual([]);
    expect([controller.theme(), controller.sidebarWidth(), controller.openrouterCipher()]).toEqual(['dark', 330, 'AQIDBA==']);
    expect(await controller.add('grok')).toEqual({ ok: true });
    const id = controller.snapshot().agents[0]?.id ?? '';
    expect(await controller.rename(id, 'Research')).toBe(true);
    await controller.setTheme('light');
    await controller.setSidebarWidth(280);
    await controller.setOpenrouterCipher('BAUGBw==');
    expect(await stateOnDisk(dir)).toMatchObject({
      version: 2,
      theme: 'light',
      sidebarWidth: 280,
      openrouterKey: 'BAUGBw==',
      agents: [{ id, kind: 'grok', title: 'Research' }],
      partitions,
    });
    await controller.setOpenrouterCipher(null);
    expect('openrouterKey' in (await stateOnDisk(dir))).toBe(false);
    expect((await stateOnDisk(dir))['partitions']).toEqual(partitions);
    await controller.close(id);
    expect((await stateOnDisk(dir))['partitions']).toEqual(partitions);
  });

  it('never writes agents.json', async () => {
    await writeFile(path.join(dir, 'agents.json'), legacy, 'utf8');
    const controller = await build(dir);
    await controller.add('deepseek');
    await controller.setTheme('system');
    await controller.flush();
    expect(await readFile(path.join(dir, 'agents.json'), 'utf8')).toBe(legacy);
  });
});

describe('controller while the state file is fail-closed', () => {
  const truncated = '{"version":2,"agents":[{"id":"';

  async function blocked(): Promise<{ controller: AgentController; folder: string }> {
    const folder = path.join(dir, 'blocked');
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, 'state.json'), truncated, 'utf8');
    return { controller: await build(folder), folder };
  }

  it('refuses to add an agent of any kind with the error and the file path, asks for no folder and writes nothing', async () => {
    const { controller, folder } = await blocked();
    for (const kind of ['grok', 'claude', 'codex', 'openrouter'] as const) {
      const result = await controller.add(kind);
      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.error).toContain(path.join(folder, 'state.json'));
    }
    expect(pickFolder).not.toHaveBeenCalled();
    expect(controller.snapshot().agents).toEqual([]);
    expect(await readFile(path.join(folder, 'state.json'), 'utf8')).toBe(truncated);
    expect(await readdir(folder)).toEqual(['state.json']);
  });

  it('refuses to change the key, keeps the old value in memory and writes nothing', async () => {
    const { controller, folder } = await blocked();
    await expect(controller.setOpenrouterCipher('AQIDBA==')).rejects.toBeInstanceOf(StateRefusedError);
    expect(controller.openrouterCipher()).toBeNull();
    await controller.setOpenrouterCipher(null);
    expect(await readFile(path.join(folder, 'state.json'), 'utf8')).toBe(truncated);
  });

  it('lets the theme, the sidebar width and a restart go on for this run without touching the file', async () => {
    const { controller, folder } = await blocked();
    await controller.setTheme('dark');
    await controller.setSidebarWidth(300);
    await controller.flush();
    await controller.restore();
    expect([controller.theme(), controller.sidebarWidth()]).toEqual(['dark', 300]);
    expect(await readFile(path.join(folder, 'state.json'), 'utf8')).toBe(truncated);
  });
});
