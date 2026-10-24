// room-map.test.ts
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenRouterClient } from '../../src/main/openrouter/client';
import { KeyStore } from '../../src/main/openrouter/key-store';
import { OpenRouterService } from '../../src/main/openrouter/service';
import { testSecretBox } from '../../src/main/openrouter/test-mode';
import { ProjectService, type ProjectGit } from '../../src/main/projects/service';
import type { FileLister } from '../../src/main/projects/map-files';
import { moveToFolder, readRecord } from '../../src/main/room-archive';
import { createRoomDrivers, type RoomDrivers } from '../../src/main/room-drivers';
import { RoomService } from '../../src/main/room-service';
import { createSelectorAdapter } from '../../src/main/site-adapters/selector-adapter';
import { SiteAdapterError, type PageRunner } from '../../src/main/site-adapters/types';
import type { RoomModels } from '../../src/shared/cli-models';
import type { ProjectView } from '../../src/shared/projects';
import type { RoomConfig, RoomEntry, RoomEvent, RoomParticipant } from '../../src/shared/room-model';
import {
  CEILING_MODEL,
  NO_ENDPOINTS_MODEL,
  SMALL_CONTEXT_MODEL,
  fakeModelsWithLimits,
  startFakeOpenRouter,
  type ChatCall,
  type FakeOpenRouter,
} from '../fixtures/openrouter-fake';
import { openStore } from '../unit/helpers/app-state';

const STUB = path.resolve(__dirname, '..', 'fixtures', 'stub-cli.mjs');
const FIXTURE = readFileSync(path.resolve(__dirname, '..', 'fixtures', 'sites', 'generic.html'), 'utf8');
const NO_MODELS: RoomModels = { claude: { models: [], efforts: [] }, codex: { models: [] } };

const CLAUDE: RoomParticipant = { id: 'claude', kind: 'claude', label: 'Claude Code' };
const CHATGPT: RoomParticipant = { id: 'chatgpt', kind: 'chatgpt', label: 'ChatGPT' };
const PAID: RoomParticipant = { id: 'openrouter', kind: 'openrouter', label: 'OpenRouter · Acme Paid', model: 'acme/paid-model', modelName: 'Acme Paid', web: false };
const SMALL: RoomParticipant = { id: 'openrouter', kind: 'openrouter', label: 'OpenRouter · Small Context', model: SMALL_CONTEXT_MODEL, modelName: 'Small Context', web: false };
const CEILING: RoomParticipant = { id: 'openrouter', kind: 'openrouter', label: 'OpenRouter · Reports a Ceiling', model: CEILING_MODEL, modelName: 'Reports a Ceiling', web: false };
const NO_ENDPOINTS: RoomParticipant = { id: 'openrouter', kind: 'openrouter', label: 'OpenRouter · No Endpoints', model: NO_ENDPOINTS_MODEL, modelName: 'No Endpoints', web: false };

const ENV_CANARY = 'canary-env-9f3a41';
const OUTSIDE_CANARY = 'canary-outside-77c1d2';
const NPM_CANARY = 'canary-npm-5be09a';
const PEM_CANARY = 'canary-pem-e1c4f7';
const CANARIES = [ENV_CANARY, OUTSIDE_CANARY, NPM_CANARY, PEM_CANARY];
const DENIED_NAMES = ['.env', 'key.pem', 'id_rsa', 'credentials.json', '.npmrc'];

let dir: string;
let userData: string;
let work: string;
let outside: string;
let log: string;
let fake: FakeOpenRouter;
let cipher: string | null;
let seatFiles: boolean;
let attachFailure: SiteAdapterError | null;
let listCalls: number;
let lister: FileLister;
let attached: string[][];
let picks: string[];
let stacks: Stack[];
let service: OpenRouterService;

