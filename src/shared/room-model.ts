// room-model.ts
import { AGENT_KINDS, AGENT_LABELS, type AgentKind } from './agents';

export const MIN_ROUNDS = 1;
export const MAX_ROUNDS = 50;
export const MAX_PROMPT_CHARS = 100000;
export const MIN_TURN_TIMEOUT_MS = 1000;
export const MAX_TURN_TIMEOUT_MS = 3_600_000;
export const DEFAULT_TURN_TIMEOUT_MS = 600000;
export const MAX_PARTICIPANTS = 16;
export const MAX_ID_CHARS = 128;
export const MAX_REPLY_CHARS = 1_000_000;
export const MAX_HISTORY_CHARS = 4_000_000;
export const MAX_ERROR_CHARS = 500;
const TRUNCATION_RESERVE = 64;

export type RoomMode = 'broadcast' | 'relay';
export type RoomEntryKind = 'prompt' | 'reply' | 'final' | 'error';

export interface RoomParticipant {
  id: string;
  kind: AgentKind;
  label: string;
}

export interface RoomConfig {
  prompt: string;
  mode: RoomMode;
  rounds: number;
  participants: RoomParticipant[];
  finalizerId: string;
  turnTimeoutMs: number;
}

export interface RoomEntry {
  authorId: string;
  label: string;
  time: number;
  kind: RoomEntryKind;
  text: string;
}

export type RoomStatus = 'done' | 'stopped' | 'failed';
export type StepState = 'running' | 'replied' | 'failed';

export interface PausedSession {
  participantId: string;
  sessionId: string;
  note: string;
}

export type RoomEvent =
  | { type: 'started'; roomId: string; historyPath: string; total: number }
  | { type: 'paused'; roomId: string; participantId: string; sessionId: string; note: string }
  | { type: 'resumed'; roomId: string; participantId: string }
  | { type: 'progress'; roomId: string; participantId: string; state: StepState; completed: number; total: number }
  | { type: 'entry'; roomId: string; entry: RoomEntry }
  | { type: 'finished'; roomId: string; status: RoomStatus };

export const ROOM_PARTICIPANTS: readonly RoomParticipant[] = AGENT_KINDS.map((kind) => ({
  id: kind,
  kind,
  label: AGENT_LABELS[kind],
}));

export function defaultFinalizerId(participants: readonly RoomParticipant[]): string {
  const claude = participants.find((participant) => participant.kind === 'claude');
  return (claude ?? participants[0])?.id ?? '';
}

export type RoomConfigResult = { ok: true; config: RoomConfig } | { ok: false; error: string };

export interface RelayOptions {
  returnToFirst?: boolean;
}

export function relaySchedule(
  participants: readonly RoomParticipant[],
  rounds: number,
  options: RelayOptions = {},
): RoomParticipant[] {
  const first = participants[0];
  if (!first) return [];
  const steps: RoomParticipant[] = [];
  for (let round = 0; round < rounds; round += 1) steps.push(...participants);
  if (options.returnToFirst && steps[steps.length - 1] !== first) steps.push(first);
  return steps;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= max;
}

function isAgentKind(value: unknown): value is AgentKind {
  return typeof value === 'string' && (AGENT_KINDS as readonly string[]).includes(value);
}

function parseParticipant(value: unknown): RoomParticipant | null {
  if (!isRecord(value)) return null;
  const { id, kind } = value;
  if (!isBoundedString(id, MAX_ID_CHARS) || !isAgentKind(kind)) return null;
  return { id, kind, label: AGENT_LABELS[kind] };
}

function parseParticipants(value: unknown): RoomParticipant[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PARTICIPANTS) return null;
  const parsed: RoomParticipant[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const participant = parseParticipant(item);
    if (!participant || seen.has(participant.id)) return null;
    seen.add(participant.id);
    parsed.push(participant);
  }
  return parsed;
}

export function parseRoomConfig(value: unknown): RoomConfigResult {
  if (!isRecord(value)) return { ok: false, error: 'room config must be an object' };
  const { prompt, mode, rounds, participants, turnTimeoutMs } = value;
  if (!isBoundedString(prompt, MAX_PROMPT_CHARS)) return { ok: false, error: `prompt must be 1..${MAX_PROMPT_CHARS} characters` };
  if (mode !== 'broadcast' && mode !== 'relay') return { ok: false, error: 'mode must be broadcast or relay' };
  if (!isInRange(rounds, MIN_ROUNDS, MAX_ROUNDS)) return { ok: false, error: `rounds must be ${MIN_ROUNDS}..${MAX_ROUNDS}` };
  if (!isInRange(turnTimeoutMs, MIN_TURN_TIMEOUT_MS, MAX_TURN_TIMEOUT_MS)) return { ok: false, error: 'turn timeout out of range' };
  const parsed = parseParticipants(participants);
  if (!parsed) return { ok: false, error: 'participants must be 1..16 unique known agents' };
  const finalizerId = value['finalizerId'] === undefined ? defaultFinalizerId(parsed) : value['finalizerId'];
  if (typeof finalizerId !== 'string' || !parsed.some((participant) => participant.id === finalizerId)) {
    return { ok: false, error: 'finalizer must be one of the participants' };
  }
  return { ok: true, config: { prompt, mode, rounds, participants: parsed, finalizerId, turnTimeoutMs } };
}

export function truncateText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let keep = Math.max(0, limit - TRUNCATION_RESERVE);
  const last = text.charCodeAt(keep - 1);
  if (keep > 0 && last >= 0xd800 && last <= 0xdbff) keep -= 1;
  return `${text.slice(0, keep)}\n[truncated ${text.length - keep} chars]`;
}
