// app-state.ts
import path from 'node:path';
import { emptyState, MAX_STATE_BYTES, type AppState } from '../../shared/agents';
import { migrateLegacyState, parseLegacyState } from '../../shared/legacy-state';
import { readState, saveState, stateFailure } from '../state-file';
import { JsonFile } from './json-file';

export const STATE_FILE_NAME = 'state.json';
export const LEGACY_FILE_NAME = 'agents.json';

export type StateSlice = Exclude<keyof AppState, 'version'>;

export class StateRefusedError extends Error {}

export class AppStateStore {
  private chain: Promise<void> = Promise.resolve();

  private constructor(
    readonly file: string,
    private doc: AppState,
    private problem: string | null,
  ) {}

  static async open(userData: string): Promise<AppStateStore> {
    const file = path.join(userData, STATE_FILE_NAME);
    const read = await readState(file);
    if (read.kind === 'ok') return new AppStateStore(file, read.value, null);
    if (read.kind === 'unreadable') return new AppStateStore(file, emptyState(), `${file} cannot be read (${read.error}); it is left untouched`);
    return AppStateStore.migrate(userData, file);
  }

  private static async migrate(userData: string, file: string): Promise<AppStateStore> {
    const legacyFile = path.join(userData, LEGACY_FILE_NAME);
    const legacy = await new JsonFile(legacyFile, { maxBytes: MAX_STATE_BYTES, parse: parseLegacyState }).read();
    if (legacy.kind === 'missing') return new AppStateStore(file, emptyState(), null);
    if (legacy.kind === 'unreadable') {
      return new AppStateStore(file, emptyState(), `${legacyFile} cannot be read (${legacy.error}); ${file} was not created and nothing is changed`);
    }
    const doc = migrateLegacyState(legacy.value);
    try {
      await saveState(file, doc);
    } catch (error) {
      return new AppStateStore(file, emptyState(), `${file} could not be written (${(error as Error).message}); nothing is changed`);
    }
    return new AppStateStore(file, doc, null);
  }

  read(): AppState {
    return this.doc;
  }

  failure(): string | null {
    return this.problem ?? stateFailure(this.file);
  }

  update<K extends StateSlice>(slice: K, change: (current: AppState[K]) => AppState[K]): Promise<void> {
    const run = async (): Promise<void> => {
      const refused = this.failure();
      if (refused !== null) throw new StateRefusedError(refused);
      const kept = Object.entries({ ...this.doc, [slice]: change(this.doc[slice]) }).filter(([, value]) => value !== undefined);
      const next = Object.fromEntries(kept) as unknown as AppState;
      await saveState(this.file, next);
      this.doc = next;
    };
    this.chain = this.chain.then(run, run);
    return this.chain;
  }
}
