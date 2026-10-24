// room-collection.test.ts
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenRouterClient } from '../../src/main/openrouter/client';
import { KeyStore } from '../../src/main/openrouter/key-store';
import { OpenRouterService } from '../../src/main/openrouter/service';
import { testSecretBox } from '../../src/main/openrouter/test-mode';
import { ProjectService, type ProjectGit } from '../../src/main/projects/service';
import { moveToFolder, readRecord } from '../../src/main/room-archive';
import { createRoomDrivers, type RoomDrivers } from '../../src/main/room-drivers';
import { RoomService } from '../../src/main/room-service';
import type { RoomModels } from '../../src/shared/cli-models';
import type { ProjectView } from '../../src/shared/projects';
import type { RoomConfig, RoomEntry, RoomEvent, RoomParticipant, StepState } from '../../src/shared/room-model';
import {
  NO_ENDPOINTS_MODEL,
  PROVIDER_LIMITED_MODEL,
  fakeModelsWithLimits,
  startFakeOpenRouter,
  type ChatCall,
  type FakeOpenRouter,
} from '../fixtures/openrouter-fake';
import { openStore } from '../unit/helpers/app-state';

const NO_MODELS: RoomModels = { claude: { models: [], efforts: [] }, codex: { models: [] } };
const CANARY = 'canary-env-4d8e02';
const DENIED_NAMES = ['.env', 'key.pem', 'credentials.json'];

const PAID: RoomParticipant = { id: 'openrouter', kind: 'openrouter', label: 'OpenRouter · Acme Paid', model: 'acme/paid-model', modelName: 'Acme Paid', web: false };
const NO_ENDPOINTS: RoomParticipant = { id: 'openrouter-2', kind: 'openrouter', label: 'OpenRouter · No Endpoints', model: NO_ENDPOINTS_MODEL, modelName: 'No Endpoints', web: false };
const ALLOWED: RoomParticipant = { ...NO_ENDPOINTS, allowCollection: true };
const LIMITED: RoomParticipant = { id: 'openrouter-3', kind: 'openrouter', label: 'OpenRouter · Limited', model: PROVIDER_LIMITED_MODEL, modelName: 'Limited', web: false };

