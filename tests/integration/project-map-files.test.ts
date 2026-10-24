// project-map-files.test.ts
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultGitPaths, GitRunner } from '../../src/main/projects/git';
import { collectProjectMap } from '../../src/main/projects/map-files';
import { DEFAULT_MAP_LIMITS } from '../../src/shared/project-map';

let base: string;
let outside: string;

beforeEach(async () => {
  base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'aiaw-map-files-')));
  outside = path.join(base, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'secret-readme.md'), 'OUTSIDE-CANARY readme', 'utf8');
  await mkdir(path.join(outside, 'dir'));
  await writeFile(path.join(outside, 'dir', 'inner.txt'), 'OUTSIDE-CANARY inner', 'utf8');
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

const gitPaths = defaultGitPaths(process.platform);
const env = { PATH: process.env['PATH'], HOME: undefined as string | undefined };

function runner(overrides: Partial<ConstructorParameters<typeof GitRunner>[0]> = {}): GitRunner {
  return new GitRunner({ platform: process.platform, ...gitPaths, hooksDir: path.join(base, 'empty-hooks'), env: { ...env, HOME: base }, ...overrides });
}

function git(cwd: string, ...args: string[]): void {
  execFileSync(gitPaths.gitBinary, ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, env: { PATH: process.env['PATH'], HOME: base }, stdio: 'ignore' });
}

async function project(name: string, files: Record<string, string>): Promise<string> {
  const folder = path.join(base, name);
  await mkdir(folder, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(folder, rel)), { recursive: true });
    await writeFile(path.join(folder, rel), content, 'utf8');
  }
  return folder;
}

