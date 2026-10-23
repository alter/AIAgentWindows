// openrouter-chat.ts
import { AGENT_LABELS } from './agents';
import type { OpenRouterSettings } from './openrouter';
import { instanceLabel } from './room-model';

export const MAX_MESSAGE_CHARS = 100_000;
export const MAX_REPLY_CHARS = 200_000;
export const MAX_ENTRIES = 2000;
export const MAX_CONVERSATION_CHARS = 3_000_000;
export const MAX_CONVERSATION_BYTES = 32 * 1024 * 1024;
export const MAX_ERROR_CHARS = 2000;
export const MAX_DETAIL_CHARS = 300;
export const CONVERSATION_VERSION = 1;

export const MODEL_FAILED_TEXT = 'The model failed on the OpenRouter side';
export const LENGTH_TEXT = 'The model reached its token limit before it wrote a reply (reasoning can use all of it): lower the effort or raise the limit.';
export const UNREADABLE_TEXT = 'OpenRouter sent an answer that could not be read.';
export const EMPTY_TEXT = 'The model sent no text.';
export const INTERRUPTED_TEXT = 'The connection ended before the reply was complete.';
export const CAPPED_TEXT = 'The reply was cut at the size limit.';
export const CHAT_SIGNED_OUT_TEXT = 'OpenRouter is not signed in. Sign in from the sidebar, then send again.';
export const BLANK_TEXT = 'Type a message first.';
export const TOO_LONG_MESSAGE_TEXT = 'The message is too long.';
export const CONVERSATION_FULL_TEXT = 'The conversation is too long. Close this agent and start a new one.';
export const NO_MODEL_TEXT = 'Choose a model first.';
export const BUSY_TEXT = 'A reply is still being written. Stop it first.';
export const UNKNOWN_AGENT_TEXT = 'This agent no longer exists.';
export const UNREADABLE_CONVERSATION_TEXT = 'The saved conversation of this agent cannot be read, so nothing was changed. Its file is kept as it is.';
export const SAVE_FAILED_TEXT = 'The conversation could not be saved.';

export type EntryStatus = 'done' | 'stopped' | 'failed';

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  cost: number | null;
}

export interface ChatEntry {
  role: 'user' | 'assistant';
  text: string;
  status: EntryStatus;
  time: number;
  error?: string;
  usage?: ChatUsage;
}

export interface Conversation {
  version: typeof CONVERSATION_VERSION;
  agentId: string;
  entries: ChatEntry[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatDelta {
  id: string;
  text: string;
}

export type ChatLoad = { ok: true; entries: ChatEntry[] } | { ok: false; error: string };
export type ChatSend = { ok: true; entry: ChatEntry } | { ok: false; error: string };

export interface StreamOutcome {
  status: EntryStatus;
  text: string;
  usage: ChatUsage | null;
  error: string | null;
}

export type StreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'finish'; reason: string }
  | { type: 'usage'; usage: ChatUsage }
  | { type: 'error'; detail: string }
  | { type: 'unreadable' }
  | { type: 'done' };

const STATUSES: readonly EntryStatus[] = ['done', 'stopped', 'failed'];
const IGNORED_FIELDS: ReadonlySet<string> = new Set(['event', 'id', 'retry']);
const LINE_END = /\r\n|\n|\r/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isCost(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function errorDetail(error: unknown): string {
  if (typeof error === 'string') return error.trim().slice(0, MAX_DETAIL_CHARS);
  const message = isRecord(error) ? error['message'] : undefined;
  return typeof message === 'string' ? message.trim().slice(0, MAX_DETAIL_CHARS) : '';
}

export function failureText(lead: string, detail: string): string {
  return detail === '' ? lead : `${lead}: ${detail}`;
}

function streamUsage(raw: unknown): ChatUsage | null {
  if (!isRecord(raw)) return null;
  const prompt = raw['prompt_tokens'];
  const completion = raw['completion_tokens'];
  if (!isCount(prompt) || !isCount(completion)) return null;
  const cost = raw['cost'];
  return { promptTokens: prompt, completionTokens: completion, cost: isCost(cost) ? cost : null };
}

function chunkEvents(payload: string): StreamEvent[] {
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return [{ type: 'unreadable' }];
  }
  if (!isRecord(raw)) return [{ type: 'unreadable' }];
  const choices = raw['choices'];
  const first: unknown = Array.isArray(choices) ? (choices as unknown[])[0] : undefined;
  const choice = isRecord(first) ? first : undefined;
  const events: StreamEvent[] = [];
  const delta = choice?.['delta'];
  const content = isRecord(delta) ? delta['content'] : undefined;
  if (typeof content === 'string' && content !== '') events.push({ type: 'delta', text: content });
  const reason = choice?.['finish_reason'];
  if (raw['error'] !== undefined || reason === 'error') events.push({ type: 'error', detail: errorDetail(raw['error'] ?? choice?.['error']) });
  else if (typeof reason === 'string') events.push({ type: 'finish', reason });
  const usage = streamUsage(raw['usage']);
  if (usage !== null) events.push({ type: 'usage', usage });
  return events;
}

function lineEvents(line: string): StreamEvent[] {
  if (line === '' || line.startsWith(':')) return [];
  const colon = line.indexOf(':');
  const field = colon < 0 ? line : line.slice(0, colon);
  if (field !== 'data') return IGNORED_FIELDS.has(field) ? [] : [{ type: 'unreadable' }];
  const payload = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
  return payload === '[DONE]' ? [{ type: 'done' }] : chunkEvents(payload);
}

export class SseParser {
  private buffer = '';

