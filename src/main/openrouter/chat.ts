// chat.ts
import { setTimeout as delay } from 'node:timers/promises';
import { attributionHeaders } from '../../shared/openrouter';
import { LENGTH_TEXT, MODEL_FAILED_TEXT, UNREADABLE_TEXT, errorDetail, failureText, rateLimitText } from '../../shared/openrouter-chat';

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

export interface ChatRequest {
  model: string;
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
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
  reset: string | null;
  text: string;
}

const MAX_ANSWER_BYTES = 16 * 1024 * 1024;
const DEFAULT_WAIT_MS = 1000;
const WEB_TOOL = { type: 'openrouter:web_search', parameters: { max_results: 3, max_uses: 2 } };

export const NOT_SIGNED_IN_TEXT = 'OpenRouter is not signed in. Sign in, then run the room again.';
const STOPPED_TEXT = 'The turn was stopped.';
export const UNREACHABLE_TEXT = 'OpenRouter could not be reached.';
export const REJECTED_TEXT = 'OpenRouter no longer accepts the saved key. You are signed out: sign in again.';

export function requestBody(request: ChatRequest, stream: boolean): Record<string, unknown> {
  return {
    model: request.model,
    stream,
    messages: request.messages,
    ...(request.effort === null ? {} : { reasoning: { effort: request.effort } }),
    ...(request.web ? { tools: [WEB_TOOL] } : {}),
  };
}

export function chatBody(input: ChatInput): Record<string, unknown> {
  return requestBody(
    {
      model: input.model,
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
      effort: input.effort,
      web: input.web,
    },
    false,
  );
}

export function postHeaders(key: string, accept: string): Record<string, string> {
  return { ...attributionHeaders(), Accept: accept, 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function limitSource(error: unknown): string {
  const metadata = isRecord(error) ? error['metadata'] : undefined;
  const source = isRecord(metadata) ? metadata['limit_source'] : undefined;
  return typeof source === 'string' && /^[a-z_]{1,64}$/.test(source) ? ` (${source})` : '';
}

function withDetail(lead: string, error: unknown): ChatError {
  return new ChatError('failed', failureText(lead, errorDetail(error)));
}

export function failedStatus(status: number, value: unknown, reset: string | null = null, now: number = Date.now()): ChatError {
  const error = isRecord(value) ? value['error'] : undefined;
  if (status === 401) return new ChatError('unauthorized', REJECTED_TEXT);
  if (status === 402) return withDetail(`OpenRouter says the account is out of credits${limitSource(error)}. Add credits or use a free model`, error);
  if (status === 429) return new ChatError('failed', rateLimitText(error, reset, now));
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

export function readAnswer(status: number, text: string, reset: string | null = null, now: number = Date.now()): string | null {
  const value = parseJson(text);
  if (status < 200 || status >= 300) throw failedStatus(status, value, reset, now);
  if (!isRecord(value)) throw new ChatError('failed', UNREADABLE_TEXT);
  const choice = firstChoice(value);
  const error = value['error'] ?? choice?.['error'];
  if (choice === undefined || choice['finish_reason'] === 'error' || error !== undefined) {
    throw withDetail(MODEL_FAILED_TEXT, error);
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
      headers: postHeaders(key, 'application/json'),
      redirect: 'error',
      signal: AbortSignal.any([options.signal, timer]),
    });
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_ANSWER_BYTES) throw new ChatError('failed', UNREADABLE_TEXT);
    return { status: response.status, retryAfter: response.headers.get('retry-after'), reset: response.headers.get('x-ratelimit-reset'), text: new TextDecoder().decode(bytes) };
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
  return readAnswer(answer.status, answer.text, answer.reset);
}