describe('a repository with secrets, symlinks and an oversized document', () => {
  it('lists only allowed paths that stay inside the project and reads only documents inside the cap', async () => {
    const folder = await project('repo', {
      '.env': 'ENV-CANARY=1',
      '.gitignore': '*.log\n',
      'src/app.ts': 'export {};',
      'with space.txt': 'x',
      'CLAUDE.md': 'CLAUDE-BODY',
      'AGENTS.md': 'A'.repeat(5000),
      'ignored.log': 'noise',
    });
    await symlink(path.join(outside, 'secret-readme.md'), path.join(folder, 'README.md'));
    await symlink(path.join(outside, 'secret-readme.md'), path.join(folder, 'escape.txt'));
    await symlink(path.join(outside, 'dir'), path.join(folder, 'dirlink'));
    await symlink(path.join(folder, '.env'), path.join(folder, 'link-to-env.txt'));
    git(folder, 'init', '-q');
    git(folder, 'add', 'src/app.ts', '.env', 'README.md');
    const map = await collectProjectMap(folder, runner(), { limits: { ...DEFAULT_MAP_LIMITS, maxDocumentBytes: 1000 } });
    expect(map.via).toBe('git');
    expect(map.documents).toEqual(['CLAUDE.md']);
    expect(map.omitted).toEqual(['AGENTS.md']);
    for (const wanted of ['src/app.ts', 'with space.txt', '.gitignore', 'CLAUDE.md', 'CLAUDE-BODY']) expect(map.text).toContain(wanted);
    for (const absent of ['ENV-CANARY', '.env', 'OUTSIDE-CANARY', 'escape.txt', 'dirlink', 'link-to-env', 'ignored.log', 'A'.repeat(100), 'README.md']) {
      expect(map.text).not.toContain(absent);
    }
  });

  it('folds the listing when the path count passes the cap', async () => {
    const files: Record<string, string> = { 'top.txt': 'x' };
    for (let n = 0; n < 60; n += 1) files[`lib/f${n}.ts`] = 'x';
    const folder = await project('many', files);
    git(folder, 'init', '-q');
    const map = await collectProjectMap(folder, runner(), { limits: { ...DEFAULT_MAP_LIMITS, maxPaths: 5 } });
    expect(map.listed).toBe(61);
    expect(map.folded).toBe(true);
    expect(map.shown).toBeLessThanOrEqual(5);
    expect(map.text).toContain('lib/');
    expect(map.text).not.toContain('f10.ts');
  });

  it('lists a folder inside a larger repository relative to the folder, without the rest of the repository', async () => {
    const outer = await project('outer', { 'top.txt': 'x', 'proj/inner.ts': 'x', 'proj/README.md': 'INNER-README' });
    git(outer, 'init', '-q');
    git(outer, 'add', 'top.txt', 'proj/inner.ts');
    const map = await collectProjectMap(path.join(outer, 'proj'), runner());
    expect(map.via).toBe('git');
    expect(map.text.split('\n')).toEqual(expect.arrayContaining(['README.md', 'inner.ts']));
    expect(map.text).not.toContain('top.txt');
    expect(map.text).not.toContain('proj/');
    expect(map.text).toContain('INNER-README');
  });

  it('follows the folder through a symlink to its real path', async () => {
    const folder = await project('real', { 'a.ts': 'x' });
    git(folder, 'init', '-q');
    const alias = path.join(base, 'alias');
    await symlink(folder, alias);
    expect((await collectProjectMap(alias, runner())).text).toContain('a.ts');
  });

  it('drops a tracked file that is gone, and a tracked file whose folder became a symlink out of the project', async () => {
    const folder = await project('moved', { 'keep.ts': 'x', 'gone.ts': 'x', 'a/b.txt': 'x' });
    git(folder, 'init', '-q');
    git(folder, 'add', '.');
    await rm(path.join(folder, 'gone.ts'));
    await rm(path.join(folder, 'a'), { recursive: true });
    await mkdir(path.join(outside, 'a'));
    await writeFile(path.join(outside, 'a', 'b.txt'), 'OUTSIDE-CANARY moved', 'utf8');
    await symlink(path.join(outside, 'a'), path.join(folder, 'a'));
    const map = await collectProjectMap(folder, runner());
    expect(map.via).toBe('git');
    expect(map.listed).toBe(1);
    expect(map.text).toContain('keep.ts');
    expect(map.text).not.toContain('gone.ts');
    expect(map.text).not.toContain('b.txt');
  });

  it('drops a document that is a symlink to a denied file inside the project, a binary one and an unreadable one', async () => {
    const folder = await project('docs', { '.env': 'ENV-CANARY=1', 'src/a.ts': 'x', 'AGENTS.md': 'AGENTS\u0000BINARY' });
    await symlink(path.join(folder, '.env'), path.join(folder, 'README.md'));
    await writeFile(path.join(folder, 'CLAUDE.md'), 'CLAUDE-SECRET-BODY', 'utf8');
    await chmod(path.join(folder, 'CLAUDE.md'), 0o000);
    git(folder, 'init', '-q');
    try {
      const map = await collectProjectMap(folder, runner());
      expect(map.documents).toEqual([]);
      expect(map.omitted).toEqual(['CLAUDE.md', 'AGENTS.md']);
      for (const absent of ['ENV-CANARY', 'README.md', 'CLAUDE-SECRET-BODY', 'BINARY']) expect(map.text).not.toContain(absent);
    } finally {
      await chmod(path.join(folder, 'CLAUDE.md'), 0o644);
    }
  });

  it('rejects a folder that does not exist', async () => {
    await expect(collectProjectMap(path.join(base, 'nowhere'), runner())).rejects.toThrow();
  });
});

