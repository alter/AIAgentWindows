// stream-state.ts
import type { SiteLogValue } from '../../shared/site-log';
import { LONG_RESPONSE_MS } from './network-tap';
import type { NetSink, StreamSource, StreamView } from './types';

export const NO_STREAM: StreamView = { state: 'none', endedAt: null };

const STREAM_MIMES = new Set(['text/event-stream', 'application/x-ndjson']);

export interface StreamTracker extends StreamSource {
  markSubmit(at: number): void;
  feed(fields: Readonly<Record<string, SiteLogValue>>, at: number): void;
}

interface Request {
  method: string;
  startedAt: number;
  mime: string;
  endedAt: number | null;
  failed: boolean;
}

export function isStreamMime(mime: string): boolean {
  return STREAM_MIMES.has(mime.split(';')[0]?.trim().toLowerCase() ?? '');
}

function word(value: SiteLogValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

export function createStreamTracker(): StreamTracker {
  const requests = new Map<string, Request>();
  let submitAt: number | null = null;

  const finish = (id: string, at: number, failed: boolean): void => {
    const known = requests.get(id);
    if (known === undefined) return;
    known.endedAt = at;
    known.failed = failed;
  };

  return {
    markSubmit(at) {
      submitAt = at;
    },
    feed(fields, at) {
      if (submitAt === null || at < submitAt) return;
      const id = word(fields['id']);
      if (id === '') return;
      const phase = word(fields['phase']);
      if (phase === 'request') {
        requests.set(id, { method: word(fields['method']).toUpperCase(), startedAt: at, mime: '', endedAt: null, failed: false });
      } else if (phase === 'response') {
        const known = requests.get(id);
        if (known !== undefined) known.mime = word(fields['mime']);
      } else if (phase === 'finished') {
        finish(id, at, false);
      } else if (phase === 'failed') {
        finish(id, at, true);
      }
    },
    view(now) {
      const all = [...requests.values()];
      const streams = all.filter((item) => isStreamMime(item.mime));
      const pool = streams.length > 0 ? streams : all.filter((item) => item.method === 'POST' && (item.endedAt ?? now) - item.startedAt > LONG_RESPONSE_MS);
      if (pool.length === 0) return NO_STREAM;
      if (pool.some((item) => item.endedAt === null)) return { state: 'open', endedAt: null };
      const ended = pool.filter((item) => !item.failed).map((item) => item.endedAt ?? 0);
      if (ended.length === 0) return { state: 'failed', endedAt: null };
      return { state: 'ended', endedAt: Math.max(...ended) };
    },
  };
}

export function tappedSink(tracker: StreamTracker, inner: NetSink | null, now: () => number = Date.now): NetSink {
  const keep = inner?.saveBody?.bind(inner);
  return {
    event(name, fields) {
      if (name === 'net' && fields !== undefined) tracker.feed(fields, now());
      inner?.event(name, fields);
    },
    ...(keep === undefined ? {} : { saveBody: keep }),
  };
}
