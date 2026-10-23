// room-archive.test.ts
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriverFactory, ParticipantDriver } from '../../src/main/room';
import { listRecords, readRecord } from '../../src/main/room-archive';
import type { RoomTerminals } from '../../src/main/room-drivers';
import { RoomService } from '../../src/main/room-service';
import { ROOM_ID, type RoomConfig, type RoomEvent, type RoomParticipant } from '../../src/shared/room-model';

const CLAUDE: RoomParticipant = { id: 'claude', kind: 'claude', label: 'Claude Code' };
const CODEX: RoomParticipant = { id: 'codex', kind: 'codex', label: 'Codex' };

let dir: string;
const services: RoomService[] = [];

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'aiaw-room-archive-'));
});

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.shutdown()));
  await rm(dir, { recursive: true, force: true });
});

const terminal: RoomTerminals = { backlog: () => ({ data: '', end: 0 }), write: () => true, resize: () => true };

function service(driverFor: DriverFactory): { room: RoomService; seen: RoomEvent[] } {
  const seen: RoomEvent[] = [];
  const room = new RoomService({
    roomsDir: path.join(dir, 'rooms'),
    driverFor,
    terminal,
    emit: (event) => seen.push(event),
    paste: () => true,
    copy: () => undefined,
    models: async () => ({ claude: { models: [], efforts: [] }, codex: { models: [] } }),
  });
  services.push(room);
  return { room, seen };
}

