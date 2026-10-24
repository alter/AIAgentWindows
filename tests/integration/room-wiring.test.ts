// room-wiring.test.ts
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentController, type ControllerDeps } from '../../src/main/agent-controller';
import { OwnerPause, type DriverFactory, type ParticipantDriver } from '../../src/main/room';
import type { RoomTerminals } from '../../src/main/room-drivers';
import { listRecords, readRecord, writeRecord } from '../../src/main/room-archive';
import { RoomService } from '../../src/main/room-service';
import { openStore } from '../unit/helpers/app-state';
import type { RoomModels } from '../../src/shared/cli-models';
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
    store: await openStore(dir),
    sharedDir: path.join(dir, 'shared'),
    platform: 'win32',
    env: { PATH: process.env.PATH, AIAW_CLAUDE_BIN: STUB, AIAW_CODEX_BIN: STUB, AIAW_STUB_TRANSCRIPT: 'claude', CLAUDE_CONFIG_DIR: configDir },
    pickFolder: async () => dir,
    emit: (channel, payload) => events.push({ channel, payload }),
    showSite,
  };
  controller = new AgentController(deps);
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

const copied: string[] = [];
const SUGGESTIONS: RoomModels = { claude: { models: ['opus'], efforts: ['high'] }, codex: { models: [{ id: 'gpt-a', efforts: ['low'] }] } };