let dir: string;
let userData: string;
let folder: string;
let fake: FakeOpenRouter;
let cipher: string | null;
let service: OpenRouterService;
let stacks: Stack[];

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
  const projects = new ProjectService({ store, userData, git, pickFolder: () => Promise.resolve(folder), trash: moveToFolder(path.join(dir, 'trash')) });
  const drivers = createRoomDrivers({
    sharedDir: path.join(userData, 'shared'),
    platform: 'win32',
    envFor: () => ({ PATH: process.env.PATH }),
    siteFor: () => null,
    openrouter: service,
  });
  const seen: RoomEvent[] = [];
  const rooms = new RoomService({
    roomsDir: path.join(userData, 'shared', 'rooms'),
    userData,
    projects,
    git: { listFiles: () => Promise.resolve({ ok: false as const, error: 'not a repository' }) },
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

async function addProject(app: Stack): Promise<ProjectView> {
  const result = await app.projects.addExisting();
  if (!result.ok) throw new Error(result.error);
  return result.project;
}

function config(participants: RoomParticipant[], overrides: Partial<RoomConfig> = {}): RoomConfig {
  return { prompt: 'the question', mode: 'relay', rounds: 1, participants, turnTimeoutMs: 20000, finalizerId: participants[0]?.id ?? 'openrouter', debugSites: false, ...overrides };
}

function recordsDir(projectId: string | null): string {
  return projectId === null ? path.join(userData, 'shared', 'rooms') : path.join(userData, 'projects', projectId, 'rooms');
}

function finishedCount(app: Stack): number {
  return app.seen.filter((event) => event.type === 'finished').length;
}

async function run(
  app: Stack,
  projectId: string | null,
  participants: RoomParticipant[],
  overrides: Partial<RoomConfig> = {},
): Promise<{ id: string; entries: RoomEntry[]; events: RoomEvent[] }> {
  expect(await app.rooms.newRoom(projectId)).toBe(true);
  const before = finishedCount(app);
  const mark = app.seen.length;
  const started = await app.rooms.start(config(participants, overrides));
  if (!started.ok) throw new Error(started.error);
  await vi.waitFor(() => expect(finishedCount(app)).toBe(before + 1), { timeout: 30000 });
  const record = await readRecord(recordsDir(projectId), started.roomId);
  return { id: started.roomId, entries: record?.entries ?? [], events: app.seen.slice(mark) };
}

async function again(app: Stack, projectId: string | null, id: string, participants: RoomParticipant[], overrides: Partial<RoomConfig> = {}): Promise<RoomEntry[]> {
  const before = finishedCount(app);
  const started = await app.rooms.start(config(participants, overrides), id);
  if (!started.ok) throw new Error(started.error);
  await vi.waitFor(() => expect(finishedCount(app)).toBe(before + 1), { timeout: 30000 });
  return (await readRecord(recordsDir(projectId), id))?.entries ?? [];
}

function callsOf(model: string): ChatCall[] {
  return fake.chatCalls.filter((call) => call.body?.model === model);
}

function states(events: RoomEvent[], participantId: string): StepState[] {
  return events.flatMap((event) => (event.type === 'progress' && event.participantId === participantId ? [event.state] : []));
}

function errorsOf(entries: RoomEntry[], authorId: string): RoomEntry[] {
  return entries.filter((entry) => entry.authorId === authorId && entry.kind === 'error');
}

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'aiaw-room-collection-')));
  userData = path.join(dir, 'userData');
  folder = path.join(dir, 'work', 'demo');
  cipher = null;
  stacks = [];
  await mkdir(path.join(folder, 'src'), { recursive: true });
  await writeFile(path.join(folder, 'src', 'app.ts'), 'export const widget = 1;\n');
  await writeFile(path.join(folder, '.env'), `API_KEY=${CANARY}\n`);
  await writeFile(path.join(folder, 'key.pem'), `-----BEGIN PRIVATE KEY-----\n${CANARY}\n`);
  await writeFile(path.join(folder, 'credentials.json'), `{"token":"${CANARY}"}`);
  await mkdir(userData, { recursive: true });
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

