// openrouter-fake.ts
import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export const FAKE_MODEL_MARKUP = '<img src=x onerror="window.__pwned=1">Evil <b>bold</b>';

export type AuthBehavior = 'approve' | 'wrong-state' | 'deny';

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface ChatCall {
  n: number;
  body: { model?: string; messages?: { role: string; content: string }[]; reasoning?: { effort?: string }; tools?: { type: string }[]; stream?: boolean } | null;
  headers: Record<string, string | string[] | undefined>;
}

export interface ChatScript {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  hang?: boolean;
}

export interface FakeOpenRouter {
  base: string;
  key: string;
  requests: RecordedRequest[];
  auth: { callbackUrl: string; challenge: string; method: string; state: string; label: string }[];
  behavior: AuthBehavior;
  expireCodes: boolean;
  revoked: boolean;
  models: unknown;
  chat: (call: ChatCall) => ChatScript | undefined;
  chatCalls: ChatCall[];
  chatClosed: number;
  hitCallback(callbackUrl: string, query: string): Promise<{ status: number; body: string }>;
  issueCode(challenge: string): string;
  close(): Promise<void>;
}

export function fakeModels(): unknown {
  const entry = (id: string, name: string, prompt: string, completion: string, extra: Record<string, unknown> = {}): unknown => ({
    id,
    name,
    context_length: 32000,
    architecture: { output_modalities: ['text'] },
    pricing: { prompt, completion },
    ...extra,
  });
  return {
    data: [
      entry('acme/free-model:free', 'Acme Free', '0', '0'),
      entry('acme/paid-model', 'Acme Paid', '0.000003', '0.000015', { reasoning: { supported_efforts: ['high', 'medium', 'low'] } }),
      entry('openrouter/free', 'Free Models Router', '0', '0'),
      entry('acme/markup', FAKE_MODEL_MARKUP, '0.000001', '0.000002'),
      entry('acme/image-only', 'Image Maker', '0.000001', '0.000002', { architecture: { output_modalities: ['image'] } }),
      entry('acme/expired', 'Expired', '0.000001', '0.000002', { expiration_date: '2020-01-01' }),
    ],
    total_count: 6,
    links: { next: null },
  };
}

