// openrouter-signin.test.ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentController } from '../../src/main/agent-controller';
import { OpenRouterClient } from '../../src/main/openrouter/client';
import { KeyStore } from '../../src/main/openrouter/key-store';
import { challengeOf, createPkce } from '../../src/main/openrouter/pkce';
import type { SecretBox } from '../../src/main/openrouter/secret-box';
import { OpenRouterService } from '../../src/main/openrouter/service';
import { fetchOpener, testSecretBox } from '../../src/main/openrouter/test-mode';
import { openStore } from '../unit/helpers/app-state';
import type { OpenRouterStatus } from '../../src/shared/openrouter';
import { ACCOUNT_LIMITED_MODEL, PROVIDER_LIMITED_MODEL, startFakeOpenRouter, type FakeOpenRouter } from '../fixtures/openrouter-fake';

let dir: string;
let fake: FakeOpenRouter;
let controller: AgentController;
let statuses: OpenRouterStatus[];
let services: OpenRouterService[];

async function newController(folder: string = dir): Promise<AgentController> {
  return new AgentController(
    {
      store: await openStore(folder),
      sharedDir: path.join(dir, 'shared'),
      platform: 'darwin',
      env: {},
      pickFolder: async () => null,
      emit: () => undefined,
    },
  );
}

interface Options {
  box?: SecretBox;
  opener?: (url: string) => Promise<void>;
  timeoutMs?: number;
  base?: string;
}

function build(options: Options = {}): OpenRouterService {
  const store = new KeyStore(options.box ?? testSecretBox(), {
    read: () => controller.openrouterCipher(),
    write: (cipher) => controller.setOpenrouterCipher(cipher),
  });
  const base = options.base ?? fake.base;
  const service = new OpenRouterService({
    client: new OpenRouterClient({ base, timeoutMs: 2000 }),
    store,
    base,
    openExternal: options.opener ?? fetchOpener(),
    emit: (status) => statuses.push(status),
    ...(options.timeoutMs === undefined ? {} : { callbackTimeoutMs: options.timeoutMs }),
  });
  services.push(service);
  return service;
}

async function stateText(): Promise<string> {
  return readFile(path.join(dir, 'state.json'), 'utf8');
}

function callbackBase(): string {
  const url = fake.auth[0]?.callbackUrl;
  if (url === undefined) throw new Error('no auth request recorded');
  return url;
}

function rawRequest(port: number, options: { method?: string; path: string; host?: string }): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { hostname: '127.0.0.1', port, method: options.method ?? 'GET', path: options.path, headers: { Host: options.host ?? `localhost:${port}` } },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), headers: response.headers }));
      },
    );
    request.on('error', reject);
    request.end();
  });
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

function portOf(url: string): number {
  return Number(new URL(url).port);
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'aiaw-openrouter-'));
  fake = await startFakeOpenRouter();
  controller = await newController();
  statuses = [];
  services = [];
});

