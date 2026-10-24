// room-projects.test.ts
import { access, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { moveToFolder, readRecord, writeRecord } from '../../src/main/room-archive';
import { createRoomDrivers, type RoomDrivers } from '../../src/main/room-drivers';
import { RoomService } from '../../src/main/room-service';
import { ProjectService, type ProjectGit } from '../../src/main/projects/service';
import type { RoomModels } from '../../src/shared/cli-models';
import { denyReadRules } from '../../src/shared/deny-list';
import type { ProjectView } from '../../src/shared/projects';
import type { RoomConfig, RoomEvent, RoomListItem, RoomParticipant, RoomRecord } from '../../src/shared/room-model';
import { openStore } from '../unit/helpers/app-state';

const STUB = path.resolve(__dirname, '..', 'fixtures', 'stub-cli.mjs');
const CLAUDE: RoomParticipant = { id: 'claude', kind: 'claude', label: 'Claude Code' };
const CODEX: RoomParticipant = { id: 'codex', kind: 'codex', label: 'Codex' };
const DEEPSEEK: RoomParticipant = { id: 'deepseek', kind: 'deepseek', label: 'DeepSeek' };
const NO_MODELS: RoomModels = { claude: { models: [], efforts: [] }, codex: { models: [] } };

interface StubCall {
  argv: string[];
  cwd: string;
  stdin: string;
  gitOptionalLocks: string;
}

interface Stack {
  rooms: RoomService;
  projects: ProjectService;
  drivers: RoomDrivers;
  seen: RoomEvent[];
}

let dir: string;
let userData: string;
let work: string;
let log: string;
let picks: (string | null)[];
let stacks: Stack[];
let stubEnv: Record<string, string>;
let seatCalls: Array<[string, string | null]>;

const git: ProjectGit = {
  available: () => Promise.resolve({ ok: true, output: 'git version 0' }),
  init: () => Promise.resolve({ ok: true, output: '' }),
};

async function stack(): Promise<Stack> {
  const store = await openStore(userData);
  const projects = new ProjectService({
    store,
    userData,
    git,
    pickFolder: () => Promise.resolve(picks.shift() ?? null),
    trash: moveToFolder(path.join(dir, 'trash')),
  });
  const drivers = createRoomDrivers({
    sharedDir: path.join(userData, 'shared'),
    platform: 'win32',
    envFor: () => ({
      PATH: process.env.PATH,
      AIAW_CLAUDE_BIN: STUB,
      AIAW_CODEX_BIN: STUB,
      AIAW_USER_DATA: path.join(dir, 'user-data'),
      CLAUDE_CONFIG_DIR: path.join(dir, 'claude-config'),
      CODEX_HOME: path.join(dir, 'codex-home'),
      AIAW_STUB_ARGV_LOG: log,
      ...stubEnv,
    }),
    siteFor: (participant, projectId) => {
      seatCalls.push([participant.id, projectId]);
      return null;
    },
    timing: { killGraceMs: 200 },
  });
  const seen: RoomEvent[] = [];
  const rooms = new RoomService({
    roomsDir: path.join(userData, 'shared', 'rooms'),
    userData,
    projects,
    trash: moveToFolder(path.join(dir, 'trash')),
    driverFor: drivers.factory,
    terminal: drivers.terminal,
    emit: (event) => seen.push(event),
    paste: () => true,
    copy: () => undefined,
    models: async () => NO_MODELS,
  });
  await rooms.init();
  const built = { rooms, projects, drivers, seen };
  stacks.push(built);
  return built;
}

async function addProject(app: Stack, name: string): Promise<ProjectView> {
  const folder = path.join(work, name);
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, 'README.md'), `${name}\n`);
  picks.push(folder);
  const result = await app.projects.addExisting();
  if (!result.ok) throw new Error(result.error);
  return result.project;
}

function config(overrides: Partial<RoomConfig> = {}): RoomConfig {
  return { prompt: 'the question', mode: 'relay', rounds: 1, participants: [CLAUDE], turnTimeoutMs: 10000, finalizerId: CLAUDE.id, debugSites: false, ...overrides };
}

async function run(app: Stack, projectId: string | null, overrides: Partial<RoomConfig> = {}): Promise<string> {
  expect(await app.rooms.newRoom(projectId)).toBe(true);
  const before = app.seen.filter((event) => event.type === 'finished').length;
  const started = await app.rooms.start(config(overrides));
  if (!started.ok) throw new Error(started.error);
  await vi.waitFor(() => expect(app.seen.filter((event) => event.type === 'finished')).toHaveLength(before + 1), { timeout: 15000 });
  return started.roomId;
}

