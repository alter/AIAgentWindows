// pack-fit.ts
import { truncateText, type RoomEntry } from './room-model';

const MIN_MAP_CHARS = 200;
const FLOOR_SHARE = 4;

export interface FitInput {
  budget: number;
  map: string;
  entries: readonly RoomEntry[];
  base: number;
  blockSize(entry: RoomEntry): number;
}

export interface Fit {
  map: string;
  entries: RoomEntry[];
  cutEntries: number;
  cutMapChars: number;
}

function historySize(input: FitInput, entries: readonly RoomEntry[]): number {
  return entries.reduce((sum, entry) => sum + input.blockSize(entry), input.base);
}

function shrunkMap(map: string, allowed: number): string {
  if (allowed >= map.length) return map;
  return allowed < MIN_MAP_CHARS ? '' : truncateText(map, allowed);
}

function cutOldest(input: FitInput, allowed: number): RoomEntry[] {
  const kept = [...input.entries];
  const required = input.entries.map((entry) => entry.kind).lastIndexOf('prompt');
  let size = historySize(input, kept);
  const requiredEntry = required < 0 ? undefined : input.entries[required];
  for (const entry of input.entries) {
    if (size <= allowed) break;
    if (entry === requiredEntry) continue;
    kept.splice(kept.indexOf(entry), 1);
    size -= input.blockSize(entry);
  }
  return kept;
}

export function fitPack(input: FitInput): Fit {
  const history = historySize(input, input.entries);
  const room = input.budget - history;
  if (room >= input.map.length) return { map: input.map, entries: [...input.entries], cutEntries: 0, cutMapChars: 0 };
  const floor = Math.min(input.map.length, Math.floor(input.budget / FLOOR_SHARE));
  const wanted = shrunkMap(input.map, Math.max(floor, room));
  const entries = cutOldest(input, input.budget - wanted.length);
  const map = shrunkMap(wanted, Math.max(0, input.budget - historySize(input, entries)));
  return { map, entries, cutEntries: input.entries.length - entries.length, cutMapChars: input.map.length - map.length };
}
