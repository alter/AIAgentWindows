// copy-agents.test.ts
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentController } from '../../src/main/agent-controller';
import { ProjectService, type ProjectsDeps } from '../../src/main/projects/service';
import type { AppStateStore } from '../../src/main/store/app-state';
import { loadState } from '../../src/main/state-file';
import { openStore } from '../unit/helpers/app-state';
import type { Agent, AppState } from '../../src/shared/agents';
import type { CopyAgentsFrom, CopyAgentsResult } from '../../src/shared/copy-agents';
import type { ProjectResult } from '../../src/shared/projects';
import { emptyOpenRouterSettings } from '../../src/shared/openrouter';

const STUB = path.resolve(__dirname, '..', 'fixtures', 'stub-cli.mjs');
const FROM_NO_PROJECT: CopyAgentsFrom = { projectId: null };

interface Launch {
  argv: string[];
  cwd: string;
}

let dir: string;
let userData: string;
let work: string;
let loose: string;
let argvLog: string;
let picked: number;
let controllers: AgentController[];
let store: AppStateStore;
let controller: AgentController;
let projects: ProjectService;
let pickAnswer: string | null;
let updates: string[];

async function folder(name: string): Promise<string> {
  const target = path.join(work, name);
  await mkdir(target, { recursive: true });
  return realpath(target);
}

function projectServiceFor(overrides: Partial<ProjectsDeps> = {}): ProjectService {
  return new ProjectService({
    store,
    userData,
    git: { available: () => Promise.resolve({ ok: true, output: '' }), init: () => Promise.resolve({ ok: true, output: '' }) },
    pickFolder: async () => pickAnswer,
    trash: async () => undefined,
    copyAgents: (source, projectId) => controller.copyAgents(source, projectId),
    ...overrides,
  });
}

async function build(initial?: AppState): Promise<void> {
  store = await openStore(userData, initial);
  const original = store.update.bind(store);
  vi.spyOn(store, 'update').mockImplementation(((slice: string, fn: never) => {
    updates.push(slice);
    return original(slice as never, fn);
  }) as typeof store.update);
  projects = projectServiceFor();
  controller = new AgentController({
    store,
    sharedDir: path.join(dir, 'shared'),
    platform: 'win32',
    env: { PATH: process.env.PATH, AIAW_CLAUDE_BIN: STUB, AIAW_CODEX_BIN: STUB, AIAW_STUB_ARGV_LOG: argvLog },
    pickFolder: async () => {
      picked += 1;
      return loose;
    },
    emit: () => undefined,
    folderOf: (id) => projects.folderOf(id),
  });
  controllers.push(controller);
}

function okProject(result: ProjectResult): { id: string; copied?: number; copyError?: string } {
  if (!result.ok) throw new Error(result.error);
  return { id: result.project.id, ...(result.copied === undefined ? {} : { copied: result.copied }), ...(result.copyError === undefined ? {} : { copyError: result.copyError }) };
}

async function enrol(name: string, copy?: CopyAgentsFrom): Promise<{ id: string; folder: string; copied?: number; copyError?: string }> {
  const real = await folder(name);
  pickAnswer = real;
  return { ...okProject(await projects.addExisting(copy)), folder: real };
}

function agentsOf(projectId: string | undefined): Agent[] {
  return controller.snapshot().agents.filter((agent) => agent.projectId === projectId);
}

async function seedLoose(): Promise<Agent[]> {
  for (const kind of ['claude', 'codex', 'chatgpt', 'grok', 'deepseek', 'openrouter'] as const) await controller.add(kind);
  const router = agentsOf(undefined).find((agent) => agent.kind === 'openrouter');
  await controller.setOpenrouterSettings(router?.id ?? '', { ...emptyOpenRouterSettings(), model: 'vendor/model-x', modelName: 'Model X', effort: 'high', web: true });
  return agentsOf(undefined);
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
  dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'aiaw-copy-agents-')));
  userData = path.join(dir, 'userData');
  work = path.join(dir, 'work');
  argvLog = path.join(dir, 'argv.log');
  await mkdir(userData);
  await mkdir(work);
  loose = await folder('loose-code');
  picked = 0;
  controllers = [];
  pickAnswer = null;
  updates = [];
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const item of controllers) item.shutdown();
  await rm(dir, { recursive: true, force: true });
});

