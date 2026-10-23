// chat-stream.ts
import { ReplyStream, UNREADABLE_TEXT, replyOutcome, type StreamOutcome } from '../../shared/openrouter-chat';
import { UNREACHABLE_TEXT, failedStatus, parseJson, postHeaders, requestBody, type ChatDeps, type ChatRequest } from './chat';

export interface StreamOptions {
  signal: AbortSignal;
  idleMs: number;
  onDelta(text: string): void;
}

export interface KeyedOutcome extends StreamOutcome {
  unauthorized: boolean;
}

export const DEFAULT_IDLE_MS = 120_000;
export const IDLE_TEXT = 'OpenRouter stopped sending data.';
const MAX_STREAM_BYTES = 16 * 1024 * 1024;
const MAX_ERROR_BYTES = 64 * 1024;

export function failedOutcome(error: string, text = '', unauthorized = false): KeyedOutcome {
  return { status: 'failed', text, usage: null, error, unauthorized };
}

async function statusOutcome(response: Response): Promise<KeyedOutcome> {
  const bytes = (await response.arrayBuffer()).slice(0, MAX_ERROR_BYTES);
  const error = failedStatus(response.status, parseJson(new TextDecoder().decode(bytes)), response.headers.get('x-ratelimit-reset'));
  return failedOutcome(error.message, '', error.code === 'unauthorized');
}

async function readBody(body: ReadableStream<Uint8Array>, stream: ReplyStream, options: StreamOptions, arm: () => void): Promise<boolean> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const show = (added: string[]): void => {
    for (const text of added) options.onDelta(text);
  };
  let bytes = 0;
  try {
    while (!stream.finished) {
      arm();
      const chunk = await reader.read();
      if (chunk.done) {
        show(stream.feed(decoder.decode()));
        show(stream.end());
        return true;
      }
      bytes += chunk.value.byteLength;
      if (bytes > MAX_STREAM_BYTES) return false;
      show(stream.feed(decoder.decode(chunk.value, { stream: true })));
    }
    return true;
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

export async function runChatStream(deps: ChatDeps, key: string, request: ChatRequest, options: StreamOptions): Promise<KeyedOutcome> {
  const stream = new ReplyStream();
  const idle = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => idle.abort(), options.idleMs);
  };
  const partial = (): string => stream.result().text;
  try {
    arm();
    const response = await (deps.fetch ?? fetch)(`${deps.base}/api/v1/chat/completions`, {
      method: 'POST',
      body: JSON.stringify(requestBody(request, true)),
      headers: postHeaders(key, 'text/event-stream'),
      redirect: 'error',
      signal: AbortSignal.any([options.signal, idle.signal]),
    });
    if (!response.ok) return await statusOutcome(response);
    if (response.body === null) return failedOutcome(UNREADABLE_TEXT);
    if (!(await readBody(response.body, stream, options, arm))) return failedOutcome(UNREADABLE_TEXT, partial());
    const result = stream.result();
    const outcome = replyOutcome(result);
    return { status: outcome.status, text: result.text, usage: result.usage, error: outcome.error, unauthorized: false };
  } catch {
    if (options.signal.aborted) return { status: 'stopped', text: partial(), usage: null, error: null, unauthorized: false };
    return failedOutcome(idle.signal.aborted ? IDLE_TEXT : UNREACHABLE_TEXT, partial());
  } finally {
    clearTimeout(timer);
  }
}
