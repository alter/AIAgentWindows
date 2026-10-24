// project-service.test.ts
import { access, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultGitPaths, GitRunner } from '../../src/main/projects/git';
import { ProjectService, storageFolder, type ProjectClosable, type ProjectGit, type ProjectsDeps } from '../../src/main/projects/service';
import { moveToFolder } from '../../src/main/room-archive';
import { StateRefusedError, STATE_FILE_NAME } from '../../src/main/store/app-state';
import type { Project, ProjectResult } from '../../src/shared/projects';
import { openStore } from '../unit/helpers/app-state';

let dir: string;
let userData: string;
let work: string;
let picks: (string | null)[];
let git: ProjectGit & { inits: string[] };
let gitFailure: string | null;
let initFailure: string | null;
let service: ProjectService;
let trashed: string[];

async function listing(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    out.push(entry.name);
    if (entry.isDirectory()) out.push(...(await listing(path.join(root, entry.name))).map((name) => `${entry.name}/${name}`));
  }
  return out.sort();
}

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

async function folder(name: string, inside: string = work): Promise<string> {
  const target = path.join(inside, name);
  await mkdir(target, { recursive: true });
  return realpath(target);
}

function build(overrides: Partial<ProjectsDeps> = {}): Promise<ProjectService> {
  return openStore(userData).then((store) => {
    return new ProjectService({
      store,
      userData,
      git,
      pickFolder: () => Promise.resolve(picks.shift() ?? null),
      trash: (file) => moveToFolder(path.join(dir, 'trash'))(file).then(() => void trashed.push(file)),
      ...overrides,
    });
  });
}

function projectOf(result: ProjectResult): Project & { missing: boolean } {
  if (!result.ok) throw new Error(`expected a project: ${result.error}`);
  return { ...result.project, createdAt: 0 };
}

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'aiaw-projects-')));
  userData = path.join(dir, 'userData');
  work = path.join(dir, 'work');
  await mkdir(userData);
  await mkdir(work);
  picks = [];
  trashed = [];
  gitFailure = null;
  initFailure = null;
  const inits: string[] = [];
  git = {
    inits,
    available: () => Promise.resolve(gitFailure === null ? { ok: true, output: 'git version 0' } : { ok: false, error: gitFailure }),
    init: (target) => {
      inits.push(target);
      return Promise.resolve(initFailure === null ? { ok: true, output: '' } : { ok: false, error: initFailure });
    },
  };
  service = await build();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('an existing folder becomes a project', () => {
  it('stores the realpath of the folder, names it after the folder and creates its storage folder', async () => {
    const real = await folder('app');
    const alias = path.join(dir, 'alias');
    await symlink(real, alias);
    picks.push(alias);
    const project = projectOf(await service.addExisting());
    expect(project).toMatchObject({ name: 'app', folder: real, missing: false });
    expect(await service.list()).toEqual([{ id: project.id, name: 'app', folder: real, missing: false }]);
    expect((await stat(path.join(userData, 'projects', project.id))).isDirectory()).toBe(true);
    const onDisk = JSON.parse(await readFile(path.join(userData, STATE_FILE_NAME), 'utf8')) as { projects: Project[] };
    expect(onDisk.projects.map((item) => item.folder)).toEqual([real]);
  });

  it('refuses the same realpath twice, also through a symlink, and keeps one project', async () => {
    const real = await folder('app');
    const alias = path.join(dir, 'alias');
    await symlink(real, alias);
    picks.push(real, alias, `${real}/../app`);
    expect((await service.addExisting()).ok).toBe(true);
    expect((await service.addExisting()).ok).toBe(false);
    expect((await service.addExisting()).ok).toBe(false);
    expect(await service.list()).toHaveLength(1);
    expect(await readdir(path.join(userData, 'projects'))).toHaveLength(1);
  });

  it('refuses two additions of one folder that run at once', async () => {
    const real = await folder('app');
    picks.push(real, real);
    const results = await Promise.all([service.addExisting(), service.addExisting()]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await service.list()).toHaveLength(1);
  });

  it('allows a project inside another project folder', async () => {
    const outer = await folder('outer');
    const inner = await folder('inner', outer);
    picks.push(outer, inner);
    expect((await service.addExisting()).ok).toBe(true);
    expect((await service.addExisting()).ok).toBe(true);
    expect((await service.list()).map((item) => item.folder)).toEqual([outer, inner]);
  });

  it('refuses a folder inside the application data folder, the data folder itself and a file', async () => {
    const inside = await folder('sub', userData);
    const file = path.join(work, 'file.txt');
    await writeFile(file, 'x', 'utf8');
    picks.push(inside, userData, file, path.join(work, 'missing'));
    for (let attempt = 0; attempt < 4; attempt += 1) expect((await service.addExisting()).ok).toBe(false);
    expect(await service.list()).toEqual([]);
  });

  it('reports a cancelled picker as cancelled', async () => {
    const result = await service.addExisting();
    expect(result).toMatchObject({ ok: false, cancelled: true });
  });

  it('refuses while the state file is fail-closed and leaves it byte-identical', async () => {
    const broken = '{"version":2,"agents":[';
    await writeFile(path.join(userData, STATE_FILE_NAME), broken, 'utf8');
    const closed = await build();
    picks.push(await folder('app'));
    const result = await closed.addExisting();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(STATE_FILE_NAME);
    expect(await readFile(path.join(userData, STATE_FILE_NAME), 'utf8')).toBe(broken);
  });

  it('cuts a folder name longer than the title limit to 80 characters', async () => {
    const odd = await folder('x'.repeat(120));
    picks.push(odd);
    expect(projectOf(await service.addExisting()).name).toBe('x'.repeat(80));
  });
});