describe('copying the agents of No project into a new project', () => {
  it('creates the same kinds in the same order, fresh, in the new folder, and leaves the source as it is', async () => {
    await build();
    const source = await seedLoose();
    await launches(2);
    const pickedBefore = picked;
    const selectedBefore = controller.snapshot().selectedId;
    const project = await enrol('app', FROM_NO_PROJECT);
    expect(project.copied).toBe(6);
    expect(project.copyError).toBeUndefined();
    const copies = agentsOf(project.id);
    expect(copies.map((agent) => agent.kind)).toEqual(source.map((agent) => agent.kind));
    expect(agentsOf(undefined)).toEqual(source);
    expect(copies.map((agent) => agent.id).filter((id) => source.some((agent) => agent.id === id))).toEqual([]);
    expect(picked).toBe(pickedBefore);
    expect(controller.snapshot().selectedId).toBe(selectedBefore);
    expect(controller.snapshot().agents).toHaveLength(12);
    const [claude, codex, chatgpt, grok, deepseek, router] = copies;
    expect(claude).toMatchObject({ cwd: project.folder, title: `Claude Code · ${path.basename(project.folder)}` });
    expect(claude?.sessionId).toBeDefined();
    expect(claude?.sessionId).not.toBe(source[0]?.sessionId);
    expect(codex).toMatchObject({ cwd: project.folder, title: `Codex · ${path.basename(project.folder)}` });
    expect(codex?.sessionId).toBeUndefined();
    expect([chatgpt, grok, deepseek].map((agent) => agent?.cwd)).toEqual([undefined, undefined, undefined]);
    expect([chatgpt?.title, grok?.title, deepseek?.title]).toEqual(['ChatGPT', 'Grok', 'DeepSeek']);
    expect(router?.openrouter).toEqual(source[5]?.openrouter);
    expect(router?.openrouter).not.toBe(source[5]?.openrouter);
    expect(router?.id).not.toBe(source[5]?.id);
    const lines = await launches(4);
    expect(lines.slice(2).map((line) => line.cwd).sort()).toEqual([project.folder, project.folder]);
  });

  it('gives each copy its own empty conversation by the agent id, never the source id', async () => {
    await build();
    const source = await seedLoose();
    const project = await enrol('app', FROM_NO_PROJECT);
    const router = agentsOf(project.id).find((agent) => agent.kind === 'openrouter');
    expect(router?.id).not.toBe(source.find((agent) => agent.kind === 'openrouter')?.id);
    expect(controller.openrouterSettings(router?.id ?? '')).toMatchObject({ model: 'vendor/model-x', effort: 'high', web: true });
  });

  it('persists the copies with one write of the agents and keeps them after a restart', async () => {
    await build();
    await seedLoose();
    const before = updates.filter((slice) => slice === 'agents').length;
    const project = await enrol('app', FROM_NO_PROJECT);
    expect(updates.filter((slice) => slice === 'agents').length - before).toBe(1);
    const saved = await loadState(path.join(userData, 'state.json'));
    expect(saved.agents.filter((agent) => agent.projectId === project.id).map((agent) => agent.kind)).toEqual(['claude', 'codex', 'chatgpt', 'grok', 'deepseek', 'openrouter']);
    controller.shutdown();
    await build(saved);
    await controller.restore();
    expect(agentsOf(project.id)).toHaveLength(6);
    expect(agentsOf(undefined)).toHaveLength(6);
  });

  it('copies from another project, whose folder may be gone, and leaves that project untouched', async () => {
    await build();
    const first = await enrol('first');
    for (const kind of ['codex', 'grok', 'openrouter'] as const) await controller.add(kind, first.id);
    await rm(first.folder, { recursive: true });
    const sourceAgents = agentsOf(first.id);
    const second = await enrol('second', { projectId: first.id });
    expect(second.copied).toBe(3);
    expect(agentsOf(second.id).map((agent) => agent.kind)).toEqual(['codex', 'grok', 'openrouter']);
    expect(agentsOf(second.id)[0]).toMatchObject({ cwd: second.folder });
    expect(agentsOf(first.id)).toEqual(sourceAgents);
    expect(agentsOf(undefined)).toEqual([]);
  });

  it('takes only the chosen source when the app holds agents of other sources too', async () => {
    await build();
    const first = await enrol('first');
    for (const kind of ['codex', 'grok'] as const) await controller.add(kind, first.id);
    await controller.add('claude');
    await controller.add('deepseek');
    const fromNoProject = await enrol('from-loose', FROM_NO_PROJECT);
    expect(fromNoProject.copied).toBe(2);
    expect(agentsOf(fromNoProject.id).map((agent) => agent.kind)).toEqual(['claude', 'deepseek']);
    const fromFirst = await enrol('from-first', { projectId: first.id });
    expect(fromFirst.copied).toBe(2);
    expect(agentsOf(fromFirst.id).map((agent) => agent.kind)).toEqual(['codex', 'grok']);
    expect(controller.snapshot().agents).toHaveLength(8);
  });

  it('copies nothing for none, and the default of an absent choice is none', async () => {
    await build();
    await seedLoose();
    const none = await enrol('app-none', 'none');
    expect(none.copied).toBeUndefined();
    expect(agentsOf(none.id)).toEqual([]);
    const absent = await enrol('app-absent');
    expect(absent.copied).toBeUndefined();
    expect(agentsOf(absent.id)).toEqual([]);
    expect(controller.snapshot().agents).toHaveLength(6);
  });

  it('copies nothing from a source without agents and says so with a count of zero', async () => {
    await build();
    const project = await enrol('empty-source', FROM_NO_PROJECT);
    expect(project.copied).toBe(0);
    expect(project.copyError).toBeUndefined();
    expect(updates.filter((slice) => slice === 'agents')).toEqual([]);
  });

  it('creates the project without copies and reports an unknown source, adding no agent anywhere', async () => {
    await build();
    await seedLoose();
    const project = await enrol('app', { projectId: 'no-such-project' });
    expect(project.copied).toBeUndefined();
    expect(project.copyError).toContain('no longer exists');
    expect(projects.ids()).toContain(project.id);
    expect(agentsOf(project.id)).toEqual([]);
    expect(controller.snapshot().agents).toHaveLength(6);
  });

  it('copies into a project made with a new folder, through the token flow', async () => {
    await build();
    await seedLoose();
    pickAnswer = work;
    const parent = await projects.pickParent();
    if (!parent.ok) throw new Error('no parent');
    const created = okProject(await projects.create(parent.token, 'made-here', FROM_NO_PROJECT));
    expect(created.copied).toBe(6);
    expect(agentsOf(created.id).find((agent) => agent.kind === 'claude')?.cwd).toBe(path.join(await realpath(work), 'made-here'));
  });
});

