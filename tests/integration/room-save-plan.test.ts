// room-save-plan.test.ts
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { moveToFolder, writeRecord } from '../../src/main/room-archive';
import { projectRoomsDir } from '../../src/main/room-context';
import { RoomService } from '../../src/main/room-service';
import { ProjectService, type ProjectGit } from '../../src/main/projects/service';
import type { RoomEntry, RoomRecord } from '../../src/shared/room-model';
import { openStore } from '../unit/helpers/app-state';

let dir: string;
let userData: string;
let work: string;
let picks: (string | null)[];
let projects: ProjectService;
let rooms: RoomService;

const git: ProjectGit = {
  available: () => Promise.resolve({ ok: true, output: 'git version 0' }),
  init: () => Promise.resolve({ ok: true, output: '' }),
};

const entry = (kind: RoomEntry['kind'], text: string): RoomEntry => ({ authorId: 'a', label: 'A', time: 1, kind, text });

function record(id: string, entries: RoomEntry[], title?: string): RoomRecord {
  return {
    version: 1,
    id,
    createdAt: 1,
    updatedAt: 2,
    status: 'done',
    config: { mode: 'relay', rounds: 1, participants: [{ id: 'claude', kind: 'claude', label: 'Claude Code' }], finalizerId: 'claude', turnTimeoutMs: 10000, debugSites: false },
    entries,
    nonce: 'nonce1',
    ...(title === undefined ? {} : { title }),
  };
}

async function build(): Promise<void> {
  const store = await openStore(userData);
  projects = new ProjectService({ store, userData, git, pickFolder: () => Promise.resolve(picks.shift() ?? null), trash: moveToFolder(path.join(dir, 'trash')) });
  rooms = new RoomService({
    roomsDir: path.join(userData, 'shared', 'rooms'),
    userData,
    projects,
    trash: moveToFolder(path.join(dir, 'trash')),
    driverFor: () => {
      throw new Error('no driver in this test');
    },
    terminal: { backlog: () => ({ data: '', end: 0 }), write: () => false, resize: () => false },
    emit: () => undefined,
    paste: () => true,
    copy: () => undefined,
    models: async () => ({ claude: { models: [], efforts: [] }, codex: { models: [] } }),
  });
  await rooms.init();
}

async function addProject(name: string): Promise<{ id: string; folder: string }> {
  const folder = path.join(work, name);
  await mkdir(folder, { recursive: true });
  picks.push(folder);
  const result = await projects.addExisting();
  if (!result.ok) throw new Error(result.error);
  return { id: result.project.id, folder: result.project.folder };
}

async function keep(projectId: string | null, saved: RoomRecord): Promise<void> {
  await writeRecord(projectId === null ? path.join(userData, 'shared', 'rooms') : projectRoomsDir(userData, projectId), saved);
}

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'aiaw-room-save-plan-')));
  userData = path.join(dir, 'userData');
  work = path.join(dir, 'work');
  await mkdir(userData);
  await mkdir(work);
  picks = [];
  await build();
});

afterEach(async () => {
  await rooms.shutdown();
  await rm(dir, { recursive: true, force: true });
});

describe('RoomService.savePlan', () => {
  it('writes the raw final text of the record to docs/plans/<slug>.md of the project with the running status rewritten', async () => {
    const project = await addProject('app');
    const raw = 'Here is the plan:\n\n```markdown\n---\nstatus: running\n---\n- [ ] T01 <b>bold</b> & `code`\n```\n';
    await keep(project.id, record('room1', [entry('prompt', 'q'), entry('reply', 'not this'), entry('final', raw)], 'Login Flow Plan'));
    await rooms.init();
    const result = await rooms.savePlan('room1', false);
    const file = path.join(project.folder, 'docs', 'plans', 'login-flow-plan.md');
    expect(result).toEqual({ ok: true, file });
    expect(await readFile(file, 'utf8')).toBe(raw.replace('status: running', 'status: draft'));
  });

  it('takes the slug from the derived title and from room-<id> when the title leaves nothing', async () => {
    const project = await addProject('app');
    await keep(project.id, record('derived', [entry('prompt', 'Plan the Import'), entry('final', 'text')]));
    await keep(project.id, record('empty1', [entry('final', 'other')], '???'));
    await rooms.init();
    expect(await rooms.savePlan('derived', false)).toMatchObject({ ok: true });
    expect(await rooms.savePlan('empty1', false)).toMatchObject({ ok: true });
    expect((await readdir(path.join(project.folder, 'docs', 'plans'))).sort()).toEqual(['plan-the-import.md', 'room-empty1.md']);
  });

  it('asks before replacing and moves the old file to the Trash on confirmation', async () => {
    const project = await addProject('app');
    await keep(project.id, record('room2', [entry('final', 'second text')], 'Same Title'));
    await rooms.init();
    const target = path.join(project.folder, 'docs', 'plans', 'same-title.md');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, 'first text');
    const asked = await rooms.savePlan('room2', false);
    expect(asked).toMatchObject({ ok: false, exists: true, file: target });
    expect(await readFile(target, 'utf8')).toBe('first text');
    expect(await readdir(path.join(dir, 'trash')).catch(() => [])).toEqual([]);
    expect(await rooms.savePlan('room2', true)).toEqual({ ok: true, file: target });
    expect(await readFile(target, 'utf8')).toBe('second text');
    const trashed = await readdir(path.join(dir, 'trash'));
    expect(trashed).toHaveLength(1);
    expect(await readFile(path.join(dir, 'trash', trashed[0] ?? ''), 'utf8')).toBe('first text');
  });

  it('refuses a room outside any project, an unknown room, a bad id and a room with no final text, and writes nothing', async () => {
    const project = await addProject('app');
    await keep(null, record('loose1', [entry('final', 'text')]));
    await keep(project.id, record('nofinal', [entry('prompt', 'q'), entry('reply', 'r')]));
    await keep(project.id, record('emptyfinal', [entry('final', '')]));
    await rooms.init();
    for (const id of ['loose1', 'missing1', 'bad/id', 'nofinal', 'emptyfinal']) {
      expect(await rooms.savePlan(id, true)).toMatchObject({ ok: false });
    }
    expect(await rooms.savePlan('loose1', true)).toMatchObject({ error: expect.stringContaining('only for a room of a project') });
    expect(await rooms.savePlan('nofinal', true)).toMatchObject({ error: expect.stringContaining('no final result') });
    expect(await readdir(project.folder)).toEqual([]);
  });

  it('refuses a project whose folder is gone and creates nothing', async () => {
    const project = await addProject('app');
    await keep(project.id, record('gone1', [entry('final', 'text')]));
    await rooms.init();
    await rename(project.folder, path.join(work, 'moved'));
    const result = await rooms.savePlan('gone1', false);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Project missing') });
    expect(await readdir(work)).toEqual(['moved']);
  });

  it('refuses a room of a project that was deleted from the index', async () => {
    const project = await addProject('app');
    await keep(project.id, record('del1', [entry('final', 'text')]));
    await rooms.init();
    expect((await projects.delete(project.id)).ok).toBe(true);
    expect(await rooms.savePlan('del1', false)).toMatchObject({ ok: false });
    expect(await readdir(project.folder)).toEqual([]);
  });

  it('finds a room it has not listed yet', async () => {
    const project = await addProject('app');
    await keep(project.id, record('late1', [entry('final', 'text')], 'Late'));
    expect(await rooms.savePlan('late1', false)).toMatchObject({ ok: true });
    expect(await readdir(path.join(project.folder, 'docs', 'plans'))).toEqual(['late.md']);
  });
});