describe('a new project', () => {
  async function pick(parent: string): Promise<string> {
    picks.push(parent);
    const picked = await service.pickParent();
    if (!picked.ok) throw new Error('picker cancelled');
    return picked.token;
  }

  it('creates <parent>/<name> with .git through the real git runner', async () => {
    const real = new GitRunner({
      platform: process.platform,
      ...defaultGitPaths(process.platform),
      hooksDir: path.join(userData, 'git-empty-hooks'),
      env: process.env,
    });
    const withGit = await build({ git: real });
    picks.push(work);
    const picked = await withGit.pickParent();
    if (!picked.ok) throw new Error('cancelled');
    expect(picked.parentName).toBe('work');
    const project = projectOf(await withGit.create(picked.token, 'fresh'));
    expect(project.folder).toBe(path.join(work, 'fresh'));
    expect((await stat(path.join(work, 'fresh', '.git'))).isDirectory()).toBe(true);
    expect(await readdir(path.join(userData, 'git-empty-hooks'))).toEqual([]);
  });

  it('resolves a symlinked parent and stores the realpath', async () => {
    const alias = path.join(dir, 'parent-alias');
    await symlink(work, alias);
    const token = await pick(alias);
    expect(projectOf(await service.create(token, 'fresh')).folder).toBe(path.join(work, 'fresh'));
    expect(git.inits).toEqual([path.join(work, 'fresh')]);
  });

  it('refuses ../x, a/b and an existing name and creates no folder', async () => {
    await mkdir(path.join(work, 'taken'));
    await writeFile(path.join(work, 'taken', 'keep.txt'), 'x', 'utf8');
    const before = await listing(dir);
    for (const name of ['../x', 'a/b', '..', '.', '', ' lead', 'trail ', 'a\\b', 'a\u0000b']) {
      const token = await pick(work);
      expect((await service.create(token, name)).ok).toBe(false);
    }
    const token = await pick(work);
    const existing = await service.create(token, 'taken');
    expect(existing.ok).toBe(false);
    expect(await listing(dir)).toEqual(before);
    expect(await listing(path.join(dir, 'x')).catch(() => 'absent')).toBe('absent');
    expect(git.inits).toEqual([]);
    expect(await service.list()).toEqual([]);
  });

  it('keeps the token after a refused name and spends it on the first real attempt', async () => {
    const token = await pick(work);
    expect((await service.create(token, '../x')).ok).toBe(false);
    expect((await service.create(token, 'fine')).ok).toBe(true);
    expect((await service.create(token, 'again')).ok).toBe(false);
    expect(await exists(path.join(work, 'again'))).toBe(false);
  });

  it('spends the token on an existing name too', async () => {
    await mkdir(path.join(work, 'taken'));
    const token = await pick(work);
    expect((await service.create(token, 'taken')).ok).toBe(false);
    expect((await service.create(token, 'other')).ok).toBe(false);
    expect(await exists(path.join(work, 'other'))).toBe(false);
  });

  it('accepts only the newest token and rejects a made-up one', async () => {
    const first = await pick(work);
    const second = await pick(work);
    expect((await service.create(first, 'a')).ok).toBe(false);
    expect((await service.create('not-a-token', 'a')).ok).toBe(false);
    expect((await service.create(second, 'a')).ok).toBe(true);
    expect(await service.pickParent()).toEqual({ ok: false });
  });

  it('creates nothing when git is missing and says why', async () => {
    gitFailure = 'git is not installed';
    const before = await listing(work);
    const token = await pick(work);
    const result = await service.create(token, 'fresh');
    expect(result).toEqual({ ok: false, error: 'git is not installed' });
    expect(await listing(work)).toEqual(before);
  });

  it('keeps the created folder, names it and adds no project when git init fails', async () => {
    initFailure = 'init exploded';
    const token = await pick(work);
    const result = await service.create(token, 'fresh');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('init exploded');
    expect(await exists(path.join(work, 'fresh'))).toBe(true);
    expect(await service.list()).toEqual([]);
  });

  it('refuses a parent that is gone or is a file, and a parent inside the data folder', async () => {
    const gone = path.join(dir, 'gone');
    await mkdir(gone);
    const goneToken = await pick(gone);
    await rm(gone, { recursive: true });
    expect((await service.create(goneToken, 'a')).ok).toBe(false);
    const file = path.join(work, 'f');
    await writeFile(file, 'x', 'utf8');
    expect((await service.create(await pick(file), 'a')).ok).toBe(false);
    const before = await listing(userData);
    expect((await service.create(await pick(userData), 'a')).ok).toBe(false);
    expect(await listing(userData)).toEqual(before);
  });

  it('refuses while the state file is fail-closed, before it creates anything', async () => {
    await writeFile(path.join(userData, STATE_FILE_NAME), '[]x', 'utf8');
    const closed = await build();
    picks.push(work);
    const picked = await closed.pickParent();
    if (!picked.ok) throw new Error('cancelled');
    expect((await closed.create(picked.token, 'fresh')).ok).toBe(false);
    expect(await exists(path.join(work, 'fresh'))).toBe(false);
  });

  it('reports a failing mkdir that is not "exists"', async () => {
    const real = path.join(work, 'readonly');
    await mkdir(real, { mode: 0o500 });
    const token = await pick(real);
    const result = await service.create(token, 'fresh');
    expect(result.ok).toBe(false);
    expect(await exists(path.join(real, 'fresh'))).toBe(false);
  });
});

