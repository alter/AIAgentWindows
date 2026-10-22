// room-archive.test.ts
import { mkdir, mkdtemp, readFile, readdir, rm, truncate, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_RECORD_BYTES,
  MAX_RECORD_ENTRIES,
  isRoomId,
  parseRoomRecord,
  type RoomEntry,
  type RoomRecord,
} from '../../src/shared/room-model';
import {
  LIST_LIMIT,
  listRecords,
  readRecord,
  recordPath,
  stopInterrupted,
  writeRecord,
} from '../../src/main/room-archive';

const CLAUDE = { id: 'claude', kind: 'claude', label: 'Claude Code' } as const;
const CODEX = { id: 'codex', kind: 'codex', label: 'Codex' } as const;

function entry(overrides: Partial<RoomEntry> = {}): RoomEntry {
  return { authorId: 'owner', label: 'You', time: 1000, kind: 'prompt', text: 'first question', ...overrides };
}

function record(overrides: Partial<RoomRecord> = {}): RoomRecord {
  return {
    version: 1,
    id: 'room-1',
    createdAt: 1000,
    updatedAt: 2000,
    status: 'done',
    config: {
      mode: 'relay',
      rounds: 2,
      participants: [CLAUDE, CODEX],
      finalizerId: 'claude',
      turnTimeoutMs: 60000,
      debugSites: false,
    },
    entries: [entry(), entry({ authorId: 'claude', label: 'Claude Code', kind: 'reply', text: 'answer', time: 1500 })],
    nonce: 'abc123',
    ...overrides,
  };
}

let dir = '';

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'room-archive-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('room id', () => {
  it('accepts letters, digits, dash and underscore up to 64 characters', () => {
    expect(isRoomId('room-2026_10_23-abc')).toBe(true);
    expect(isRoomId('a'.repeat(64))).toBe(true);
  });

  it('rejects an id with a path separator or outside the allowed characters', () => {
    for (const bad of ['', 'a/b', 'a\\b', '..', '../x', 'a.b', 'a b', 'é', 'a'.repeat(65), 'a\u0000b', 12, null, undefined]) {
      expect(isRoomId(bad)).toBe(false);
    }
    expect(() => recordPath(dir, '../escape')).toThrow();
    expect(() => recordPath(dir, 'a/b')).toThrow();
  });

  it('refuses an id that escapes the rooms directory', async () => {
    expect(() => recordPath(path.join(dir, 'rooms'), '..')).toThrow();
    await expect(readRecord(dir, '../../etc/passwd')).resolves.toBeNull();
    await expect(writeRecord(dir, record({ id: '../escape' }))).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
  });

  it('joins a valid id under the rooms directory', () => {
    expect(recordPath(dir, 'room-1')).toBe(path.join(dir, 'room-1.json'));
  });
});

describe('record round trip', () => {
  it('a record written after each entry parses back into the same entries', async () => {
    const entries: RoomEntry[] = [];
    const texts = ['one', 'two <b>markup</b>', 'three\nlines'];
    for (const [index, text] of texts.entries()) {
      entries.push(entry({ kind: index === 0 ? 'prompt' : 'reply', text, time: 1000 + index }));
      await writeRecord(dir, record({ entries: [...entries], status: 'running', updatedAt: 2000 + index }));
      const back = await readRecord(dir, 'room-1');
      expect(back?.entries).toEqual(entries);
      expect(back?.updatedAt).toBe(2000 + index);
    }
    expect((await readdir(dir)).sort()).toEqual(['room-1.json']);
  });

  it('keeps config, nonce and status exactly', async () => {
    const written = record({ status: 'failed', nonce: 'n-1_x' });
    await writeRecord(dir, written);
    expect(await readRecord(dir, 'room-1')).toEqual(written);
  });

  it('creates the rooms directory when it does not exist', async () => {
    const nested = path.join(dir, 'shared', 'rooms');
    await writeRecord(nested, record());
    expect((await readRecord(nested, 'room-1'))?.id).toBe('room-1');
  });

  it('returns null for a room that does not exist', async () => {
    expect(await readRecord(dir, 'nope')).toBeNull();
  });

  it('returns null for a file that is not a record and leaves it untouched', async () => {
    await writeFile(path.join(dir, 'broken.json'), '{ not json', 'utf8');
    expect(await readRecord(dir, 'broken')).toBeNull();
    expect(await readFile(path.join(dir, 'broken.json'), 'utf8')).toBe('{ not json');
  });

  it('returns null for a record whose id differs from its file name', async () => {
    await writeFile(path.join(dir, 'other.json'), JSON.stringify(record()), 'utf8');
    expect(await readRecord(dir, 'other')).toBeNull();
  });
});

