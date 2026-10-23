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
let showSite: Mock<NonNullable<ControllerDeps['showSite']>>;
let closeSite: Mock<NonNullable<ControllerDeps['closeSite']>>;
let layoutSidebar: Mock<NonNullable<ControllerDeps['layoutSidebar']>>;

function controllerDeps(): ControllerDeps {
  return {
    stateFile: path.join(dir, 'agents.json'),
    sharedDir: path.join(dir, 'shared'),
    platform: 'win32',
    env: { PATH: process.env.PATH, AIAW_CLAUDE_BIN: STUB, AIAW_CODEX_BIN: STUB },
    pickFolder: async () => folder,
    emit: (channel, payload) => events.push({ channel, payload }),
    siteNav,
    showSite,
    closeSite,
    layoutSidebar,
  };
}

function build(): AgentController {
  return new AgentController(controllerDeps(), emptyState());
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
  showSite = vi.fn<NonNullable<ControllerDeps['showSite']>>();
  closeSite = vi.fn<NonNullable<ControllerDeps['closeSite']>>();
  layoutSidebar = vi.fn<NonNullable<ControllerDeps['layoutSidebar']>>();
  controller = build();
});

afterEach(async () => {
  controller.shutdown();
  await rm(dir, { recursive: true, force: true });
});