interface Stack {
  rooms: RoomService;
  projects: ProjectService;
  drivers: RoomDrivers;
  seen: RoomEvent[];
}

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
  const dom = new JSDOM(FIXTURE, { runScripts: 'dangerously', url: 'https://fixture.test/' });
  const runner: PageRunner = {
    run: (code) => Promise.resolve(dom.window.eval(code)),
    setInputFiles: (_selector, files) => {
      attached.push(files);
      return Promise.resolve();
    },
  };
  const drivers = createRoomDrivers({
    sharedDir: path.join(userData, 'shared'),
    platform: 'win32',
    envFor: () => ({
      PATH: process.env.PATH,
      AIAW_CLAUDE_BIN: STUB,
      AIAW_CODEX_BIN: STUB,
      AIAW_STUB_ARGV_LOG: log,
      AIAW_USER_DATA: path.join(dir, 'user-data'),
      CLAUDE_CONFIG_DIR: path.join(dir, 'claude-config'),
    }),
    siteFor: () => {
      const adapter = createSelectorAdapter('fixture', { input: '#ta', submit: '#send', stop: '#stop', replies: '.msg.assistant', ...(seatFiles ? { fileInput: '#file' } : {}) });
      const failure = attachFailure;
      return { adapter: failure === null ? adapter : { ...adapter, attachFile: () => Promise.reject(failure) }, runner };
    },
    openrouter: service,
    timing: { pollMs: 20, settleMs: 40, killGraceMs: 200 },
  });
  const seen: RoomEvent[] = [];
  const rooms = new RoomService({
    roomsDir: path.join(userData, 'shared', 'rooms'),
    userData,
    projects,
    git: { listFiles: (folder) => lister.listFiles(folder) },
    trash: moveToFolder(path.join(dir, 'trash')),
    driverFor: drivers.factory,
    terminal: drivers.terminal,
    emit: (event) => seen.push(event),
    paste: () => true,
    copy: () => undefined,
    models: async () => NO_MODELS,
    openrouter: service,
  });
  await rooms.init();
  const built = { rooms, projects, drivers, seen };
  stacks.push(built);
  return built;
}

async function addProject(app: Stack, folder: string): Promise<ProjectView> {
  picks.push(folder);
  const result = await app.projects.addExisting();
  if (!result.ok) throw new Error(result.error);
  return result.project;
}

async function seedProject(): Promise<string> {
  const folder = path.join(work, 'demo');
  await mkdir(path.join(folder, 'src'), { recursive: true });
  await mkdir(path.join(folder, 'config'), { recursive: true });
  await writeFile(path.join(outside, 'secret.txt'), `${OUTSIDE_CANARY}\n`);
  await symlink(path.join(outside, 'secret.txt'), path.join(folder, 'README.md'));
  await writeFile(path.join(folder, 'CLAUDE.md'), '# Demo\nThe demo project builds widgets.\n');
  await writeFile(path.join(folder, '.env'), `API_KEY=${ENV_CANARY}\n`);
  await writeFile(path.join(folder, '.npmrc'), `//registry.npmjs.org/:_authToken=${NPM_CANARY}\n`);
  await writeFile(path.join(folder, 'key.pem'), `-----BEGIN PRIVATE KEY-----\n${PEM_CANARY}\n`);
  await writeFile(path.join(folder, 'id_rsa'), PEM_CANARY);
  await writeFile(path.join(folder, 'config', 'credentials.json'), `{"token":"${ENV_CANARY}"}`);
  await writeFile(path.join(folder, 'src', 'app.ts'), 'export const widget = 1;\n');
  await writeFile(path.join(folder, 'src', 'util.ts'), 'export const util = 2;\n');
  return realpath(folder);
}

function config(participants: RoomParticipant[], overrides: Partial<RoomConfig> = {}): RoomConfig {
  return { prompt: 'the question', mode: 'relay', rounds: 1, participants, turnTimeoutMs: 20000, finalizerId: participants[0]?.id ?? 'claude', debugSites: false, ...overrides };
}

async function run(app: Stack, projectId: string | null, participants: RoomParticipant[], overrides: Partial<RoomConfig> = {}): Promise<{ id: string; entries: RoomEntry[] }> {
  expect(await app.rooms.newRoom(projectId)).toBe(true);
  const before = app.seen.filter((event) => event.type === 'finished').length;
  const started = await app.rooms.start(config(participants, overrides));
  if (!started.ok) throw new Error(started.error);
  await vi.waitFor(() => expect(app.seen.filter((event) => event.type === 'finished')).toHaveLength(before + 1), { timeout: 20000 });
  const record = await readRecord(recordsDir(app, projectId), started.roomId);
  return { id: started.roomId, entries: record?.entries ?? [] };
}

function recordsDir(app: Stack, projectId: string | null): string {
  void app;
  return projectId === null ? path.join(userData, 'shared', 'rooms') : path.join(userData, 'projects', projectId, 'rooms');
}

function messages(call: ChatCall): { system: string; user: string } {
  const found = (role: string): string => call.body?.messages?.find((message) => message.role === role)?.content ?? '';
  return { system: found('system'), user: found('user') };
}

