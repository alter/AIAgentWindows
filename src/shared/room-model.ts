// room-model.ts
import { AGENT_KINDS, type AgentKind } from './agents';

export const MIN_ROUNDS = 1;
export const MAX_ROUNDS = 50;
export const MAX_PROMPT_CHARS = 100000;
export const MIN_TURN_TIMEOUT_MS = 1000;
export const MAX_TURN_TIMEOUT_MS = 3_600_000;
export const DEFAULT_TURN_TIMEOUT_MS = 600000;
export const MAX_PARTICIPANTS = 16;
export const MAX_LABEL_CHARS = 80;
export const MAX_ID_CHARS = 128;

export type RoomMode = 'broadcast' | 'relay';
export type RoomEntryKind = 'prompt' | 'reply' | 'error';

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
  turnTimeoutMs: number;
}

export interface RoomEntry {
  authorId: string;
  label: string;
  time: number;
  kind: RoomEntryKind;
  text: string;
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
  const { id, kind, label } = value;
  if (!isBoundedString(id, MAX_ID_CHARS) || !isAgentKind(kind) || !isBoundedString(label, MAX_LABEL_CHARS)) return null;
  return { id, kind, label };
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
  return { ok: true, config: { prompt, mode, rounds, participants: parsed, turnTimeoutMs } };
}