describe('parseRoomRecord', () => {
  it('accepts a valid record and drops unknown fields', () => {
    const parsed = parseRoomRecord({ ...record(), extra: 1, entries: [{ ...entry(), extra: 2 }] });
    expect(parsed?.entries).toEqual([entry()]);
    expect(parsed).not.toHaveProperty('extra');
  });

  it('accepts an empty entry text', () => {
    expect(parseRoomRecord(record({ entries: [entry({ text: '' })] }))?.entries[0]?.text).toBe('');
  });

  it('rejects anything that is not an object', () => {
    for (const bad of [null, undefined, 'x', 5, [], [record()]]) expect(parseRoomRecord(bad)).toBeNull();
  });

  it('rejects a wrong version, id, nonce or timestamp', () => {
    const base = record();
    const bads: unknown[] = [
      { ...base, version: 2 },
      { ...base, version: undefined },
      { ...base, id: 'a/b' },
      { ...base, id: 5 },
      { ...base, nonce: '' },
      { ...base, nonce: 'has space' },
      { ...base, nonce: 'x'.repeat(65) },
      { ...base, createdAt: -1 },
      { ...base, createdAt: 1.5 },
      { ...base, createdAt: '1' },
      { ...base, updatedAt: Number.NaN },
    ];
    for (const bad of bads) expect(parseRoomRecord(bad)).toBeNull();
  });

  it('rejects a status outside running, done, stopped and failed', () => {
    for (const status of ['paused', '', 5, null]) expect(parseRoomRecord({ ...record(), status })).toBeNull();
    for (const status of ['running', 'done', 'stopped', 'failed']) expect(parseRoomRecord({ ...record(), status })?.status).toBe(status);
  });

  it('rejects an invalid config through the participant validation', () => {
    const base = record();
    const bads: unknown[] = [
      undefined,
      null,
      [],
      { ...base.config, participants: [] },
      { ...base.config, participants: [{ id: 'x', kind: 'unknown' }] },
      { ...base.config, participants: [CLAUDE, CLAUDE] },
      { ...base.config, mode: 'chat' },
      { ...base.config, rounds: 0 },
      { ...base.config, finalizerId: 'nobody' },
      { ...base.config, turnTimeoutMs: 1 },
    ];
    for (const config of bads) expect(parseRoomRecord({ ...base, config })).toBeNull();
  });

  it('drops a prompt stored in the config', () => {
    const parsed = parseRoomRecord({ ...record(), config: { ...record().config, prompt: 'leak' } });
    expect(parsed?.config).not.toHaveProperty('prompt');
  });

  it('keeps the round and the state of an entry, accepts records without them and rejects bad values', () => {
    const rounded = entry({ kind: 'error', round: 2, state: 'timeout' });
    expect(parseRoomRecord(record({ entries: [rounded] }))?.entries[0]).toEqual(rounded);
    expect(parseRoomRecord(record({ entries: [entry()] }))?.entries[0]).not.toHaveProperty('round');
    for (const round of [0, -1, 1.5, '2', null, 51]) expect(parseRoomRecord(record({ entries: [{ ...entry(), round } as unknown as RoomEntry] }))).toBeNull();
    for (const state of ['done', 5, null]) expect(parseRoomRecord(record({ entries: [{ ...entry(), state } as unknown as RoomEntry] }))).toBeNull();
  });

  it('rejects invalid entries', () => {
    const good = entry();
    const bads: unknown[] = [
      null,
      'x',
      { ...good, authorId: '' },
      { ...good, authorId: 'a'.repeat(129) },
      { ...good, label: '' },
      { ...good, time: -1 },
      { ...good, time: 1.5 },
      { ...good, kind: 'note' },
      { ...good, text: 5 },
      { ...good, text: 'x'.repeat(1_000_001) },
    ];
    for (const bad of bads) expect(parseRoomRecord({ ...record(), entries: [good, bad] })).toBeNull();
    expect(parseRoomRecord({ ...record(), entries: 'x' })).toBeNull();
  });

  it('rejects more entries than the bound', () => {
    const many = Array.from({ length: MAX_RECORD_ENTRIES + 1 }, () => entry());
    expect(parseRoomRecord({ ...record(), entries: many })).toBeNull();
    expect(parseRoomRecord({ ...record(), entries: many.slice(1) })?.entries).toHaveLength(MAX_RECORD_ENTRIES);
  });
});

