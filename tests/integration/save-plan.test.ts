// save-plan.test.ts
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { savePlanFile, type SavePlanDeps } from '../../src/main/projects/save-plan';

let dir: string;
let project: string;
let outside: string;
let trashed: string[];

function deps(overrides: Partial<SavePlanDeps> = {}): SavePlanDeps {
  return {
    trash: async (file) => {
      trashed.push(file);
      await rm(file);
    },
    ...overrides,
  };
}

const plan = (slug: string, replace = false, extra: Partial<SavePlanDeps> = {}) => savePlanFile(project, slug, 'plan text\n', replace, deps(extra));
const planFile = (slug: string) => path.join(project, 'docs', 'plans', `${slug}.md`);

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'aiaw-save-plan-')));
  project = path.join(dir, 'project');
  outside = path.join(dir, 'outside');
  await mkdir(project);
  await mkdir(outside);
  trashed = [];
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('savePlanFile', () => {
  it('creates docs and docs/plans one level at a time and writes the plan', async () => {
    const made: string[] = [];
    const result = await plan('first', false, { mkdir: async (folder) => { made.push(path.relative(project, folder)); await mkdir(folder); } });
    expect(result).toEqual({ ok: true, file: planFile('first') });
    expect(made).toEqual(['docs', path.join('docs', 'plans')]);
    expect(await readFile(planFile('first'), 'utf8')).toBe('plan text\n');
    expect(await readdir(path.join(project, 'docs', 'plans'))).toEqual(['first.md']);
  });

  it('uses existing docs and docs/plans folders and keeps their other files', async () => {
    await mkdir(path.join(project, 'docs', 'plans'), { recursive: true });
    await writeFile(path.join(project, 'docs', 'plans', 'other.md'), 'other');
    const result = await plan('second');
    expect(result.ok).toBe(true);
    expect((await readdir(path.join(project, 'docs', 'plans'))).sort()).toEqual(['other.md', 'second.md']);
  });

  it('asks for confirmation when the file exists and leaves it untouched', async () => {
    await plan('same');
    await writeFile(planFile('same'), 'edited by hand');
    const result = await plan('same');
    expect(result).toMatchObject({ ok: false, exists: true, file: planFile('same') });
    expect(await readFile(planFile('same'), 'utf8')).toBe('edited by hand');
    expect(trashed).toEqual([]);
  });

  it('moves the old file to the Trash first and then writes the new one when replace is confirmed', async () => {
    await plan('same');
    await writeFile(planFile('same'), 'edited by hand');
    const order: string[] = [];
    const result = await savePlanFile(project, 'same', 'new text', true, {
      trash: async (file) => {
        order.push(`trash:${await readFile(file, 'utf8')}`);
        await rm(file);
      },
    });
    expect(result).toEqual({ ok: true, file: planFile('same') });
    expect(order).toEqual(['trash:edited by hand']);
    expect(await readFile(planFile('same'), 'utf8')).toBe('new text');
  });

  it('does not write when the Trash move fails and the old file stays', async () => {
    await plan('same');
    const result = await savePlanFile(project, 'same', 'new text', true, {
      trash: () => Promise.reject(new Error('trash is full')),
    });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('trash is full') });
    expect(await readFile(planFile('same'), 'utf8')).toBe('plan text\n');
  });

  it('writes a new file when replace is true but nothing exists', async () => {
    const result = await plan('fresh', true);
    expect(result.ok).toBe(true);
    expect(trashed).toEqual([]);
  });

  it('refuses a symlinked docs folder before creating anything', async () => {
    await symlink(outside, path.join(project, 'docs'));
    const made: string[] = [];
    const result = await plan('x', false, { mkdir: async (folder) => { made.push(folder); await mkdir(folder); } });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('docs') });
    expect(made).toEqual([]);
    expect(await readdir(outside)).toEqual([]);
  });

  it('refuses a symlinked docs/plans folder before creating anything', async () => {
    await mkdir(path.join(project, 'docs'));
    await symlink(outside, path.join(project, 'docs', 'plans'));
    const made: string[] = [];
    const result = await plan('x', false, { mkdir: async (folder) => { made.push(folder); await mkdir(folder); } });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('plans') });
    expect(made).toEqual([]);
    expect(await readdir(outside)).toEqual([]);
  });

  it('refuses a docs that is a file', async () => {
    await writeFile(path.join(project, 'docs'), 'not a folder');
    const result = await plan('x');
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('not a folder') });
  });

  it('refuses a symlinked target file even when replace is confirmed, and writes nothing through it', async () => {
    await mkdir(path.join(project, 'docs', 'plans'), { recursive: true });
    const victim = path.join(outside, 'victim.md');
    await writeFile(victim, 'keep');
    await symlink(victim, planFile('link'));
    for (const replace of [false, true]) {
      const result = await plan('link', replace);
      expect(result).toMatchObject({ ok: false, error: expect.stringContaining('symbolic link') });
    }
    expect(await readFile(victim, 'utf8')).toBe('keep');
    expect((await lstat(planFile('link'))).isSymbolicLink()).toBe(true);
    expect(trashed).toEqual([]);
  });

  it('refuses a target that is a folder', async () => {
    await mkdir(planFile('folder'), { recursive: true });
    const result = await plan('folder', true);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('not a file') });
    expect(trashed).toEqual([]);
  });

  it('refuses when the real path of the parent is not under the real path of the project', async () => {
    const result = await plan('x', false, { realpath: async (file) => (file === project ? file : path.join(outside, 'plans')) });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('outside') });
    await expect(lstat(planFile('x'))).rejects.toThrow();
  });

  it('refuses a planted temp symlink and writes nothing through it', async () => {
    await mkdir(path.join(project, 'docs', 'plans'), { recursive: true });
    const victim = path.join(outside, 'victim.txt');
    await writeFile(victim, 'keep');
    await symlink(victim, `${planFile('temp')}.${process.pid}.fixed.tmp`);
    const result = await plan('temp', false, { suffix: () => 'fixed' });
    expect(result.ok).toBe(false);
    expect(await readFile(victim, 'utf8')).toBe('keep');
    await expect(lstat(planFile('temp'))).rejects.toThrow();
  });

  it('reports a failing mkdir as a refusal', async () => {
    await writeFile(path.join(dir, 'blocker'), 'x');
    const result = await savePlanFile(path.join(dir, 'blocker'), 'x', 'text', false, deps());
    expect(result.ok).toBe(false);
  });

  it('leaves no temp file behind after a write', async () => {
    await plan('clean');
    expect((await readdir(path.join(project, 'docs', 'plans'))).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});
