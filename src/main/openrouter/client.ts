// client.ts
import {
  MAX_MODELS_BYTES,
  attributionHeaders,
  parseKeyInfo,
  parseModels,
  parsePastedKey,
  type KeyInfo,
  type ModelItem,
} from '../../shared/openrouter';
import { runChat, type ChatInput, type ChatOptions } from './chat';

export class OpenRouterError extends Error {
  constructor(
    readonly kind: 'status' | 'network' | 'shape',
    readonly status: number,
  ) {
    super(`openrouter ${kind} ${status}`);
  }
}

export interface ClientDeps {
  base: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

export class OpenRouterClient {
  constructor(private readonly deps: ClientDeps) {}

  async exchange(code: string, verifier: string): Promise<string> {
    const body = JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' });
    const raw = await this.send('/api/v1/auth/keys', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } }, 64 * 1024);
    const key = isObject(raw) ? parsePastedKey(raw['key']) : null;
    if (key === null) throw new OpenRouterError('shape', 200);
    return key;
  }

  async keyInfo(key: string): Promise<KeyInfo> {
    const info = parseKeyInfo(await this.send('/api/v1/key', { method: 'GET', headers: { Authorization: `Bearer ${key}` } }, 64 * 1024));
    if (info === null) throw new OpenRouterError('shape', 200);
    return info;
  }

  async models(): Promise<ModelItem[]> {
    const raw = await this.send('/api/v1/models', { method: 'GET', headers: {} }, MAX_MODELS_BYTES);
    return parseModels(raw, (this.deps.now ?? Date.now)());
  }

  chat(key: string, input: ChatInput, options: ChatOptions): Promise<string | null> {
    return runChat({ base: this.deps.base, ...(this.deps.fetch === undefined ? {} : { fetch: this.deps.fetch }) }, key, input, options);
  }

  private async send(path: string, init: { method: string; body?: string; headers: Record<string, string> }, maxBytes: number): Promise<unknown> {
    let response: Response;
    let bytes: ArrayBuffer;
    try {
      response = await (this.deps.fetch ?? fetch)(`${this.deps.base}${path}`, {
        method: init.method,
        ...(init.body === undefined ? {} : { body: init.body }),
        headers: { ...attributionHeaders(), Accept: 'application/json', ...init.headers },
        redirect: 'error',
        signal: AbortSignal.timeout(this.deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
      bytes = await response.arrayBuffer();
    } catch {
      throw new OpenRouterError('network', 0);
    }
    if (!response.ok) throw new OpenRouterError('status', response.status);
    if (bytes.byteLength > maxBytes) throw new OpenRouterError('shape', response.status);
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
      throw new OpenRouterError('shape', response.status);
    }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
