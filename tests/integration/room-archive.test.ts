// room-archive.test.ts
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriverFactory, ParticipantDriver } from '../../src/main/room';
import { listRecords, readRecord } from '../../src/main/room-archive';
import type { RoomTerminals } from '../../src/main/room-drivers';
import { RoomService } from '../../src/main/room-service';
import type { RoomConfig, RoomEvent, RoomParticipant } from '../../src/shared/room-model';

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
