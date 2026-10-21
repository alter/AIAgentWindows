// room-view.ts
import { renderHistory } from './room-history';
import {
  ROOM_PARTICIPANTS,
  parseRoomConfig,
  type RoomConfigResult,
  type RoomEntry,
  type RoomEvent,
  type RoomMode,
  type RoomStatus,
} from './room-model';

export type RoomPhase = 'idle' | 'running' | RoomStatus;
export type CarryWhat = 'final' | 'history';
export const CARRY_KINDS: readonly CarryWhat[] = ['final', 'history'];

export interface RoomSnapshot {
  phase: RoomPhase;
  roomId: string | null;
  historyPath: string | null;
  entries: RoomEntry[];
  running: string[];
  completed: number;
  total: number;
}

export type RoomStartResult = { ok: true; roomId: string; historyPath: string } | { ok: false; error: string };

export interface RoomFormValues {
  prompt: string;
  mode: RoomMode;
  rounds: string;
  timeoutMinutes: string;
  checked: readonly string[];
}

const MS_PER_MINUTE = 60_000;

export function emptyRoomSnapshot(): RoomSnapshot {
  return { phase: 'idle', roomId: null, historyPath: null, entries: [], running: [], completed: 0, total: 0 };
}

export function applyRoomEvent(snapshot: RoomSnapshot, event: RoomEvent): RoomSnapshot {
  if (event.type === 'started') {
    return { phase: 'running', roomId: event.roomId, historyPath: event.historyPath, entries: [], running: [], completed: 0, total: event.total };
  }
  if (event.roomId !== snapshot.roomId) return snapshot;
  if (event.type === 'entry') return { ...snapshot, entries: [...snapshot.entries, event.entry] };
  if (event.type === 'finished') return { ...snapshot, phase: event.status, running: [] };
  const others = snapshot.running.filter((id) => id !== event.participantId);
  const running = event.state === 'running' ? [...others, event.participantId] : others;
  return { ...snapshot, running, completed: event.completed, total: event.total };
}

export function carryText(snapshot: RoomSnapshot, what: CarryWhat): string | null {
  if (snapshot.phase === 'running' || snapshot.roomId === null) return null;
  if (what === 'history') return renderHistory(snapshot.roomId, snapshot.entries);
  const last = [...snapshot.entries].reverse().find((entry) => entry.kind === 'reply');
  return last === undefined || last.text.length === 0 ? null : last.text;
}

export function formToConfig(form: RoomFormValues): RoomConfigResult {
  const participants = ROOM_PARTICIPANTS.filter((item) => form.checked.includes(item.id));
  const rounds = form.mode === 'broadcast' ? 1 : Number(form.rounds);
  const minutes = form.timeoutMinutes.trim() === '' ? Number.NaN : Number(form.timeoutMinutes);
  return parseRoomConfig({
    prompt: form.prompt,
    mode: form.mode,
    rounds,
    participants,
    turnTimeoutMs: Math.round(minutes * MS_PER_MINUTE),
  });
}
