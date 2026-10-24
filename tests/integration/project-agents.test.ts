// project-agents.test.ts
import { mkdir, mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { AgentController, type ControllerDeps } from '../../src/main/agent-controller';
import { ProjectService } from '../../src/main/projects/service';
import type { AppStateStore } from '../../src/main/store/app-state';
import { loadState } from '../../src/main/state-file';
import { openStore } from '../unit/helpers/app-state';
import type { AppState } from '../../src/shared/agents';
import { EVENT_CHANNELS, type PtyDataEvent } from '../../src/shared/ipc';

const STUB = path.resolve(__dirname, '..', 'fixtures', 'stub-cli.mjs');

interface Launch {
  argv: string[];
  cwd: string;
}

let dir: string;
let userData: string;
let work: string;
let argvLog: string;
let events: { channel: string; payload: unknown }[];
let picked: number;
let controllers: AgentController[];
let projects: ProjectService;
let closeSite: Mock<(id: string) => void>;
let closeChat: Mock<(id: string) => void>;
let pickAnswer: string | null;
let folderGate: Promise<void> | null;

async function folder(name: string): Promise<string> {
  const target = path.join(work, name);
  await mkdir(target, { recursive: true });
  return realpath(target);
}

function projectServiceFor(store: AppStateStore): ProjectService {
  return new ProjectService({
    store,
    userData,
    git: { available: () => Promise.resolve({ ok: true, output: '' }), init: () => Promise.resolve({ ok: true, output: '' }) },
    pickFolder: async () => pickAnswer,
    trash: async () => undefined,
  });
}

async function build(initial?: AppState): Promise<AgentController> {
  const store = await openStore(userData, initial);
  projects = projectServiceFor(store);
  const deps: ControllerDeps = {
    store,
    sharedDir: path.join(dir, 'shared'),
    platform: 'win32',
    env: { PATH: process.env.PATH, AIAW_CLAUDE_BIN: STUB, AIAW_CODEX_BIN: STUB, AIAW_STUB_ARGV_LOG: argvLog },
    pickFolder: async () => {
      picked += 1;
      return path.join(dir, 'never-chosen');
    },
    emit: (channel, payload) => events.push({ channel, payload }),
    closeSite: (id) => closeSite(id),
    closeChat: (id) => closeChat(id),
    folderOf: async (id) => {
      await folderGate;
      return projects.folderOf(id);
    },
  };
  const controller = new AgentController(deps);
  controllers.push(controller);
  return controller;
}

async function enrol(name: string): Promise<{ id: string; folder: string }> {
  const real = await folder(name);
  pickAnswer = real;
  const result = await projects.addExisting();
  if (!result.ok) throw new Error(result.error);
  return { id: result.project.id, folder: real };
}

function output(id: string): string {
  return events
    .filter((event) => event.channel === EVENT_CHANNELS.ptyData)
    .map((event) => event.payload as PtyDataEvent)
    .filter((payload) => payload.id === id)
    .map((payload) => payload.data)
    .join('');
}

async function launches(expected: number): Promise<Launch[]> {
  let lines: Launch[] = [];
  await vi.waitFor(async () => {
    const text = await readFile(argvLog, 'utf8').catch(() => '');
    lines = text.split('\n').filter((line) => line.length > 0).map((line) => JSON.parse(line) as Launch);
    expect(lines).toHaveLength(expected);
  });
  return lines;
}

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'aiaw-project-agents-')));
  userData = path.join(dir, 'userData');
  work = path.join(dir, 'work');
  argvLog = path.join(dir, 'argv.log');
  await mkdir(userData);
  await mkdir(work);
  events = [];
  picked = 0;
  controllers = [];
  closeSite = vi.fn<(id: string) => void>();
  closeChat = vi.fn<(id: string) => void>();
  pickAnswer = null;
  folderGate = null;
});

afterEach(async () => {
  for (const controller of controllers) controller.shutdown();
  await rm(dir, { recursive: true, force: true });
});

describe('an agent added inside a project', () => {
  it('runs a Claude Code pty in the project folder without asking for a folder, and stores the project id', async () => {
    const controller = await build();
    const project = await enrol('app');
    expect(await controller.add('claude', project.id)).toEqual({ ok: true });
    const agent = controller.snapshot().agents[0];
    expect(agent).toMatchObject({ kind: 'claude', projectId: project.id, cwd: project.folder });
    expect(picked).toBe(0);
    const [launch] = await launches(1);
    expect(launch?.cwd).toBe(project.folder);
    expect((await loadState(path.join(userData, 'state.json'))).agents[0]).toMatchObject({ projectId: project.id, cwd: project.folder });
  });

  it('does the same for Codex, and keeps the folder picker for an agent outside any project', async () => {
    const controller = await build();
    const project = await enrol('app');
    await controller.add('codex', project.id);
    expect(controller.snapshot().agents[0]).toMatchObject({ kind: 'codex', projectId: project.id, cwd: project.folder });
    expect(picked).toBe(0);
    await controller.add('claude');
    expect(picked).toBe(1);
    expect(controller.snapshot().agents[1]?.projectId).toBeUndefined();
  });

  it('gives site and OpenRouter agents the project id and no folder', async () => {
    const controller = await build();
    const project = await enrol('app');
    for (const kind of ['chatgpt', 'grok', 'deepseek', 'openrouter'] as const) await controller.add(kind, project.id);
    const agents = controller.snapshot().agents;
    expect(agents.map((agent) => agent.projectId)).toEqual([project.id, project.id, project.id, project.id]);
    expect(agents.map((agent) => agent.cwd)).toEqual([undefined, undefined, undefined, undefined]);
    expect(picked).toBe(0);
  });

  it('refuses an unknown project and a project whose folder is gone, adds nothing and does not recreate the folder', async () => {
    const controller = await build();
    const project = await enrol('app');
    const unknown = await controller.add('claude', 'no-such-project');
    expect(unknown).toMatchObject({ ok: false });
    await rm(project.folder, { recursive: true });
    const lost = await controller.add('claude', project.id);
    expect(lost.ok).toBe(false);
    expect(lost.ok ? '' : lost.error).toContain('Project missing');
    expect((await controller.add('grok', project.id)).ok).toBe(false);
    expect(controller.snapshot().agents).toEqual([]);
    expect(picked).toBe(0);
    await expect(stat(project.folder)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(argvLog, 'utf8').catch(() => '')).toBe('');
  });
});

