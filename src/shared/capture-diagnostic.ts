// capture-diagnostic.ts
import { HTML_TAGS } from './capture-sanitize';

export const AUTO_STATUSES = ['saved', 'no-chat', 'not-signed-in', 'leak-refused', 'no-agent', 'failed'] as const;
export type AutoStatus = (typeof AUTO_STATUSES)[number];

export const PATH_WORDS: readonly string[] = [
  'a', 'c', 's', 'g', 'chat', 'chats', 'conversation', 'conversations', 'share', 'app', 'project', 'projects', 'new', 'library', 'explore', 'history', 'settings', 'login', 'auth',
];

const MAX_SEGMENTS = 8;
const MAX_COUNT = 10_000_000;
const COUNTED_TAGS = new Set<string>([...HTML_TAGS, 'html', 'head', 'script', 'style', 'noscript', 'template', 'link', 'meta', 'title', 'base', 'other']);
const SITE = /^[a-z]{1,20}$/;

export function redactPath(pathname: string): string {
  const words = new Set(PATH_WORDS);
  const segments = pathname.split('/').filter((segment) => segment !== '').slice(0, MAX_SEGMENTS);
  return '/' + segments.map((segment) => (words.has(segment) ? segment : ':id')).join('/');
}

export interface WaitInfo {
  polls: number;
  waitedMs: number;
  messageListSeen: boolean;
  replySeen: boolean;
  settled: boolean;
  timedOut: boolean;
}

export interface ViewportInfo {
  width: number;
  height: number;
}

export interface DiagnosticInput {
  site: string;
  status: AutoStatus;
  landingPath: string | null;
  loadedPath: string | null;
  wait: WaitInfo | null;
  viewport: ViewportInfo | null;
  mainRegion: boolean | null;
  stats: unknown;
}

export interface Diagnostic {
  site: string;
  status: AutoStatus;
  landingPath: string | null;
  conversationLinkFound: boolean;
  loadedPath: string | null;
  wait: WaitInfo | null;
  viewport: ViewportInfo | null;
  mainRegion: boolean | null;
  elements: { before: Record<string, number>; after: Record<string, number> } | null;
  classes: { seen: number; closed: number; stylesheet: number; dropped: number } | null;
  stylesheets: { total: number; readable: number; unreadable: number; classNames: number } | null;
}

function record(raw: unknown): Record<string, unknown> | null {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

function count(raw: unknown): number {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= MAX_COUNT ? raw : 0;
}

function counts(raw: unknown, names: readonly string[]): Record<string, number> {
  const source = record(raw) ?? {};
  const result: Record<string, number> = {};
  for (const name of [...names].sort()) {
    const value = source[name];
    if (value !== undefined) result[name] = count(value);
  }
  return result;
}

function fixed<K extends string>(raw: unknown, keys: readonly K[]): Record<K, number> | null {
  const source = record(raw);
  if (source === null) return null;
  return Object.fromEntries(keys.map((key) => [key, count(source[key])])) as Record<K, number>;
}

export function buildDiagnostic(input: DiagnosticInput): Diagnostic {
  const stats = record(input.stats);
  const elements = record(stats?.['elements']);
  const tags = [...COUNTED_TAGS];
  return {
    site: SITE.test(input.site) ? input.site : 'x',
    status: input.status,
    landingPath: input.landingPath,
    conversationLinkFound: input.loadedPath !== null,
    loadedPath: input.loadedPath,
    wait: input.wait === null ? null : { ...input.wait, polls: count(input.wait.polls), waitedMs: count(input.wait.waitedMs) },
    viewport: input.viewport === null ? null : { width: count(input.viewport.width), height: count(input.viewport.height) },
    mainRegion: input.mainRegion,
    elements: elements === null ? null : { before: counts(elements['before'], tags), after: counts(elements['after'], tags) },
    classes: fixed(stats?.['classes'], ['seen', 'closed', 'stylesheet', 'dropped']),
    stylesheets: fixed(stats?.['stylesheets'], ['total', 'readable', 'unreadable', 'classNames']),
  };
}

export function diagnosticText(diagnostic: Diagnostic): string {
  return JSON.stringify(diagnostic, null, 2) + '\n';
}
