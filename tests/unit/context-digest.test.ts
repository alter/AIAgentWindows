// context-digest.test.ts
import { describe, expect, it } from 'vitest';
import { parseDigest, type ContextDigest } from '../../src/shared/context-digest';
import { parseRoomRecord, type RoomEntry, type RoomRecord } from '../../src/shared/room-model';

const HASH = '0123456789abcdef';

const DIGEST: ContextDigest = {
  history: { first: 0, last: 3, count: 3 },
  parts: [
    { id: 'history', bytes: 120, hash: HASH },
    { id: 'project-map', bytes: 40, hash: 'fedcba9876543210' },
  ],
  files: [{ name: '1.md', bytes: 160 }],
  map: 'aaaaaaaaaaaaaaaa',
  cut: { via: 'inline', entries: 2, mapChars: 50 },
};

function recordWith(entry: Record<string, unknown>): unknown {
  return {
    version: 1,
    id: 'room-20260101-000000-abcdef',
    createdAt: 1,
    updatedAt: 2,
    status: 'done',
    nonce: 'room-20260101-000000-abcdef',
    config: { mode: 'relay', rounds: 1, participants: [{ id: 'claude', kind: 'claude', label: 'Claude Code' }], finalizerId: 'claude', turnTimeoutMs: 10000, debugSites: false },
    entries: [{ authorId: 'claude', label: 'Claude Code', time: 5, kind: 'reply', text: 'hello', ...entry }],
  };
}

function entryOf(record: RoomRecord | null): RoomEntry | undefined {
  return record?.entries[0];
}

describe('parseDigest', () => {
  it('keeps a complete digest as it is', () => {
    expect(parseDigest(JSON.parse(JSON.stringify(DIGEST)))).toEqual(DIGEST);
  });

  it('keeps the collection flag only as true, and refuses anything else', () => {
    const allowed = { ...DIGEST, collectionAllowed: true };
    expect(parseDigest(JSON.parse(JSON.stringify(allowed)))).toEqual(allowed);
    for (const value of [false, 'true', 1, null]) expect(parseDigest({ ...DIGEST, collectionAllowed: value })).toBeNull();
  });

  it('keeps a digest without a map, files or a cut', () => {
    const small = { history: { first: 0, last: 0, count: 1 }, parts: [{ id: 'history', bytes: 1, hash: HASH }], files: [] };
    expect(parseDigest(small)).toEqual(small);
  });

  it.each([
    ['a non-object', 'x'],
    ['an array', []],
    ['a negative count', { ...DIGEST, history: { first: 0, last: 3, count: -1 } }],
    ['a fractional byte count', { ...DIGEST, parts: [{ id: 'history', bytes: 1.5, hash: HASH }] }],
    ['a hash that is not hex of the fixed length', { ...DIGEST, parts: [{ id: 'history', bytes: 1, hash: 'XYZ' }] }],
    ['a part id with a space', { ...DIGEST, parts: [{ id: 'a b', bytes: 1, hash: HASH }] }],
    ['a file name with a path separator', { ...DIGEST, files: [{ name: '../x.md', bytes: 1 }] }],
    ['a file name with a backslash', { ...DIGEST, files: [{ name: 'a\\b.md', bytes: 1 }] }],
    ['a file name with a NUL', { ...DIGEST, files: [{ name: 'a\u0000b.md', bytes: 1 }] }],
    ['a file name over the length cap', { ...DIGEST, files: [{ name: `${'a'.repeat(256)}.md`, bytes: 1 }] }],
    ['an empty file name', { ...DIGEST, files: [{ name: '', bytes: 1 }] }],
    ['a map hash of the wrong shape', { ...DIGEST, map: 'nothex' }],
    ['a cut by an unknown route', { ...DIGEST, cut: { via: 'magic', entries: 1, mapChars: 1 } }],
    ['too many parts', { ...DIGEST, parts: Array.from({ length: 9 }, () => DIGEST.parts[0]) }],
    ['a history that is not an object', { ...DIGEST, history: 3 }],
    ['files that are not a list', { ...DIGEST, files: {} }],
    ['too many files', { ...DIGEST, files: Array.from({ length: 9 }, () => DIGEST.files[0]) }],
    ['a part that is not an object', { ...DIGEST, parts: [3] }],
    ['a file that is not an object', { ...DIGEST, files: [3] }],
    ['a cut that is not an object', { ...DIGEST, cut: 3 }],
  ])('refuses %s', (_name, value) => {
    expect(parseDigest(value)).toBeNull();
  });
});

describe('a digest on a record entry', () => {
  it('survives a parse of the record the entry sits in', () => {
    const entry = entryOf(parseRoomRecord(recordWith({ digest: DIGEST })));
    expect(entry?.digest).toEqual(DIGEST);
  });

  it('is dropped when it is malformed, and the entry stays', () => {
    const entry = entryOf(parseRoomRecord(recordWith({ digest: { history: 'no' } })));
    expect(entry?.text).toBe('hello');
    expect(entry?.digest).toBeUndefined();
  });

  it('is absent from an entry that never had one', () => {
    expect(entryOf(parseRoomRecord(recordWith({})))).not.toHaveProperty('digest');
  });
});
