// projects.ts
import { hasControlCharacter, parseTitle } from './title';

export const MAX_PROJECT_NAME_CHARS = 80;
export const MAX_FOLDER_NAME_BYTES = 255;
export const MAX_PROJECTS = 500;
export const MAX_FOLDER_PATH_BYTES = 4096;

const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/;
const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface Project {
  id: string;
  name: string;
  folder: string;
  createdAt: number;
}

export interface ProjectView {
  id: string;
  name: string;
  folder: string;
  missing: boolean;
}

export type PickParentResult = { ok: true; token: string; parentName: string } | { ok: false };
export type ProjectResult = { ok: true; project: ProjectView; copied?: number; copyError?: string } | { ok: false; error: string; cancelled?: true };
export type FolderLookup = { ok: true; folder: string } | { ok: false; error: string };
export type ProjectActionResult = { ok: true; warning?: string } | { ok: false; error: string };

export function isProjectId(value: unknown): value is string {
  return typeof value === 'string' && PROJECT_ID_PATTERN.test(value);
}

export function parseProjectName(value: unknown): string | null {
  return parseTitle(value, MAX_PROJECT_NAME_CHARS);
}

export type FolderNameCheck = { ok: true; name: string } | { ok: false; error: string };

export function parseFolderName(value: unknown): FolderNameCheck {
  if (typeof value !== 'string' || value.length === 0) return { ok: false, error: 'Type a name for the new folder.' };
  if (value === '.' || value === '..' || value.includes('/') || value.includes('\\')) {
    return { ok: false, error: 'The name must be one folder name, without slashes or dots-only names.' };
  }
  if (hasControlCharacter(value)) return { ok: false, error: 'The name contains a control character.' };
  if (value !== value.trim()) return { ok: false, error: 'The name must not start or end with a space.' };
  if (Buffer.byteLength(value, 'utf8') > MAX_FOLDER_NAME_BYTES) return { ok: false, error: 'The name is too long.' };
  if (parseProjectName(value) === null) return { ok: false, error: `The name is longer than ${MAX_PROJECT_NAME_CHARS} characters.` };
  return { ok: true, name: value };
}

export function nameFromFolder(folder: string): string {
  const base = folder.split(/[\\/]/).filter((part) => part.length > 0).at(-1) ?? '';
  const printable = Array.from(base).filter((char) => !hasControlCharacter(char)).join('');
  return parseProjectName(base) ?? parseProjectName(printable.slice(0, MAX_PROJECT_NAME_CHARS)) ?? 'Project';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseProject(raw: unknown): Project | null {
  if (!isRecord(raw)) return null;
  const { id, name, folder, createdAt } = raw;
  if (!isProjectId(id)) return null;
  const clean = parseProjectName(name);
  if (clean === null || clean !== name) return null;
  if (typeof folder !== 'string' || !ABSOLUTE_PATH.test(folder) || Buffer.byteLength(folder, 'utf8') > MAX_FOLDER_PATH_BYTES) return null;
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt) || createdAt < 0) return null;
  return { id, name: clean, folder, createdAt };
}

export function parseProjects(raw: unknown): Project[] {
  if (!Array.isArray(raw) || raw.length > MAX_PROJECTS) throw new Error('projects is not a list of at most 500');
  const seen = new Set<string>();
  return raw.map((item: unknown) => {
    const project = parseProject(item);
    if (project === null) throw new Error('a project is not valid');
    if (seen.has(project.id)) throw new Error('a project id is repeated');
    seen.add(project.id);
    return project;
  });
}
