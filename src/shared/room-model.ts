// room-model.ts
import { AGENT_KINDS, AGENT_LABELS, isSiteKind, type AgentKind } from './agents';

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
export const MAX_RECORD_ENTRIES = 20000;
export const MAX_RECORD_BYTES = 50 * 1024 * 1024;
const TRUNCATION_RESERVE = 64;
export const OWNER_ID = 'owner';
export const ROOM_ID = 'room';
const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const PARTICIPANT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MODEL_PATTERN = /^[A-Za-z0-9._:[\]-]{1,64}$/;
const EFFORT_PATTERN = /^[a-z]{1,16}$/;
const ENTRY_KINDS: readonly RoomEntryKind[] = ['prompt', 'reply', 'final', 'error'];
const RECORD_STATUSES: readonly RoomRecordStatus[] = ['running', 'done', 'stopped', 'failed'];

export type RoomMode = 'broadcast' | 'relay';
export type RoomEntryKind = 'prompt' | 'reply' | 'final' | 'error';

export interface RoomParticipant {
  id: string;
  kind: AgentKind;
  label: string;
  model?: string;
  effort?: string;
}

export interface RoomConfig {
  prompt: string;
  mode: RoomMode;
  rounds: number;
  participants: RoomParticipant[];
  finalizerId: string;
  turnTimeoutMs: number;
  debugSites: boolean;
}

export type RoomEntryState = 'timeout' | 'stopped';
const ENTRY_STATES: readonly RoomEntryState[] = ['timeout', 'stopped'];

export interface RoomEntry {
  authorId: string;
  label: string;
  time: number;
  kind: RoomEntryKind;
  text: string;
  round?: number;
  state?: RoomEntryState;
}

export type RoomStatus = 'done' | 'stopped' | 'failed';
export type RoomRecordStatus = 'running' | RoomStatus;
export type RoomRecordConfig = Omit<RoomConfig, 'prompt'>;

export interface RoomRecord {
  version: 1;
  id: string;
  createdAt: number;
  updatedAt: number;
  status: RoomRecordStatus;
  config: RoomRecordConfig;
  entries: RoomEntry[];
  nonce: string;
}
export type RoomListItem =
  | { id: string; unreadable: false; createdAt: number; updatedAt: number; status: RoomRecordStatus; firstPrompt: string }
  | { id: string; unreadable: true };

export type StepState = 'running' | 'replied' | 'failed' | 'timeout';

export interface RoomPlan {
  mode: RoomMode;
  rounds: number;
  finalizerId: string;
  participants: RoomParticipant[];
}

export interface PausedSession {
  participantId: string;
  sessionId: string;
  note: string;
}

export type RoomEvent =
  | { type: 'started'; roomId: string; historyPath: string; total: number; plan: RoomPlan; previous?: RoomEntry[] }
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

export function instanceLabel(parts: { kind: AgentKind; model?: string; effort?: string }): string {
  return [AGENT_LABELS[parts.kind], parts.model, parts.effort].filter((part) => part !== undefined).join(' \u00b7 ');
}

export function nextParticipantId(kind: AgentKind, existing: readonly string[]): string {
  if (!existing.includes(kind)) return kind;
  let number = 2;
  while (existing.includes(`${kind}-${number}`)) number += 1;
  return `${kind}-${number}`;
}

export function defaultFinalizerId(participants: readonly RoomParticipant[]): string {
  const claude = participants.find((participant) => participant.kind === 'claude');
  return (claude ?? participants[0])?.id ?? '';
}

export function roomPlan(config: RoomConfig): RoomPlan {
  const { mode, rounds, finalizerId, participants } = config;
  return { mode, rounds, finalizerId, participants: participants.map((participant) => ({ ...participant })) };
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

function parseShaped(value: unknown, pattern: RegExp): string | null | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'string' && pattern.test(value) ? value : null;
}

function parseParticipant(value: unknown): RoomParticipant | null {
  if (!isRecord(value)) return null;
  const { id, kind } = value;
  if (typeof id !== 'string' || !PARTICIPANT_ID_PATTERN.test(id) || !isAgentKind(kind)) return null;
  const model = parseShaped(value['model'], MODEL_PATTERN);
  const effort = parseShaped(value['effort'], EFFORT_PATTERN);
  if (model === null || effort === null) return null;
  if (isSiteKind(kind) && (model !== undefined || effort !== undefined)) return null;
  const parts = { kind, ...(model === undefined ? {} : { model }), ...(effort === undefined ? {} : { effort }) };
  return { id, ...parts, label: instanceLabel(parts) };
}

