// page-call.ts
import { SiteAdapterError, type PageRunner } from './types';

export interface PageReply {
  ok: boolean;
  error?: string;
  detail?: string;
  value?: unknown;
  length?: number;
  kind?: string;
  count?: number;
}

const CODES = new Set(['input-missing', 'submit-unavailable']);

function parse(raw: unknown): PageReply {
  if (typeof raw !== 'string') throw new SiteAdapterError('page-error', 'page script returned no result');
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) return parsed as PageReply;
  } catch {
    // falls through to the error below
  }
  throw new SiteAdapterError('page-error', 'page script returned unreadable result');
}

export async function callPage(runner: PageRunner, code: string): Promise<PageReply> {
  const reply = parse(await runner.run(code));
  if (reply.ok) return reply;
  const known = reply.error !== undefined && CODES.has(reply.error);
  if (known) throw new SiteAdapterError(reply.error as 'input-missing' | 'submit-unavailable', reply.error as string);
  throw new SiteAdapterError('page-error', reply.detail ?? 'page script failed');
}