function gatedDriver(gate: Promise<void>): DriverFactory {
  return async (participant): Promise<ParticipantDriver> => ({
    turn: async () => {
      if (participant.id === CODEX.id) await gate;
      return `reply of ${participant.label}`;
    },
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

describe('room rename in the service', () => {
  const roomsDir = (): string => path.join(dir, 'rooms');

  it('a rename during a run survives the next entry', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { room, seen } = service(gatedDriver(gate));
    const started = await room.start(config());
    const id = started.ok ? started.roomId : '';
    await vi.waitFor(async () => expect((await readRecord(roomsDir(), id))?.entries.length).toBeGreaterThanOrEqual(2));
    expect(await room.rename(id, 'Renamed mid-run')).toBe(true);
    release();
    await finished(seen);
    const record = await readRecord(roomsDir(), id);
    expect(record?.title).toBe('Renamed mid-run');
    expect(record?.status).toBe('done');
    expect(record?.entries.length).toBeGreaterThanOrEqual(4);
    const listed = await room.list();
    expect(listed[0]).toMatchObject({ id, title: 'Renamed mid-run' });
  });

  it('renames a saved room that is not running and keeps its entries', async () => {
    const { room, seen } = service(gatedDriver(Promise.resolve()));
    const started = await room.start(config({ prompt: 'derive me\nsecond line' }));
    const id = started.ok ? started.roomId : '';
    await finished(seen);
    expect((await room.list())[0]).toMatchObject({ id, title: 'derive me' });
    const before = await readRecord(roomsDir(), id);
    expect(await room.rename(id, '  Saved name ')).toBe(true);
    const after = await readRecord(roomsDir(), id);
    expect(after?.title).toBe('Saved name');
    expect(after?.entries).toEqual(before?.entries);
    expect((await listRecords(roomsDir()))[0]).toMatchObject({ id, title: 'Saved name' });
  });

  it('a continued room keeps its title', async () => {
    const first = service(gatedDriver(Promise.resolve()));
    const started = await first.room.start(config());
    const id = started.ok ? started.roomId : '';
    await finished(first.seen);
    expect(await first.room.rename(id, 'Kept')).toBe(true);
    await first.room.open(id);
    const again = await first.room.start(config({ prompt: 'follow-up' }), id);
    expect(again.ok).toBe(true);
    await vi.waitFor(async () => expect((await readRecord(roomsDir(), id))?.status).toBe('done'));
    await vi.waitFor(async () => expect((await readRecord(roomsDir(), id))?.entries.length).toBeGreaterThan(4));
    expect((await readRecord(roomsDir(), id))?.title).toBe('Kept');
  });

  it('refuses a malformed id or title, an unknown room and an unreadable record, and leaves the file unchanged', async () => {
    const { room, seen } = service(gatedDriver(Promise.resolve()));
    const started = await room.start(config());
    const id = started.ok ? started.roomId : '';
    await finished(seen);
    expect(await room.rename('../x', 'ok')).toBe(false);
    expect(await room.rename(id, '')).toBe(false);
    expect(await room.rename(id, 'a\nb')).toBe(false);
    expect(await room.rename('missing', 'ok')).toBe(false);
    const file = path.join(roomsDir(), `${id}.json`);
    expect((await readRecord(roomsDir(), id))?.title).toBeUndefined();
    await writeFile(file, '{ not json', 'utf8');
    expect(await room.rename(id, 'ok')).toBe(false);
    expect(await readFile(file, 'utf8')).toBe('{ not json');
  });
});

describe('room resume in the service', () => {
  const roomsDir = (): string => path.join(dir, 'rooms');

  interface Call {
    id: string;
    text: string;
  }

  interface Script {
    calls: Call[];
    hold: (call: Call, count: number) => boolean;
  }

  function scripted(script: Script): DriverFactory {
    return async (participant): Promise<ParticipantDriver> => ({
      turn: async (request) => {
        const call = { id: participant.id, text: request.text };
        script.calls.push(call);
        if (script.hold(call, script.calls.length)) return new Promise<string | null>(() => undefined);
        return `reply of ${participant.label}`;
      },
      reset: async () => undefined,
      dispose: () => undefined,
    });
  }

  async function finishedCount(seen: RoomEvent[], count: number): Promise<void> {
    await vi.waitFor(() => expect(seen.filter((event) => event.type === 'finished')).toHaveLength(count));
  }

  async function stopAfterCalls(room: RoomService, script: Script, count: number): Promise<void> {
    await vi.waitFor(() => expect(script.calls.length).toBe(count));
    room.stop();
  }

  function turnPairs(entries: { authorId: string; kind: string; round?: number }[]): string[] {
    return entries.filter((entry) => entry.round !== undefined && (entry.kind === 'reply' || entry.kind === 'error')).map((entry) => `${entry.authorId}:${entry.round}`);
  }

  it('a resumed relay skips the answered turns', async () => {
    const script: Script = { calls: [], hold: (_call, count) => count === 3 };
    const { room, seen } = service(scripted(script));
    const wanted = config({ rounds: 2 });
    const started = await room.start(wanted);
    const id = started.ok ? started.roomId : '';
    await stopAfterCalls(room, script, 3);
    await finishedCount(seen, 1);
    const stopped = await readRecord(roomsDir(), id);
    expect(stopped?.status).toBe('stopped');
    expect(turnPairs(stopped?.entries ?? [])).toEqual(['claude:1', 'codex:1']);

    script.hold = () => false;
    const resumed = await room.start({ ...wanted, turnTimeoutMs: 7000 }, id, true);
    expect(resumed.ok).toBe(true);
    await finishedCount(seen, 2);

    const record = await readRecord(roomsDir(), id);
    expect(record?.status).toBe('done');
    expect(record?.config.turnTimeoutMs).toBe(7000);
    expect(script.calls.slice(3).map((call) => call.id)).toEqual(['claude', 'codex', 'claude']);
    const entries = record?.entries ?? [];
    expect(entries.filter((entry) => entry.kind === 'prompt')).toHaveLength(1);
    const pairs = turnPairs(entries);
    expect(pairs).toEqual(['claude:1', 'codex:1', 'claude:2', 'codex:2']);
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(entries.filter((entry) => entry.kind === 'final')).toHaveLength(1);
    const snapshot = room.state();
    expect(snapshot.phase).toBe('done');
    expect(snapshot.completed).toBe(snapshot.total);
  });

  it('a relay stopped while the finalizer works resumes with the final only', async () => {
    const script: Script = { calls: [], hold: (_call, count) => count === 3 };
    const { room, seen } = service(scripted(script));
    const started = await room.start(config());
    const id = started.ok ? started.roomId : '';
    await stopAfterCalls(room, script, 3);
    await finishedCount(seen, 1);
    script.hold = () => false;
    expect((await room.start(config(), id, true)).ok).toBe(true);
    await finishedCount(seen, 2);
    expect(script.calls.slice(3).map((call) => call.id)).toEqual(['claude']);
    const record = await readRecord(roomsDir(), id);
    expect(record?.status).toBe('done');
    expect(turnPairs(record?.entries ?? [])).toEqual(['claude:1', 'codex:1']);
    expect(record?.entries.filter((entry) => entry.kind === 'final')).toHaveLength(1);
  });

  it('a broadcast stopped mid-round resumes only the missing participants, who do not see the replies of their own round', async () => {
    const script: Script = { calls: [], hold: (call, count) => count <= 2 && call.id === CODEX.id };
    const { room, seen } = service(scripted(script));
    const wanted = config({ mode: 'broadcast', rounds: 2 });
    const started = await room.start(wanted);
    const id = started.ok ? started.roomId : '';
    await vi.waitFor(async () => expect(turnPairs((await readRecord(roomsDir(), id))?.entries ?? [])).toEqual(['claude:1']));
    room.stop();
    await finishedCount(seen, 1);

    script.hold = () => false;
    expect((await room.start(wanted, id, true)).ok).toBe(true);
    await finishedCount(seen, 2);

    const resumedCalls = script.calls.slice(2);
    expect(resumedCalls.map((call) => call.id).sort()).toEqual(['claude', 'claude', 'codex', 'codex']);
    expect(resumedCalls[0]?.id).toBe('codex');
    expect(resumedCalls[0]?.text).not.toContain('reply of Claude Code');
    expect(resumedCalls[1]?.text).toContain('reply of Claude Code');
    const record = await readRecord(roomsDir(), id);
    const pairs = turnPairs(record?.entries ?? []);
    expect([...pairs].sort()).toEqual(['claude:1', 'claude:2', 'codex:1', 'codex:2']);
    expect(record?.entries.filter((entry) => entry.kind === 'prompt')).toHaveLength(1);
    expect(record?.entries.filter((entry) => entry.kind === 'final')).toHaveLength(1);
  });

  function stopEntries(entries: { authorId: string; state?: string }[]): number {
    return entries.filter((entry) => entry.authorId === ROOM_ID && entry.state === 'stopped').length;
  }

  function roomBlocks(history: string): number {
    return history.split('\n').filter((line) => /^<<<entry-\S+ author="Room" /.test(line)).length;
  }

  it('a resume drops the stop entries of its segment', async () => {
    const script: Script = { calls: [], hold: (_call, count) => count === 3 };
    const { room, seen } = service(scripted(script));
    const wanted = config({ rounds: 2 });
    const started = await room.start(wanted);
    const id = started.ok ? started.roomId : '';
    await stopAfterCalls(room, script, 3);
    await finishedCount(seen, 1);
    expect(stopEntries((await readRecord(roomsDir(), id))?.entries ?? [])).toBe(1);
    expect(roomBlocks(await readFile(path.join(roomsDir(), `${id}.md`), 'utf8'))).toBe(1);

    script.hold = (_call, count) => count === 4;
    expect((await room.start(wanted, id, true)).ok).toBe(true);
    await stopAfterCalls(room, script, 4);
    await finishedCount(seen, 2);
    expect(stopEntries((await readRecord(roomsDir(), id))?.entries ?? [])).toBe(1);

    script.hold = () => false;
    expect((await room.start(wanted, id, true)).ok).toBe(true);
    await finishedCount(seen, 3);

    const record = await readRecord(roomsDir(), id);
    expect(record?.status).toBe('done');
    expect(stopEntries(record?.entries ?? [])).toBe(0);
    expect(roomBlocks(await readFile(path.join(roomsDir(), `${id}.md`), 'utf8'))).toBe(0);
    expect(script.calls.slice(3).filter((call) => /author="Room" /.test(call.text))).toHaveLength(0);
    const starts = seen.filter((event) => event.type === 'started');
    expect(starts).toHaveLength(3);
    for (const event of starts.slice(1)) expect(event.type === 'started' ? stopEntries(event.previous ?? []) : -1).toBe(0);
  });

  it('a Continue with a new prompt keeps the stop entry of the old segment', async () => {
    const script: Script = { calls: [], hold: (_call, count) => count === 3 };
    const { room, seen } = service(scripted(script));
    const started = await room.start(config({ rounds: 2 }));
    const id = started.ok ? started.roomId : '';
    await stopAfterCalls(room, script, 3);
    await finishedCount(seen, 1);

    script.hold = () => false;
    expect((await room.start(config({ prompt: 'another question' }), id)).ok).toBe(true);
    await finishedCount(seen, 2);

    const record = await readRecord(roomsDir(), id);
    expect(stopEntries(record?.entries ?? [])).toBe(1);
    expect(roomBlocks(await readFile(path.join(roomsDir(), `${id}.md`), 'utf8'))).toBe(1);
    expect(script.calls.slice(3).some((call) => /author="Room" /.test(call.text))).toBe(true);
  });

  it('refuses a resume whose prompt or setup differs, one with nothing to resume or for another room, and writes nothing', async () => {
    const script: Script = { calls: [], hold: (_call, count) => count === 3 };
    const { room, seen } = service(scripted(script));
    const wanted = config({ rounds: 2 });
    const started = await room.start(wanted);
    const id = started.ok ? started.roomId : '';
    await stopAfterCalls(room, script, 3);
    await finishedCount(seen, 1);
    const file = path.join(roomsDir(), `${id}.json`);
    const history = path.join(roomsDir(), `${id}.md`);
    const before = [await readFile(file, 'utf8'), await readFile(history, 'utf8')];
    const events = seen.length;
    const calls = script.calls.length;

    const differing: RoomConfig[] = [
      { ...wanted, prompt: 'another question' },
      { ...wanted, mode: 'broadcast' },
      { ...wanted, rounds: 3 },
      { ...wanted, participants: [CLAUDE] },
      { ...wanted, participants: [CODEX, CLAUDE] },
      { ...wanted, participants: [CLAUDE, { ...CODEX, model: 'gpt-x', label: 'Codex \u00b7 gpt-x' }] },
      { ...wanted, finalizerId: CODEX.id },
    ];
    for (const candidate of differing) {
      const refused = await room.start(candidate, id, true);
      expect(refused.ok).toBe(false);
    }
    expect((await room.start(wanted, 'room-elsewhere', true)).ok).toBe(false);
    expect([await readFile(file, 'utf8'), await readFile(history, 'utf8')]).toEqual(before);
    expect(seen).toHaveLength(events);
    expect(script.calls).toHaveLength(calls);
    expect(room.state().phase).toBe('stopped');

    script.hold = () => false;
    expect((await room.start(wanted, id, true)).ok).toBe(true);
    await finishedCount(seen, 2);
    const refusedDone = await room.start(wanted, id, true);
    expect(refusedDone.ok).toBe(false);
    expect((await readRecord(roomsDir(), id))?.status).toBe('done');
  });
});
