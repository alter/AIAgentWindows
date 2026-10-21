// room-view.ts
import { SITE_KINDS_WITH_ADAPTER, isSiteKind, type SiteKind } from './agents';
import { renderCarryHistory } from './room-history';
import {
  ROOM_PARTICIPANTS,
  defaultFinalizerId,
  parseRoomConfig,
  type RoomConfigResult,
  type RoomEntry,
  type RoomEvent,
  type PausedSession,
  type RoomMode,
  type RoomParticipant,
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
  paused: PausedSession[];
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
  finalizerId?: string;
}

const MS_PER_MINUTE = 60_000;

export interface ParticipantAvailability {
  available: boolean;
  note: string;
}

export function missingAdapterNote(label: string): string {
  return `${label} has no site adapter`;
}

export function participantAvailability(
  participant: RoomParticipant,
  withAdapter: readonly SiteKind[] = SITE_KINDS_WITH_ADAPTER,
): ParticipantAvailability {
  const kind = participant.kind;
  if (!isSiteKind(kind) || withAdapter.includes(kind)) return { available: true, note: '' };
  return { available: false, note: missingAdapterNote(participant.label) };
}

export function emptyRoomSnapshot(): RoomSnapshot {
  return { phase: 'idle', roomId: null, historyPath: null, entries: [], running: [], paused: [], completed: 0, total: 0 };
}

export function applyRoomEvent(snapshot: RoomSnapshot, event: RoomEvent): RoomSnapshot {
  if (event.type === 'started') {
    return { phase: 'running', roomId: event.roomId, historyPath: event.historyPath, entries: [], running: [], paused: [], completed: 0, total: event.total };
  }
  if (event.roomId !== snapshot.roomId) return snapshot;
  if (event.type === 'entry') return { ...snapshot, entries: [...snapshot.entries, event.entry] };
  if (event.type === 'finished') return { ...snapshot, phase: event.status, running: [], paused: [] };
  if (event.type === 'paused') {
    const { participantId, sessionId, note } = event;
    return { ...snapshot, paused: [...snapshot.paused.filter((item) => item.participantId !== participantId), { participantId, sessionId, note }] };
  }
  if (event.type === 'resumed') return { ...snapshot, paused: snapshot.paused.filter((item) => item.participantId !== event.participantId) };
  const others = snapshot.running.filter((id) => id !== event.participantId);
  const running = event.state === 'running' ? [...others, event.participantId] : others;
  return { ...snapshot, running, completed: event.completed, total: event.total };
}

export function carryText(snapshot: RoomSnapshot, what: CarryWhat): string | null {
  if (snapshot.phase === 'running' || snapshot.roomId === null) return null;
  if (what === 'history') return renderCarryHistory(snapshot.roomId, snapshot.entries);
  const newest = [...snapshot.entries].reverse();
  const last = newest.find((entry) => entry.kind === 'final') ?? newest.find((entry) => entry.kind === 'reply');
  return last === undefined || last.text.length === 0 ? null : last.text;
}

export function resolveFinalizer(checked: readonly string[], previous: string): string {
  const ticked = ROOM_PARTICIPANTS.filter((item) => checked.includes(item.id));
  return ticked.some((item) => item.id === previous) ? previous : defaultFinalizerId(ticked);
}

export function formToConfig(form: RoomFormValues, withAdapter: readonly SiteKind[] = SITE_KINDS_WITH_ADAPTER): RoomConfigResult {
  const participants = ROOM_PARTICIPANTS.filter((item) => form.checked.includes(item.id));
  const unavailable = participants.find((item) => !participantAvailability(item, withAdapter).available);
  if (unavailable !== undefined) return { ok: false, error: participantAvailability(unavailable, withAdapter).note };
  const rounds = Number(form.rounds);
  const minutes = form.timeoutMinutes.trim() === '' ? Number.NaN : Number(form.timeoutMinutes);
  return parseRoomConfig({
    prompt: form.prompt,
    mode: form.mode,
    rounds,
    participants,
    finalizerId: resolveFinalizer(form.checked, form.finalizerId ?? ''),
    turnTimeoutMs: Math.round(minutes * MS_PER_MINUTE),
  });
}
