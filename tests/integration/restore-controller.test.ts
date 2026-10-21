// restore-controller.test.ts
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentController, type ControllerDeps } from '../../src/main/agent-controller';
import { loadState } from '../../src/main/state-file';
import type { AppState } from '../../src/shared/agents';
import type { Rollout } from '../../src/shared/codex-claim';
import { EVENT_CHANNELS, type PtyDataEvent } from '../../src/shared/ipc';

const STUB = path.resolve(__dirname, '..', 'fixtures', 'stub-cli.mjs');
const SESSION = '0199a1b2-c3d4-7e5f-8a6b-9c2d3e4f5a6b';
const CODEX_ID = '0199a1b2-c3d4-7e5f-8a6b-1c2d3e4f5a6b';

let dir: string;
let events: { channel: string; payload: unknown }[];
let rollouts: Rollout[];
let controllers: AgentController[];

function build(initial: AppState): AgentController {
  const deps: ControllerDeps = {
    stateFile: path.join(dir, 'agents.json'),
    sharedDir: path.join(dir, 'shared'),
    platform: 'win32',
    env: { PATH: process.env.PATH, AIAW_CLAUDE_BIN: STUB, AIAW_CODEX_BIN: STUB },
    pickFolder: async () => dir,
    emit: (channel, payload) => events.push({ channel, payload }),
    listRollouts: async () => rollouts,
  };
  const controller = new AgentController(deps, initial);
  controllers.push(controller);
  return controller;
}

function output(id: string): string {
  return events
    .filter((event) => event.channel === EVENT_CHANNELS.ptyData)
    .map((event) => event.payload as PtyDataEvent)
    .filter((payload) => payload.id === id)
    .map((payload) => payload.data)
    .join('');
}

function rolloutFor(cwd: string, createdAtMs: number): Rollout {
  return {
    fileName: `rollout-2026-10-21T10-00-00-${CODEX_ID}.jsonl`,
    firstLine: JSON.stringify({ type: 'session_meta', payload: { id: CODEX_ID, cwd } }),
    createdAtMs,
  };
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'aiaw-restore-'));
  events = [];
  rollouts = [];
  controllers = [];
});

afterEach(async () => {
  for (const controller of controllers) controller.shutdown();
  await rm(dir, { recursive: true, force: true });
});

describe('restore at start', () => {
  it('resumes a claude agent from the state file with its session id', async () => {
    const first = build({ version: 1, agents: [] });
    await first.add('claude');
    const saved = await loadState(path.join(dir, 'agents.json'));
    const agent = saved.agents[0];
    first.shutdown();
    events = [];
    const second = build(saved);
    await second.restore();
    await expect.poll(() => output(agent?.id ?? '')).toContain('STUB-CLI BANNER');
    expect(output(agent?.id ?? '')).toContain('--resume');
    expect(output(agent?.id ?? '')).toContain(agent?.sessionId ?? 'missing');
    expect(second.snapshot().agents).toEqual(saved.agents);
  });

  it('claims the codex rollout when the list is saved and resumes it after a restart', async () => {
    const first = build({ version: 1, agents: [] });
    await first.add('codex');
    expect((await loadState(path.join(dir, 'agents.json'))).agents[0]?.sessionId).toBeUndefined();
    rollouts = [rolloutFor(dir, Date.now() + 1000)];
    await first.flush();
    const saved = await loadState(path.join(dir, 'agents.json'));
    expect(saved.agents[0]?.sessionId).toBe(CODEX_ID);
    first.shutdown();
    events = [];
    const second = build(saved);
    await second.restore();
    const id = saved.agents[0]?.id ?? '';
    await expect.poll(() => output(id)).toContain('STUB-CLI BANNER');
    expect(output(id)).toContain('resume');
    expect(output(id)).toContain(CODEX_ID);
  });

  it('claims before restoring and persists the claim', async () => {
    const created = Date.now() - 60_000;
    const initial: AppState = {
      version: 1,
      agents: [{ id: 'codex-1', kind: 'codex', title: 'Codex', cwd: dir, createdAt: created }],
    };
    rollouts = [rolloutFor(dir, created + 5000)];
    const controller = build(initial);
    await controller.restore();
    expect(controller.agentById('codex-1')?.sessionId).toBe(CODEX_ID);
    expect((await loadState(path.join(dir, 'agents.json'))).agents[0]?.sessionId).toBe(CODEX_ID);
    await expect.poll(() => output('codex-1')).toContain(CODEX_ID);
  });

  it('restores an unclaimed codex agent as a fresh codex and a site agent without a pty', async () => {
    const initial: AppState = {
      version: 1,
      agents: [
        { id: 'codex-1', kind: 'codex', title: 'Codex', cwd: dir, createdAt: 1000 },
        { id: 'site-1', kind: 'grok', title: 'Grok', createdAt: 1000 },
      ],
    };
    const controller = build(initial);
    await controller.restore();
    await expect.poll(() => output('codex-1')).toContain('STUB-CLI BANNER');
    expect(output('codex-1')).not.toContain('resume');
    expect(output('site-1')).toBe('');
    expect(controller.snapshot().agents).toHaveLength(2);
  });

  it('keeps an agent whose folder is gone listed and restores the others', async () => {
    const initial: AppState = {
      version: 1,
      agents: [
        { id: 'gone', kind: 'claude', title: 'Claude', cwd: path.join(dir, 'missing'), sessionId: SESSION, createdAt: 1000 },
        { id: 'fine', kind: 'claude', title: 'Claude', cwd: dir, sessionId: CODEX_ID, createdAt: 1000 },
      ],
    };
    const controller = build(initial);
    await controller.restore();
    await expect.poll(() => output('fine')).toContain('STUB-CLI BANNER');
    expect(controller.snapshot().agents.map((agent) => agent.id)).toEqual(['gone', 'fine']);
  });
});
