// atomic-file.test.ts
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pidAlive, sweepStaleTemps, writeAtomic } from '../../src/main/store/atomic-file';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'aiaw-atomic-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('writeAtomic', () => {
  it('lands two concurrent writes to one file whole and leaves no temp file', async () => {
    const file = path.join(dir, 'a.json');
    const first = 'a'.repeat(200_000);
    const second = 'b'.repeat(200_000);
    await Promise.all([writeAtomic(file, first), writeAtomic(file, second)]);
    expect([first, second]).toContain(await readFile(file, 'utf8'));
    expect(await readdir(dir)).toEqual(['a.json']);
  });

  it('refuses a planted symlink at the temp path and writes nothing through it', async () => {
    const file = path.join(dir, 'a.json');
    const target = path.join(dir, 'victim.txt');
    await writeFile(target, 'keep', 'utf8');
    await symlink(target, `${file}.${process.pid}.fixed.tmp`);
    await expect(writeAtomic(file, 'new', { suffix: () => 'fixed' })).rejects.toThrow();
    expect(await readFile(target, 'utf8')).toBe('keep');
    await expect(readFile(file, 'utf8')).rejects.toThrow();
  });

  it('creates missing directories', async () => {
    const file = path.join(dir, 'x', 'y', 'a.json');
    await writeAtomic(file, 'hi');
    expect(await readFile(file, 'utf8')).toBe('hi');
  });
});

describe('sweepStaleTemps', () => {
  it('removes a dead pid temp file in its directory and keeps a live pid, a sibling directory and a subdirectory', async () => {
    const sibling = await mkdtemp(path.join(os.tmpdir(), 'aiaw-sibling-'));
    await mkdir(path.join(dir, 'sub'));
    const dead = 2_000_000_000;
    await writeFile(path.join(dir, `x.${dead}.tmp`), '', 'utf8');
    await writeFile(path.join(dir, `y.${dead}.ab12.tmp`), '', 'utf8');
    await writeFile(path.join(dir, `x.${process.pid}.tmp`), '', 'utf8');
    await writeFile(path.join(dir, 'plain.tmp'), '', 'utf8');
    await writeFile(path.join(dir, 'sub', `x.${dead}.tmp`), '', 'utf8');
    await writeFile(path.join(sibling, `x.${dead}.tmp`), '', 'utf8');
    const removed = await sweepStaleTemps(dir);
    expect(removed.sort()).toEqual([`x.${dead}.tmp`, `y.${dead}.ab12.tmp`]);
    expect((await readdir(dir)).sort()).toEqual(['plain.tmp', 'sub', `x.${process.pid}.tmp`]);
    expect(await readdir(path.join(dir, 'sub'))).toEqual([`x.${dead}.tmp`]);
    expect(await readdir(sibling)).toEqual([`x.${dead}.tmp`]);
    await rm(sibling, { recursive: true, force: true });
  });

  it('returns nothing for a missing directory', async () => {
    expect(await sweepStaleTemps(path.join(dir, 'nope'))).toEqual([]);
  });
});

describe('pidAlive', () => {
  it('treats the current process as alive and EPERM as alive but ESRCH as dead', () => {
    expect(pidAlive(process.pid)).toBe(true);
    const fail = (code: string) => () => {
      throw Object.assign(new Error(code), { code });
    };
    expect(pidAlive(1, fail('EPERM'))).toBe(true);
    expect(pidAlive(1, fail('ESRCH'))).toBe(false);
  });
});