  push(text: string): StreamEvent[] {
    const lines = (this.buffer + text).split(LINE_END);
    this.buffer = lines.pop() ?? '';
    return lines.flatMap(lineEvents);
  }

  end(): StreamEvent[] {
    const rest = this.buffer;
    this.buffer = '';
    return lineEvents(rest);
  }
}

export interface ReplyResult {
  text: string;
  capped: boolean;
  finish: string | null;
  usage: ChatUsage | null;
  error: string | null;
  failure: 'error' | 'unreadable' | null;
  done: boolean;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

export class ReplyStream {
  private readonly parser = new SseParser();
  private text = '';
  private capped = false;
  private finish: string | null = null;
  private usage: ChatUsage | null = null;
  private error: string | null = null;
  private failure: ReplyResult['failure'] = null;
  private done = false;

  get finished(): boolean {
    return this.done || this.failure !== null || this.capped;
  }

  feed(chunk: string): string[] {
    return this.apply(this.parser.push(chunk));
  }

  end(): string[] {
    return this.apply(this.parser.end());
  }

  result(): ReplyResult {
    return { text: this.text, capped: this.capped, finish: this.finish, usage: this.usage, error: this.error, failure: this.failure, done: this.done };
  }

  private apply(events: readonly StreamEvent[]): string[] {
    const added: string[] = [];
    for (const event of events) {
      if (this.finished) break;
      if (event.type === 'delta') {
        const accepted = this.accept(event.text);
        if (accepted !== '') added.push(accepted);
      } else if (event.type === 'finish') {
        this.finish = event.reason;
      } else if (event.type === 'usage') {
        this.usage = event.usage;
      } else if (event.type === 'error') {
        this.failure = 'error';
        this.error = event.detail;
      } else if (event.type === 'unreadable') {
        this.failure = 'unreadable';
      } else {
        this.done = true;
      }
    }
    return added;
  }

