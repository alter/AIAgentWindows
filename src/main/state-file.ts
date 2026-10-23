// state-file.ts
import { emptyState, MAX_STATE_BYTES, parseStateDocument, serializeState, type AppState } from '../shared/agents';
import { JsonFile, type JsonRead } from './store/json-file';

const files = new Map<string, JsonFile<AppState>>();

function fileFor(file: string): JsonFile<AppState> {
  let known = files.get(file);
  if (known === undefined) {
    known = new JsonFile(file, { maxBytes: MAX_STATE_BYTES, parse: parseStateDocument });
    files.set(file, known);
  }
  return known;
}

export function readState(file: string): Promise<JsonRead<AppState>> {
  return fileFor(file).read();
}

export async function loadState(file: string): Promise<AppState> {
  const read = await readState(file);
  return read.kind === 'ok' ? read.value : emptyState();
}

export function stateFailure(file: string): string | null {
  return files.get(file)?.failure() ?? null;
}

export async function saveState(file: string, state: AppState): Promise<void> {
  await fileFor(file).write(serializeState(state));
}
