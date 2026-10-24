// service.ts
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  isProjectId,
  nameFromFolder,
  parseFolderName,
  parseProjectName,
  type PickParentResult,
  type Project,
  type ProjectActionResult,
  type ProjectResult,
  type ProjectView,
} from '../../shared/projects';
import type { AppStateStore } from '../store/app-state';
import type { GitOutcome } from './git';

export interface ProjectGit {
  available(): Promise<GitOutcome>;
  init(folder: string): Promise<GitOutcome>;
}

export interface ProjectClosable {
  canClose(id: string): string | null;
  closeProject(id: string): void | Promise<void>;
}

export type TrashFn = (file: string) => Promise<void>;

export interface ProjectsDeps {
  store: Pick<AppStateStore, 'read' | 'update' | 'failure'>;
  userData: string;
  git: ProjectGit;
  pickFolder(): Promise<string | null>;
  trash: TrashFn;
  now?(): number;
  newId?(): string;
  newToken?(): string;
}

export type FolderLookup = { ok: true; folder: string } | { ok: false; error: string };

const INSIDE_USER_DATA = 'A project folder cannot live inside the application data folder.';

class DuplicateFolder extends Error {
  constructor(readonly name: string) {
    super(name);
  }
}

function duplicateMessage(name: string): string {
  return `This folder is already the project "${name}".`;
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function missingAsNull<T>(work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function isFolderHere(folder: string): Promise<boolean> {
  try {
    const real = await realpath(folder);
    return real === folder && (await stat(real)).isDirectory();
  } catch {
    return false;
  }
}

export function storageFolder(root: string, id: string): string {
  const target = path.join(root, id);
  if (!isProjectId(id) || path.dirname(target) !== root) throw new Error('the storage folder is not a direct child of the projects folder');
  return target;
}

function viewOf(project: Project, missing: boolean): ProjectView {
  return { id: project.id, name: project.name, folder: project.folder, missing };
}

export class ProjectService {
  private readonly closables: ProjectClosable[] = [];
  private pending: { token: string; parent: string } | null = null;

  constructor(private readonly deps: ProjectsDeps) {}

  register(closable: ProjectClosable): void {
    this.closables.push(closable);
  }

  private projects(): Project[] {
    return this.deps.store.read().projects ?? [];
  }

  async list(): Promise<ProjectView[]> {
    return Promise.all(this.projects().map(async (project) => viewOf(project, !(await isFolderHere(project.folder)))));
  }

  async folderOf(id: string): Promise<FolderLookup> {
    const project = this.projects().find((item) => item.id === id);
    if (project === undefined) return fail('The project no longer exists.');
    if (!(await isFolderHere(project.folder))) return fail(`Project missing: the folder of "${project.name}" is gone or moved (${project.folder}).`);
    return { ok: true, folder: project.folder };
  }

  async pickParent(): Promise<PickParentResult> {
    const parent = await this.deps.pickFolder();
    if (parent === null) return { ok: false };
    this.pending = { token: (this.deps.newToken ?? randomUUID)(), parent };
    return { ok: true, token: this.pending.token, parentName: path.basename(parent) };
  }

  async create(token: string, name: string): Promise<ProjectResult> {
    const pending = this.pending;
    if (pending === null || pending.token !== token) return fail('The parent folder choice has expired: choose the parent folder again.');
    const checked = parseFolderName(name);
    if (!checked.ok) return fail(checked.error);
    const refused = this.deps.store.failure();
    if (refused !== null) return fail(refused);
    this.pending = null;
    try {
      return await this.createFolder(pending.parent, checked.name);
    } catch (error) {
      return fail(messageOf(error));
    }
  }

  async addExisting(): Promise<ProjectResult> {
    const picked = await this.deps.pickFolder();
    if (picked === null) return { ok: false, error: 'No folder was chosen.', cancelled: true };
    const refused = this.deps.store.failure();
    if (refused !== null) return fail(refused);
    try {
      const folder = await realpath(picked);
      if (!(await stat(folder)).isDirectory()) return fail('That is not a folder.');
      if (await this.insideUserData(folder)) return fail(INSIDE_USER_DATA);
      return await this.enroll(folder, nameFromFolder(folder));
    } catch (error) {
      return fail(messageOf(error));
    }
  }

  async rename(id: string, name: string): Promise<ProjectActionResult> {
    const clean = parseProjectName(name);
    if (clean === null) return fail('The name must be 1 to 80 characters without control characters.');
    if (!this.projects().some((item) => item.id === id)) return fail('The project no longer exists.');
    try {
      await this.deps.store.update('projects', (current) => (current ?? []).map((item) => (item.id === id ? { ...item, name: clean } : item)));
      return { ok: true };
    } catch (error) {
      return fail(messageOf(error));
    }
  }

  async delete(id: string): Promise<ProjectActionResult> {
    if (!this.projects().some((item) => item.id === id)) return fail('The project no longer exists.');
    const refused = this.deps.store.failure();
    if (refused !== null) return fail(refused);
    for (const closable of this.closables) {
      const veto = closable.canClose(id);
      if (veto !== null) return fail(veto);
    }
    try {
      for (const closable of this.closables) await closable.closeProject(id);
      await this.deps.store.update('projects', (current) => (current ?? []).filter((item) => item.id !== id));
    } catch (error) {
      return fail(messageOf(error));
    }
    const warning = await this.trashStorage(id);
    return warning === null ? { ok: true } : { ok: true, warning };
  }

  private async createFolder(parentPicked: string, name: string): Promise<ProjectResult> {
    const git = await this.deps.git.available();
    if (!git.ok) return fail(git.error);
    const parent = await realpath(parentPicked);
    if (!(await stat(parent)).isDirectory()) return fail('The parent is not a folder.');
    const folder = path.join(parent, name);
    if (await this.insideUserData(folder)) return fail(INSIDE_USER_DATA);
    try {
      await mkdir(folder);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        return fail(`A folder named "${name}" already exists there. To use it, add it with "Existing folder".`);
      }
      return fail(`The folder could not be created: ${messageOf(error)}`);
    }
    const init = await this.deps.git.init(folder);
    if (!init.ok) return fail(`${init.error} The folder ${folder} was created and stays there.`);
    return this.enroll(await realpath(folder), name);
  }

  private async insideUserData(folder: string): Promise<boolean> {
    const root = await realpath(this.deps.userData);
    return folder === root || folder.startsWith(`${root}${path.sep}`);
  }

  private async enroll(folder: string, name: string): Promise<ProjectResult> {
    const project: Project = { id: (this.deps.newId ?? randomUUID)(), name, folder, createdAt: (this.deps.now ?? Date.now)() };
    const known = this.projects().find((item) => item.folder === folder);
    if (known !== undefined) return fail(duplicateMessage(known.name));
    await mkdir(path.join(this.deps.userData, 'projects', project.id), { recursive: true });
    try {
      await this.deps.store.update('projects', (current) => {
        const taken = (current ?? []).find((item) => item.folder === folder);
        if (taken !== undefined) throw new DuplicateFolder(taken.name);
        return [...(current ?? []), project];
      });
    } catch (error) {
      return fail(error instanceof DuplicateFolder ? duplicateMessage(error.name) : messageOf(error));
    }
    return { ok: true, project: viewOf(project, false) };
  }

  private async trashStorage(id: string): Promise<string | null> {
    try {
      const root = await missingAsNull(() => realpath(path.join(this.deps.userData, 'projects')));
      if (root === null) return null;
      const target = storageFolder(root, id);
      if ((await missingAsNull(() => lstat(target))) === null) return null;
      await this.deps.trash(target);
      return null;
    } catch (error) {
      return `The project was removed from the list, but its storage folder could not be moved to the Trash: ${messageOf(error)}`;
    }
  }
}