async function packFiles(roomId: string, projectId: string): Promise<string[]> {
  const root = path.join(userData, 'projects', projectId, 'rooms', `${roomId}.packs`);
  const names = await readdir(root, { recursive: true }).catch(() => [] as string[]);
  const out: string[] = [];
  for (const name of names) {
    const text = await readFile(path.join(root, name), 'utf8').catch(() => null);
    if (text !== null) out.push(text);
  }
  return out;
}

async function stubInputs(): Promise<string[]> {
  const text = await readFile(log, 'utf8').catch(() => '');
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => (JSON.parse(line) as { stdin: string }).stdin);
}

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'aiaw-room-map-')));
  userData = path.join(dir, 'userData');
  work = path.join(dir, 'work');
  outside = path.join(dir, 'outside');
  log = path.join(dir, 'calls.log');
  await Promise.all([mkdir(userData), mkdir(work), mkdir(outside)]);
  picks = [];
  stacks = [];
  attached = [];
  cipher = null;
  seatFiles = true;
  attachFailure = null;
  listCalls = 0;
  lister = {
    listFiles: () => {
      listCalls += 1;
      return Promise.resolve({ ok: false as const, error: 'not a repository' });
    },
  };
  fake = await startFakeOpenRouter();
  fake.models = fakeModelsWithLimits();
  service = new OpenRouterService({
    client: new OpenRouterClient({ base: fake.base, timeoutMs: 2000 }),
    store: new KeyStore(testSecretBox(), {
      read: () => cipher,
      write: (value) => {
        cipher = value;
        return Promise.resolve();
      },
    }),
    base: fake.base,
    openExternal: () => Promise.resolve(),
    emit: () => undefined,
  });
  await service.paste(fake.key);
  projectFolder = await seedProject();
});

afterEach(async () => {
  for (const app of stacks) {
    await app.rooms.shutdown();
    app.drivers.shutdown();
  }
  service.shutdown();
  await fake.close();
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

let projectFolder: string;

describe('an OpenRouter participant in a project room', () => {
  it('gets the map in the system part, never a denied name, and asks for provider.data_collection deny', async () => {
    const app = await stack();
    const project = await addProject(app, projectFolder);
    const { entries } = await run(app, project.id, [PAID]);
    expect(entries.filter((entry) => entry.kind === 'reply' || entry.kind === 'final')).toHaveLength(2);
    const [call] = fake.chatCalls;
    const { system } = messages(call as ChatCall);
    expect(system).toContain('src/app.ts');
    expect(system).toContain('The demo project builds widgets.');
    for (const name of DENIED_NAMES) expect(system).not.toContain(name);
    expect(call?.body?.provider).toEqual({ data_collection: 'deny' });
    expect(call?.body).not.toHaveProperty('max_completion_tokens');
  });

  it('sends max_completion_tokens only for a model that reports a ceiling', async () => {
    const app = await stack();
    const project = await addProject(app, projectFolder);
    await run(app, project.id, [CEILING]);
    expect(fake.chatCalls[0]?.body?.max_completion_tokens).toBe(2048);
    expect(fake.chatCalls[0]?.body?.provider).toEqual({ data_collection: 'deny' });
  });

  it('fits a model with a 4000-token context on every turn and records the cut', async () => {
    fake.chat = () => ({ body: { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'x'.repeat(3000) } }] } });
    const app = await stack();
    const project = await addProject(app, projectFolder);
    const { entries } = await run(app, project.id, [SMALL], { rounds: 3, prompt: 'q'.repeat(1000) });
    expect(entries.filter((entry) => entry.kind !== 'prompt').every((entry) => entry.kind === 'reply' || entry.kind === 'final')).toBe(true);
    expect(fake.chatCalls.length).toBeGreaterThanOrEqual(4);
    for (const call of fake.chatCalls) {
      const { system, user } = messages(call);
      expect(system.length + user.length).toBeLessThanOrEqual((4000 - 1000) * 3);
      expect(user).toContain('q'.repeat(1000));
    }
    const cut = entries.map((entry) => entry.digest?.cut).filter((value) => value !== undefined);
    expect(cut.length).toBeGreaterThan(0);
    expect(cut.every((item) => item?.via === 'budget')).toBe(true);
    expect(fake.chatCalls.every((call) => call.body?.max_completion_tokens === undefined)).toBe(true);
  });

  it('shows a refusal for lack of endpoints as a readable turn error that names data_collection', async () => {
    const app = await stack();
    const project = await addProject(app, projectFolder);
    const { entries } = await run(app, project.id, [NO_ENDPOINTS]);
    const failed = entries.find((entry) => entry.kind === 'error');
    expect(failed?.text).toContain('data_collection');
  });
});

