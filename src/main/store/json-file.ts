// json-file.ts
import { readFile } from 'node:fs/promises';
import { writeAtomic } from './atomic-file';

export type JsonRead<T> = { kind: 'missing' } | { kind: 'ok'; value: T } | { kind: 'unreadable'; error: string };

export interface JsonFileOptions<T> {
  maxBytes: number;
  parse: (raw: unknown) => T;
}

export class FailClosedError extends Error {
  constructor(readonly file: string, readonly reason: string) {
    super(`${file} cannot be read (${reason}); it is left untouched`);
  }
}

export class JsonFile<T> {
  private problem: string | null = null;

  constructor(readonly file: string, private readonly options: JsonFileOptions<T>) {}

  failure(): string | null {
    return this.problem;
  }

  async read(): Promise<JsonRead<T>> {
    let text: string;
    try {
      text = await readFile(this.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
      return this.fail((error as Error).message);
    }
    if (Buffer.byteLength(text, 'utf8') > this.options.maxBytes) return this.fail('too large');
    try {
      const value = this.options.parse(JSON.parse(text));
      this.problem = null;
      return { kind: 'ok', value };
    } catch (error) {
      return this.fail((error as Error).message);
    }
  }

  async write(text: string): Promise<void> {
    if (this.problem !== null) throw new FailClosedError(this.file, this.problem);
    await writeAtomic(this.file, text);
  }

  private fail(error: string): JsonRead<T> {
    this.problem = error;
    return { kind: 'unreadable', error };
  }
}
