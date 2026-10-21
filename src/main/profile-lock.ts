// profile-lock.ts
import { execFile } from 'node:child_process';
import { readlink } from 'node:fs/promises';
import path from 'node:path';

export const APP_DIR_NAME = 'ai-agent-windows';

export interface ProcessRow {
  pid: number;
  ppid: number;
  command: string;
}

export interface ProfileLockDeps {
  processes(): Promise<ProcessRow[]>;
  readLink(file: string): Promise<string | null>;
  isAlive(pid: number): boolean;
  ownPid: number;
}

export function defaultUserData(platform: string, env: Readonly<Record<string, string | undefined>>, home: string): string {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', APP_DIR_NAME);
  if (platform === 'win32') return path.join(env['APPDATA'] ?? path.join(home, 'AppData', 'Roaming'), APP_DIR_NAME);
  return path.join(env['XDG_CONFIG_HOME'] ?? path.join(home, '.config'), APP_DIR_NAME);
}

export function parseProcessList(text: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (match !== null) rows.push({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] ?? '' });
  }
  return rows;
}

export function holdsProfile(row: ProcessRow, userData: string, ownPid: number): boolean {
  if (row.pid === ownPid) return false;
  const flag = `--user-data-dir=${userData}`;
  const at = row.command.indexOf(flag);
  if (at < 0) return false;
  const after = row.command.slice(at + flag.length);
  return after === '' || after.startsWith(' ');
}

export async function profileInUse(userData: string, deps: ProfileLockDeps): Promise<string | null> {
  let rows: ProcessRow[];
  try {
    rows = await deps.processes();
  } catch {
    return 'the process list cannot be read, so it is not known whether another instance holds the profile';
  }
  const holder = rows.find((row) => holdsProfile(row, userData, deps.ownPid));
  if (holder !== undefined) return `process ${holder.pid} holds the profile ${userData}`;
  const target = await deps.readLink(path.join(userData, 'SingletonLock'));
  const pid = target === null ? NaN : Number(/-(\d+)$/.exec(target)?.[1]);
  if (Number.isInteger(pid) && pid !== deps.ownPid && deps.isAlive(pid)) return `process ${pid} holds the profile lock in ${userData}`;
  return null;
}

export function systemProfileLockDeps(): ProfileLockDeps {
  return {
    processes: () =>
      new Promise((resolve, reject) => {
        execFile('ps', ['-axww', '-o', 'pid=,ppid=,command='], { maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
          if (error !== null) reject(error);
          else resolve(parseProcessList(stdout));
        });
      }),
    readLink: async (file) => {
      try {
        return await readlink(file);
      } catch {
        return null;
      }
    },
    isAlive: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'EPERM';
      }
    },
    ownPid: process.pid,
  };
}