async function calls(): Promise<StubCall[]> {
  const text = await readFile(log, 'utf8').catch(() => '');
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as StubCall);
}

const flagValue = (call: StubCall | undefined, flag: string): string | undefined => call?.argv[(call?.argv.indexOf(flag) ?? -2) + 1];

async function snapshotOf(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    const info = await stat(file);
    out.push(`${entry.name}:${entry.isDirectory() ? 'dir' : 'file'}:${info.size}:${info.mtimeMs}`);
    if (entry.isDirectory()) out.push(...(await snapshotOf(file)).map((line) => `${entry.name}/${line}`));
  }
  return out.sort();
}

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

function listed(items: RoomListItem[], projectId: string | null): string[] {
  return items.filter((item) => item.projectId === projectId).map((item) => item.id);
}

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'aiaw-room-projects-')));
  userData = path.join(dir, 'userData');
  work = path.join(dir, 'work');
  log = path.join(dir, 'calls.log');
  await mkdir(userData);
  await mkdir(work);
  picks = [];
  stacks = [];
  stubEnv = {};
  seatCalls = [];
});

afterEach(async () => {
  for (const app of stacks) {
    await app.rooms.shutdown();
    app.drivers.shutdown();
  }
  await rm(dir, { recursive: true, force: true });
});

describe('rooms of two projects in one app run', () => {
  it('runs the CLI participant of each room in its own project folder with a fresh session', async () => {
    const app = await stack();
    const first = await addProject(app, 'first');
    const second = await addProject(app, 'second');
    await run(app, first.id);
    await run(app, second.id);
    const all = await calls();
    expect(all).toHaveLength(4);
    expect(all.map((call) => call.cwd)).toEqual([first.folder, first.folder, second.folder, second.folder]);
    expect(flagValue(all[2], '--session-id')).toBeDefined();
    expect(all[2]?.argv).not.toContain('--resume');
    expect(flagValue(all[2], '--session-id')).not.toBe(flagValue(all[0], '--session-id'));
  });

  it('keeps the records of each room in the rooms folder of its project and lists them under it', async () => {
    const app = await stack();
    const first = await addProject(app, 'first');
    const second = await addProject(app, 'second');
    const inFirst = await run(app, first.id);
    const inSecond = await run(app, second.id);
    const loose = await run(app, null);
    expect(await readdir(path.join(userData, 'projects', first.id, 'rooms'))).toContain(`${inFirst}.json`);
    expect(await readdir(path.join(userData, 'projects', second.id, 'rooms'))).toContain(`${inSecond}.json`);
    expect(await readdir(path.join(userData, 'shared', 'rooms'))).toContain(`${loose}.json`);
    const items = await app.rooms.list();
    expect(listed(items, first.id)).toEqual([inFirst]);
    expect(listed(items, second.id)).toEqual([inSecond]);
    expect(listed(items, null)).toEqual([loose]);
  });

  it('asks for the site seat of the project of the room and of no project for a room outside one', async () => {
    const app = await stack();
    const first = await addProject(app, 'first');
    const second = await addProject(app, 'second');
    const site = { participants: [DEEPSEEK], finalizerId: DEEPSEEK.id };
    await run(app, first.id, site);
    await run(app, second.id, site);
    await run(app, null, site);
    expect(seatCalls.every(([id]) => id === 'deepseek')).toBe(true);
    expect([...new Set(seatCalls.map(([, projectId]) => projectId))]).toEqual([first.id, second.id, null]);
  });

  it('refuses to open a room of another project while a room runs and names the running room', async () => {
    const app = await stack();
    const first = await addProject(app, 'first');
    const second = await addProject(app, 'second');
    const other = await run(app, second.id);
    stubEnv['AIAW_STUB_HANG'] = '1';
    expect(app.rooms.newRoom(first.id)).toBe(true);
    const finishedBefore = app.seen.filter((event) => event.type === 'finished').length;
    const started = await app.rooms.start(config({ prompt: 'hang question one' }));
    if (!started.ok) throw new Error(started.error);
    await vi.waitFor(async () => expect((await app.rooms.list()).find((item) => item.id === started.roomId)).toBeDefined());
    const before = app.rooms.state();
    const refused = await app.rooms.open(other);
    expect(refused.ok).toBe(false);
    expect(refused.ok ? '' : refused.error).toContain('hang question one');
    expect(app.rooms.state()).toBe(before);
    app.rooms.stop();
    await vi.waitFor(() => expect(app.seen.filter((event) => event.type === 'finished')).toHaveLength(finishedBefore + 1), { timeout: 15000 });
    expect((await app.rooms.open(other)).ok).toBe(true);
  });

  it('opens the running room itself and returns its live snapshot, while another room stays refused', async () => {
    const app = await stack();
    const first = await addProject(app, 'first');
    const other = await run(app, first.id);
    stubEnv['AIAW_STUB_HANG'] = '1';
    expect(app.rooms.newRoom(first.id)).toBe(true);
    const finishedBefore = app.seen.filter((event) => event.type === 'finished').length;
    const started = await app.rooms.start(config({ prompt: 'hang question one' }));
    if (!started.ok) throw new Error(started.error);
    await vi.waitFor(async () => expect((await app.rooms.list()).find((item) => item.id === started.roomId)).toBeDefined());
    const before = app.rooms.state();
    const again = await app.rooms.open(started.roomId);
    expect(again.ok).toBe(true);
    expect(again.ok ? again.snapshot : null).toBe(before);
    expect(app.rooms.state()).toBe(before);
    expect((await app.rooms.open(other)).ok).toBe(false);
    expect(app.rooms.state()).toBe(before);
    app.rooms.stop();
    await vi.waitFor(() => expect(app.seen.filter((event) => event.type === 'finished')).toHaveLength(finishedBefore + 1), { timeout: 15000 });
  });

  it('runs a room outside any project in its own subfolder of the rooms folder, as before', async () => {
    const app = await stack();
    await run(app, null);
    const all = await calls();
    expect(all.map((call) => call.cwd)).toEqual([path.join(userData, 'shared', 'rooms', 'claude-1'), path.join(userData, 'shared', 'rooms', 'claude-1')]);
  });

  it('writes nothing into the project folder during a project room run', async () => {
    const app = await stack();
    const project = await addProject(app, 'quiet');
    const before = await snapshotOf(project.folder);
    await run(app, project.id, { rounds: 2 });
    expect(await snapshotOf(project.folder)).toEqual(before);
  });
});