describe('a participant refused for lack of endpoints in a project room', () => {
  it('is called once in a relay of three rounds, fails once in the feed, and the others carry on to a final answer', async () => {
    const app = await stack();
    const project = await addProject(app);
    const { entries, events } = await run(app, project.id, [PAID, NO_ENDPOINTS], { rounds: 3 });
    expect(callsOf(NO_ENDPOINTS_MODEL)).toHaveLength(1);
    expect(callsOf('acme/paid-model')).toHaveLength(4);
    expect(errorsOf(entries, NO_ENDPOINTS.id)).toHaveLength(1);
    expect(entries.filter((entry) => entry.authorId === NO_ENDPOINTS.id)).toHaveLength(1);
    expect(entries.filter((entry) => entry.authorId === PAID.id && entry.kind === 'reply')).toHaveLength(3);
    expect(entries.filter((entry) => entry.kind === 'final')).toHaveLength(1);
    expect(states(events, NO_ENDPOINTS.id)).toEqual(['running', 'failed', 'skipped', 'skipped']);
    const progress = events.filter((event) => event.type === 'progress');
    const last = progress[progress.length - 1];
    expect(last?.type === 'progress' && last.completed).toBe(last?.type === 'progress' ? last.total : -1);
    expect(events.find((event) => event.type === 'finished')).toMatchObject({ status: 'done' });
  });

  it('is called once in a broadcast of three rounds too', async () => {
    const app = await stack();
    const project = await addProject(app);
    const { entries, events } = await run(app, project.id, [PAID, NO_ENDPOINTS], { rounds: 3, mode: 'broadcast' });
    expect(callsOf(NO_ENDPOINTS_MODEL)).toHaveLength(1);
    expect(callsOf('acme/paid-model')).toHaveLength(4);
    expect(entries.filter((entry) => entry.authorId === NO_ENDPOINTS.id)).toHaveLength(1);
    expect(states(events, NO_ENDPOINTS.id)).toEqual(['running', 'failed', 'skipped', 'skipped']);
  });

  it('is passed over by the relay: the next participant still takes its turn each round', async () => {
    const app = await stack();
    const project = await addProject(app);
    const third: RoomParticipant = { ...PAID, id: 'openrouter-4' };
    const { entries } = await run(app, project.id, [PAID, NO_ENDPOINTS, third], { rounds: 2 });
    expect(entries.filter((entry) => entry.authorId === third.id && entry.kind === 'reply').map((entry) => entry.round)).toEqual([1, 2]);
    expect(callsOf(NO_ENDPOINTS_MODEL)).toHaveLength(1);
  });

  it('keeps a skipped finalizer out of the final turn and hands it to a participant that answered', async () => {
    const app = await stack();
    const project = await addProject(app);
    const { entries } = await run(app, project.id, [PAID, NO_ENDPOINTS], { rounds: 2, finalizerId: NO_ENDPOINTS.id });
    expect(callsOf(NO_ENDPOINTS_MODEL)).toHaveLength(1);
    expect(entries.filter((entry) => entry.kind === 'final').map((entry) => entry.authorId)).toEqual([PAID.id]);
  });

  it('names the switch in the readable reason', async () => {
    const app = await stack();
    const project = await addProject(app);
    const { entries } = await run(app, project.id, [NO_ENDPOINTS]);
    const failed = errorsOf(entries, NO_ENDPOINTS.id)[0];
    expect(failed?.text).toContain('data_collection');
    expect(failed?.text).toContain('Allow data collection');
  });

  it('is tried once again by the next run of the same room, and skipped again after failing', async () => {
    const app = await stack();
    const project = await addProject(app);
    const first = await run(app, project.id, [PAID, NO_ENDPOINTS], { rounds: 2 });
    expect(callsOf(NO_ENDPOINTS_MODEL)).toHaveLength(1);
    const entries = await again(app, project.id, first.id, [PAID, NO_ENDPOINTS], { rounds: 2, prompt: 'a follow-up' });
    expect(callsOf(NO_ENDPOINTS_MODEL)).toHaveLength(2);
    expect(errorsOf(entries, NO_ENDPOINTS.id)).toHaveLength(2);
  });
});

