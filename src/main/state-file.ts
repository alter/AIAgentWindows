// state-file.ts
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { emptyState, parseState, serializeState, type AppState } from '../shared/agents';

export async function loadState(file: string): Promise<AppState> {
  try {
    return parseState(await readFile(file, 'utf8'));
  } catch {
    return emptyState();
  }
}

export async function saveState(file: string, state: AppState): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, serializeState(state), 'utf8');
  await rename(temp, file);
}
