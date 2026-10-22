// room-archive.ts
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MAX_RECORD_BYTES, isRoomId, parseRoomRecord, type RoomRecord, type RoomRecordStatus } from '../shared/room-model';

export const LIST_LIMIT = 200;
const FIRST_PROMPT_CHARS = 120;
const RECORD_SUFFIX = '.json';

export type RoomListItem =
  | { id: string; unreadable: false; createdAt: number; updatedAt: number; status: RoomRecordStatus; firstPrompt: string }
  | { id: string; unreadable: true };

export function recordPath(roomsDir: string, id: string): string {
  if (!isRoomId(id)) throw new Error('invalid room id');
  const root = path.resolve(roomsDir);
  const file = path.resolve(root, `${id}${RECORD_SUFFIX}`);
  if (path.dirname(file) !== root) throw new Error('room record outside the rooms directory');
  return file;
}

export async function writeRecord(roomsDir: string, record: RoomRecord): Promise<void> {
  const file = recordPath(roomsDir, record.id);
  await mkdir(roomsDir, { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(record), 'utf8');
  await rename(temp, file);
}

async function loadFile(file: string, id: string): Promise<RoomRecord | null> {
  try {
    if ((await stat(file)).size > MAX_RECORD_BYTES) return null;
    const record = parseRoomRecord(JSON.parse(await readFile(file, 'utf8')));
    return record !== null && record.id === id ? record : null;
  } catch {
    return null;
  }
}

export async function readRecord(roomsDir: string, id: string): Promise<RoomRecord | null> {
  if (!isRoomId(id)) return null;
  return loadFile(recordPath(roomsDir, id), id);
}

async function recordIds(roomsDir: string): Promise<string[]> {
  try {
    const names = await readdir(roomsDir, { withFileTypes: true });
    return names
      .filter((item) => item.isFile() && item.name.endsWith(RECORD_SUFFIX))
      .map((item) => item.name.slice(0, -RECORD_SUFFIX.length))
      .filter(isRoomId);
  } catch {
    return [];
  }
}

function firstPromptLine(record: RoomRecord): string {
  const prompt = record.entries.find((item) => item.kind === 'prompt');
  const line = (prompt?.text ?? '').split(/\r\n|[\n\r]/)[0] ?? '';
  return line.slice(0, FIRST_PROMPT_CHARS);
}

export async function listRecords(roomsDir: string): Promise<RoomListItem[]> {
  const readable: Extract<RoomListItem, { unreadable: false }>[] = [];
  const unreadable: RoomListItem[] = [];
  for (const id of await recordIds(roomsDir)) {
    const record = await readRecord(roomsDir, id);
    if (record === null) {
      unreadable.push({ id, unreadable: true });
    } else {
      readable.push({
        id,
        unreadable: false,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        status: record.status,
        firstPrompt: firstPromptLine(record),
      });
    }
  }
  readable.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  unreadable.sort((a, b) => a.id.localeCompare(b.id));
  return [...readable, ...unreadable].slice(0, LIST_LIMIT);
}

export async function stopInterrupted(roomsDir: string): Promise<string[]> {
  const stopped: string[] = [];
  for (const id of await recordIds(roomsDir)) {
    const record = await readRecord(roomsDir, id);
    if (record === null || record.status !== 'running') continue;
    await writeRecord(roomsDir, { ...record, status: 'stopped' });
    stopped.push(id);
  }
  return stopped.sort();
}
