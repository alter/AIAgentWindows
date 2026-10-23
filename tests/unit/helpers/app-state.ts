// app-state.ts
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { serializeState, type AppState } from '../../../src/shared/agents';
import { AppStateStore, STATE_FILE_NAME } from '../../../src/main/store/app-state';

export async function openStore(dir: string, initial?: AppState): Promise<AppStateStore> {
  if (initial !== undefined) await writeFile(path.join(dir, STATE_FILE_NAME), serializeState(initial), 'utf8');
  return AppStateStore.open(dir);
}