describe('the controller copy', () => {
  it('refuses a target project that is unknown or whose folder is gone, adding nothing', async () => {
    await build();
    await seedLoose();
    const unknown = await controller.copyAgents(FROM_NO_PROJECT, 'no-such-project');
    expect(unknown.ok).toBe(false);
    const target = await enrol('target');
    await rm(target.folder, { recursive: true });
    const lost = await controller.copyAgents(FROM_NO_PROJECT, target.id);
    expect(lost.ok ? '' : lost.error).toContain('Project missing');
    expect(controller.snapshot().agents).toHaveLength(6);
  });

  it('refuses while the state file is fail-closed', async () => {
    await build();
    await seedLoose();
    const target = await enrol('target');
    vi.spyOn(store, 'failure').mockReturnValue('state refused');
    expect(await controller.copyAgents(FROM_NO_PROJECT, target.id)).toEqual({ ok: false, error: 'state refused' });
    expect(controller.snapshot().agents).toHaveLength(6);
  });
});

describe('the project service copy', () => {
  it('reports that copying is unavailable when the service has no copier, and still creates the project', async () => {
    await build();
    projects = projectServiceFor({ copyAgents: undefined as never });
    const project = await enrol('app', FROM_NO_PROJECT);
    expect(project.copyError).toContain('not available');
    expect(projects.ids()).toContain(project.id);
  });

  it('turns a refusal or a throw of the copier into a notice and keeps the project', async () => {
    await build();
    const refusals: CopyAgentsResult[] = [{ ok: false, error: 'the copier said no' }];
    projects = projectServiceFor({ copyAgents: async () => refusals[0] as CopyAgentsResult });
    const refused = await enrol('refused', FROM_NO_PROJECT);
    expect(refused.copyError).toBe('the copier said no');
    projects = projectServiceFor({
      copyAgents: async () => {
        throw new Error('disk on fire');
      },
    });
    const thrown = await enrol('thrown', FROM_NO_PROJECT);
    expect(thrown.copyError).toContain('disk on fire');
    expect(projects.ids()).toHaveLength(2);
  });

  it('never calls the copier for none', async () => {
    await build();
    const copyAgents = vi.fn<ProjectsDeps['copyAgents'] & object>();
    projects = projectServiceFor({ copyAgents });
    await enrol('app', 'none');
    await enrol('other');
    expect(copyAgents).not.toHaveBeenCalled();
  });
});