function challengeOf(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function json(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

function parseBody(body: string): ChatCall['body'] {
  try {
    return JSON.parse(body) as ChatCall['body'];
  } catch {
    return null;
  }
}

function localGet(target: string): Promise<{ status: number; body: string }> {
  const url = new URL(target);
  return new Promise((resolve, reject) => {
    const request = http.get({ hostname: '127.0.0.1', port: url.port, path: `${url.pathname}${url.search}`, headers: { Host: `localhost:${url.port}` } }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('error', reject);
  });
}

export async function startFakeOpenRouter(): Promise<FakeOpenRouter> {
  const codes = new Map<string, { challenge: string; used: boolean }>();
  const fake: FakeOpenRouter = {
    base: '',
    key: `sk-or-v1-FAKE${randomBytes(12).toString('hex')}`,
    requests: [],
    auth: [],
    behavior: 'approve',
    expireCodes: false,
    revoked: false,
    models: fakeModels(),
    chat: () => undefined,
    chatCalls: [],
    chatClosed: 0,
    hitCallback: (callbackUrl, query) => localGet(`${callbackUrl}${query}`),
    issueCode: (challenge) => {
      const code = `code-${randomBytes(8).toString('hex')}`;
      codes.set(code, { challenge, used: false });
      return code;
    },
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }),
  };

  const exchange = (body: string, response: http.ServerResponse): void => {
    let payload: { code?: unknown; code_verifier?: unknown; code_challenge_method?: unknown };
    try {
      payload = JSON.parse(body) as typeof payload;
    } catch {
      json(response, 400, { error: { message: 'Invalid JSON', code: 400 } });
      return;
    }
    const entry = typeof payload.code === 'string' ? codes.get(payload.code) : undefined;
    if (entry === undefined || entry.used || payload.code_challenge_method !== 'S256') {
      json(response, 400, { error: { message: 'Invalid code', code: 400 } });
      return;
    }
    if (fake.expireCodes) {
      json(response, 403, { error: { message: 'Authorization code expired', code: 403 } });
      return;
    }
    if (typeof payload.code_verifier !== 'string' || challengeOf(payload.code_verifier) !== entry.challenge) {
      json(response, 403, { error: { message: 'Invalid code or code_verifier', code: 403 } });
      return;
    }
    entry.used = true;
    json(response, 200, { key: fake.key, user_id: 'user_fake' });
  };

  const chatReply = (call: ChatCall, response: http.ServerResponse): void => {
    const script = fake.chat(call);
    if (script?.hang === true) return;
    const model = call.body?.model ?? 'unknown';
    const fallback = {
      id: `gen-${call.n}`,
      model,
      object: 'chat.completion',
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: `Reply from ${model} number ${call.n}` } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
    response.writeHead(script?.status ?? 200, { 'Content-Type': 'application/json', ...script?.headers });
    response.end(JSON.stringify(script?.body ?? fallback));
  };

  const chat = (request: http.IncomingMessage, body: string, response: http.ServerResponse): void => {
    const call: ChatCall = { n: fake.chatCalls.length + 1, body: parseBody(body), headers: request.headers };
    fake.chatCalls.push(call);
    response.on('close', () => {
      if (!response.writableFinished) fake.chatClosed += 1;
    });
    if (fake.revoked || request.headers.authorization !== `Bearer ${fake.key}`) {
      json(response, 401, { error: { message: 'No cookie auth credentials found', code: 401 } });
      return;
    }
    chatReply(call, response);
  };

  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const url = new URL(request.url ?? '/', 'http://fake');
      fake.requests.push({ method: request.method ?? '', path: url.pathname, headers: request.headers, body });
      if (request.method === 'GET' && url.pathname === '/auth') {
        const callbackUrl = url.searchParams.get('callback_url') ?? '';
        const challenge = url.searchParams.get('code_challenge') ?? '';
        const state = url.searchParams.get('state') ?? '';
        fake.auth.push({
          callbackUrl,
          challenge,
          method: url.searchParams.get('code_challenge_method') ?? '',
          state,
          label: url.searchParams.get('key_label') ?? '',
        });
        if (fake.behavior === 'deny' || callbackUrl === '') {
          response.writeHead(200);
          response.end('shown');
          return;
        }
        const sent = fake.behavior === 'wrong-state' ? `${state.slice(0, -1)}${state.endsWith('A') ? 'B' : 'A'}` : state;
        const code = fake.issueCode(challenge);
        void fake.hitCallback(callbackUrl, `?code=${encodeURIComponent(code)}&state=${encodeURIComponent(sent)}`).then(
          () => {
            response.writeHead(200);
            response.end('approved');
          },
          () => {
            response.writeHead(502);
            response.end('callback unreachable');
          },
        );
      } else if (request.method === 'POST' && url.pathname === '/api/v1/auth/keys') {
        exchange(body, response);
      } else if (request.method === 'GET' && url.pathname === '/api/v1/key') {
        if (fake.revoked || request.headers.authorization !== `Bearer ${fake.key}`) {
          json(response, 401, { error: { message: 'No cookie auth credentials found', code: 401 } });
          return;
        }
        json(response, 200, {
          data: { label: 'fake', is_free_tier: true, limit_remaining: null, free_model_daily_requests: { used: 3, limit: 50, remaining: 47 } },
        });
      } else if (request.method === 'POST' && url.pathname === '/api/v1/chat/completions') {
        chat(request, body, response);
      } else if (request.method === 'GET' && url.pathname === '/api/v1/models') {
        json(response, 200, fake.models);
      } else {
        json(response, 404, { error: { message: 'not found', code: 404 } });
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  fake.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return fake;
}
