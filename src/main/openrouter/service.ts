// service.ts
import type { OpenRouterModels } from '../../shared/ipc';
import {
  SIGN_IN_TIMEOUT_MS,
  authUrl,
  emptyStatus,
  parsePastedKey,
  type OpenRouterMode,
  type OpenRouterNotice,
  type OpenRouterStatus,
} from '../../shared/openrouter';
import { ChatError, NOT_SIGNED_IN_TEXT, type ChatInput, type ChatOptions } from './chat';
import { OpenRouterError, type OpenRouterClient } from './client';
import type { KeyStore } from './key-store';
import { startCallbackServer, type CallbackServer } from './loopback';
import { ModelCache } from './models';
import { createPkce, type Pkce } from './pkce';

export interface ServiceDeps {
  client: OpenRouterClient;
  store: KeyStore;
  base: string;
  openExternal(url: string): Promise<void>;
  emit(status: OpenRouterStatus): void;
  callbackTimeoutMs?: number;
}

interface Pending {
  pkce: Pkce;
  server: CallbackServer | null;
}

export class OpenRouterService {
  private current: OpenRouterStatus = emptyStatus();
  private pending: Pending | null = null;
  private epoch = 0;
  private flow: Promise<void> = Promise.resolve();
  private readonly cache: ModelCache;

  constructor(private readonly deps: ServiceDeps) {
    this.cache = new ModelCache(() => deps.client.models());
  }

  status(): OpenRouterStatus {
    return this.current;
  }

  settled(): Promise<void> {
    return this.flow;
  }

  async init(): Promise<void> {
    const loaded = await this.deps.store.load();
    if (loaded === 'loaded') {
      this.set({ state: 'connected', mode: null, notice: null, info: null });
      this.flow = this.loadInfo();
    } else if (loaded === 'unavailable') {
      this.set({ ...emptyStatus(), notice: 'storage-unavailable' });
    }
  }

  async connect(mode: OpenRouterMode): Promise<OpenRouterStatus> {
    if (this.current.state === 'connected') return this.current;
    this.stopPending();
    const epoch = this.epoch;
    if (!(await this.deps.store.canStore())) return epoch === this.epoch ? this.signedOut('storage-unavailable') : this.current;
    const pkce = createPkce();
    let server: CallbackServer | null;
    try {
      server = await this.start(mode, pkce);
    } catch {
      if (epoch !== this.epoch) return this.current;
      this.stopPending();
      return this.signedOut('open-failed');
    }
    if (server !== null) this.flow = this.awaitCallback(server, pkce, epoch);
    return this.current;
  }

  private async start(mode: OpenRouterMode, pkce: Pkce): Promise<CallbackServer | null> {
    const server = mode === 'browser' ? await startCallbackServer({ state: pkce.state, timeoutMs: this.deps.callbackTimeoutMs ?? SIGN_IN_TIMEOUT_MS }) : null;
    this.pending = { pkce, server };
    const url =
      server === null
        ? authUrl(this.deps.base, { challenge: pkce.challenge })
        : authUrl(this.deps.base, { challenge: pkce.challenge, callbackUrl: `http://localhost:${server.port}/callback`, state: pkce.state });
    this.set({ state: 'signing-in', mode, notice: null, info: null });
    await this.deps.openExternal(url);
    return server;
  }

  async paste(text: string): Promise<OpenRouterStatus> {
    const value = parsePastedKey(text);
    if (value === null) return this.set({ ...this.current, notice: 'invalid-key' });
    if (!(await this.deps.store.canStore())) return this.signedOut('storage-unavailable');
    const waiting = this.pending;
    if (waiting !== null && waiting.server === null) {
      const epoch = this.epoch;
      this.pending = null;
      await this.complete(value, waiting.pkce.verifier, epoch);
      return this.current;
    }
    try {
      const info = await this.deps.client.keyInfo(value);
      return await this.adopt(value, info);
    } catch (error) {
      return this.set({ ...this.current, notice: error instanceof OpenRouterError && error.kind === 'network' ? 'network' : 'invalid-key' });
    }
  }

  cancel(): OpenRouterStatus {
    if (this.current.state !== 'signing-in') return this.current;
    this.stopPending();
    return this.signedOut(null);
  }

  async disconnect(): Promise<OpenRouterStatus> {
    this.stopPending();
    await this.deps.store.clear();
    return this.set(emptyStatus());
  }

  async refresh(): Promise<OpenRouterStatus> {
    if (this.deps.store.has()) await this.loadInfo();
    return this.current;
  }

  async keyRejected(): Promise<void> {
    this.stopPending();
    await this.deps.store.clear();
    this.signedOut('key-rejected');
  }

  async chat(input: ChatInput, options: ChatOptions): Promise<string | null> {
    const key = this.deps.store.bearer();
    if (key === null) throw new ChatError('failed', NOT_SIGNED_IN_TEXT);
    try {
      return await this.deps.client.chat(key, input, options);
    } catch (error) {
      if (error instanceof ChatError && error.code === 'unauthorized' && this.deps.store.bearer() === key) await this.keyRejected();
      throw error;
    }
  }

  models(refresh: boolean): Promise<OpenRouterModels> {
    return this.cache.get(refresh);
  }

  shutdown(): void {
    this.stopPending();
  }

  private stopPending(): void {
    this.epoch += 1;
    this.pending?.server?.close();
    this.pending = null;
  }

  private signedOut(notice: OpenRouterNotice | null): OpenRouterStatus {
    return this.set({ ...emptyStatus(), notice });
  }

  private async awaitCallback(server: CallbackServer, pkce: Pkce, epoch: number): Promise<void> {
    const result = await server.result;
    if (epoch !== this.epoch) return;
    this.pending = null;
    if (result.kind === 'code') await this.complete(result.code, pkce.verifier, epoch);
    else this.signedOut(result.kind === 'timeout' ? 'sign-in-timeout' : null);
  }

  private async complete(code: string, verifier: string, epoch: number): Promise<void> {
    let key: string;
    try {
      key = await this.deps.client.exchange(code, verifier);
    } catch (error) {
      if (epoch === this.epoch) this.signedOut(error instanceof OpenRouterError && error.kind === 'network' ? 'network' : 'sign-in-failed');
      return;
    }
    if (epoch !== this.epoch) return;
    await this.adopt(key, null);
  }

  private async adopt(key: string, info: OpenRouterStatus['info']): Promise<OpenRouterStatus> {
    if (!(await this.deps.store.save(key))) return this.signedOut('storage-unavailable');
    this.set({ state: 'connected', mode: null, notice: null, info });
    if (info === null) await this.loadInfo();
    return this.current;
  }

  private async loadInfo(): Promise<void> {
    const key = this.deps.store.bearer();
    if (key === null) return;
    try {
      const info = await this.deps.client.keyInfo(key);
      if (this.deps.store.bearer() === key) this.set({ state: 'connected', mode: null, notice: null, info });
    } catch (error) {
      if (error instanceof OpenRouterError && error.kind === 'status' && error.status === 401 && this.deps.store.bearer() === key) await this.keyRejected();
    }
  }

  private set(status: OpenRouterStatus): OpenRouterStatus {
    this.current = status;
    this.deps.emit(status);
    return status;
  }
}