describe('after an app restart', () => {
  it('lists a project room under its project, opens it with its feed and continues it in the project folder', async () => {
    const app = await stack();
    const project = await addProject(app, 'kept');
    const inProject = await run(app, project.id);
    const loose = await run(app, null);
    await app.rooms.shutdown();
    app.drivers.shutdown();
    await writeFile(log, '');

    const again = await stack();
    const items = await again.rooms.list();
    expect(listed(items, project.id)).toEqual([inProject]);
    expect(listed(items, null)).toEqual([loose]);
    const opened = await again.rooms.open(inProject);
    if (!opened.ok) throw new Error(opened.error);
    expect(opened.snapshot.projectId).toBe(project.id);
    expect(opened.snapshot.entries.map((entry) => entry.kind)).toEqual(['prompt', 'reply', 'final']);
    const started = await again.rooms.start(config(), inProject);
    if (!started.ok) throw new Error(started.error);
    expect(started.roomId).toBe(inProject);
    await vi.waitFor(() => expect(again.seen.some((event) => event.type === 'finished')).toBe(true), { timeout: 15000 });
    const all = await calls();
    expect(all.length).toBeGreaterThan(0);
    expect(all.map((call) => call.cwd)).toEqual(all.map(() => project.folder));
    expect((await again.rooms.list()).filter((item) => item.id === inProject)).toHaveLength(1);
  });

  it('opens the latest room of any project at start and marks interrupted runs of every folder as stopped', async () => {
    const app = await stack();
    const project = await addProject(app, 'late');
    const loose = await run(app, null);
    const inProject = await run(app, project.id);
    await app.rooms.shutdown();
    app.drivers.shutdown();
    const record = (await readRecord(path.join(userData, 'projects', project.id, 'rooms'), inProject)) as RoomRecord;
    await writeRecord(path.join(userData, 'projects', project.id, 'rooms'), { ...record, status: 'running', updatedAt: record.updatedAt + 1000 });
    const other = (await readRecord(path.join(userData, 'shared', 'rooms'), loose)) as RoomRecord;
    await writeRecord(path.join(userData, 'shared', 'rooms'), { ...other, status: 'running' });

    const again = await stack();
    expect(again.rooms.state().roomId).toBe(inProject);
    expect(again.rooms.state().projectId).toBe(project.id);
    const items = await again.rooms.list();
    expect(items.map((item) => (item.unreadable ? 'unreadable' : item.status))).toEqual(['stopped', 'stopped']);
  });
});