describe('persistence', () => {
  it('finds the projects after a restart and keeps them through writes of other slices', async () => {
    const real = await folder('app');
    picks.push(real);
    const project = projectOf(await service.addExisting());
    const store = await openStore(userData);
    await store.update('theme', () => 'dark');
    await store.update('agents', () => []);
    const restarted = await build();
    expect(await restarted.list()).toEqual([{ id: project.id, name: 'app', folder: real, missing: false }]);
    expect((await openStore(userData)).read().theme).toBe('dark');
  });
});

describe('rename', () => {
  it('renames the project and never touches its folder', async () => {
    const real = await folder('app');
    picks.push(real);
    const project = projectOf(await service.addExisting());
    const before = await listing(dir);
    expect(await service.rename(project.id, '  New name ')).toEqual({ ok: true });
    expect((await service.list())[0]?.name).toBe('New name');
    expect(await listing(dir)).toEqual(before);
    expect(await exists(real)).toBe(true);
  });

  it('refuses a bad name and an unknown project', async () => {
    picks.push(await folder('app'));
    const project = projectOf(await service.addExisting());
    expect((await service.rename(project.id, '')).ok).toBe(false);
    expect((await service.rename(project.id, 'a\nb')).ok).toBe(false);
    expect((await service.rename('nope', 'x')).ok).toBe(false);
    expect((await service.list())[0]?.name).toBe('app');
  });

  it('reports a refused write', async () => {
    const state = { version: 2 as const, agents: [], projects: [{ id: 'p1', name: 'one', folder: work, createdAt: 1 }] };
    const refusing = await build({
      store: { read: () => state, failure: () => null, update: () => Promise.reject(new StateRefusedError('state.json is refused')) },
    });
    expect(await refusing.rename('p1', 'two')).toEqual({ ok: false, error: 'state.json is refused' });
  });
});

