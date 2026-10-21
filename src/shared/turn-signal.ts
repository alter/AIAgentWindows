// turn-signal.ts
import { MAX_ERROR_CHARS, truncateText } from './room-model';

export type TurnSignal =
  | { state: 'running' }
  | { state: 'done'; reply: string | null; continued: boolean }
  | { state: 'failed'; reason: string };

type JsonRecord = Record<string, unknown>;

const RUNNING: TurnSignal = { state: 'running' };
const CODEX_END_EVENTS = new Set(['task_complete', 'turn_complete']);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRecords(text: string): JsonRecord[] {
  const records: JsonRecord[] = [];
  for (const line of text.split('\n')) {
    if (line.length === 0) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isRecord(parsed)) records.push(parsed);
    } catch {
      continue;
    }
  }
  return records;
}

function timeOf(record: JsonRecord): number {
  return typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : Number.NaN;
}

function isAfter(record: JsonRecord, sentAtMs: number): boolean {
  return timeOf(record) >= sentAtMs;
}

function blocksOf(record: JsonRecord): JsonRecord[] {
  const message = record.message;
  if (!isRecord(message) || !Array.isArray(message.content)) return [];
  return message.content.filter(isRecord);
}

function textOf(blocks: readonly JsonRecord[], type: string): string[] {
  return blocks.flatMap((block) => (block.type === type && typeof block.text === 'string' && block.text.length > 0 ? [block.text] : []));
}

function stopReason(record: JsonRecord): string | undefined {
  const message = record.message;
  return isRecord(message) && typeof message.stop_reason === 'string' ? message.stop_reason : undefined;
}

function messageId(record: JsonRecord): unknown {
  return isRecord(record.message) ? record.message.id : undefined;
}

export function readClaudeTurn(text: string, sentAtMs: number): TurnSignal {
  const assistant = parseRecords(text).filter((record) => record.type === 'assistant' && isAfter(record, sentAtMs));
  const first = assistant.findIndex((record) => stopReason(record) === 'end_turn' && textOf(blocksOf(record), 'text').length > 0);
  if (first === -1) return RUNNING;
  const id = messageId(assistant[first] as JsonRecord);
  const sameMessage = assistant.filter((record) => stopReason(record) === 'end_turn' && messageId(record) === id);
  const reply = sameMessage.flatMap((record) => textOf(blocksOf(record), 'text')).join('\n');
  const continued = assistant.slice(first + 1).some((record) => stopReason(record) === 'tool_use');
  return { state: 'done', reply, continued };
}

function payloadOf(record: JsonRecord): JsonRecord | null {
  return record.type === 'event_msg' && isRecord(record.payload) ? record.payload : null;
}

function finalAnswer(payload: JsonRecord): string | null {
  const item = payload.item;
  if (payload.type !== 'item_completed' || !isRecord(item)) return null;
  if (item.type !== 'AgentMessage' || item.phase !== 'final_answer' || !Array.isArray(item.content)) return null;
  const parts = textOf(item.content.filter(isRecord), 'Text');
  return parts.length > 0 ? parts.join('\n') : null;
}

function errorReason(error: unknown): string {
  return isRecord(error) && typeof error.message === 'string' ? truncateText(error.message, MAX_ERROR_CHARS) : 'the turn ended with an error';
}

export function readCodexTurn(text: string, sentAtMs: number): TurnSignal {
  const events = parseRecords(text).filter((record) => isAfter(record, sentAtMs));
  let lastFinal: string | null = null;
  for (const record of events) {
    const payload = payloadOf(record);
    if (payload === null) continue;
    lastFinal = finalAnswer(payload) ?? lastFinal;
    if (payload.type === 'turn_aborted') return { state: 'failed', reason: 'the turn was aborted' };
    if (!CODEX_END_EVENTS.has(String(payload.type))) continue;
    if (payload.error) return { state: 'failed', reason: errorReason(payload.error) };
    const reply = typeof payload.last_agent_message === 'string' ? payload.last_agent_message : lastFinal;
    return { state: 'done', reply, continued: false };
  }
  return RUNNING;
}