describe('a participant allowed to be collected in a project room', () => {
  it('omits data_collection from its request and answers, while the others still carry deny', async () => {
    const app = await stack();
    const project = await addProject(app);
    const { entries, events } = await run(app, project.id, [PAID, ALLOWED], { rounds: 2 });
    const own = callsOf(NO_ENDPOINTS_MODEL);
    expect(own.length).toBeGreaterThanOrEqual(2);
    for (const call of own) {
      expect(call.body).not.toHaveProperty('provider');
      expect(JSON.stringify(call.body)).not.toContain('data_collection');
    }
    for (const call of callsOf('acme/paid-model')) expect(call.body?.provider).toEqual({ data_collection: 'deny' });
    expect(errorsOf(entries, ALLOWED.id)).toHaveLength(0);
    expect(entries.filter((entry) => entry.authorId === ALLOWED.id && entry.kind === 'reply')).toHaveLength(2);
    expect(states(events, ALLOWED.id)).not.toContain('skipped');
  });

  it('keeps the rest of the request as it was: the map in the system part, the history, no secret', async () => {
    const app = await stack();
    const project = await addProject(app);
    await run(app, project.id, [ALLOWED]);
    const [call] = callsOf(NO_ENDPOINTS_MODEL);
    const system = call?.body?.messages?.find((message) => message.role === 'system')?.content ?? '';
    expect(system).toContain('src/app.ts');
    for (const name of DENIED_NAMES) expect(system).not.toContain(name);
    for (const sent of fake.chatCalls) expect(JSON.stringify(sent.body)).not.toContain(CANARY);
  });

  it('says so in the context sent of its turns and of no other participant', async () => {
    const app = await stack();
    const project = await addProject(app);
    const { entries } = await run(app, project.id, [PAID, ALLOWED]);
    const mine = entries.filter((entry) => entry.authorId === ALLOWED.id && entry.digest !== undefined);
    const others = entries.filter((entry) => entry.authorId === PAID.id && entry.digest !== undefined);
    expect(mine.length).toBeGreaterThan(0);
    expect(others.length).toBeGreaterThan(0);
    for (const entry of mine) expect(entry.digest?.collectionAllowed).toBe(true);
    for (const entry of others) expect(entry.digest).not.toHaveProperty('collectionAllowed');
  });

  it('survives a reopen after a restart, in the saved record and in the form the room opens with', async () => {
    const app = await stack();
    const project = await addProject(app);
    const { id } = await run(app, project.id, [PAID, ALLOWED]);
    const record = await readRecord(recordsDir(project.id), id);
    expect(record?.config.participants.find((item) => item.id === ALLOWED.id)?.allowCollection).toBe(true);
    expect(record?.config.participants.find((item) => item.id === PAID.id)).not.toHaveProperty('allowCollection');
    const restarted = await stack();
    const opened = await restarted.rooms.open(id);
    expect(opened.ok && opened.form.rows?.find((row) => row.id === ALLOWED.id)?.allowCollection).toBe(true);
    expect(opened.ok && opened.form.rows?.find((row) => row.id === PAID.id)).not.toHaveProperty('allowCollection');
  });

  it('applies a change from the next turn: switched on for the next run, the refused model answers', async () => {
    const app = await stack();
    const project = await addProject(app);
    const first = await run(app, project.id, [PAID, NO_ENDPOINTS]);
    expect(errorsOf(first.entries, NO_ENDPOINTS.id)).toHaveLength(1);
    const entries = await again(app, project.id, first.id, [PAID, ALLOWED], { prompt: 'a follow-up' });
    expect(errorsOf(entries, NO_ENDPOINTS.id)).toHaveLength(1);
    expect(entries.filter((entry) => entry.authorId === NO_ENDPOINTS.id && entry.kind === 'reply')).toHaveLength(1);
    expect(callsOf(NO_ENDPOINTS_MODEL)).toHaveLength(2);
  });
});

describe('a room without a project', () => {
  it('is not changed: no deny, no skip, the switch changes nothing', async () => {
    const app = await stack();
    const { entries, events } = await run(app, null, [NO_ENDPOINTS, { ...PAID, allowCollection: true }], { rounds: 3 });
    expect(errorsOf(entries, NO_ENDPOINTS.id)).toHaveLength(0);
    expect(callsOf(NO_ENDPOINTS_MODEL)).toHaveLength(4);
    expect(states(events, NO_ENDPOINTS.id)).not.toContain('skipped');
    for (const call of fake.chatCalls) expect(Object.keys(call.body ?? {}).sort()).toEqual(['messages', 'model', 'stream']);
    for (const entry of entries) expect(entry.digest ?? {}).not.toHaveProperty('collectionAllowed');
  });
});

describe('an error that is not a permanent refusal', () => {
  it('keeps today\'s behaviour for a rate limit: the participant is called every round and never skipped', async () => {
    const app = await stack();
    const project = await addProject(app);
    const { entries, events } = await run(app, project.id, [PAID, LIMITED], { rounds: 2 });
    expect(errorsOf(entries, LIMITED.id).length).toBeGreaterThanOrEqual(2);
    expect(callsOf(PROVIDER_LIMITED_MODEL).length).toBeGreaterThanOrEqual(4);
    expect(states(events, LIMITED.id)).not.toContain('skipped');
  });
});
