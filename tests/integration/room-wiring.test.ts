// room-wiring.test.ts
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentController, type ControllerDeps } from '../../src/main/agent-controller';
import type { DriverFactory, ParticipantDriver } from '../../src/main/room';
import { RoomService } from '../../src/main/room-service';
import { emptyState } from '../../src/shared/agents';
import { EVENT_CHANNELS } from '../../src/shared/ipc';
import type { RoomConfig, RoomEvent, RoomParticipant } from '../../src/shared/room-model';

const STUB = path.resolve(__dirname, '..', 'fixtures', 'stub-cli.mjs');
const CLAUDE: RoomParticipant = { id: 'claude', kind: 'claude', label: 'Claude Code' };
const CODEX: RoomParticipant = { id: 'codex', kind: 'codex', label: 'Codex' };

let dir: string;
let events: { channel: string; payload: unknown }[];
let controller: AgentController;
let showSite: ReturnType<typeof vi.fn<NonNullable<ControllerDeps['showSite']>>>;
const services: RoomService[] = [];

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'aiaw-room-wiring-'));
  events = [];
  showSite = vi.fn<NonNullable<ControllerDeps['showSite']>>();
  const configDir = path.join(dir, 'claude-config');
  const deps: ControllerDeps = {
    stateFile: path.join(dir, 'agents.json'),
    sharedDir: path.join(dir, 'shared'),
    platform: 'win32',
    env: { PATH: process.env.PATH, AIAW_CLAUDE_BIN: STUB, AIAW_CODEX_BIN: STUB, AIAW_STUB_TRANSCRIPT: 'claude', CLAUDE_CONFIG_DIR: configDir },
    pickFolder: async () => dir,
    emit: (channel, payload) => events.push({ channel, payload }),
    showSite,
  };
  controller = new AgentController(deps, emptyState());
});

afterEach(async () => {
  controller.shutdown();
  await Promise.all(services.splice(0).map((service) => service.shutdown()));
  await rm(dir, { recursive: true, force: true });
});

function output(id: string): string {
  return controller.ptyBacklog(id).data;
}

describe('room selection in the controller', () => {
  it('opening the room hides site views and is reported in the snapshot', async () => {
    await controller.add('grok');
    const site = controller.snapshot().agents[0];
    showSite.mockClear();
    events.length = 0;
    controller.selectRoom();
    expect(controller.snapshot().roomOpen).toBe(true);
    expect(showSite).toHaveBeenLastCalledWith(null);
    expect(events.some((event) => event.channel === EVENT_CHANNELS.agentsChanged)).toBe(true);
    await controller.select(site?.id ?? '');
    expect(controller.snapshot().roomOpen).toBe(false);
    expect(showSite).toHaveBeenLastCalledWith(site);
  });

  it('adding an agent leaves the room, closing another agent does not', async () => {
    await controller.add('grok');
    await controller.add('deepseek');
    const [first] = controller.snapshot().agents;
    controller.selectRoom();
    await controller.close(first?.id ?? '');
    expect(controller.snapshot().roomOpen).toBe(true);
    await controller.add('chatgpt');
    expect(controller.snapshot().roomOpen).toBe(false);
  });
});

describe('carry into a working session', () => {
  it('pastes the text into a CLI session without submitting it', async () => {
    await controller.add('claude');
    const id = controller.snapshot().agents[0]?.id ?? '';
    await vi.waitFor(() => expect(output(id)).toContain('STUB-CLI BANNER'));
    expect(controller.paste(id, 'carried <b>text</b>\nsecond line')).toBe(true);
    await vi.waitFor(() => expect(output(id)).toContain('second line'));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(output(id)).not.toContain('SUBMITTED:');
    controller.ptyWrite(id, '\r');
    await vi.waitFor(() => expect(output(id)).toContain('SUBMITTED:'));
  });

  it('refuses a site agent, an unknown id and an exited session', async () => {
    await controller.add('grok');
    expect(controller.paste(controller.snapshot().agents[0]?.id ?? '', 'x')).toBe(false);
    expect(controller.paste('missing', 'x')).toBe(false);
    await controller.add('claude');
    const id = controller.snapshot().agents[1]?.id ?? '';
    await vi.waitFor(() => expect(output(id)).toContain('STUB-CLI BANNER'));
    controller.ptyWrite(id, '/exit\r');
    await vi.waitFor(() =>
      expect(events.some((event) => event.channel === EVENT_CHANNELS.ptyExit && (event.payload as { id: string }).id === id)).toBe(true),
    );
    expect(controller.paste(id, 'x')).toBe(false);
  });
});