describe('stopInterrupted', () => {
  it('a running record is loaded as stopped', async () => {
    await writeRecord(dir, record({ status: 'running', updatedAt: 7777 }));
    const stopped = await stopInterrupted(dir);
    expect(stopped).toEqual(['room-1']);
    const back = await readRecord(dir, 'room-1');
    expect(back?.status).toBe('stopped');
    expect(back?.updatedAt).toBe(7777);
    expect(back?.entries).toEqual(record().entries);
  });

  it('leaves finished and unreadable records byte-identical', async () => {
    await writeRecord(dir, record({ id: 'done-1', status: 'done' }));
    await writeFile(path.join(dir, 'broken.json'), '{"status":"running"', 'utf8');
    const before = await readFile(path.join(dir, 'done-1.json'), 'utf8');
    expect(await stopInterrupted(dir)).toEqual([]);
    expect(await readFile(path.join(dir, 'done-1.json'), 'utf8')).toBe(before);
    expect(await readFile(path.join(dir, 'broken.json'), 'utf8')).toBe('{"status":"running"');
  });

  it('does nothing when the rooms directory does not exist', async () => {
    expect(await stopInterrupted(path.join(dir, 'missing'))).toEqual([]);
  });
});

describe('listRecords', () => {
  it('lists records newest first with id, status, times and the first line of the first prompt', async () => {
    await writeRecord(dir, record({ id: 'old', updatedAt: 100, entries: [entry({ text: 'older\nsecond line' })] }));
    await writeRecord(dir, record({ id: 'new', updatedAt: 300, status: 'stopped', entries: [entry({ text: 'newer' })] }));
    await writeRecord(dir, record({ id: 'mid', updatedAt: 200, entries: [entry({ kind: 'reply', text: 'r' }), entry({ text: 'later prompt' })] }));
    const list = await listRecords(dir);
    expect(list.map((item) => item.id)).toEqual(['new', 'mid', 'old']);
    expect(list[0]).toEqual({ id: 'new', unreadable: false, createdAt: 1000, updatedAt: 300, status: 'stopped', firstPrompt: 'newer' });
    expect(list[1]).toMatchObject({ firstPrompt: 'later prompt' });
    expect(list[2]).toMatchObject({ firstPrompt: 'older' });
  });

  it('cuts the first prompt line at 120 characters and gives an empty string without a prompt', async () => {
    await writeRecord(dir, record({ id: 'long', entries: [entry({ text: `${'x'.repeat(200)}\nrest` })] }));
    await writeRecord(dir, record({ id: 'bare', entries: [] }));
    const byId = new Map((await listRecords(dir)).map((item) => [item.id, item]));
    expect(byId.get('long')).toMatchObject({ firstPrompt: 'x'.repeat(120) });
    expect(byId.get('bare')).toMatchObject({ firstPrompt: '' });
  });

  it('an unreadable file is listed as unreadable and left untouched', async () => {
    const files: Record<string, string> = {
      'garbage.json': '\u0000\u0001 not json',
      'wrong-shape.json': JSON.stringify({ version: 1, id: 'wrong-shape' }),
      'mismatch.json': JSON.stringify(record({ id: 'someone-else' })),
    };
    for (const [name, text] of Object.entries(files)) await writeFile(path.join(dir, name), text, 'utf8');
    await writeRecord(dir, record({ id: 'good' }));
    const list = await listRecords(dir);
    expect(list.filter((item) => item.unreadable).map((item) => item.id).sort()).toEqual(['garbage', 'mismatch', 'wrong-shape']);
    expect(list.find((item) => item.id === 'good')?.unreadable).toBe(false);
    expect(list[0]?.id).toBe('good');
    for (const [name, text] of Object.entries(files)) expect(await readFile(path.join(dir, name), 'utf8')).toBe(text);
  });

  it('lists a record over the size bound as unreadable without opening it', async () => {
    const file = path.join(dir, 'huge.json');
    await writeFile(file, '', 'utf8');
    await truncate(file, MAX_RECORD_BYTES + 1);
    const list = await listRecords(dir);
    expect(list).toEqual([{ id: 'huge', unreadable: true }]);
    expect(await readRecord(dir, 'huge')).toBeNull();
  });

  it('ignores temp files, history files, directories and names that are not room ids', async () => {
    await writeRecord(dir, record());
    await writeFile(path.join(dir, 'room-1.md'), '# Room', 'utf8');
    await writeFile(path.join(dir, 'room-1.json.123.tmp'), '{}', 'utf8');
    await writeFile(path.join(dir, 'has space.json'), '{}', 'utf8');
    await mkdir(path.join(dir, 'folder.json'));
    expect((await listRecords(dir)).map((item) => item.id)).toEqual(['room-1']);
  });

  it('returns an empty list when the rooms directory does not exist', async () => {
    expect(await listRecords(path.join(dir, 'missing'))).toEqual([]);
  });

  it('lists at most the newest records up to the limit', async () => {
    for (let index = 0; index < LIST_LIMIT + 3; index += 1) {
      await writeRecord(dir, record({ id: `r${index}`, updatedAt: index }));
    }
    const list = await listRecords(dir);
    expect(list).toHaveLength(LIST_LIMIT);
    expect(list[0]?.id).toBe(`r${LIST_LIMIT + 2}`);
  });
});
