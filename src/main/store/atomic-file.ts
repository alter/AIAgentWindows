// atomic-file.ts
import { randomBytes } from 'node:crypto';
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const TEMP_NAME = /\.(\d+)(?:\.[0-9a-f]+)?\.tmp$/;

export interface AtomicDeps {
  suffix: () => string;
}

const defaults: AtomicDeps = { suffix: () => randomBytes(4).toString('hex') };

export async function writeAtomic(file: string, text: string, deps: AtomicDeps = defaults): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${deps.suffix()}.tmp`;
  try {
    await writeFile(temp, text, { encoding: 'utf8', flag: 'wx' });
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function pidAlive(pid: number, kill: (pid: number, signal: 0) => unknown = process.kill): boolean {
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

export async function sweepStaleTemps(dir: string, alive: (pid: number) => boolean = pidAlive): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = TEMP_NAME.exec(entry.name);
    if (match === null || alive(Number(match[1]))) continue;
    await rm(path.join(dir, entry.name), { force: true });
    removed.push(entry.name);
  }
  return removed;
}