describe('agent controller', () => {
  it('keeps the sidebar width, lays the site views out from it and stores it beside the agents', async () => {
    expect(controller.sidebarWidth()).toBe(260);
    await controller.setSidebarWidth(340);
    expect(controller.sidebarWidth()).toBe(340);
    expect(layoutSidebar).toHaveBeenCalledWith(340);
    expect((await loadState(path.join(dir, 'agents.json'))).sidebarWidth).toBe(340);
  });

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

  it('keeps the output of a pane-less agent as a backlog with a running end offset', async () => {
    await controller.add('claude');
    const id = controller.snapshot().agents[0]?.id ?? '';
    await waitForBanner(id);
    const backlog = controller.ptyBacklog(id);
    expect(backlog.data).toContain('STUB-CLI BANNER');
    const lastEvent = events
      .filter((event) => event.channel === EVENT_CHANNELS.ptyData)
      .map((event) => event.payload as PtyDataEvent)
      .filter((payload) => payload.id === id)
      .at(-1);
    expect(lastEvent?.end).toBe(backlog.end);
    expect(controller.ptyBacklog('missing')).toEqual({ data: '', end: 0 });
  });

  it('tells the site host which site agent is selected, or none for a CLI agent', async () => {
    await controller.add('grok');
    const site = controller.snapshot().agents[0];
    expect(showSite).toHaveBeenLastCalledWith(site);
    await controller.add('claude');
    expect(showSite).toHaveBeenLastCalledWith(null);
    await controller.select(site?.id ?? '');
    expect(showSite).toHaveBeenLastCalledWith(site);
    showSite.mockClear();
    controller.syncSelection();
    expect(showSite).toHaveBeenCalledWith(site);
  });

  it('shows the refusal in the pane and spawns nothing when test mode has no binary override', async () => {
    const guarded = new AgentController(
      {
        stateFile: path.join(dir, 'guarded.json'),
        sharedDir: path.join(dir, 'shared'),
        platform: 'win32',
        env: { PATH: process.env.PATH, AIAW_USER_DATA: dir },
        pickFolder: async () => folder,
        emit: (channel, payload) => events.push({ channel, payload }),
      },
      emptyState(),
    );
    try {
      await guarded.add('codex');
      const agent = guarded.snapshot().agents[0];
      expect(agent?.kind).toBe('codex');
      expect(guarded.ptyBacklog(agent?.id ?? '').data).toContain('AIAW_CODEX_BIN');
      expect(events.some((event) => event.channel === EVENT_CHANNELS.ptyExit && (event.payload as { id?: string }).id === agent?.id)).toBe(false);
    } finally {
      guarded.shutdown();
    }
  });

  it('renames an agent, stores the title beside the agents and refuses a bad id or title', async () => {
    await controller.add('grok');
    await controller.add('deepseek');
    const [grok, deepseek] = controller.snapshot().agents;
    expect(await controller.rename(grok?.id ?? '', '  Research  ')).toBe(true);
    expect(controller.snapshot().agents.map((agent) => agent.title)).toEqual(['Research', 'DeepSeek']);
    expect(controller.snapshot().selectedId).toBe(deepseek?.id);
    expect((await loadState(path.join(dir, 'agents.json'))).agents.map((agent) => agent.title)).toEqual(['Research', 'DeepSeek']);
    const changed = events.filter((event) => event.channel === EVENT_CHANNELS.agentsChanged);
    expect((changed.at(-1)?.payload as AgentsSnapshot).agents[0]?.title).toBe('Research');
    const before = events.length;
    for (const [id, title] of [['missing', 'x'], [grok?.id ?? '', ''], [grok?.id ?? '', 'x'.repeat(81)], [grok?.id ?? '', 'a\nb']] as const) {
      expect(await controller.rename(id, title)).toBe(false);
    }
    expect(events.length).toBe(before);
    expect(controller.snapshot().agents[0]?.title).toBe('Research');
    const reopened = new AgentController({ ...controllerDeps(), stateFile: path.join(dir, 'agents.json') }, await loadState(path.join(dir, 'agents.json')));
    expect(reopened.snapshot().agents.map((agent) => agent.title)).toEqual(['Research', 'DeepSeek']);
    reopened.shutdown();
  });

  it('closes an agent: kills its pty, drops it from the state file and the snapshot, keeps the others', async () => {
    await controller.add('claude');
    await controller.add('grok');
    await controller.add('codex');
    const [claude, grok, codex] = controller.snapshot().agents;
    await waitForBanner(claude?.id ?? '');
    await controller.close(claude?.id ?? '');
    const snapshot = controller.snapshot();
    expect(snapshot.agents.map((agent) => agent.id)).toEqual([grok?.id, codex?.id]);
    expect(snapshot.selectedId).toBe(codex?.id);
    expect(controller.ptyBacklog(claude?.id ?? '')).toEqual({ data: '', end: 0 });
    expect((await loadState(path.join(dir, 'agents.json'))).agents.map((agent) => agent.id)).toEqual([grok?.id, codex?.id]);
    await controller.close(grok?.id ?? '');
    expect(closeSite).toHaveBeenCalledWith(grok?.id);
    await controller.close('missing');
    expect(controller.snapshot().agents).toHaveLength(1);
    const changed = events.filter((event) => event.channel === EVENT_CHANNELS.agentsChanged);
    expect((changed.at(-1)?.payload as AgentsSnapshot).agents).toHaveLength(1);
  });

  it('stays closed after a relaunch and stops the process', async () => {
    await controller.add('claude');
    const id = controller.snapshot().agents[0]?.id ?? '';
    await waitForBanner(id);
    await controller.close(id);
    const after = events.length;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(events.slice(after).some((event) => event.channel === EVENT_CHANNELS.ptyData)).toBe(false);
    const reopened = build();
    const state = await loadState(path.join(dir, 'agents.json'));
    expect(state.agents).toEqual([]);
    expect(reopened.snapshot().agents).toEqual([]);
  });

  it('restarts an exited CLI agent with the same restore argv and refuses while it runs', async () => {
    await controller.add('claude');
    const agent = controller.snapshot().agents[0];
    const id = agent?.id ?? '';
    await waitForBanner(id);
    expect(await controller.restart(id)).toBe(false);
    controller.ptyWrite(id, '/exit\r');
    await vi.waitFor(() => expect(events.some((event) => event.channel === EVENT_CHANNELS.ptyExit)).toBe(true));
    events.length = 0;
    expect(await controller.restart(id)).toBe(true);
    const banner = await waitForBanner(id);
    expect(banner).toContain(agent?.sessionId ?? 'no-session');
    expect(await controller.restart(id)).toBe(false);
    expect(await controller.restart('missing')).toBe(false);
  });

  it('does not restart a site agent', async () => {
    await controller.add('grok');
    expect(await controller.restart(controller.snapshot().agents[0]?.id ?? '')).toBe(false);
  });
});
