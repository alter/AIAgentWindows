// map-files.ts
import { open, readdir, realpath, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import {
  buildProjectMap,
  DEFAULT_MAP_LIMITS,
  isListablePath,
  MAP_DOCUMENT_NAMES,
  type MapDocument,
  type MapLimits,
  type ProjectMap,
} from '../../shared/project-map';
import { simpleIgnore } from '../../shared/simple-ignore';
import type { ListOutcome } from './git';

export interface FileLister {
  listFiles(folder: string): Promise<ListOutcome>;
}

export interface CollectOptions {
  limits?: MapLimits;
  walkEntryLimit?: number;
}

export interface CollectedMap extends ProjectMap {
  via: 'git' | 'walk';
  incomplete: boolean;
  fallbackReason?: string;
}

const WALK_SKIPPED_NAMES: ReadonlySet<string> = new Set(['.git', 'node_modules']);
const DEFAULT_WALK_ENTRY_LIMIT = 100_000;
const IGNORE_FILE_BYTES = 64 * 1024;
const CHECK_CONCURRENCY = 32;

interface Listing {
  paths: string[];
  incomplete: boolean;
}

async function realFile(root: string, rel: string): Promise<string | null> {
  try {
    const real = await realpath(path.join(root, ...rel.split('/')));
    if (!isListablePath(path.relative(root, real).split(path.sep).join('/'))) return null;
    return (await stat(real)).isFile() ? real : null;
  } catch {
    return null;
  }
}

async function readBounded(file: string, cap: number): Promise<string | undefined> {
  try {
    const handle = await open(file, 'r');
    try {
      const buffer = Buffer.alloc(cap + 1);
      const { bytesRead } = await handle.read(buffer, 0, cap + 1, 0);
      const head = buffer.subarray(0, bytesRead);
      return bytesRead > cap || head.includes(0) ? undefined : head.toString('utf8');
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
}

async function mapWithLimit<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await work(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function topLevelIgnore(root: string): Promise<(rel: string, isDirectory: boolean) => boolean> {
  const file = await realFile(root, '.gitignore');
  const text = file === null ? undefined : await readBounded(file, IGNORE_FILE_BYTES);
  return simpleIgnore(text ?? '');
}

async function walkFiles(root: string, entryLimit: number): Promise<Listing> {
  const ignored = await topLevelIgnore(root);
  const paths: string[] = [];
  const pending = [''];
  let visited = 0;
  while (pending.length > 0) {
    const dir = pending.pop() as string;
    const entries = await readdir(path.join(root, dir), { withFileTypes: true }).catch(() => [] as Dirent[]);
    for (const entry of entries) {
      if (visited >= entryLimit) return { paths, incomplete: true };
      visited += 1;
      const rel = dir === '' ? entry.name : `${dir}/${entry.name}`;
      const isDirectory = entry.isDirectory();
      if (WALK_SKIPPED_NAMES.has(entry.name) || ignored(rel, isDirectory) || !isListablePath(rel)) continue;
      if (isDirectory) pending.push(rel);
      else paths.push(rel);
    }
  }
  return { paths, incomplete: false };
}

export async function collectProjectMap(folder: string, git: FileLister, options: CollectOptions = {}): Promise<CollectedMap> {
  const limits = options.limits ?? DEFAULT_MAP_LIMITS;
  const root = await realpath(folder);
  const listed = await git.listFiles(root);
  const listing: Listing = listed.ok ? { paths: listed.paths, incomplete: false } : await walkFiles(root, options.walkEntryLimit ?? DEFAULT_WALK_ENTRY_LIMIT);
  const candidates = listing.paths.filter(isListablePath);
  const resolved = await mapWithLimit(candidates, CHECK_CONCURRENCY, (rel) => realFile(root, rel));
  const files = new Map<string, string>();
  candidates.forEach((rel, index) => {
    const real = resolved[index];
    if (real !== null && real !== undefined) files.set(rel, real);
  });
  const documents: MapDocument[] = [];
  for (const name of MAP_DOCUMENT_NAMES) {
    const real = files.get(name);
    if (real !== undefined) documents.push({ path: name, content: await readBounded(real, limits.maxDocumentBytes) });
  }
  const map = buildProjectMap({ paths: [...files.keys()], documents }, limits);
  return { ...map, via: listed.ok ? 'git' : 'walk', incomplete: listing.incomplete, ...(listed.ok ? {} : { fallbackReason: listed.error }) };
}