describe('delete', () => {
  async function made(name = 'app'): Promise<{ id: string; code: string }> {
    const code = await folder(name);
    await writeFile(path.join(code, 'main.ts'), 'code', 'utf8');
    await mkdir(path.join(code, '.git'));
    await writeFile(path.join(code, '.git', 'HEAD'), 'ref', 'utf8');
    picks.push(code);
    return { id: projectOf(await service.addExisting()).id, code };
  }

  it('removes the project from the index, trashes its storage folder and leaves the code folder as it was', async () => {
    const { id, code } = await made();
    const storage = path.join(userData, 'projects', id);
    await writeFile(path.join(storage, 'note.txt'), 'x', 'utf8');
    const before = await listing(code);
    const mtime = (await stat(code)).mtimeMs;
    expect(await service.delete(id)).toEqual({ ok: true });
    expect(await service.list()).toEqual([]);
    expect(await exists(storage)).toBe(false);
    expect(trashed).toEqual([storage]);
    expect(await readdir(path.join(dir, 'trash'))).toHaveLength(1);
    expect(await listing(code)).toEqual(before);
    expect((await stat(code)).mtimeMs).toBe(mtime);
    const onDisk = JSON.parse(await readFile(path.join(userData, STATE_FILE_NAME), 'utf8')) as { projects?: Project[] };
    expect(onDisk.projects).toEqual([]);
  });

  it('asks every canClose before any closeProject and refuses on a veto', async () => {
    const { id } = await made();
    const order: string[] = [];
    const first: ProjectClosable = { canClose: () => (order.push('first-can'), null), closeProject: () => void order.push('first-close') };
    const second: ProjectClosable = { canClose: () => (order.push('second-can'), 'a room run is in progress'), closeProject: () => void order.push('second-close') };
    service.register(first);
    service.register(second);
    expect(await service.delete(id)).toEqual({ ok: false, error: 'a room run is in progress' });
    expect(order).toEqual(['first-can', 'second-can']);
    expect(await service.list()).toHaveLength(1);
    expect(await exists(path.join(userData, 'projects', id))).toBe(true);
    expect(trashed).toEqual([]);
  });

  it('closes every service with the project id once nothing vetoes', async () => {
    const { id } = await made();
    const order: string[] = [];
    service.register({ canClose: () => (order.push('a-can'), null), closeProject: (target) => void order.push(`a-close:${target}`) });
    service.register({ canClose: () => (order.push('b-can'), null), closeProject: async (target) => void order.push(`b-close:${target}`) });
    expect((await service.delete(id)).ok).toBe(true);
    expect(order).toEqual(['a-can', 'b-can', `a-close:${id}`, `b-close:${id}`]);
  });

  it('keeps the project when a close fails', async () => {
    const { id } = await made();
    service.register({ canClose: () => null, closeProject: () => Promise.reject(new Error('pty would not die')) });
    expect(await service.delete(id)).toEqual({ ok: false, error: 'pty would not die' });
    expect(await service.list()).toHaveLength(1);
  });

  it('refuses an unknown project and a fail-closed store', async () => {
    expect((await service.delete('nope')).ok).toBe(false);
    const state = { version: 2 as const, agents: [], projects: [{ id: 'p1', name: 'one', folder: work, createdAt: 1 }] };
    const closed = await build({ store: { read: () => state, failure: () => 'state.json is unreadable', update: () => Promise.resolve() } });
    expect(await closed.delete('p1')).toEqual({ ok: false, error: 'state.json is unreadable' });
  });

  it('reports a failing Trash as a warning after the project left the index', async () => {
    const { id } = await made();
    const failing = await build({ trash: () => Promise.reject(new Error('no trash here')) });
    const result = await failing.delete(id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warning).toContain('no trash here');
    expect(await failing.list()).toEqual([]);
  });

  it('succeeds without a warning when the storage folder or the projects folder is already gone', async () => {
    const one = await made('one');
    await rm(path.join(userData, 'projects', one.id), { recursive: true });
    expect(await service.delete(one.id)).toEqual({ ok: true });
    const two = await made('two');
    await rm(path.join(userData, 'projects'), { recursive: true });
    expect(await service.delete(two.id)).toEqual({ ok: true });
    expect(trashed).toEqual([]);
  });

  it('reports a warning when the projects folder cannot be looked into', async () => {
    const { id } = await made();
    await rm(path.join(userData, 'projects'), { recursive: true });
    await writeFile(path.join(userData, 'projects'), 'not a folder', 'utf8');
    const result = await service.delete(id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warning).toBeDefined();
    expect(await service.list()).toEqual([]);
    expect(trashed).toEqual([]);
  });

  it('trashes only a direct child of the real projects folder', () => {
    const root = path.join(dir, 'root');
    expect(storageFolder(root, 'abc-1')).toBe(path.join(root, 'abc-1'));
    for (const id of ['..', '../x', 'a/b', '', '.', '/abs', 'x'.repeat(65)]) expect(() => storageFolder(root, id)).toThrow();
  });

  it('trashes through a symlinked projects folder by its real path', async () => {
    const { id } = await made();
    const moved = path.join(dir, 'elsewhere');
    await rename(path.join(userData, 'projects'), moved);
    await symlink(moved, path.join(userData, 'projects'));
    expect((await service.delete(id)).ok).toBe(true);
    expect(trashed).toEqual([path.join(moved, id)]);
  });
});