describe('a room of a missing project', () => {
  it('is refused at start, creates nothing and does not bring the folder back', async () => {
    const app = await stack();
    const project = await addProject(app, 'gone');
    await run(app, project.id);
    expect(await app.rooms.newRoom(project.id)).toBe(true);
    await rm(project.folder, { recursive: true });
    await writeFile(log, '');
    const before = await snapshotOf(userData);
    const started = await app.rooms.start(config());
    expect(started.ok).toBe(false);
    if (!started.ok) expect(started.error).toContain(project.folder);
    expect(await exists(project.folder)).toBe(false);
    expect(await snapshotOf(userData)).toEqual(before);
    expect(await calls()).toEqual([]);
    expect(app.rooms.isRunning()).toBe(false);
  });

  it('is refused when the project is gone from the index, and a new room there is refused too', async () => {
    const app = await stack();
    const project = await addProject(app, 'deleted');
    expect(await app.rooms.newRoom(project.id)).toBe(true);
    expect((await app.projects.delete(project.id)).ok).toBe(true);
    const started = await app.rooms.start(config());
    expect(started.ok).toBe(false);
    expect(await app.rooms.newRoom(project.id)).toBe(false);
    expect(await app.rooms.newRoom('no-such-project')).toBe(false);
  });
});

describe('rooms of a project through the id-only channels', () => {
  it('renames and deletes a project room in its own folder and drops it from the list', async () => {
    const app = await stack();
    const project = await addProject(app, 'tidy');
    const id = await run(app, project.id);
    expect(await app.rooms.rename(id, 'Named')).toBe(true);
    const named = (await app.rooms.list()).find((item) => item.id === id);
    expect(named && !named.unreadable ? named.title : null).toBe('Named');
    expect(await app.rooms.delete(id)).toBe(true);
    expect(await app.rooms.list()).toEqual([]);
    expect(await exists(path.join(userData, 'projects', project.id, 'rooms', `${id}.json`))).toBe(false);
    expect(app.rooms.state().roomId).toBeNull();
  });

  it('forgets the open room of a project that is deleted and does not list its rooms any more', async () => {
    const app = await stack();
    const project = await addProject(app, 'short-lived');
    const id = await run(app, project.id);
    expect(app.rooms.state().roomId).toBe(id);
    app.projects.register({ canClose: () => null, closeProject: (closed) => app.rooms.closeProject(closed) });
    expect((await app.projects.delete(project.id)).ok).toBe(true);
    expect(app.rooms.state().roomId).toBeNull();
    expect(await app.rooms.list()).toEqual([]);
    expect((await app.rooms.open(id)).ok).toBe(false);
  });

  it('refuses to open or rename a room that no folder knows', async () => {
    const app = await stack();
    expect((await app.rooms.open('room-unknown')).ok).toBe(false);
    expect(await app.rooms.rename('room-unknown', 'x')).toBe(false);
  });
});

async function entriesOf(root: string, relative = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const rel = path.join(relative, entry.name);
    const info = await lstat(path.join(root, rel), { bigint: true });
    const type = info.isSymbolicLink() ? 'link' : info.isDirectory() ? 'dir' : 'file';
    out.push(`${rel}|${type}|${info.size}|${info.mtimeNs}`);
    if (type === 'dir') out.push(...(await entriesOf(root, rel)));
  }
  return out.sort();
}

