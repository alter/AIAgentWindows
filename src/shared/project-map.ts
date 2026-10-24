// project-map.ts
import { isDenied } from './deny-list';

export const MAP_DOCUMENT_NAMES: readonly string[] = ['README.md', 'CLAUDE.md', 'AGENTS.md'];

export interface MapLimits {
  maxBytes: number;
  maxPaths: number;
  maxDocumentBytes: number;
}

export const DEFAULT_MAP_LIMITS: MapLimits = { maxBytes: 48 * 1024, maxPaths: 1500, maxDocumentBytes: 12 * 1024 };

export interface MapDocument {
  path: string;
  content?: string;
}

export interface ProjectMapInput {
  paths: readonly string[];
  documents: readonly MapDocument[];
}

export interface ProjectMap {
  text: string;
  listed: number;
  shown: number;
  folded: boolean;
  documents: string[];
  omitted: string[];
}

const HEADER = 'Project files (paths relative to the project folder; a folder shown with a count is folded):';
const EMPTY_LINE = '(no files)';
const MORE_RESERVE = 48;
const DRIVE_PREFIX = /^[A-Za-z]:/;

const encoder = new TextEncoder();

function sizeOf(text: string): number {
  return encoder.encode(text).length;
}

function hasUnusableCharacter(rel: string): boolean {
  return [...rel].some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127 || char === '\\';
  });
}

export function isListablePath(rel: string): boolean {
  if (rel === '' || rel.startsWith('/') || DRIVE_PREFIX.test(rel) || hasUnusableCharacter(rel)) return false;
  if (rel.split('/').some((part) => part === '' || part === '.' || part === '..')) return false;
  return !isDenied(rel);
}

function entriesAt(files: readonly string[], depth: number): string[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    const parts = file.split('/');
    const key = parts.length <= depth ? file : `${parts.slice(0, depth).join('/')}/`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([key, count]) => (key.endsWith('/') ? `${key} (${count} files)` : key));
}

interface Tree {
  lines: string[];
  folded: boolean;
}

function treeLines(files: readonly string[], limits: MapLimits, budget: number): Tree {
  if (files.length === 0) return { lines: [EMPTY_LINE], folded: false };
  const deepest = Math.max(...files.map((file) => file.split('/').length));
  for (let depth = deepest; depth >= 1; depth -= 1) {
    const lines = entriesAt(files, depth);
    if (lines.length <= limits.maxPaths && sizeOf(lines.join('\n')) <= budget) return { lines, folded: depth < deepest };
  }
  const top = entriesAt(files, 1);
  const kept: string[] = [];
  let used = MORE_RESERVE;
  for (const line of top) {
    used += sizeOf(line) + 1;
    if (kept.length + 1 >= limits.maxPaths || used > budget) break;
    kept.push(line);
  }
  return { lines: [...kept, `... and ${top.length - kept.length} more entries`], folded: true };
}

interface Sections {
  text: string;
  included: string[];
  omitted: string[];
}

function documentSections(files: ReadonlySet<string>, documents: readonly MapDocument[], limits: MapLimits): Sections {
  const budget = Math.floor(limits.maxBytes / 2);
  const included: string[] = [];
  const omitted: string[] = [];
  let text = '';
  for (const name of MAP_DOCUMENT_NAMES) {
    if (!files.has(name)) continue;
    const content = documents.find((candidate) => candidate.path === name)?.content;
    const section = content === undefined ? '' : `\n\n--- ${name} ---\n${content}`;
    if (content === undefined || sizeOf(content) > limits.maxDocumentBytes || sizeOf(text + section) > budget) omitted.push(name);
    else {
      included.push(name);
      text += section;
    }
  }
  return { text, included, omitted };
}

export function buildProjectMap(input: ProjectMapInput, limits: MapLimits = DEFAULT_MAP_LIMITS): ProjectMap {
  const files = [...new Set(input.paths.filter(isListablePath))].sort();
  const sections = documentSections(new Set(files), input.documents, limits);
  const budget = limits.maxBytes - sizeOf(sections.text) - sizeOf(HEADER) - 1;
  const tree = treeLines(files, limits, budget);
  return {
    text: `${HEADER}\n${tree.lines.join('\n')}${sections.text}`,
    listed: files.length,
    shown: files.length === 0 ? 0 : tree.lines.length,
    folded: tree.folded,
    documents: sections.included,
    omitted: sections.omitted,
  };
}