function parseParticipants(value: unknown): RoomParticipant[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PARTICIPANTS) return null;
  const parsed: RoomParticipant[] = [];
  const seen = new Set<string>();
  const sites = new Set<AgentKind>();
  for (const item of value) {
    const participant = parseParticipant(item);
    if (!participant || seen.has(participant.id)) return null;
    if (isSiteKind(participant.kind)) {
      if (sites.has(participant.kind)) return null;
      sites.add(participant.kind);
    }
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
  if (!parsed) return { ok: false, error: 'participants must be 1..16 unique known agents with valid model and effort' };
  const finalizerId = value['finalizerId'] === undefined ? defaultFinalizerId(parsed) : value['finalizerId'];
  if (typeof finalizerId !== 'string' || !parsed.some((participant) => participant.id === finalizerId)) {
    return { ok: false, error: 'finalizer must be one of the participants' };
  }
  const debugSites = value['debugSites'] === undefined ? false : value['debugSites'];
  if (typeof debugSites !== 'boolean') return { ok: false, error: 'debugSites must be true or false' };
  return { ok: true, config: { prompt, mode, rounds, participants: parsed, finalizerId, turnTimeoutMs, debugSites } };
}

export function truncateText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let keep = Math.max(0, limit - TRUNCATION_RESERVE);
  const last = text.charCodeAt(keep - 1);
  if (keep > 0 && last >= 0xd800 && last <= 0xdbff) keep -= 1;
  return `${text.slice(0, keep)}\n[truncated ${text.length - keep} chars]`;
}

export function isRoomId(value: unknown): value is string {
  return typeof value === 'string' && ROOM_ID_PATTERN.test(value);
}

function isTimestamp(value: unknown): value is number {
  return isInRange(value, 0, Number.MAX_SAFE_INTEGER);
}

function parseEntry(value: unknown): RoomEntry | null {
  if (!isRecord(value)) return null;
  const { authorId, label, time, kind, text } = value;
  if (!isBoundedString(authorId, MAX_ID_CHARS) || !isBoundedString(label, MAX_ID_CHARS) || !isTimestamp(time)) return null;
  if (typeof kind !== 'string' || !(ENTRY_KINDS as readonly string[]).includes(kind)) return null;
  if (typeof text !== 'string' || text.length > MAX_REPLY_CHARS) return null;
  const entry: RoomEntry = { authorId, label, time, kind: kind as RoomEntryKind, text };
  const { round, state } = value;
  if (round !== undefined) {
    if (!isInRange(round, MIN_ROUNDS, MAX_ROUNDS)) return null;
    entry.round = round;
  }
  if (state !== undefined) {
    if (typeof state !== 'string' || !(ENTRY_STATES as readonly string[]).includes(state)) return null;
    entry.state = state as RoomEntryState;
  }
  return entry;
}

function parseEntries(value: unknown): RoomEntry[] | null {
  if (!Array.isArray(value) || value.length > MAX_RECORD_ENTRIES) return null;
  const entries: RoomEntry[] = [];
  for (const item of value) {
    const entry = parseEntry(item);
    if (!entry) return null;
    entries.push(entry);
  }
  return entries;
}

function parseRecordConfig(value: unknown): RoomRecordConfig | null {
  if (!isRecord(value)) return null;
  const result = parseRoomConfig({ ...value, prompt: '-' });
  if (!result.ok) return null;
  const { mode, rounds, participants, finalizerId, turnTimeoutMs, debugSites } = result.config;
  return { mode, rounds, participants, finalizerId, turnTimeoutMs, debugSites };
}

export function parseRoomRecord(value: unknown): RoomRecord | null {
  if (!isRecord(value) || value['version'] !== 1) return null;
  const { id, createdAt, updatedAt, status, nonce } = value;
  if (!isRoomId(id) || !isRoomId(nonce) || !isTimestamp(createdAt) || !isTimestamp(updatedAt)) return null;
  if (typeof status !== 'string' || !(RECORD_STATUSES as readonly string[]).includes(status)) return null;
  const config = parseRecordConfig(value['config']);
  const entries = parseEntries(value['entries']);
  if (!config || !entries) return null;
  return { version: 1, id, createdAt, updatedAt, status: status as RoomRecordStatus, config, entries, nonce };
}