describe('a project whose folder is gone', () => {
  it('is listed as missing, refuses lookups and is never recreated', async () => {
    const real = await folder('app');
    picks.push(real);
    const project = projectOf(await service.addExisting());
    expect(await service.folderOf(project.id)).toEqual({ ok: true, folder: real });
    await rm(real, { recursive: true });
    expect((await service.list())[0]?.missing).toBe(true);
    const lookup = await service.folderOf(project.id);
    expect(lookup.ok).toBe(false);
    expect(await exists(real)).toBe(false);
  });

  it('is missing when the folder path now leads somewhere else or is a file', async () => {
    const real = await folder('app');
    picks.push(real);
    const project = projectOf(await service.addExisting());
    const other = await folder('other');
    await rm(real, { recursive: true });
    await symlink(other, real);
    expect((await service.folderOf(project.id)).ok).toBe(false);
    expect((await service.list())[0]?.missing).toBe(true);
    await rm(real);
    await writeFile(real, 'x', 'utf8');
    expect((await service.folderOf(project.id)).ok).toBe(false);
  });

  it('reports an unknown id', async () => {
    expect((await service.folderOf('nope')).ok).toBe(false);
  });
});

describe('injected ids and time', () => {
  it('uses the generators it is given', async () => {
    const seeded = await build({ newId: () => 'fixed-id', now: () => 42, newToken: () => '00000000-0000-4000-8000-000000000000' });
    picks.push(await folder('app'));
    expect(projectOf(await seeded.addExisting()).id).toBe('fixed-id');
    const state = JSON.parse(await readFile(path.join(userData, STATE_FILE_NAME), 'utf8')) as { projects: Project[] };
    expect(state.projects[0]?.createdAt).toBe(42);
    picks.push(work);
    expect(await seeded.pickParent()).toEqual({ ok: true, token: '00000000-0000-4000-8000-000000000000', parentName: 'work' });
  });

  it('does not call git for an existing folder', async () => {
    const spy = vi.spyOn(git, 'available');
    picks.push(await folder('app'));
    await service.addExisting();
    expect(spy).not.toHaveBeenCalled();
  });
});
