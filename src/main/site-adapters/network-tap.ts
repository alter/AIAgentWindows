// network-tap.ts
import type { NetSink, NetWatch } from './types';

export const MAX_BODY_BYTES = 2_000_000;
export const LONG_RESPONSE_MS = 1000;
const BODY_MIMES = new Set(['text/event-stream', 'application/x-ndjson', 'application/json']);

export interface NetDebugger {
  isAttached(): boolean;
  attach(protocolVersion?: string): void;
  sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: 'message', listener: (event: unknown, method: string, params: unknown) => void): unknown;
  removeListener(event: 'message', listener: (event: unknown, method: string, params: unknown) => void): unknown;
}

interface Tracked {
  path: string;
  startedAt: number;
  mime: string;
}

type Params = Record<string, unknown>;

function isParams(value: unknown): value is Params {
  return typeof value === 'object' && value !== null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function seconds(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

export function originOf(url: string | null): string | null {
  if (url === null) return null;
  try {
    const parsed = new URL(url);
    return parsed.origin === 'null' ? null : parsed.origin;
  } catch {
    return null;
  }
}

function pathOf(url: string, origin: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.origin === origin ? parsed.pathname : null;
  } catch {
    return null;
  }
}

export function isBodyMime(mime: string): boolean {
  return BODY_MIMES.has(mime.split(';')[0]?.trim().toLowerCase() ?? '');
}

export function capBody(body: string): string {
  const bytes = Buffer.from(body, 'utf8');
  return bytes.length <= MAX_BODY_BYTES ? body : bytes.subarray(0, MAX_BODY_BYTES).toString('utf8');
}

function failure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function watchNetwork(cdp: NetDebugger, pageUrl: string | null, sink: NetSink): Promise<NetWatch> {
  const origin = originOf(pageUrl);
  if (origin === null) {
    sink.event('net-skipped', { reason: 'no-origin' });
    return { stop: () => Promise.resolve() };
  }
  const tracked = new Map<string, Tracked>();
  const pending = new Set<Promise<void>>();

  const saveBody = async (id: string, path: string): Promise<void> => {
    const keep = sink.saveBody?.bind(sink);
    if (keep === undefined) return;
    try {
      const reply = (await cdp.sendCommand('Network.getResponseBody', { requestId: id })) as { body?: unknown; base64Encoded?: unknown };
      const raw = text(reply.body);
      const decoded = reply.base64Encoded === true ? Buffer.from(raw, 'base64').toString('utf8') : raw;
      const file = await keep(capBody(decoded));
      sink.event('net', { phase: 'body', id, path, file: file ?? 'not-saved', chars: decoded.length });
    } catch (error) {
      sink.event('net', { phase: 'body-failed', id, path, error: failure(error) });
    }
  };

  const onMessage = (_event: unknown, method: string, raw: unknown): void => {
    if (!isParams(raw)) return;
    const id = text(raw['requestId']);
    if (method === 'Network.requestWillBeSent') {
      const request = isParams(raw['request']) ? raw['request'] : {};
      const path = pathOf(text(request['url']), origin);
      if (path === null) return;
      tracked.set(id, { path, startedAt: seconds(raw['timestamp']), mime: '' });
      sink.event('net', { phase: 'request', id, path, method: text(request['method']), resourceType: text(raw['type']) });
      return;
    }
    const known = tracked.get(id);
    if (known === undefined) return;
    if (method === 'Network.responseReceived') {
      const response = isParams(raw['response']) ? raw['response'] : {};
      known.mime = text(response['mimeType']);
      sink.event('net', { phase: 'response', id, path: known.path, mime: known.mime, status: Number(response['status'] ?? 0) });
    } else if (method === 'Network.loadingFinished') {
      const durationMs = Math.round((seconds(raw['timestamp']) - known.startedAt) * 1000);
      sink.event('net', { phase: 'finished', id, path: known.path, length: Number(raw['encodedDataLength'] ?? 0), durationMs });
      if (isBodyMime(known.mime) && durationMs > LONG_RESPONSE_MS) {
        const job = saveBody(id, known.path).finally(() => pending.delete(job));
        pending.add(job);
      }
    } else if (method === 'Network.loadingFailed') {
      sink.event('net', { phase: 'failed', id, path: known.path, error: text(raw['errorText']) });
    }
  };

  if (!cdp.isAttached()) cdp.attach('1.3');
  cdp.on('message', onMessage);
  try {
    await cdp.sendCommand('Network.enable');
  } catch (error) {
    cdp.removeListener('message', onMessage);
    throw error;
  }
  return {
    async stop() {
      cdp.removeListener('message', onMessage);
      await Promise.all([...pending]);
      await cdp.sendCommand('Network.disable').catch(() => undefined);
    },
  };
}