  private accept(text: string): string {
    const room = MAX_REPLY_CHARS - this.text.length;
    if (text.length <= room) {
      this.text += text;
      return text;
    }
    this.capped = true;
    let cut = text.slice(0, room);
    if (cut.length > 0 && isHighSurrogate(cut.charCodeAt(cut.length - 1))) cut = cut.slice(0, -1);
    this.text += cut;
    return cut;
  }
}

export function replyOutcome(result: ReplyResult): { status: EntryStatus; error: string | null } {
  if (result.failure === 'unreadable') return { status: 'failed', error: UNREADABLE_TEXT };
  if (result.failure === 'error') return { status: 'failed', error: failureText(MODEL_FAILED_TEXT, result.error ?? '') };
  if (result.capped) return { status: 'stopped', error: CAPPED_TEXT };
  if (result.text.trim() === '') return { status: 'failed', error: result.finish === 'length' ? LENGTH_TEXT : EMPTY_TEXT };
  if (!result.done && result.finish === null) return { status: 'failed', error: INTERRUPTED_TEXT };
  return { status: 'done', error: null };
}

export function emptyConversation(agentId: string): Conversation {
  return { version: CONVERSATION_VERSION, agentId, entries: [] };
}

export function serializeConversation(conversation: Conversation): string {
  return JSON.stringify(conversation);
}

function parseStoredUsage(raw: unknown): ChatUsage | null {
  if (!isRecord(raw)) return null;
  const { promptTokens, completionTokens, cost } = raw;
  if (!isCount(promptTokens) || !isCount(completionTokens)) return null;
  if (cost !== null && !isCost(cost)) return null;
  return { promptTokens, completionTokens, cost };
}

function parseEntry(raw: unknown): ChatEntry | null {
  if (!isRecord(raw)) return null;
  const { role, text, status, time, error, usage } = raw;
  if (role !== 'user' && role !== 'assistant') return null;
  if (typeof text !== 'string' || text.length > (role === 'user' ? MAX_MESSAGE_CHARS : MAX_REPLY_CHARS)) return null;
  if (!STATUSES.includes(status as EntryStatus) || (role === 'user' && status !== 'done')) return null;
  if (typeof time !== 'number' || !Number.isFinite(time)) return null;
  const entry: ChatEntry = { role, text, status: status as EntryStatus, time };
  if (error !== undefined) {
    if (typeof error !== 'string' || error.length > MAX_ERROR_CHARS) return null;
    entry.error = error;
  }
  if (usage !== undefined) {
    const stored = parseStoredUsage(usage);
    if (stored === null) return null;
    entry.usage = stored;
  }
  return entry;
}

export function parseConversation(text: string, agentId: string): Conversation | null {
  if (Buffer.byteLength(text, 'utf8') > MAX_CONVERSATION_BYTES) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw['version'] !== CONVERSATION_VERSION || raw['agentId'] !== agentId) return null;
  const listed = raw['entries'];
  if (!Array.isArray(listed) || listed.length > MAX_ENTRIES) return null;
  const entries: ChatEntry[] = [];
  for (const item of listed as unknown[]) {
    const entry = parseEntry(item);
    if (entry === null) return null;
    entries.push(entry);
  }
  return { version: CONVERSATION_VERSION, agentId, entries };
}

export function userEntry(text: string, time: number): ChatEntry {
  return { role: 'user', text, status: 'done', time };
}

export function assistantEntry(outcome: StreamOutcome, time: number): ChatEntry {
  return {
    role: 'assistant',
    text: outcome.text,
    status: outcome.status,
    time,
    ...(outcome.error === null ? {} : { error: outcome.error }),
    ...(outcome.usage === null ? {} : { usage: outcome.usage }),
  };
}

export function contextMessages(entries: readonly ChatEntry[]): ChatMessage[] {
  return entries
    .filter((entry) => entry.role === 'user' || (entry.status !== 'failed' && entry.text !== ''))
    .map((entry) => ({ role: entry.role, content: entry.text }));
}

export function sendProblem(entries: readonly ChatEntry[], text: string): string | null {
  if (text.trim() === '') return BLANK_TEXT;
  if (text.length > MAX_MESSAGE_CHARS) return TOO_LONG_MESSAGE_TEXT;
  const total = entries.reduce((sum, entry) => sum + entry.text.length, text.length);
  return entries.length + 2 > MAX_ENTRIES || total > MAX_CONVERSATION_CHARS ? CONVERSATION_FULL_TEXT : null;
}

export function openrouterTitle(settings: OpenRouterSettings): string {
  if (settings.model === '') return AGENT_LABELS.openrouter;
  return instanceLabel({ kind: 'openrouter', model: settings.model, ...(settings.modelName === undefined ? {} : { modelName: settings.modelName }) });
}
