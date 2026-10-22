// room-wiring.test.ts
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentController, type ControllerDeps } from '../../src/main/agent-controller';
import { OwnerPause, type DriverFactory, type ParticipantDriver } from '../../src/main/room';
import type { RoomTerminals } from '../../src/main/room-drivers';
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

function service(driverFor: DriverFactory, pasted: Array<[string, string]> = [], terminal: RoomTerminals = noTerminal(), debugRoot?: string): { room: RoomService; seen: RoomEvent[] } {
  const seen: RoomEvent[] = [];
  const room = new RoomService({
    roomsDir: path.join(dir, 'rooms'),
    debugRoot,
    driverFor,
    terminal,
    emit: (event) => seen.push(event),
    paste: (id, text) => {
      pasted.push([id, text]);
      return id !== 'gone';
    },
  });
  services.push(room);
  return { room, seen };
}

function noTerminal(): RoomTerminals {
  return { backlog: () => ({ data: 'screen', end: 6 }), write: () => true, resize: () => true };
}

function pausingDriver(): DriverFactory {
  return async (participant): Promise<ParticipantDriver> => {
    let calls = 0;
    return {
      turn: async () => {
        calls += 1;
        if (calls === 1) throw new OwnerPause(`room-${participant.id}-1`, 'accept the folder, then Resume');
        return `reply of ${participant.label}`;
      },
      reset: async () => undefined,
      dispose: () => undefined,
    };
  };
}

function echoDriver(): DriverFactory {
  return async (participant): Promise<ParticipantDriver> => ({
    turn: async () => `reply of ${participant.label}`,
    reset: async () => undefined,
    dispose: () => undefined,
  });
}

function config(overrides: Partial<RoomConfig> = {}): RoomConfig {
  return { prompt: 'the question', mode: 'relay', rounds: 1, participants: [CLAUDE, CODEX], turnTimeoutMs: 5000, finalizerId: CLAUDE.id, debugSites: false, ...overrides };
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
    expect(state.entries.map((entry) => entry.label)).toEqual(['Owner', 'Claude Code', 'Codex', 'Claude Code']);
    const history = await readFile(state.historyPath ?? '', 'utf8');
    expect(history.indexOf('reply of Claude Code')).toBeLessThan(history.indexOf('reply of Codex'));
  });

  it('names the debug directory of the run only when the switch is on and a debug root is configured, and hands the switch to every turn', async () => {
    const debugRoot = path.join(dir, 'debug', 'sites');
    const switches: boolean[] = [];
    const watching: DriverFactory = async () => ({
      turn: async (request) => {
        switches.push(request.debugSites);
        return 'reply';
      },
      reset: async () => undefined,
      dispose: () => undefined,
    });
    const on = service(watching, [], noTerminal(), debugRoot);
    const started = on.room.start(config({ participants: [CLAUDE], debugSites: true }));
    await finished(on.seen);
    expect(started.ok && started.debugDir).toBe(path.join(debugRoot, started.ok ? started.roomId : ''));
    expect(new Set(switches)).toEqual(new Set([true]));
    switches.length = 0;
    const off = service(watching, [], noTerminal(), debugRoot);
    const quiet = off.room.start(config({ participants: [CLAUDE] }));
    await finished(off.seen);
    expect(quiet.ok && quiet.debugDir).toBeNull();
    expect(new Set(switches)).toEqual(new Set([false]));
    const bare = service(watching);
    const nowhere = bare.room.start(config({ participants: [CLAUDE], debugSites: true }));
    await finished(bare.seen);
    expect(nowhere.ok && nowhere.debugDir).toBeNull();
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
    let turns = 0;
    const slow: DriverFactory = async (participant) => ({
      turn: () => {
        turns += 1;
        if (turns > 1) return Promise.resolve(`final of ${participant.label}`);
        return new Promise((resolve) => (gate.release = () => resolve(`reply of ${participant.label}`)));
      },
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
    expect(pasted[0]).toEqual(['s1', 'final of Claude Code']);
    expect(pasted[1]?.[1]).toContain('# Room');
  });

  it('carry is false when there is nothing to carry', () => {
    const pasted: Array<[string, string]> = [];
    const { room } = service(echoDriver(), pasted);
    expect(room.carry('s1', 'final')).toBe(false);
    expect(pasted).toEqual([]);
  });
});

describe('room service terminal of a paused session', () => {
  it('lets the renderer see and type into a paused session only, and Resume lets the run finish', async () => {
    const writes: Array<[string, string]> = [];
    const sizes: Array<[string, number, number]> = [];
    const terminal: RoomTerminals = {
      backlog: () => ({ data: 'dialog', end: 6 }),
      write: (id, data) => {
        writes.push([id, data]);
        return true;
      },
      resize: (id, cols, rows) => {
        sizes.push([id, cols, rows]);
        return true;
      },
    };
    const { room, seen } = service(pausingDriver(), [], terminal);
    expect(room.terminalWrite('room-claude-1', 'x')).toBe(false);
    expect(room.terminalBacklog('room-claude-1')).toEqual({ data: '', end: 0 });
    room.start(config({ participants: [CLAUDE] }));
    await vi.waitFor(() => expect(room.state().paused.map((item) => item.sessionId)).toEqual(['room-claude-1']));
    expect(room.terminalBacklog('room-claude-1')).toEqual({ data: 'dialog', end: 6 });
    expect(room.terminalWrite('room-claude-1', '\r')).toBe(true);
    expect(room.terminalResize('room-claude-1', 100, 30)).toBe(true);
    expect(room.terminalWrite('room-other-1', 'x')).toBe(false);
    expect(room.terminalResize('room-other-1', 10, 10)).toBe(false);
    expect(writes).toEqual([['room-claude-1', '\r']]);
    expect(sizes).toEqual([['room-claude-1', 100, 30]]);
    room.resume();
    await finished(seen);
    expect(room.state().paused).toEqual([]);
    expect(room.state().entries.map((entry) => entry.kind)).toEqual(['prompt', 'reply', 'final']);
    expect(room.terminalWrite('room-claude-1', 'x')).toBe(false);
  });
});
