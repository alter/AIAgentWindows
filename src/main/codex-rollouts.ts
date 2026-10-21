// codex-rollouts.ts
import { open, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Rollout } from '../shared/codex-claim';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAYS = 60;
const FIRST_LINE_BYTES = 64 * 1024;

export function codexHome(env: Readonly<Record<string, string | undefined>>): string {
  return env['CODEX_HOME'] || path.join(os.homedir(), '.codex');
}

function dayDirectory(root: string, timeMs: number): string {
  const date = new Date(timeMs);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return path.join(root, 'sessions', String(date.getFullYear()), pad(date.getMonth() + 1), pad(date.getDate()));
}

async function readFirstLine(file: string): Promise<string> {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(FIRST_LINE_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, FIRST_LINE_BYTES, 0);
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    const newline = text.indexOf('\n');
    return newline === -1 ? text : text.slice(0, newline);
  } finally {
    await handle.close();
  }
}

async function readRollout(directory: string, fileName: string): Promise<Rollout | null> {
  const file = path.join(directory, fileName);
  try {
    const info = await stat(file);
    return { fileName, firstLine: await readFirstLine(file), createdAtMs: info.birthtimeMs || info.mtimeMs };
  } catch {
    return null;
  }
}

async function listDirectory(directory: string): Promise<Rollout[]> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return [];
  }
  const found = await Promise.all(names.filter((name) => name.startsWith('rollout-')).map((name) => readRollout(directory, name)));
  return found.filter((item): item is Rollout => item !== null);
}

export async function listRollouts(home: string, sinceMs: number, nowMs: number = Date.now()): Promise<Rollout[]> {
  const first = Math.max(sinceMs - DAY_MS, nowMs - MAX_DAYS * DAY_MS);
  const directories = new Set<string>();
  for (let time = first; time <= nowMs + DAY_MS; time += DAY_MS) directories.add(dayDirectory(home, time));
  const lists = await Promise.all([...directories].map((directory) => listDirectory(directory)));
  return lists.flat();
}