describe('a folder that is not a repository, or no git at all', () => {
  async function walkFixture(): Promise<string> {
    const folder = await project('plain', {
      '.git/config': 'not a repository',
      '.gitignore': '*.log\nbuild/\n/dist\n',
      '.env': 'ENV-CANARY=1',
      'secrets/token.txt': 'SECRET-CANARY',
      'node_modules/pkg/index.js': 'x',
      'build/out.js': 'x',
      'dist/out.js': 'x',
      'trace.log': 'x',
      'sub/deep/file.ts': 'x',
      'sub/build/keep.ts': 'x',
      'CLAUDE.md': 'CLAUDE-BODY',
      'sub/.git': 'gitdir: elsewhere',
    });
    await symlink(path.join(outside, 'secret-readme.md'), path.join(folder, 'README.md'));
    await symlink(path.join(outside, 'dir'), path.join(folder, 'dirlink'));
    await symlink(path.join(folder, 'sub'), path.join(folder, 'innerlink'));
    return folder;
  }

  it('walks the directory with the fixed skip list, the deny list and the top-level .gitignore', async () => {
    const folder = await walkFixture();
    const map = await collectProjectMap(folder, runner());
    expect(map.via).toBe('walk');
    expect(map.incomplete).toBe(false);
    expect(map.fallbackReason).toContain('Git failed');
    expect(map.text.split('\n')).toEqual(expect.arrayContaining(['.gitignore', 'CLAUDE.md', 'sub/deep/file.ts']));
    expect(map.documents).toEqual(['CLAUDE.md']);
    for (const absent of ['ENV-CANARY', 'SECRET-CANARY', 'node_modules', 'build/out', 'dist', 'trace.log', 'OUTSIDE-CANARY', 'README.md', 'dirlink', 'inner.txt', 'innerlink', 'config', 'sub/.git']) {
      expect(map.text).not.toContain(absent);
    }
  });

  it('applies no .gitignore when the file is a symlink out of the project or is not text', async () => {
    const folder = await project('odd', { 'trace.log': 'x', 'a.ts': 'x' });
    await symlink(path.join(outside, 'secret-readme.md'), path.join(folder, '.gitignore'));
    expect((await collectProjectMap(folder, runner({ gitBinary: path.join(base, 'absent') }))).text).toContain('trace.log');
    await rm(path.join(folder, '.gitignore'));
    await writeFile(path.join(folder, '.gitignore'), '*.log\u0000\n', 'utf8');
    expect((await collectProjectMap(folder, runner({ gitBinary: path.join(base, 'absent') }))).text).toContain('trace.log');
  });

  it('applies no .gitignore that is over its size cap', async () => {
    const folder = await project('huge-ignore', { 'trace.log': 'x', 'a.ts': 'x', '.gitignore': `*.log\n${'#'.repeat(70 * 1024)}\n` });
    expect((await collectProjectMap(folder, runner({ gitBinary: path.join(base, 'absent'), platform: 'linux' }))).text).toContain('trace.log');
  });

  it('walks when git is not installed, and says why', async () => {
    const folder = await project('nogit', { 'a.ts': 'x' });
    const map = await collectProjectMap(folder, runner({ gitBinary: path.join(base, 'absent'), platform: 'linux' }));
    expect(map.via).toBe('walk');
    expect(map.fallbackReason).toContain('absent');
    expect(map.text).toContain('a.ts');
  });

  it('stops the walk at the entry limit and says the listing is incomplete', async () => {
    const files: Record<string, string> = {};
    for (let n = 0; n < 10; n += 1) files[`f${n}.txt`] = 'x';
    const folder = await project('big', files);
    const map = await collectProjectMap(folder, runner({ gitBinary: path.join(base, 'absent'), platform: 'linux' }), { walkEntryLimit: 3 });
    expect(map.incomplete).toBe(true);
    expect(map.listed).toBeLessThanOrEqual(3);
  });

  it('skips a folder it cannot read', async () => {
    const folder = await project('locked', { 'ok.ts': 'x', 'closed/inside.ts': 'x' });
    await chmod(path.join(folder, 'closed'), 0o000);
    try {
      const map = await collectProjectMap(folder, runner({ gitBinary: path.join(base, 'absent'), platform: 'linux' }));
      expect(map.text).toContain('ok.ts');
      expect(map.text).not.toContain('inside.ts');
    } finally {
      await chmod(path.join(folder, 'closed'), 0o755);
    }
  });
});
