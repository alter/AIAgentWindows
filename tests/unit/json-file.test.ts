// json-file.test.ts
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FailClosedError, JsonFile } from '../../src/main/store/json-file';

let dir: string;
let file: string;

function open(maxBytes = 1000): JsonFile<{ n: number }> {
  return new JsonFile(file, {
    maxBytes,
    parse: (raw) => {
      const n = (raw as { n?: unknown }).n;
      if (n !== 1) throw new Error('bad version');
      return { n };
    },
  });
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'aiaw-json-'));
  file = path.join(dir, 'f.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('JsonFile', () => {
  it('reads a missing file as missing and writes it', async () => {
    const json = open();
    expect(await json.read()).toEqual({ kind: 'missing' });
    await json.write('{"n":1}');
    expect(await json.read()).toEqual({ kind: 'ok', value: { n: 1 } });
    expect(json.failure()).toBeNull();
  });

  it('never rewrites a truncated file, an oversize file, a future version or an unreadable path', async () => {
    const cases: Array<[string, () => Promise<void>, number]> = [
      ['truncated', () => writeFile(file, '{"n":', 'utf8'), 1000],
      ['future version', () => writeFile(file, '{"n":3}', 'utf8'), 1000],
      ['oversize', () => writeFile(file, '{"n":1,"pad":"' + 'x'.repeat(50) + '"}', 'utf8'), 20],
    ];
    for (const [, setup, max] of cases) {
      await setup();
      const before = await readFile(file);
      const json = open(max);
      expect((await json.read()).kind).toBe('unreadable');
      await expect(json.write('{"n":1}')).rejects.toBeInstanceOf(FailClosedError);
      expect((await readFile(file)).equals(before)).toBe(true);
      expect(json.failure()).not.toBeNull();
    }
    await rm(file);
    await writeFile(path.join(dir, 'f.json.d'), '', 'utf8');
    const folder = new JsonFile(dir, { maxBytes: 10, parse: () => 1 });
    expect((await folder.read()).kind).toBe('unreadable');
  });

  it('writes again once a later read succeeds', async () => {
    const json = open();
    await writeFile(file, 'junk', 'utf8');
    await json.read();
    await writeFile(file, '{"n":1}', 'utf8');
    expect((await json.read()).kind).toBe('ok');
    await json.write('{"n":1}');
  });
});
