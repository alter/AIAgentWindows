// git-runner.test.ts
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultGitPaths, GitRunner, type ExecFn, type GitConfig } from '../../src/main/projects/git';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'aiaw-git-runner-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function stub(name: string, body: string): Promise<string> {
  const file = path.join(dir, name);
  await writeFile(file, `#!/bin/sh\n${body}\n`, 'utf8');
  await chmod(file, 0o755);
  return file;
}

async function lines(file: string): Promise<string[]> {
  return (await readFile(file, 'utf8').catch(() => '')).split('\n').filter((line) => line.length > 0);
}

function config(overrides: Partial<GitConfig>): GitConfig {
  return {
    platform: 'linux',
    gitBinary: path.join(dir, 'git'),
    xcodeSelectBinary: path.join(dir, 'xcode-select'),
    hooksDir: path.join(dir, 'empty-hooks'),
    env: { PATH: process.env['PATH'] },
    ...overrides,
  };
}

describe('hardening of every git call', () => {
  const recorded: { file: string; args: string[]; env: NodeJS.ProcessEnv; cwd?: string }[] = [];
  const exec: ExecFn = (file, args, options) => {
    recorded.push({ file, args, env: options.env, cwd: options.cwd });
    return Promise.resolve({ stdout: file.endsWith('xcode-select') ? `${dir}\n` : 'git version 9\n', stderr: '' });
  };

  beforeEach(async () => {
    recorded.length = 0;
    await mkdir(path.join(dir, 'usr', 'bin'), { recursive: true });
    await writeFile(path.join(dir, 'usr', 'bin', 'git'), '', 'utf8');
  });

  it('passes the hooks directory, the fsmonitor override and the two environment variables to every call, the version check and init included', async () => {
    const hooksDir = path.join(dir, 'empty-hooks');
    const runner = new GitRunner(config({ platform: 'darwin', exec, hooksDir, env: { PATH: '/bin', GIT_TERMINAL_PROMPT: '1', GIT_OPTIONAL_LOCKS: '1' } }));
    expect(await runner.available()).toEqual({ ok: true, output: 'git version 9' });
    expect(await runner.init('/some/folder')).toEqual({ ok: true, output: 'git version 9' });
    const gitCalls = recorded.filter((call) => !call.file.endsWith('xcode-select'));
    expect(gitCalls.map((call) => call.args.at(-1))).toEqual(['--version', 'init']);
    for (const call of gitCalls) {
      expect(call.args.slice(0, 4)).toEqual(['-c', `core.hooksPath=${hooksDir}`, '-c', 'core.fsmonitor=false']);
    }
    for (const call of recorded) {
      expect(call.env['GIT_TERMINAL_PROMPT']).toBe('0');
      expect(call.env['GIT_OPTIONAL_LOCKS']).toBe('0');
      expect(call.env['PATH']).toBe('/bin');
    }
    expect(recorded.find((call) => call.args.at(-1) === 'init')?.cwd).toBe('/some/folder');
    expect(await readdir(hooksDir)).toEqual([]);
  });

  it('runs the gate command on darwin only', async () => {
    await new GitRunner(config({ platform: 'darwin', exec })).available();
    expect(recorded[0]?.args).toEqual(['-p']);
    recorded.length = 0;
    await new GitRunner(config({ platform: 'linux', exec })).available();
    await new GitRunner(config({ platform: 'win32', exec })).available();
    expect(recorded.every((call) => !call.file.endsWith('xcode-select'))).toBe(true);
    expect(recorded).toHaveLength(2);
  });

  it('keeps the module to one execFile call and one child_process import', async () => {
    const source = await readFile(path.resolve(__dirname, '..', '..', 'src', 'main', 'projects', 'git.ts'), 'utf8');
    expect(source.match(/\bexecFile\w*\s*\(/g)).toHaveLength(1);
    expect(source.match(/from 'node:child_process'/g)).toHaveLength(1);
    expect(source).toMatch(/import \{ execFile \} from 'node:child_process'/);
    expect(source.match(/core\.hooksPath=/g)).toHaveLength(1);
    expect(source.match(/core\.fsmonitor=false/g)).toHaveLength(1);
    expect(source.match(/GIT_TERMINAL_PROMPT/g)).toHaveLength(1);
    expect(source.match(/GIT_OPTIONAL_LOCKS/g)).toHaveLength(1);
  });

  it('turns a failure that is not an exec failure into a readable error', async () => {
    const throwing: ExecFn = () => Promise.reject(new Error('boom'));
    const outcome = await new GitRunner(config({ exec: throwing })).available();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain('boom');
    const rejecting: ExecFn = () => Promise.reject('plain text');
    const text = await new GitRunner(config({ exec: rejecting })).available();
    expect(text.ok).toBe(false);
    if (!text.ok) expect(text.error).toContain('plain text');
  });
});

describe('default paths', () => {
  it('uses the system binaries on darwin and the PATH lookup elsewhere', () => {
    expect(defaultGitPaths('darwin')).toEqual({ gitBinary: '/usr/bin/git', xcodeSelectBinary: '/usr/bin/xcode-select' });
    expect(defaultGitPaths('linux').gitBinary).toBe('git');
    expect(defaultGitPaths('win32').gitBinary).toBe('git');
  });
});

describe('with stub binaries', () => {
  it('on darwin never runs git when xcode-select fails, prints nothing or names a folder without git', async () => {
    const marker = path.join(dir, 'git-ran');
    await stub('git', `echo ran >> ${marker}`);
    const bare = path.join(dir, 'bare');
    await mkdir(bare);
    const cases = ['exit 1', 'true', `echo ${bare}`];
    for (const body of cases) {
      await stub('xcode-select', body);
      const outcome = await new GitRunner(config({ platform: 'darwin' })).available();
      expect(outcome.ok).toBe(false);
    }
    const missingTool = await new GitRunner(config({ platform: 'darwin', xcodeSelectBinary: path.join(dir, 'nowhere') })).available();
    expect(missingTool.ok).toBe(false);
    expect(await lines(marker)).toEqual([]);
  });

  it('on darwin runs git once the tools folder holds a git binary', async () => {
    const tools = path.join(dir, 'tools');
    await mkdir(path.join(tools, 'usr', 'bin'), { recursive: true });
    await writeFile(path.join(tools, 'usr', 'bin', 'git'), '', 'utf8');
    await stub('xcode-select', `echo ${tools}`);
    await stub('git', 'echo "git version 1.2.3"');
    expect(await new GitRunner(config({ platform: 'darwin' })).available()).toEqual({ ok: true, output: 'git version 1.2.3' });
  });

  it('reports a missing git readably on the other platforms, with no gate command', async () => {
    const marker = path.join(dir, 'gate-ran');
    await stub('xcode-select', `echo ran >> ${marker}`);
    for (const platform of ['linux', 'win32']) {
      const outcome = await new GitRunner(config({ platform, gitBinary: path.join(dir, 'no-such-git') })).available();
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error).toContain('no-such-git');
    }
    expect(await lines(marker)).toEqual([]);
  });

  it('shows the first words of git stderr, or the exit message when stderr is empty', async () => {
    await stub('git', 'echo "fatal: detected dubious ownership in repository" >&2; exit 128');
    const refused = await new GitRunner(config({})).available();
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toContain('detected dubious ownership');
    await stub('git', 'exit 3');
    const silent = await new GitRunner(config({})).available();
    expect(silent.ok).toBe(false);
    if (!silent.ok) expect(silent.error.length).toBeGreaterThan(0);
    await stub('git', `printf 'x%.0s' $(seq 1 500) >&2; exit 1`);
    const long = await new GitRunner(config({})).available();
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.error).toContain('xxx');
    if (!long.ok) expect(long.error).not.toContain('x'.repeat(301));
  });

  it('checks the version once per runner, remembers success and checks again after a failure', async () => {
    const log = path.join(dir, 'calls');
    await stub('git', `echo "$*" >> ${log}; echo "git version 2"`);
    const runner = new GitRunner(config({}));
    await runner.available();
    await runner.available();
    await runner.init(dir);
    expect((await lines(log)).filter((line) => line.endsWith('--version'))).toHaveLength(1);
    const failing = new GitRunner(config({ gitBinary: path.join(dir, 'later') }));
    expect((await failing.available()).ok).toBe(false);
    await stub('later', 'echo "git version 3"');
    expect(await failing.available()).toEqual({ ok: true, output: 'git version 3' });
  });

  it('runs init inside the folder with the hardened argv and environment', async () => {
    const log = path.join(dir, 'init-log');
    const folder = path.join(dir, 'new-project');
    await mkdir(folder);
    await stub('git', `case "$*" in *--version) echo "git version 2";; *) { echo "$*"; pwd -P; env | grep '^GIT_' | sort; } > ${log};; esac`);
    expect((await new GitRunner(config({})).init(folder)).ok).toBe(true);
    const written = await lines(log);
    expect(written[0]).toBe(`-c core.hooksPath=${path.join(dir, 'empty-hooks')} -c core.fsmonitor=false init`);
    expect(written[1]).toBe(await realpath(folder));
    expect(written).toContain('GIT_OPTIONAL_LOCKS=0');
    expect(written).toContain('GIT_TERMINAL_PROMPT=0');
  });

  it('does not run init when git is unavailable', async () => {
    const outcome = await new GitRunner(config({ gitBinary: path.join(dir, 'absent') })).init(dir);
    expect(outcome.ok).toBe(false);
  });
});