async function plantRepository(folder: string): Promise<void> {
  await mkdir(path.join(folder, '.git', 'objects'), { recursive: true });
  await writeFile(path.join(folder, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  await writeFile(path.join(folder, '.git', 'config'), '[core]\n\tbare = false\n');
  await writeFile(path.join(folder, '.git', 'index'), 'DIRC');
  await mkdir(path.join(folder, '.claude'), { recursive: true });
  await writeFile(path.join(folder, '.claude', 'settings.json'), '{"hooks":{}}\n');
  await writeFile(path.join(folder, '.env'), 'CANARY=1\n');
  await mkdir(path.join(folder, 'src'), { recursive: true });
  await writeFile(path.join(folder, 'src', 'index.ts'), 'export {};\n');
  await symlink(path.join(folder, 'src'), path.join(folder, 'linked'));
}

describe('a project room turn', () => {
  const both = { participants: [CLAUDE, CODEX], rounds: 2 };

  it('runs every CLI participant with its isolation profile in the project folder', async () => {
    const app = await stack();
    const project = await addProject(app, 'profiled');
    await run(app, project.id, both);
    const all = await calls();
    const claude = all.filter((call) => call.argv.includes('-p'));
    const codex = all.filter((call) => call.argv[0] === 'exec');
    expect(claude.length).toBeGreaterThan(0);
    expect(codex.length).toBeGreaterThan(0);
    expect(all.map((call) => call.cwd)).toEqual(all.map(() => project.folder));
    for (const call of claude) {
      expect(call.argv).toContain('--restricted');
      expect(call.argv).toContain('--strict-mcp-config');
      expect(flagValue(call, '--tools')).toBe('Read,Grep,Glob');
      expect(flagValue(call, '--permission-mode')).toBe('plan');
      expect(flagValue(call, '-n')).toBeDefined();
      expect(call.argv).not.toContain('--add-dir');
      expect(call.argv.join(' ')).not.toMatch(/Web(Search|Fetch)/);
      expect(JSON.parse(flagValue(call, '--settings') ?? 'null')).toEqual({ permissions: { deny: denyReadRules() } });
    }
    for (const call of codex) {
      expect(call.argv).toContain('--ignore-user-config');
      expect(call.argv).toContain('web_search="disabled"');
      expect(call.argv).toContain('features.plugins=false');
      expect(flagValue(call, '--sandbox')).toBe('read-only');
      expect(call.argv).not.toContain('-n');
    }
    for (const call of all) expect(call.argv.join(' ')).not.toMatch(/dangerously|bypassPermissions|--yolo/);
  });

  it('names the Claude session after the room and tells the participants they only discuss', async () => {
    const app = await stack();
    const project = await addProject(app, 'named');
    const id = await run(app, project.id);
    expect(await app.rooms.rename(id, 'Plan the API')).toBe(true);
    await writeFile(log, '');
    const again = await app.rooms.start(config(), id);
    if (!again.ok) throw new Error(again.error);
    await vi.waitFor(() => expect(app.seen.filter((event) => event.type === 'finished')).toHaveLength(2), { timeout: 15000 });
    const all = await calls();
    expect(all.length).toBeGreaterThan(0);
    for (const call of all) {
      expect(flagValue(call, '-n')).toBe('Plan the API');
      expect(call.stdin).toMatch(/never execute the project's plans/i);
    }
  });

  it('gives every room turn GIT_OPTIONAL_LOCKS=0, project or not', async () => {
    const app = await stack();
    const project = await addProject(app, 'locks');
    await run(app, project.id, both);
    await run(app, null, both);
    const all = await calls();
    expect(all.length).toBeGreaterThanOrEqual(4);
    expect(all.map((call) => call.gitOptionalLocks)).toEqual(all.map(() => '0'));
  });

  it('keeps the profile of a room outside any project: shared directory, web tools, no isolation flags', async () => {
    const app = await stack();
    await run(app, null, both);
    const all = await calls();
    const shared = path.join(userData, 'shared');
    for (const call of all.filter((one) => one.argv.includes('-p'))) {
      expect(flagValue(call, '--tools')).toBe('Read,Grep,Glob,WebSearch,WebFetch');
      expect(flagValue(call, '--add-dir')).toBe(shared);
      expect(call.argv).not.toContain('--restricted');
      expect(call.argv).not.toContain('--settings');
      expect(call.argv).not.toContain('-n');
    }
    for (const call of all.filter((one) => one.argv[0] === 'exec')) {
      expect(call.argv).toContain('web_search="live"');
      expect(call.argv).not.toContain('--ignore-user-config');
    }
  });

  it('leaves every entry of the project folder, .git and .claude included, as it was', async () => {
    const app = await stack();
    const project = await addProject(app, 'untouched');
    await plantRepository(project.folder);
    const before = await entriesOf(project.folder);
    expect(before.some((line) => line.startsWith(path.join('.git', 'HEAD')))).toBe(true);
    expect(before.some((line) => line.startsWith(path.join('.claude', 'settings.json')))).toBe(true);
    expect(before.some((line) => line.startsWith('linked|link|'))).toBe(true);
    await run(app, project.id, { participants: [CLAUDE, CODEX], rounds: 2 });
    expect((await calls()).length).toBeGreaterThanOrEqual(4);
    expect(await entriesOf(project.folder)).toEqual(before);
    expect(await exists(path.join(project.folder, 'history.md'))).toBe(false);
  });
});