afterEach(async () => {
  for (const service of services) service.shutdown();
  controller.shutdown();
  await fake.close();
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

describe('PKCE sign-in against the fake server', () => {
  it('sends the S256 challenge of the verifier and a 43 character state, exchanges the code and keeps only ciphertext', async () => {
    const service = build();
    const first = await service.connect('browser');
    expect(first.state).toBe('signing-in');
    await service.settled();
    const auth = fake.auth[0];
    expect(auth?.method).toBe('S256');
    expect(auth?.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(auth?.callbackUrl).toMatch(/^http:\/\/localhost:\d+\/callback$/);
    expect(auth?.label).toBe('AI Agent Windows');
    const exchange = fake.requests.find((request) => request.path === '/api/v1/auth/keys');
    const body = JSON.parse(exchange?.body ?? '{}') as { code_verifier: string; code_challenge_method: string };
    expect(body.code_challenge_method).toBe('S256');
    expect(challengeOf(body.code_verifier)).toBe(auth?.challenge);
    expect(service.status()).toEqual({
      state: 'connected',
      mode: null,
      notice: null,
      info: { isFreeTier: true, limitRemaining: null, freeRequests: { used: 3, limit: 50, remaining: 47 } },
    });
    const text = await stateText();
    expect(text).not.toContain(fake.key);
    expect(text).not.toContain('FAKE');
    const stored = (JSON.parse(text) as { openrouterKey: string }).openrouterKey;
    expect(Buffer.from(stored, 'base64').toString('latin1')).not.toContain('FAKE');
    expect(Buffer.from(stored, 'base64').toString('latin1')).not.toContain(fake.key);
    expect(JSON.stringify(statuses)).not.toContain(fake.key);
    expect(JSON.stringify(service.status())).not.toContain('FAKE');
    for (const request of fake.requests.filter((entry) => entry.path.startsWith('/api'))) {
      expect(request.headers['x-openrouter-title']).toBe('AI Agent Windows');
      expect(request.headers['http-referer']).toBe('http://localhost');
      expect(request.headers['x-openrouter-app-visibility']).toBe('hidden');
    }
    expect(fake.requests.find((request) => request.path === '/api/v1/key')?.headers.authorization).toBe(`Bearer ${fake.key}`);
  });

  it('a pkce pair is random, its challenge is the base64url sha256 of the verifier and both are 43 characters', () => {
    const one = createPkce();
    const two = createPkce();
    expect(one.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(one.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(one.challenge).toBe(challengeOf(one.verifier));
    expect(challengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    expect(one.verifier).not.toBe(two.verifier);
    expect(one.state).not.toBe(two.state);
    expect(one.state).not.toBe(one.verifier);
  });

  it('a stored key survives a restart: a new service reads the ciphertext and shows connected', async () => {
    const service = build();
    await service.connect('browser');
    await service.settled();
    const again = build();
    await again.init();
    expect(again.status().state).toBe('connected');
    await again.settled();
    expect(again.status().info?.freeRequests?.remaining).toBe(47);
  });

  it('a callback with a wrong state is refused and no key is stored', async () => {
    fake.behavior = 'deny';
    const service = build();
    await service.connect('browser');
    const wrong = `${fake.auth[0]?.state.slice(0, -1)}${fake.auth[0]?.state.endsWith('A') ? 'B' : 'A'}`;
    const code = fake.issueCode(fake.auth[0]?.challenge ?? '');
    const refused = await fake.hitCallback(callbackBase(), `?code=${code}&state=${wrong}`);
    expect(refused.status).toBe(400);
    const missing = await fake.hitCallback(callbackBase(), `?code=${code}`);
    expect(missing.status).toBe(400);
    expect(fake.requests.filter((request) => request.path === '/api/v1/auth/keys')).toHaveLength(0);
    expect(service.status().state).toBe('signing-in');
    expect(await stateText().catch(() => '')).not.toContain('openrouterKey');
    expect(controller.openrouterCipher()).toBeNull();
    const accepted = await fake.hitCallback(callbackBase(), `?code=${code}&state=${fake.auth[0]?.state}`);
    expect(accepted.status).toBe(200);
    await service.settled();
    expect(service.status().state).toBe('connected');
  });

  it('a wrong state sent by the browser leaves the user signed out of a stored key', async () => {
    fake.behavior = 'wrong-state';
    const service = build();
    await service.connect('browser');
    await Promise.race([service.settled(), new Promise((resolve) => setTimeout(resolve, 150))]);
    expect(fake.requests.filter((request) => request.path === '/api/v1/auth/keys')).toHaveLength(0);
    expect(service.status().state).toBe('signing-in');
    expect(controller.openrouterCipher()).toBeNull();
    service.cancel();
  });

  it('the callback page echoes nothing from the request', async () => {
    fake.behavior = 'deny';
    const service = build();
    await service.connect('browser');
    const port = portOf(callbackBase());
    const marker = 'ECHO<script>alert(1)</script>MARKER';
    const encoded = encodeURIComponent(marker);
    const refused = await rawRequest(port, { path: `/callback?code=${encoded}&state=${encoded}&x=${encoded}` });
    expect(refused.status).toBe(400);
    expect(refused.body).not.toContain('MARKER');
    expect(refused.body).not.toContain('script>alert');
    const unknown = await rawRequest(port, { path: `/${encoded}?code=${encoded}` });
    expect(unknown.status).toBe(400);
    expect(unknown.body).not.toContain('MARKER');
    expect(refused.headers['content-type']).toContain('text/html');
    expect(refused.headers['cache-control']).toBe('no-store');
    expect(refused.headers['x-content-type-options']).toBe('nosniff');
    expect(refused.headers['referrer-policy']).toBe('no-referrer');
    expect(refused.headers['content-security-policy']).toBe("default-src 'none'");
    const code = `CODE${encoded}`.slice(0, 40);
    const accepted = await rawRequest(port, { path: `/callback?code=${encodeURIComponent(code)}&state=${fake.auth[0]?.state}&extra=${encoded}` });
    expect(accepted.status).toBe(200);
    expect(accepted.body).not.toContain('MARKER');
    expect(accepted.body).not.toContain('CODE');
    expect(accepted.body).not.toContain(fake.auth[0]?.state ?? 'x');
    await service.settled();
  });

  it('refuses other methods, other paths and a foreign host name, and keeps waiting', async () => {
    fake.behavior = 'deny';
    const service = build();
    await service.connect('browser');
    const port = portOf(callbackBase());
    const state = fake.auth[0]?.state ?? '';
    const code = fake.issueCode(fake.auth[0]?.challenge ?? '');
    expect((await rawRequest(port, { method: 'POST', path: `/callback?code=${code}&state=${state}` })).status).toBe(400);
    expect((await rawRequest(port, { path: `/other?code=${code}&state=${state}` })).status).toBe(400);
    expect((await rawRequest(port, { path: `/callback?code=${code}&state=${state}`, host: 'evil.example' })).status).toBe(400);
    expect((await rawRequest(port, { path: `/callback?code=${code}&state=${state}`, host: `localhost:${port + 1}` })).status).toBe(400);
    expect((await rawRequest(port, { path: `/callback?code=${'c'.repeat(513)}&state=${state}` })).status).toBe(400);
    expect((await rawRequest(port, { path: `/callback?code=&state=${state}` })).status).toBe(400);
    expect((await rawRequest(port, { path: `/callback?code=${code}&state=${state}0` })).status).toBe(400);
    expect(fake.requests.filter((request) => request.path === '/api/v1/auth/keys')).toHaveLength(0);
    expect(service.status().state).toBe('signing-in');
    service.cancel();
  });

  it('binds the loopback interface only and closes after the first valid callback', async () => {
    fake.behavior = 'deny';
    const service = build();
    await service.connect('browser');
    const port = portOf(callbackBase());
    const bound = await new Promise<string>((resolve) => {
      const probe = net.connect(port, '127.0.0.1', () => {
        resolve(probe.remoteAddress ?? '');
        probe.destroy();
      });
    });
    expect(bound).toBe('127.0.0.1');
    const code = fake.issueCode(fake.auth[0]?.challenge ?? '');
    const accepted = await rawRequest(port, { path: `/callback?code=${code}&state=${fake.auth[0]?.state}` });
    expect(accepted.status).toBe(200);
    await service.settled();
    expect(await portOpen(port)).toBe(false);
    expect(fake.requests.filter((request) => request.path === '/api/v1/auth/keys')).toHaveLength(1);
  });

  it('closes the listener after the time limit and says so', async () => {
    fake.behavior = 'deny';
    const service = build({ timeoutMs: 60 });
    await service.connect('browser');
    const port = portOf(callbackBase());
    await service.settled();
    expect(service.status()).toEqual({ state: 'signed-out', mode: null, notice: 'sign-in-timeout', info: null });
    expect(await portOpen(port)).toBe(false);
  });

  it('an expired code is refused and no key is stored', async () => {
    fake.expireCodes = true;
    const service = build();
    await service.connect('browser');
    await service.settled();
    expect(service.status()).toEqual({ state: 'signed-out', mode: null, notice: 'sign-in-failed', info: null });
    expect(controller.openrouterCipher()).toBeNull();
  });

  it('an invalid code is refused and no key is stored', async () => {
    fake.behavior = 'deny';
    const service = build();
    await service.connect('browser');
    const accepted = await fake.hitCallback(callbackBase(), `?code=never-issued&state=${fake.auth[0]?.state}`);
    expect(accepted.status).toBe(200);
    await service.settled();
    expect(service.status().notice).toBe('sign-in-failed');
    expect(controller.openrouterCipher()).toBeNull();
  });

  it('a code that cannot be exchanged because the server is gone says the server could not be reached', async () => {
    fake.behavior = 'deny';
    const service = build();
    await service.connect('browser');
    const code = fake.issueCode(fake.auth[0]?.challenge ?? '');
    await fake.close();
    await fake.hitCallback(callbackBase(), `?code=${code}&state=${fake.auth[0]?.state}`).catch(() => undefined);
    await service.settled();
    expect(service.status().notice).toBe('network');
    fake = await startFakeOpenRouter();
  });

  it('cancel stops the listener and signs out quietly; a second connect works', async () => {
    fake.behavior = 'deny';
    const service = build();
    await service.connect('browser');
    const port = portOf(callbackBase());
    expect(service.cancel().state).toBe('signed-out');
    await service.settled();
    expect(await portOpen(port)).toBe(false);
    expect(service.status().notice).toBeNull();
    expect(service.cancel().state).toBe('signed-out');
    fake.behavior = 'approve';
    await service.connect('browser');
    await service.settled();
    expect(service.status().state).toBe('connected');
    expect((await service.connect('browser')).state).toBe('connected');
  });

  it('starting again replaces a sign-in that is still waiting', async () => {
    fake.behavior = 'deny';
    const service = build();
    await service.connect('browser');
    const firstPort = portOf(callbackBase());
    await service.connect('browser');
    expect(await portOpen(firstPort)).toBe(false);
    expect(fake.auth).toHaveLength(2);
    service.cancel();
  });

  it('says the browser could not be opened and closes the listener', async () => {
    const service = build({
      opener: async () => {
        throw new Error('no browser');
      },
    });
    const status = await service.connect('browser');
    expect(status).toEqual({ state: 'signed-out', mode: null, notice: 'open-failed', info: null });
    await service.settled();
  });
});

describe('401 and disconnect', () => {
  it('a 401 clears the stored key and returns to sign-in', async () => {
    const service = build();
    await service.connect('browser');
    await service.settled();
    expect(controller.openrouterCipher()).not.toBeNull();
    fake.revoked = true;
    const status = await service.refresh();
    expect(status).toEqual({ state: 'signed-out', mode: null, notice: 'key-rejected', info: null });
    expect(controller.openrouterCipher()).toBeNull();
    expect(await stateText()).not.toContain('openrouterKey');
  });

  it('a 401 at start-up clears the stored key too', async () => {
    const first = build();
    await first.connect('browser');
    await first.settled();
    fake.revoked = true;
    const again = build();
    await again.init();
    await again.settled();
    expect(again.status().notice).toBe('key-rejected');
    expect(controller.openrouterCipher()).toBeNull();
  });

  it('another failure of the key info keeps the key and the connected state', async () => {
    const service = build();
    await service.connect('browser');
    await service.settled();
    await fake.close();
    const status = await service.refresh();
    expect(status.state).toBe('connected');
    expect(controller.openrouterCipher()).not.toBeNull();
    fake = await startFakeOpenRouter();
  });

  it('disconnect removes the ciphertext and is the signed-out state', async () => {
    const service = build();
    await service.connect('browser');
    await service.settled();
    const status = await service.disconnect();
    expect(status).toEqual({ state: 'signed-out', mode: null, notice: null, info: null });
    expect(controller.openrouterCipher()).toBeNull();
    expect(await stateText()).not.toContain('openrouterKey');
    expect((await service.refresh()).state).toBe('signed-out');
  });

  it('refresh while signed out does nothing', async () => {
    const service = build();
    expect((await service.refresh()).state).toBe('signed-out');
    expect(fake.requests).toHaveLength(0);
  });
});

describe('safe storage', () => {
  const unavailable: SecretBox = {
    available: async () => false,
    encrypt: async () => {
      throw new Error('never');
    },
    decrypt: async () => {
      throw new Error('never');
    },
  };

  it('without safe storage nothing is stored and the block says so', async () => {
    const service = build({ box: unavailable });
    const status = await service.connect('browser');
    expect(status).toEqual({ state: 'signed-out', mode: null, notice: 'storage-unavailable', info: null });
    expect(fake.requests).toHaveLength(0);
    expect(controller.openrouterCipher()).toBeNull();
    expect((await service.paste('sk-or-v1-pasted')).notice).toBe('storage-unavailable');
    expect(fake.requests).toHaveLength(0);
  });

  it('while state.json cannot be read the key is not saved, the block says so and the file stays as it was', async () => {
    const broken = path.join(dir, 'broken');
    const truncated = '{"version":2,"agents":[{"id":"';
    await mkdir(broken);
    await writeFile(path.join(broken, 'state.json'), truncated, 'utf8');
    const working = controller;
    controller = await newController(broken);
    try {
      const service = build();
      const status = await service.paste(fake.key);
      expect(status).toEqual({ state: 'signed-out', mode: null, notice: 'state-refused', info: null });
      expect(controller.openrouterCipher()).toBeNull();
      expect(await readFile(path.join(broken, 'state.json'), 'utf8')).toBe(truncated);
    } finally {
      controller.shutdown();
      controller = working;
    }
  });

  it('a stored key stays untouched while safe storage is unavailable at start-up', async () => {
    const service = build();
    await service.connect('browser');
    await service.settled();
    const cipher = controller.openrouterCipher();
    const again = build({ box: unavailable });
    await again.init();
    expect(again.status()).toEqual({ state: 'signed-out', mode: null, notice: 'storage-unavailable', info: null });
    expect(controller.openrouterCipher()).toBe(cipher);
  });

  it('a ciphertext that cannot be read is dropped at start-up', async () => {
    await controller.setOpenrouterCipher(Buffer.from('not a real ciphertext at all').toString('base64'));
    const service = build();
    await service.init();
    expect(service.status().state).toBe('signed-out');
    expect(controller.openrouterCipher()).toBeNull();
  });

  it('re-encrypts a key that the platform asks to re-encrypt', async () => {
    const real = testSecretBox();
    const rotating: SecretBox = { ...real, decrypt: async (cipher) => ({ ...(await real.decrypt(cipher)), reEncrypt: true }) };
    const service = build();
    await service.connect('browser');
    await service.settled();
    const before = controller.openrouterCipher();
    const again = build({ box: rotating });
    await again.init();
    expect(again.status().state).toBe('connected');
    expect(controller.openrouterCipher()).not.toBe(before);
    await again.settled();
  });

  it('a platform that throws while encrypting stores nothing', async () => {
    const failing: SecretBox = {
      available: async () => true,
      encrypt: async () => {
        throw new Error('keychain locked');
      },
      decrypt: async () => ({ text: '', reEncrypt: false }),
    };
    const service = build({ box: failing });
    await service.connect('browser');
    await service.settled();
    expect(service.status().notice).toBe('storage-unavailable');
    expect(controller.openrouterCipher()).toBeNull();
  });

  it('an empty decrypted key is dropped', async () => {
    const empty: SecretBox = { available: async () => true, encrypt: async () => Buffer.from('x'), decrypt: async () => ({ text: '', reEncrypt: false }) };
    await controller.setOpenrouterCipher('AAAA');
    const service = build({ box: empty });
    await service.init();
    expect(service.status().state).toBe('signed-out');
    expect(controller.openrouterCipher()).toBeNull();
  });
});

describe('paste fallbacks', () => {
  it('a pasted key is checked against the server, stored as ciphertext and shown as connected', async () => {
    const service = build();
    const status = await service.paste(`  ${fake.key}\n`);
    expect(status.state).toBe('connected');
    expect(status.info?.freeRequests?.remaining).toBe(47);
    expect(await stateText()).not.toContain(fake.key);
    expect(controller.openrouterCipher()).not.toBeNull();
  });

  it('a pasted key the server refuses is not stored', async () => {
    const service = build();
    const status = await service.paste('sk-or-v1-not-the-key');
    expect(status).toEqual({ state: 'signed-out', mode: null, notice: 'invalid-key', info: null });
    expect(controller.openrouterCipher()).toBeNull();
  });

  it('text that is not a key is refused without a request, and a dead server is reported', async () => {
    const service = build();
    expect((await service.paste('two words')).notice).toBe('invalid-key');
    expect(fake.requests).toHaveLength(0);
    await fake.close();
    expect((await service.paste('sk-or-v1-x')).notice).toBe('network');
    fake = await startFakeOpenRouter();
  });

  it('the code mode shows the headless page without a callback and exchanges the pasted code', async () => {
    fake.behavior = 'deny';
    const service = build();
    const status = await service.connect('code');
    expect(status).toEqual({ state: 'signing-in', mode: 'code', notice: null, info: null });
    expect(fake.auth[0]?.callbackUrl).toBe('');
    expect(fake.auth[0]?.state).toBe('');
    const code = fake.issueCode(fake.auth[0]?.challenge ?? '');
    const done = await service.paste(code);
    expect(done.state).toBe('connected');
    expect(await stateText()).not.toContain(fake.key);
  });

  it('a pasted code the server refuses ends the sign-in without a key', async () => {
    fake.behavior = 'deny';
    const service = build();
    await service.connect('code');
    const done = await service.paste('wrong-code');
    expect(done).toEqual({ state: 'signed-out', mode: null, notice: 'sign-in-failed', info: null });
    expect(controller.openrouterCipher()).toBeNull();
  });

  it('a sign-in cancelled while the code is exchanged leaves no key behind', async () => {
    fake.behavior = 'deny';
    const service = build();
    await service.connect('code');
    const code = fake.issueCode(fake.auth[0]?.challenge ?? '');
    const pending = service.paste(code);
    await service.disconnect();
    await pending;
    expect(service.status().state).toBe('signed-out');
    expect(controller.openrouterCipher()).toBeNull();
  });
});

describe('model list', () => {
  it('is fetched once per run, refetched on demand, and keeps the old list when the server fails', async () => {
    const service = build();
    const first = await service.models(false);
    expect(first.ok).toBe(true);
    expect(first.models.map((model) => model.id)).toEqual(['acme/free-model:free', 'acme/paid-model', 'openrouter/free', PROVIDER_LIMITED_MODEL, ACCOUNT_LIMITED_MODEL, 'acme/markup']);
    await service.models(false);
    expect(fake.requests.filter((request) => request.path === '/api/v1/models')).toHaveLength(1);
    expect(fake.requests.find((request) => request.path === '/api/v1/models')?.headers.authorization).toBeUndefined();
    await Promise.all([service.models(true), service.models(true)]);
    expect(fake.requests.filter((request) => request.path === '/api/v1/models')).toHaveLength(2);
    await fake.close();
    const failed = await service.models(true);
    expect(failed.ok).toBe(false);
    expect(failed.models).toHaveLength(6);
    fake = await startFakeOpenRouter();
  });

  it('reports a failure with an empty list when nothing was ever fetched', async () => {
    const service = build({ base: 'http://127.0.0.1:1' });
    expect(await service.models(false)).toEqual({ ok: false, models: [] });
  });
});

describe('client limits', () => {
  it('rejects a redirect, a body that is not JSON, a key reply without a key and a body over the limit', async () => {
    const answer = (status: number, body: string, headers: Record<string, string> = {}): typeof fetch =>
      (async () => new Response(body, { status, headers })) as typeof fetch;
    const client = (fetchImpl: typeof fetch): OpenRouterClient => new OpenRouterClient({ base: fake.base, fetch: fetchImpl });
    await expect(client(answer(200, 'not json')).models()).rejects.toMatchObject({ kind: 'shape' });
    await expect(client(answer(200, '{"user_id":"x"}')).exchange('c', 'v')).rejects.toMatchObject({ kind: 'shape' });
    await expect(client(answer(200, '{"key":"has space"}')).exchange('c', 'v')).rejects.toMatchObject({ kind: 'shape' });
    await expect(client(answer(200, '{"data":{}}')).models()).resolves.toEqual([]);
    await expect(client(answer(200, '[]')).keyInfo('k')).rejects.toMatchObject({ kind: 'shape' });
    await expect(client(answer(200, ' '.repeat(70 * 1024) + '{}')).keyInfo('k')).rejects.toMatchObject({ kind: 'shape' });
    await expect(client(answer(401, '{}')).keyInfo('k')).rejects.toMatchObject({ kind: 'status', status: 401 });
    await expect(client((async () => Promise.reject(new TypeError('redirect'))) as typeof fetch).models()).rejects.toMatchObject({ kind: 'network' });
  });
});
