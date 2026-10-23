// loopback.ts
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { MAX_CODE_CHARS, STATE_CHARS } from '../../shared/openrouter';
import { statesMatch } from './pkce';

export type CallbackResult = { kind: 'code'; code: string } | { kind: 'timeout' } | { kind: 'closed' };

export interface CallbackServer {
  port: number;
  result: Promise<CallbackResult>;
  close(): void;
}

const DONE_PAGE = '<!doctype html><meta charset="utf-8"><title>AI Agent Windows</title><p>You can close this tab and return to the app.</p>';
const REFUSED_PAGE = '<!doctype html><meta charset="utf-8"><title>AI Agent Windows</title><p>This request was not accepted. Return to the app.</p>';

function reply(response: http.ServerResponse, status: number, page: string): void {
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'",
    Connection: 'close',
  });
  response.end(page);
}

function hostAllowed(host: string | undefined, port: number): boolean {
  return host === `localhost:${port}` || host === `127.0.0.1:${port}`;
}

function parseCallback(target: string): { code: string; state: string } | null {
  let url: URL;
  try {
    url = new URL(target, 'http://localhost');
  } catch {
    return null;
  }
  if (url.pathname !== '/callback') return null;
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (code === null || code.length < 1 || code.length > MAX_CODE_CHARS || state === null || state.length !== STATE_CHARS) return null;
  return { code, state };
}

export function startCallbackServer(options: { state: string; timeoutMs: number }): Promise<CallbackServer> {
  return new Promise((resolve, reject) => {
    let settle: (result: CallbackResult) => void = () => undefined;
    const result = new Promise<CallbackResult>((done) => {
      settle = done;
    });
    let timer: NodeJS.Timeout | undefined;
    const server = http.createServer((request, response) => {
      const port = (server.address() as AddressInfo | null)?.port ?? 0;
      const parsed = request.method === 'GET' && hostAllowed(request.headers.host, port) ? parseCallback(request.url ?? '') : null;
      if (parsed === null || !statesMatch(options.state, parsed.state)) {
        reply(response, 400, REFUSED_PAGE);
        return;
      }
      reply(response, 200, DONE_PAGE);
      finish({ kind: 'code', code: parsed.code });
    });
    const finish = (outcome: CallbackResult): void => {
      if (timer !== undefined) clearTimeout(timer);
      settle(outcome);
      server.close();
      if (outcome.kind === 'code') server.closeIdleConnections();
      else server.closeAllConnections();
    };
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      timer = setTimeout(() => finish({ kind: 'timeout' }), options.timeoutMs);
      timer.unref();
      resolve({
        port: (server.address() as AddressInfo).port,
        result,
        close: () => finish({ kind: 'closed' }),
      });
    });
  });
}
