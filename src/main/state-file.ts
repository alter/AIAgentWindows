// state-file.ts
import { emptyState, MAX_STATE_BYTES, parseState, serializeState, STATE_VERSION, type AppState } from '../shared/agents';
import { JsonFile } from './store/json-file';

const files = new Map<string, JsonFile<AppState>>();

function parseShape(raw: unknown): AppState {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('not an object');
  const version = (raw as Record<string, unknown>)['version'];
  if (version !== STATE_VERSION) throw new Error(`version ${String(version)} is not ${STATE_VERSION}`);
  return parseState(JSON.stringify(raw));
}

function fileFor(file: string): JsonFile<AppState> {
  let known = files.get(file);
  if (known === undefined) {
    known = new JsonFile(file, { maxBytes: MAX_STATE_BYTES, parse: parseShape });
    files.set(file, known);
  }
  return known;
}

export async function loadState(file: string): Promise<AppState> {
  const read = await fileFor(file).read();
  return read.kind === 'ok' ? read.value : emptyState();
}

export function stateFailure(file: string): string | null {
  return files.get(file)?.failure() ?? null;
}

export async function saveState(file: string, state: AppState): Promise<void> {
  await fileFor(file).write(serializeState(state));
}