describe('a project agent after a restart', () => {
  it('runs in the folder the project index gives, not the one stored on the agent', async () => {
    const first = await build();
    const project = await enrol('app');
    await first.add('claude', project.id);
    await launches(1);
    first.shutdown();
    const saved = await loadState(path.join(userData, 'state.json'));
    const stale: AppState = { ...saved, agents: saved.agents.map((agent) => ({ ...agent, cwd: path.join(dir, 'elsewhere') })) };
    const second = await build(stale);
    await second.restore();
    const lines = await launches(2);
    expect(lines[1]?.cwd).toBe(project.folder);
    expect(second.snapshot().agents[0]?.projectId).toBe(project.id);
  });

  it('starts nothing for an agent whose project folder is gone, says why in its pane and keeps it listed', async () => {
    const first = await build();
    const gone = await enrol('gone-app');
    const fine = await enrol('fine-app');
    await first.add('claude', gone.id);
    await first.add('claude', fine.id);
    await launches(2);
    first.shutdown();
    await rm(gone.folder, { recursive: true });
    const saved = await loadState(path.join(userData, 'state.json'));
    events = [];
    const second = await build(saved);
    await second.restore();
    const [goneAgent, fineAgent] = second.snapshot().agents;
    await vi.waitFor(() => expect(output(goneAgent?.id ?? '')).toContain('Project missing'));
    const lines = await launches(3);
    expect(lines.slice(2).map((line) => line.cwd)).toEqual([fine.folder]);
    await vi.waitFor(() => expect(output(fineAgent?.id ?? '')).toContain('STUB-CLI BANNER'));
    expect(output(goneAgent?.id ?? '')).not.toContain('STUB-CLI BANNER');
    expect(second.snapshot().agents).toHaveLength(2);
    await expect(stat(gone.folder)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses a restart when the project folder is gone, with the reason', async () => {
    const first = await build();
    const project = await enrol('app');
    await first.add('claude', project.id);
    await launches(1);
    first.shutdown();
    await rm(project.folder, { recursive: true });
    const saved = await loadState(path.join(userData, 'state.json'));
    const second = await build(saved);
    const id = saved.agents[0]?.id ?? '';
    expect(await second.restart(id)).toBe(false);
    expect(output(id)).toContain('Project missing');
    await launches(1);
    await expect(stat(project.folder)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('a restart that is overtaken', () => {
  it('starts no pty for an agent that was closed while its project folder was being checked', async () => {
    const first = await build();
    const project = await enrol('app');
    await first.add('claude', project.id);
    await launches(1);
    first.shutdown();
    const saved = await loadState(path.join(userData, 'state.json'));
    const second = await build(saved);
    const id = saved.agents[0]?.id ?? '';
    let release: () => void = () => undefined;
    folderGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const restarting = second.restart(id);
    await second.close(id);
    release();
    expect(await restarting).toBe(false);
    await launches(1);
    expect(second.snapshot().agents).toEqual([]);
  });
});

describe('closing a project', () => {
  it('lets a delete go ahead, since closing the agents of a project never vetoes it', async () => {
    const controller = await build();
    expect(controller.canClose()).toBeNull();
  });

  it('closes the pty, the site view and the chat of that project agents and no other agent', async () => {
    const controller = await build();
    const one = await enrol('one');
    const two = await enrol('two');
    await controller.add('claude', one.id);
    await controller.add('grok', one.id);
    await controller.add('openrouter', one.id);
    await controller.add('claude', two.id);
    await controller.add('grok');
    await launches(2);
    const [claudeOne, grokOne, chatOne, claudeTwo, loose] = controller.snapshot().agents;
    await controller.closeProject(one.id);
    expect(controller.snapshot().agents.map((agent) => agent.id)).toEqual([claudeTwo?.id, loose?.id]);
    expect(closeSite.mock.calls.map((call) => call[0]).sort()).toEqual([claudeOne?.id, grokOne?.id, chatOne?.id].sort());
    expect(closeChat.mock.calls.map((call) => call[0])).toContain(chatOne?.id);
    expect((await loadState(path.join(userData, 'state.json'))).agents.map((agent) => agent.id)).toEqual([claudeTwo?.id, loose?.id]);
    await vi.waitFor(() => expect(controller.ptyBacklog(claudeOne?.id ?? '').data).toBe(''));
    await vi.waitFor(() => expect(controller.ptyBacklog(claudeTwo?.id ?? '').data).toContain('STUB-CLI BANNER'));
  });
});
