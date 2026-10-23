// chat.ts
import { setTimeout as delay } from 'node:timers/promises';
import { attributionHeaders } from '../../shared/openrouter';

export type ChatErrorCode = 'unauthorized' | 'timeout' | 'failed';

export class ChatError extends Error {
  constructor(
    readonly code: ChatErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ChatError';
  }
}

export interface ChatInput {
  model: string;
  system: string;
  user: string;
  effort: string | null;
  web: boolean;
}

export interface ChatOptions {
  timeoutMs: number;
  signal: AbortSignal;
}

export interface ChatDeps {
  base: string;
  fetch?: typeof fetch;
}

interface Answer {
  status: number;
  retryAfter: string | null;
  text: string;
}

const MAX_ANSWER_BYTES = 16 * 1024 * 1024;
const MAX_DETAIL_CHARS = 300;
const DEFAULT_WAIT_MS = 1000;
const WEB_TOOL = { type: 'openrouter:web_search', parameters: { max_results: 3, max_uses: 2 } };

export const NOT_SIGNED_IN_TEXT = 'OpenRouter is not signed in. Sign in, then run the room again.';
const STOPPED_TEXT = 'The turn was stopped.';
const UNREACHABLE_TEXT = 'OpenRouter could not be reached.';
const UNREADABLE_TEXT = 'OpenRouter sent an answer that could not be read.';
const LENGTH_TEXT = 'The model reached its token limit before it wrote a reply (reasoning can use all of it): lower the effort or raise the limit.';
const RATE_TEXT = 'OpenRouter is rate limiting this key (free models have a per-minute and a per-day cap). Try again later or pick another model.';
const REJECTED_TEXT = 'OpenRouter no longer accepts the saved key. You are signed out: sign in again.';

export function chatBody(input: ChatInput): Record<string, unknown> {
  return {
    model: input.model,
    stream: false,
    messages: [
      { role: 'system', content: input.system },
      { role: 'user', content: input.user },
    ],
    ...(input.effort === null ? {} : { reasoning: { effort: input.effort } }),
    ...(input.web ? { tools: [WEB_TOOL] } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function detailOf(error: unknown): string {
  if (!isRecord(error)) return '';
  const message = error['message'];
  return typeof message === 'string' ? message.trim().slice(0, MAX_DETAIL_CHARS) : '';
}

function limitSource(error: unknown): string {
  const metadata = isRecord(error) ? error['metadata'] : undefined;
  const source = isRecord(metadata) ? metadata['limit_source'] : undefined;
  return typeof source === 'string' && /^[a-z_]{1,64}$/.test(source) ? ` (${source})` : '';
}

function withDetail(lead: string, error: unknown): ChatError {
  const detail = detailOf(error);
  return new ChatError('failed', detail === '' ? lead : `${lead}: ${detail}`);
}

function failedStatus(status: number, value: unknown): ChatError {
  const error = isRecord(value) ? value['error'] : undefined;
  if (status === 401) return new ChatError('unauthorized', REJECTED_TEXT);
  if (status === 402) return withDetail(`OpenRouter says the account is out of credits${limitSource(error)}. Add credits or use a free model`, error);
  if (status === 429) return new ChatError('failed', RATE_TEXT);
  return withDetail(`OpenRouter answered HTTP ${status}`, error);
}

function firstChoice(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const choices = value['choices'];
  const first: unknown = Array.isArray(choices) ? (choices as unknown[])[0] : undefined;
  return isRecord(first) ? first : undefined;
}

function contentOf(choice: Record<string, unknown>): string | null {
  const message = choice['message'];
  const content = isRecord(message) ? message['content'] : undefined;
  return typeof content === 'string' && content.trim() !== '' ? content : null;
}

export function readAnswer(status: number, text: string): string | null {
  const value = parseJson(text);
  if (status < 200 || status >= 300) throw failedStatus(status, value);
  if (!isRecord(value)) throw new ChatError('failed', UNREADABLE_TEXT);
  const choice = firstChoice(value);
  const error = value['error'] ?? choice?.['error'];
  if (choice === undefined || choice['finish_reason'] === 'error' || error !== undefined) {
    throw withDetail('The model failed on the OpenRouter side', error);
  }
  const content = contentOf(choice);
  if (content === null && choice['finish_reason'] === 'length') throw new ChatError('failed', LENGTH_TEXT);
  return content;
}

function waitMs(header: string | null): number {
  const seconds = header === null || header.trim() === '' ? Number.NaN : Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : DEFAULT_WAIT_MS;
}

function timeoutError(timeoutMs: number): ChatError {
  return new ChatError('timeout', `the turn did not end within ${timeoutMs} ms`);
}

async function post(deps: ChatDeps, key: string, body: string, options: ChatOptions, deadline: number): Promise<Answer> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw timeoutError(options.timeoutMs);
  const timer = AbortSignal.timeout(remaining);
  try {
    const response = await (deps.fetch ?? fetch)(`${deps.base}/api/v1/chat/completions`, {
      method: 'POST',
      body,
      headers: { ...attributionHeaders(), Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      redirect: 'error',
      signal: AbortSignal.any([options.signal, timer]),
    });
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_ANSWER_BYTES) throw new ChatError('failed', UNREADABLE_TEXT);
    return { status: response.status, retryAfter: response.headers.get('retry-after'), text: new TextDecoder().decode(bytes) };
  } catch (error) {
    if (error instanceof ChatError) throw error;
    if (options.signal.aborted) throw new ChatError('failed', STOPPED_TEXT);
    throw timer.aborted ? timeoutError(options.timeoutMs) : new ChatError('failed', UNREACHABLE_TEXT);
  }
}

async function pause(ms: number, options: ChatOptions): Promise<void> {
  try {
    await delay(ms, undefined, { signal: options.signal });
  } catch {
    throw new ChatError('failed', STOPPED_TEXT);
  }
}

export async function runChat(deps: ChatDeps, key: string, input: ChatInput, options: ChatOptions): Promise<string | null> {
  const deadline = Date.now() + options.timeoutMs;
  const body = JSON.stringify(chatBody(input));
  let answer = await post(deps, key, body, options, deadline);
  if (answer.status === 429) {
    await pause(Math.min(waitMs(answer.retryAfter), Math.max(0, deadline - Date.now())), options);
    answer = await post(deps, key, body, options, deadline);
  }
  return readAnswer(answer.status, answer.text);
}
