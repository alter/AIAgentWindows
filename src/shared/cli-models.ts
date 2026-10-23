// cli-models.ts
import { EFFORT_PATTERN, MODEL_PATTERN } from './room-model';

export const MAX_SUGGESTED_MODELS = 50;
export const MAX_SUGGESTED_EFFORTS = 20;
const MAX_HELP_BLOCK_LINES = 12;
const QUOTED_MODEL = /'([A-Za-z0-9._:[\]-]{1,64})'/g;

export interface ClaudeModels {
  models: string[];
  efforts: string[];
}

export interface CodexModel {
  id: string;
  efforts: string[];
}

export interface CodexModels {
  models: CodexModel[];
}

export interface RoomModels {
  claude: ClaudeModels;
  codex: CodexModels;
}

export function emptyRoomModels(): RoomModels {
  return { claude: { models: [], efforts: [] }, codex: { models: [] } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function uniqueShaped(items: Iterable<unknown>, pattern: RegExp, limit: number): string[] {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.size >= limit) break;
    if (typeof item === 'string' && pattern.test(item)) seen.add(item);
  }
  return [...seen];
}

function helpBlock(text: string, flag: string): string {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^\\s*(?:-\\w,\\s*)?${flag}(?=[\\s<=]|$)`).test(line));
  if (start < 0) return '';
  const block = [lines[start] ?? ''];
  for (let index = start + 1; index < lines.length && block.length < MAX_HELP_BLOCK_LINES; index += 1) {
    const line = lines[index] ?? '';
    if (line.trim() === '' || /^\s*-/.test(line)) break;
    block.push(line);
  }
  return block.join(' ');
}

export function parseClaudeHelpModels(helpText: string): ClaudeModels {
  const quoted = [...helpBlock(helpText, '--model').matchAll(QUOTED_MODEL)].map((match) => match[1]);
  const levels = /\(([^)]*)\)/.exec(helpBlock(helpText, '--effort'))?.[1] ?? '';
  return {
    models: uniqueShaped(quoted, MODEL_PATTERN, MAX_SUGGESTED_MODELS),
    efforts: uniqueShaped(levels.split(',').map((level) => level.trim()), EFFORT_PATTERN, MAX_SUGGESTED_EFFORTS),
  };
}

function levelsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const efforts = value.map((level) => (isRecord(level) ? level['effort'] : undefined));
  return uniqueShaped(efforts, EFFORT_PATTERN, MAX_SUGGESTED_EFFORTS);
}

export function parseCodexCatalog(value: unknown): CodexModels {
  const list = isRecord(value) && Array.isArray(value['models']) ? (value['models'] as unknown[]) : [];
  const models: CodexModel[] = [];
  for (const item of list) {
    if (models.length >= MAX_SUGGESTED_MODELS) break;
    if (!isRecord(item) || item['visibility'] !== 'list') continue;
    const id = item['slug'];
    if (typeof id !== 'string' || !MODEL_PATTERN.test(id) || models.some((model) => model.id === id)) continue;
    models.push({ id, efforts: levelsOf(item['supported_reasoning_levels']) });
  }
  return { models };
}

function parseLooseJson(text: string): unknown {
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first < 0 || last < first) return null;
  try {
    return JSON.parse(text.slice(first, last + 1));
  } catch {
    return null;
  }
}

export function parseCodexCatalogText(text: string | null): CodexModels {
  return parseCodexCatalog(text === null ? null : parseLooseJson(text));
}