function service(driverFor: DriverFactory, pasted: Array<[string, string]> = []): { room: RoomService; seen: RoomEvent[] } {
  const seen: RoomEvent[] = [];
  const room = new RoomService({
    roomsDir: path.join(dir, 'rooms'),
    driverFor,
    emit: (event) => seen.push(event),
    paste: (id, text) => {
      pasted.push([id, text]);
      return id !== 'gone';
    },
  });
  services.push(room);
  return { room, seen };
}

function echoDriver(): DriverFactory {
  return async (participant): Promise<ParticipantDriver> => ({
    turn: async () => `reply of ${participant.label}`,
    reset: async () => undefined,
    dispose: () => undefined,
  });
}

function config(overrides: Partial<RoomConfig> = {}): RoomConfig {
  return { prompt: 'the question', mode: 'relay', rounds: 1, participants: [CLAUDE, CODEX], turnTimeoutMs: 5000, ...overrides };
}

async function finished(seen: RoomEvent[]): Promise<void> {
  await vi.waitFor(() => expect(seen.some((event) => event.type === 'finished')).toBe(true));
}

describe('room service', () => {
  it('runs a relay, mirrors the events into its snapshot and writes the history file', async () => {
    const { room, seen } = service(echoDriver());
    expect(room.state().phase).toBe('idle');
    const started = room.start(config());
    expect(started.ok).toBe(true);
    await finished(seen);
    const state = room.state();
    expect(state.phase).toBe('done');
    expect(state.entries.map((entry) => entry.label)).toEqual(['Owner', 'Claude Code', 'Codex']);
    const history = await readFile(state.historyPath ?? '', 'utf8');
    expect(history.indexOf('reply of Claude Code')).toBeLessThan(history.indexOf('reply of Codex'));
  });

  it('refuses a second start while running and stops the run on request', async () => {
    const hang: DriverFactory = async () => ({
      turn: (request) => new Promise((resolve) => request.signal.addEventListener('abort', () => resolve(null))),
      reset: async () => undefined,
      dispose: () => undefined,
    });
    const { room, seen } = service(hang);
    expect(room.start(config()).ok).toBe(true);
    expect(room.start(config())).toEqual({ ok: false, error: 'a room run is already in progress' });
    room.stop();
    await finished(seen);
    expect(room.state().phase).toBe('stopped');
  });

  it('carries the final reply or the history into a session by id, never while running', async () => {
    const pasted: Array<[string, string]> = [];
    const gate: { release: () => void } = { release: () => undefined };
    const slow: DriverFactory = async (participant) => ({
      turn: () => new Promise((resolve) => (gate.release = () => resolve(`reply of ${participant.label}`))),
      reset: async () => undefined,
      dispose: () => undefined,
    });
    const { room, seen } = service(slow, pasted);
    room.start(config({ participants: [CLAUDE] }));
    expect(room.carry('s1', 'final')).toBe(false);
    await vi.waitFor(() => expect(seen.some((event) => event.type === 'progress')).toBe(true));
    gate.release();
    await finished(seen);
    expect(room.carry('s1', 'final')).toBe(true);
    expect(room.carry('s1', 'history')).toBe(true);
    expect(room.carry('gone', 'final')).toBe(false);
    expect(pasted[0]).toEqual(['s1', 'reply of Claude Code']);
    expect(pasted[1]?.[1]).toContain('# Room');
  });

  it('carry is false when there is nothing to carry', () => {
    const pasted: Array<[string, string]> = [];
    const { room } = service(echoDriver(), pasted);
    expect(room.carry('s1', 'final')).toBe(false);
    expect(pasted).toEqual([]);
  });
});