describe('a room without a project', () => {
  it('sends the request bodies of today: no provider, no max_completion_tokens, the intro alone as the system part', async () => {
    const app = await stack();
    const { entries } = await run(app, null, [CEILING]);
    expect(entries.some((entry) => entry.kind === 'reply' || entry.kind === 'final')).toBe(true);
    for (const call of fake.chatCalls) {
      expect(Object.keys(call.body ?? {}).sort()).toEqual(['messages', 'model', 'stream']);
      expect(messages(call).system).not.toContain('Project files');
    }
    expect(listCalls).toBe(0);
  });

  it('answers a no-endpoints model normally, since collection is not denied there', async () => {
    const app = await stack();
    const { entries } = await run(app, null, [NO_ENDPOINTS]);
    expect(entries.some((entry) => entry.kind === 'error')).toBe(false);
  });
});

describe('a web participant in a project room', () => {
  it('attaches one file with the map and the history and points the prompt at it', async () => {
    const app = await stack();
    const project = await addProject(app, projectFolder);
    const { id, entries } = await run(app, project.id, [CHATGPT]);
    expect(attached).toHaveLength(2);
    const files = await packFiles(id, project.id);
    expect(files).toHaveLength(2);
    for (const file of files) {
      expect(file).toContain('src/app.ts');
      expect(file).toContain('the question');
    }
    const reply = entries.find((entry) => entry.kind === 'reply');
    expect(reply?.text).toContain('attached file');
    expect(reply?.digest?.files).toHaveLength(1);
    expect(reply?.digest?.map).toMatch(/^[0-9a-f]{16}$/);
    expect(reply?.digest?.cut).toBeUndefined();
  });

  it('inlines the same text when the page cannot take files, and records the cut', async () => {
    seatFiles = false;
    const app = await stack();
    const project = await addProject(app, projectFolder);
    const { entries } = await run(app, project.id, [CHATGPT], { prompt: 'p'.repeat(2000) });
    const reply = entries.find((entry) => entry.kind === 'reply');
    expect(reply?.kind).toBe('reply');
    expect(reply?.text).toContain('src/app.ts');
    expect(reply?.text).toContain('p'.repeat(2000));
    expect(reply?.digest?.cut).toMatchObject({ via: 'inline' });
    expect(attached).toEqual([]);
  });

  it('cuts the oldest history from the inline text and keeps the latest request', async () => {
    seatFiles = false;
    const app = await stack();
    const project = await addProject(app, projectFolder);
    expect(await app.rooms.newRoom(project.id)).toBe(true);
    const first = await app.rooms.start(config([CHATGPT], { prompt: `${'old '.repeat(1500)}FIRST` }));
    if (!first.ok) throw new Error(first.error);
    await vi.waitFor(() => expect(app.seen.filter((event) => event.type === 'finished')).toHaveLength(1), { timeout: 20000 });
    const second = await app.rooms.start(config([CHATGPT], { prompt: `${'new '.repeat(1500)}SECOND` }), first.roomId);
    if (!second.ok) throw new Error(second.error);
    await vi.waitFor(() => expect(app.seen.filter((event) => event.type === 'finished')).toHaveLength(2), { timeout: 20000 });
    const record = await readRecord(recordsDir(app, project.id), first.roomId);
    const last = [...(record?.entries ?? [])].reverse().find((entry) => entry.kind === 'final' || entry.kind === 'reply');
    expect(last?.text).toContain('SECOND');
    expect(last?.text).not.toContain('FIRST');
    expect(last?.digest?.cut?.entries).toBeGreaterThan(0);
  });
});

describe('a web page that fails to take the attachment for another reason', () => {
  it('ends the turn with the error instead of inlining the text, and still records the digest', async () => {
    attachFailure = new SiteAdapterError('page-error', 'the page broke');
    const app = await stack();
    const project = await addProject(app, projectFolder);
    const { entries } = await run(app, project.id, [CHATGPT]);
    const failed = entries.find((entry) => entry.kind === 'error');
    expect(failed?.text).toContain('the page broke');
    expect(failed?.text).not.toContain('src/app.ts');
    expect(failed?.digest?.cut).toBeUndefined();
    expect(failed?.digest?.files).toHaveLength(1);
  });
});

