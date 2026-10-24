// context-digest.ts
export const MAX_DIGEST_PARTS = 8;
export const MAX_DIGEST_FILES = 8;
const MAX_COUNT = 2_000_000_000;
const MAX_FILE_NAME = 255;
const HASH_PATTERN = /^[0-9a-f]{16}$/;
const PART_ID_PATTERN = /^[a-z][a-z-]{0,31}$/;

export interface DigestHistory {
  first: number;
  last: number;
  count: number;
}

export interface DigestPart {
  id: string;
  bytes: number;
  hash: string;
}

export interface DigestFile {
  name: string;
  bytes: number;
}

export interface DigestCut {
  via: 'budget' | 'inline';
  entries: number;
  mapChars: number;
}

export interface ContextDigest {
  history: DigestHistory;
  parts: DigestPart[];
  files: DigestFile[];
  map?: string;
  cut?: DigestCut;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_COUNT;
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && HASH_PATTERN.test(value);
}

function parseHistory(value: unknown): DigestHistory | null {
  if (!isRecord(value)) return null;
  const { first, last, count } = value;
  return isCount(first) && isCount(last) && isCount(count) ? { first, last, count } : null;
}

function parsePart(value: unknown): DigestPart | null {
  if (!isRecord(value)) return null;
  const { id, bytes, hash } = value;
  return typeof id === 'string' && PART_ID_PATTERN.test(id) && isCount(bytes) && isHash(hash) ? { id, bytes, hash } : null;
}

function isForbiddenNameChar(char: string): boolean {
  return char === '/' || char === '\\' || char.charCodeAt(0) === 0;
}

function parseFile(value: unknown): DigestFile | null {
  if (!isRecord(value)) return null;
  const { name, bytes } = value;
  if (typeof name !== 'string' || name === '' || name.length > MAX_FILE_NAME || [...name].some(isForbiddenNameChar) || !isCount(bytes)) return null;
  return { name, bytes };
}

function parseCut(value: unknown): DigestCut | null {
  if (!isRecord(value)) return null;
  const { via, entries, mapChars } = value;
  return (via === 'budget' || via === 'inline') && isCount(entries) && isCount(mapChars) ? { via, entries, mapChars } : null;
}

function parseList<T>(value: unknown, max: number, parse: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const items: T[] = [];
  for (const raw of value as unknown[]) {
    const item = parse(raw);
    if (item === null) return null;
    items.push(item);
  }
  return items;
}

export function parseDigest(value: unknown): ContextDigest | null {
  if (!isRecord(value)) return null;
  const history = parseHistory(value['history']);
  const parts = parseList(value['parts'], MAX_DIGEST_PARTS, parsePart);
  const files = parseList(value['files'], MAX_DIGEST_FILES, parseFile);
  if (history === null || parts === null || files === null) return null;
  const digest: ContextDigest = { history, parts, files };
  const { map, cut } = value;
  if (map !== undefined) {
    if (!isHash(map)) return null;
    digest.map = map;
  }
  if (cut !== undefined) {
    const parsed = parseCut(cut);
    if (parsed === null) return null;
    digest.cut = parsed;
  }
  return digest;
}