describe('listing files', () => {
  const recorded: { args: string[]; cwd?: string; maxBuffer?: number; env: NodeJS.ProcessEnv }[] = [];
  const answer = (stdout: string): ExecFn => (file, args, options) => {
    recorded.push({ args, cwd: options.cwd, maxBuffer: options.maxBuffer, env: options.env });
    return Promise.resolve({ stdout: file.endsWith('xcode-select') ? `${dir}\n` : stdout, stderr: '' });
  };

  beforeEach(() => {
    recorded.length = 0;
  });

  it('asks for tracked and untracked unignored files below the folder, NUL separated, through the hardened runner', async () => {
    const hooksDir = path.join(dir, 'empty-hooks');
    const runner = new GitRunner(config({ exec: answer('a.ts\0'), hooksDir }));
    expect(await runner.listFiles('/proj')).toEqual({ ok: true, paths: ['a.ts'] });
    const call = recorded.find((entry) => entry.args.includes('ls-files'));
    expect(call?.args).toEqual([
      '-c',
      `core.hooksPath=${hooksDir}`,
      '-c',
      'core.fsmonitor=false',
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
      '--',
      '.',
    ]);
    expect(call?.cwd).toBe('/proj');
    expect(call?.maxBuffer).toBeGreaterThan(1024 * 1024);
    expect(call?.env['GIT_OPTIONAL_LOCKS']).toBe('0');
    expect(call?.env['GIT_TERMINAL_PROMPT']).toBe('0');
  });

  it('keeps names as they are, drops empty entries and repeats', async () => {
    const runner = new GitRunner(config({ exec: answer(' lead\0b c\0\0b c\0trail \n\0') }));
    expect(await runner.listFiles('/proj')).toEqual({ ok: true, paths: [' lead', 'b c', 'trail \n'] });
  });

  it('reports an empty listing as no paths', async () => {
    expect(await new GitRunner(config({ exec: answer('') })).listFiles('/proj')).toEqual({ ok: true, paths: [] });
  });

  it('passes on the refusal of a missing git and of a failed listing', async () => {
    const missing = await new GitRunner(config({ gitBinary: path.join(dir, 'absent') })).listFiles(dir);
    expect(missing.ok).toBe(false);
    await stub('git', `case "$*" in *--version) echo "git version 2";; *) echo "fatal: not a git repository" >&2; exit 128;; esac`);
    const failed = await new GitRunner(config({})).listFiles(dir);
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error).toContain('not a git repository');
  });
});