function service(driverFor: DriverFactory, pasted: Array<[string, string]> = [], terminal: RoomTerminals = noTerminal(), debugRoot?: string): { room: RoomService; seen: RoomEvent[] } {
  const seen: RoomEvent[] = [];
  const room = new RoomService({
    roomsDir: path.join(dir, 'rooms'),
    userData: dir,
    debugRoot,
    trash: async () => undefined,
    driverFor,
    terminal,
    emit: (event) => seen.push(event),
    paste: (id, text) => {
      pasted.push([id, text]);
      return id !== 'gone';
    },
    copy: (text) => copied.push(text),
    models: async () => SUGGESTIONS,
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
    const started = await room.start(config());
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
    const started = await on.room.start(config({ participants: [CLAUDE], debugSites: true }));
    await finished(on.seen);
    expect(started.ok && started.debugDir).toBe(path.join(debugRoot, started.ok ? started.roomId : ''));
    expect(new Set(switches)).toEqual(new Set([true]));
    switches.length = 0;
    const off = service(watching, [], noTerminal(), debugRoot);
    const quiet = await off.room.start(config({ participants: [CLAUDE] }));
    await finished(off.seen);
    expect(quiet.ok && quiet.debugDir).toBeNull();
    expect(new Set(switches)).toEqual(new Set([false]));
    const bare = service(watching);
    const nowhere = await bare.room.start(config({ participants: [CLAUDE], debugSites: true }));
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
    expect(room.isRunning()).toBe(false);
    expect((await room.start(config())).ok).toBe(true);
    expect(room.isRunning()).toBe(true);
    expect(await room.start(config())).toEqual({ ok: false, error: 'a room run is already in progress' });
    room.stop();
    await finished(seen);
    expect(room.isRunning()).toBe(false);
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
    await room.start(config({ participants: [CLAUDE] }));
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

  it('copies the whole final text of the snapshot, not a text from the renderer, and nothing while there is no final', async () => {
    copied.length = 0;
    const { room, seen } = service(echoDriver());
    expect(room.copyFinal()).toBe(false);
    await room.start(config({ participants: [CLAUDE] }));
    await finished(seen);
    expect(room.copyFinal()).toBe(true);
    const final = room.state().entries.find((entry) => entry.kind === 'final');
    expect(copied).toEqual([final?.text]);
    expect(copied[0]?.length).toBeGreaterThan(0);
  });

  it('hands the renderer the suggestions its dependency reads', async () => {
    const { room } = service(async () => ({ turn: async () => 'x', reset: async () => undefined, dispose: () => undefined }));
    expect(await room.models()).toBe(SUGGESTIONS);
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
    await room.start(config({ participants: [CLAUDE] }));
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

describe('room archive in the service', () => {
  const roomsDir = (): string => path.join(dir, 'rooms');

  async function savedRoom(prompt = 'the question'): Promise<string> {
    const { room, seen } = service(echoDriver());
    const started = await room.start(config({ prompt, participants: [CLAUDE] }));
    await finished(seen);
    return started.ok ? started.roomId : '';
  }

  async function copyRecord(id: string, newId: string, updatedAt: number, status: 'running' | 'done'): Promise<void> {
    const record = await readRecord(roomsDir(), id);
    if (record === null) throw new Error('no record');
    await writeRecord(roomsDir(), { ...record, id: newId, updatedAt, status });
  }

  it('lists the saved rooms newest first', async () => {
    const id = await savedRoom('first line\nsecond line');
    await copyRecord(id, 'older', 1, 'done');
    const { room } = service(echoDriver());
    const listed = await room.list();
    expect(listed.map((item) => item.id)).toEqual([id, 'older']);
    expect(listed[0]).toMatchObject({ unreadable: false, status: 'done', firstPrompt: 'first line' });
  });

  it('opens a saved room into the snapshot and returns the prefilled form', async () => {
    const id = await savedRoom();
    const { room } = service(echoDriver());
    const opened = await room.open(id);
    expect(opened.ok).toBe(true);
    expect(room.state().roomId).toBe(id);
    expect(room.state().phase).toBe('done');
    expect(room.state().historyPath).toBe(path.join(roomsDir(), `${id}.md`));
    expect(room.state().entries.map((entry) => entry.kind)).toEqual(['prompt', 'reply', 'final']);
    expect(opened.ok && opened.form).toMatchObject({ prompt: '', mode: 'relay', checked: ['claude'] });
    expect(room.copyFinal()).toBe(true);
  });

  it('refuses to open an unknown, unreadable or malformed id and leaves the snapshot as it was', async () => {
    await mkdir(roomsDir(), { recursive: true });
    await writeFile(path.join(roomsDir(), 'broken.json'), '{"not": "a record"', 'utf8');
    const { room } = service(echoDriver());
    for (const id of ['missing', 'broken', '../escape', 'a/b', '']) {
      const opened = await room.open(id);
      expect(opened.ok).toBe(false);
    }
    expect(room.state().phase).toBe('idle');
    expect((await readFile(path.join(roomsDir(), 'broken.json'), 'utf8'))).toBe('{"not": "a record"');
  });

  it('refuses to open a room while a run is in progress', async () => {
    const id = await savedRoom();
    const hang: DriverFactory = async () => ({
      turn: (request) => new Promise((resolve) => request.signal.addEventListener('abort', () => resolve(null))),
      reset: async () => undefined,
      dispose: () => undefined,
    });
    const { room, seen } = service(hang);
    await room.start(config({ participants: [CLAUDE] }));
    const before = room.state();
    expect((await room.open(id)).ok).toBe(false);
    expect(room.state()).toBe(before);
    room.stop();
    await finished(seen);
  });

  it('continues the opened room: same id, same files, old entries first', async () => {
    const id = await savedRoom('first prompt');
    const seenPrompts: string[] = [];
    const watching: DriverFactory = async (participant) => ({
      turn: async (request) => {
        seenPrompts.push(`${request.text}${request.historyText ?? ''}`);
        return `again of ${participant.label}`;
      },
      reset: async () => undefined,
      dispose: () => undefined,
    });
    const { room, seen } = service(watching);
    await room.open(id);
    const started = await room.start(config({ prompt: 'second prompt', participants: [CLAUDE] }), id);
    expect(started.ok && started.roomId).toBe(id);
    await finished(seen);
    const record = await readRecord(roomsDir(), id);
    expect(record?.entries.map((entry) => entry.text).filter((text) => text.includes('prompt'))).toEqual(['first prompt', 'second prompt']);
    expect(record?.entries.length).toBe(6);
    const history = await readFile(path.join(roomsDir(), `${id}.md`), 'utf8');
    expect(history.indexOf('first prompt')).toBeLessThan(history.indexOf('second prompt'));
    expect(seenPrompts[0]).toContain('first prompt');
    expect((await listRecords(roomsDir())).length).toBe(1);
  });

  it('continues the room a live run just finished in, without opening it from the list', async () => {
    const { room, seen } = service(echoDriver());
    const first = await room.start(config({ prompt: 'first prompt', participants: [CLAUDE] }));
    await finished(seen);
    const id = first.ok ? first.roomId : '';
    const second = await room.start(config({ prompt: 'second prompt', participants: [CLAUDE] }), id);
    expect(second.ok && second.roomId).toBe(id);
    await vi.waitFor(() => expect(seen.filter((event) => event.type === 'finished').length).toBe(2));
    const record = await readRecord(roomsDir(), id);
    expect(record?.entries.filter((entry) => entry.kind === 'prompt').map((entry) => entry.text)).toEqual(['first prompt', 'second prompt']);
    expect((await listRecords(roomsDir())).length).toBe(1);
  });

  it('new room clears the snapshot so a reload does not bring the old room back, and a continuation of it is refused', async () => {
    const id = await savedRoom();
    const { room } = service(echoDriver());
    await room.open(id);
    expect(room.newRoom(null)).toBe(true);
    expect(room.state().roomId).toBeNull();
    expect(room.state().entries).toEqual([]);
    expect((await room.start(config(), id)).ok).toBe(false);
  });

  it('new room is refused while a run is in progress', async () => {
    const hang: DriverFactory = async () => ({
      turn: (request) => new Promise((resolve) => request.signal.addEventListener('abort', () => resolve(null))),
      reset: async () => undefined,
      dispose: () => undefined,
    });
    const { room, seen } = service(hang);
    await room.start(config({ participants: [CLAUDE] }));
    const before = room.state();
    expect(room.newRoom(null)).toBe(false);
    expect(room.state()).toBe(before);
    room.stop();
    await finished(seen);
  });

  it('refuses a continuation that is not the opened room or has no record', async () => {
    const id = await savedRoom();
    const { room } = service(echoDriver());
    expect((await room.start(config(), id)).ok).toBe(false);
    await room.open(id);
    expect((await room.start(config(), 'other')).ok).toBe(false);
    await rm(path.join(roomsDir(), `${id}.json`));
    expect((await room.start(config(), id)).ok).toBe(false);
    expect(room.state().phase).toBe('done');
  });

  it('init rewrites a running record as stopped and opens the most recent room', async () => {
    const id = await savedRoom();
    await copyRecord(id, 'interrupted', 5_000_000_000_000, 'running');
    await copyRecord(id, 'old', 1, 'done');
    const { room } = service(echoDriver());
    await room.init();
    expect((await readRecord(roomsDir(), 'interrupted'))?.status).toBe('stopped');
    expect(room.state().roomId).toBe('interrupted');
    expect(room.state().phase).toBe('stopped');
  });

  it('init leaves the room empty when there are no records or the directory cannot be read', async () => {
    const empty = service(echoDriver());
    await empty.room.init();
    expect(empty.room.state().phase).toBe('idle');
    await writeFile(roomsDir(), 'not a directory', 'utf8');
    await empty.room.init();
    expect(empty.room.state().phase).toBe('idle');
    expect(await empty.room.list()).toEqual([]);
  });

  it('init survives a rooms directory it cannot write to and still opens the room', async () => {
    const id = await savedRoom();
    await copyRecord(id, 'interrupted', 5_000_000_000_000, 'running');
    await chmod(roomsDir(), 0o500);
    try {
      const { room } = service(echoDriver());
      await expect(room.init()).resolves.toBeUndefined();
      expect(room.state().roomId).toBe('interrupted');
      expect(room.state().phase).toBe('stopped');
    } finally {
      await chmod(roomsDir(), 0o700);
    }
  });
});