describe('the map of a run', () => {
  it('is built once for a run with several recipients and several turns', async () => {
    const app = await stack();
    const project = await addProject(app, projectFolder);
    await run(app, project.id, [CHATGPT, PAID], { rounds: 2 });
    expect(listCalls).toBe(1);
  });

  it('is not built for a room with CLI participants only', async () => {
    const app = await stack();
    const project = await addProject(app, projectFolder);
    await run(app, project.id, [CLAUDE]);
    expect(listCalls).toBe(0);
  });

  it('lets the run go on without a map when it cannot be built', async () => {
    lister = { listFiles: () => Promise.reject(new Error('listing failed')) };
    const app = await stack();
    const project = await addProject(app, projectFolder);
    const { entries } = await run(app, project.id, [PAID]);
    expect(entries.filter((entry) => entry.kind === 'reply' || entry.kind === 'final')).toHaveLength(2);
    expect(entries.every((entry) => entry.digest?.map === undefined)).toBe(true);
    expect(messages(fake.chatCalls[0] as ChatCall).system).not.toContain('Project files');
  });

  it('lists only what the project holds and the deny list allows, with no symlink target', async () => {
    const app = await stack();
    const project = await addProject(app, projectFolder);
    await run(app, project.id, [PAID]);
    const { system } = messages(fake.chatCalls[0] as ChatCall);
    expect(system).toContain('src/util.ts');
    expect(system).not.toContain('README.md');
  });
});

describe('what leaves the machine', () => {
  it('holds no canary, no denied name and no symlink target in any request body, attached file or CLI prompt', async () => {
    const app = await stack();
    const project = await addProject(app, projectFolder);
    const { id } = await run(app, project.id, [CLAUDE, CHATGPT, PAID], { rounds: 2 });
    const outgoing = [
      ...fake.chatCalls.map((call) => JSON.stringify(call.body)),
      ...fake.requests.map((request) => request.body),
      ...(await packFiles(id, project.id)),
      ...(await stubInputs()),
    ];
    expect(outgoing.length).toBeGreaterThan(5);
    for (const text of outgoing) {
      for (const canary of CANARIES) expect(text).not.toContain(canary);
      for (const name of DENIED_NAMES) expect(text).not.toContain(name);
    }
  });
});

describe('the digest of a turn', () => {
  it('survives the run, a rename, a reopen after a restart and a continuation', async () => {
    const app = await stack();
    const project = await addProject(app, projectFolder);
    const { id, entries } = await run(app, project.id, [CLAUDE, PAID]);
    const digests = entries.map((entry) => entry.digest);
    expect(digests.filter((digest) => digest !== undefined)).toHaveLength(entries.filter((entry) => entry.kind !== 'prompt').length);
    const before = JSON.stringify(digests);
    expect(await app.rooms.rename(id, 'A new name')).toBe(true);
    const renamed = await readRecord(recordsDir(app, project.id), id);
    expect(JSON.stringify(renamed?.entries.map((entry) => entry.digest))).toBe(before);
    const restarted = await stack();
    const opened = await restarted.rooms.open(id);
    expect(opened.ok).toBe(true);
    if (opened.ok) expect(JSON.stringify(opened.snapshot.entries.map((entry) => entry.digest))).toBe(before);
    const again = await restarted.rooms.start(config([CLAUDE, PAID], { prompt: 'a follow-up' }), id);
    if (!again.ok) throw new Error(again.error);
    await vi.waitFor(() => expect(restarted.seen.filter((event) => event.type === 'finished')).toHaveLength(1), { timeout: 20000 });
    const continued = await readRecord(recordsDir(restarted, project.id), id);
    expect(JSON.stringify(continued?.entries.slice(0, entries.length).map((entry) => entry.digest))).toBe(before);
    expect(continued?.entries.length).toBeGreaterThan(entries.length);
  });

  it('names the range of history it sent, the size and hash of each part and the map of the run', async () => {
    const app = await stack();
    const project = await addProject(app, projectFolder);
    const { entries } = await run(app, project.id, [PAID]);
    const reply = entries.find((entry) => entry.kind === 'reply');
    expect(reply?.digest?.history).toEqual({ first: 0, last: 0, count: 1 });
    expect(reply?.digest?.parts.map((part) => part.id)).toEqual(['history', 'project-map']);
    const final = entries.find((entry) => entry.kind === 'final');
    expect(final?.digest?.history).toEqual({ first: 0, last: 1, count: 2 });
    expect(final?.digest?.map).toBe(reply?.digest?.map);
  });
});