describe('a repository whose .git/config is hostile', () => {
  const git = defaultGitPaths(process.platform);
  const realGit = (cwd: string, args: string[]): string =>
    execFileSync(git.gitBinary, ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8', env: { PATH: process.env['PATH'], HOME: dir } });

  it('never runs the core.fsmonitor command of the repository while listing files', async () => {
    const repo = path.join(dir, 'hostile');
    await mkdir(repo);
    realGit(repo, ['init', '-q']);
    await writeFile(path.join(repo, 'tracked.txt'), 'one\n', 'utf8');
    realGit(repo, ['add', 'tracked.txt']);
    await writeFile(path.join(repo, 'untracked.txt'), 'two\n', 'utf8');
    const marker = path.join(dir, 'fsmonitor-ran');
    const hook = path.join(dir, 'fsmonitor-hook.sh');
    await writeFile(hook, `#!/bin/sh\necho "$@" >> ${marker}\n`, 'utf8');
    await chmod(hook, 0o755);
    const config = path.join(repo, '.git', 'config');
    await writeFile(config, `${await readFile(config, 'utf8')}[core]\n\tfsmonitor = ${hook}\n`, 'utf8');

    const control = realGit(repo, ['ls-files', '--cached', '--others', '--exclude-standard']);
    expect(control.split('\n').filter((line) => line !== '').sort()).toEqual(['tracked.txt', 'untracked.txt']);
    expect(await lines(marker)).not.toEqual([]);
    await rm(marker, { force: true });

    const runner = new GitRunner({ platform: process.platform, ...git, hooksDir: path.join(dir, 'empty-hooks'), env: { PATH: process.env['PATH'], HOME: dir } });
    const listed = await runner.listFiles(repo);
    expect(listed).toEqual({ ok: true, paths: expect.arrayContaining(['tracked.txt', 'untracked.txt']) });
    expect(await lines(marker)).toEqual([]);
  });
});
