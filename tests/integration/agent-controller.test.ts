// agent-controller.test.ts
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { AgentController, type ControllerDeps } from '../../src/main/agent-controller';
import { loadState } from '../../src/main/state-file';
import { emptyState } from '../../src/shared/agents';
import { EVENT_CHANNELS, type AgentsSnapshot, type PtyDataEvent } from '../../src/shared/ipc';

const STUB = path.resolve(__dirname, '..', 'fixtures', 'stub-cli.mjs');

let dir: string;
let folder: string | null;
let events: { channel: string; payload: unknown }[];
let controller: AgentController;
let siteNav: Mock<NonNullable<ControllerDeps['siteNav']>>;

function build(): AgentController {
  const deps: ControllerDeps = {
    stateFile: path.join(dir, 'agents.json'),
    sharedDir: path.join(dir, 'shared'),
    platform: 'win32',
    env: { PATH: process.env.PATH, AIAW_CLAUDE_BIN: STUB, AIAW_CODEX_BIN: STUB },
    pickFolder: async () => folder,
    emit: (channel, payload) => events.push({ channel, payload }),
    siteNav,
  };
  return new AgentController(deps, emptyState());
}

async function waitForBanner(id: string): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const text = events
      .filter((event) => event.channel === EVENT_CHANNELS.ptyData)
      .map((event) => event.payload as PtyDataEvent)
      .filter((payload) => payload.id === id)
      .map((payload) => payload.data)
      .join('');
    if (text.includes('STUB-CLI BANNER')) return text;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('no banner');
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'aiaw-controller-'));
  folder = dir;
  events = [];
  siteNav = vi.fn<NonNullable<ControllerDeps['siteNav']>>();
  controller = build();
});

afterEach(async () => {
  controller.shutdown();
  await rm(dir, { recursive: true, force: true });
});

describe('agent controller', () => {
  it('adds a claude agent that runs in a pty with a fresh session id and persists it', async () => {
    await controller.add('claude');
    const snapshot = controller.snapshot();
    const agent = snapshot.agents[0];
    expect(agent?.kind).toBe('claude');
    expect(agent?.cwd).toBe(dir);
    expect(agent?.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(snapshot.selectedId).toBe(agent?.id);
    const banner = await waitForBanner(agent?.id ?? '');
    expect(banner).toContain('--session-id');
    expect(banner).toContain('--add-dir');
    expect((await loadState(path.join(dir, 'agents.json'))).agents).toEqual(snapshot.agents);
    const changed = events.filter((event) => event.channel === EVENT_CHANNELS.agentsChanged);
    expect((changed.at(-1)?.payload as AgentsSnapshot).selectedId).toBe(agent?.id);
  });

  it('adds a codex agent without a session id', async () => {
    await controller.add('codex');
    const agent = controller.snapshot().agents[0];
    expect(agent?.kind).toBe('codex');
    expect(agent?.sessionId).toBeUndefined();
  });

  it('adds nothing when the folder dialog is cancelled', async () => {
    folder = null;
    await controller.add('claude');
    expect(controller.snapshot().agents).toEqual([]);
    expect(events).toEqual([]);
  });

  it('adds a site agent without a pty and selects agents by id', async () => {
    await controller.add('grok');
    await controller.add('deepseek');
    const [first, second] = controller.snapshot().agents;
    expect(first?.cwd).toBeUndefined();
    expect(controller.selectedAgent()?.id).toBe(second?.id);
    await controller.select(first?.id ?? '');
    expect(controller.selectedAgent()?.id).toBe(first?.id);
    await controller.select('missing');
    expect(controller.selectedAgent()?.id).toBe(first?.id);
    expect(controller.agentById('missing')).toBeUndefined();
  });

  it('passes pty input through untouched and forwards site navigation', async () => {
    await controller.add('claude');
    const id = controller.snapshot().agents[0]?.id ?? '';
    await waitForBanner(id);
    controller.ptyResize(id, 100, 30);
    controller.ptyWrite(id, 'hi');
    await vi.waitFor(() => {
      const text = events
        .filter((event) => event.channel === EVENT_CHANNELS.ptyData)
        .map((event) => (event.payload as PtyDataEvent).data)
        .join('');
      expect(text).toContain('hi');
      expect(text).not.toContain('SUBMITTED');
    });
    controller.siteNav(id, 'back');
    expect(siteNav).toHaveBeenCalledWith(id, 'back');
  });
});
