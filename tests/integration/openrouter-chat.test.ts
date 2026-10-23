// openrouter-chat.test.ts
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentController } from '../../src/main/agent-controller';
import { IDLE_TEXT } from '../../src/main/openrouter/chat-stream';
import { OpenRouterChats } from '../../src/main/openrouter/chats';
import { OpenRouterClient } from '../../src/main/openrouter/client';
import { ConversationStore } from '../../src/main/openrouter/conversation-store';
import { KeyStore } from '../../src/main/openrouter/key-store';
import { OpenRouterService } from '../../src/main/openrouter/service';
import { testSecretBox } from '../../src/main/openrouter/test-mode';
import { openStore } from '../unit/helpers/app-state';
import type { OpenRouterSettings, OpenRouterStatus } from '../../src/shared/openrouter';
import {
  BUSY_TEXT,
  EMPTY_TEXT,
  INTERRUPTED_TEXT,
  LENGTH_TEXT,
  MODEL_FAILED_TEXT,
  NOTHING_TO_RETRY_TEXT,
  UNREADABLE_TEXT,
  parseConversation,
  type ChatDelta,
  type ChatEntry,
  type ChatSend,
} from '../../src/shared/openrouter-chat';
import { ACCOUNT_LIMITED_MODEL, FAKE_LIMIT_MARKUP, FAKE_PROVIDER_NAME, PROVIDER_LIMITED_MODEL, SSE_COMMENT, sseData, sseDelta, sseTail, startFakeOpenRouter, type ChatCall, type ChatScript, type FakeOpenRouter } from '../fixtures/openrouter-fake';

const AGENT = '0b9a5d6e-3f43-4c1b-9d57-1f6b7a2c8e10';

let dir: string;
let fake: FakeOpenRouter;
let service: OpenRouterService;
let store: ConversationStore;
let settings: OpenRouterSettings;
let deltas: ChatDelta[];
let copied: string[];
let statuses: OpenRouterStatus[];
let cipher: string | null;

function chats(idleMs?: number): OpenRouterChats {
  return new OpenRouterChats({
    service,
    store,
    settingsOf: (id) => (id === AGENT ? settings : undefined),
    emit: (delta) => deltas.push(delta),
    copy: (text) => copied.push(text),
    ...(idleMs === undefined ? {} : { idleMs }),
  });
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'aiaw-or-chat-'));
  fake = await startFakeOpenRouter();
  statuses = [];
  deltas = [];
  copied = [];
  cipher = null;
  settings = { model: 'acme/free-model:free', modelName: 'Acme Free', effort: '', web: false };
  store = new ConversationStore(path.join(dir, 'openrouter'));
  service = new OpenRouterService({
    client: new OpenRouterClient({ base: fake.base, timeoutMs: 2000 }),
    store: new KeyStore(testSecretBox(), {
      read: () => cipher,
      write: (value) => {
        cipher = value;
        return Promise.resolve();
      },
    }),
    base: fake.base,
    openExternal: () => Promise.resolve(),
    emit: (status) => statuses.push(status),
  });
  await service.paste(fake.key);
});

afterEach(async () => {
  service.shutdown();
  await fake.close();
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

function script(next: (call: ChatCall) => ChatScript | undefined): void {
  fake.chat = next;
}

async function until(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 10000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function entryOf(result: ChatSend): ChatEntry {
  if (!result.ok) throw new Error(`send refused: ${result.error}`);
  return result.entry;
}

async function stored(): Promise<ChatEntry[]> {
  return parseConversation(await readFile(store.file(AGENT), 'utf8'), AGENT)?.entries ?? [];
}

describe('streaming against the fake server', () => {
  it('shows deltas as they arrive, skips comments, joins a split chunk and keeps the usage', async () => {
    const entry = entryOf(await chats().send(AGENT, 'First question'));
    expect(entry).toMatchObject({ role: 'assistant', status: 'done', text: 'Reply from acme/free-model:free number 1', usage: { promptTokens: 10, completionTokens: 5, cost: null } });
    expect(entry.error).toBeUndefined();
    expect(deltas.every((delta) => delta.id === AGENT)).toBe(true);
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.map((delta) => delta.text).join('')).toBe(entry.text);
    const call = fake.chatCalls[0] as ChatCall;
    expect(call.body?.stream).toBe(true);
    expect(call.headers.accept).toBe('text/event-stream');
    expect(call.headers.authorization).toBe(`Bearer ${fake.key}`);
    expect(call.body).not.toHaveProperty('reasoning');
    expect(call.body).not.toHaveProperty('tools');
    expect(await stored()).toMatchObject([{ role: 'user', text: 'First question', status: 'done' }, { role: 'assistant', text: entry.text, status: 'done' }]);
  });

  it('every request carries the stored conversation, with the effort and web search of the agent', async () => {
    const service1 = chats();
    await service1.send(AGENT, 'First question');
    settings = { model: 'acme/paid-model', effort: 'low', web: true };
    await chats().send(AGENT, 'Second question');
    const second = fake.chatCalls[1] as ChatCall;
    expect(second.body?.model).toBe('acme/paid-model');
    expect(second.body?.messages).toEqual([
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'Reply from acme/free-model:free number 1' },
      { role: 'user', content: 'Second question' },
    ]);
    expect(second.body?.reasoning).toEqual({ effort: 'low' });
    expect(second.body?.tools?.map((tool) => tool.type)).toEqual(['openrouter:web_search']);
    const reloaded = await chats().load(AGENT);
    expect(reloaded.ok && reloaded.entries.map((entry) => entry.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  });

  it('Stop aborts the request, keeps the text written so far and sends it with the next request', async () => {
    script((call) => (call.n === 1 ? { stream: { parts: [SSE_COMMENT, sseDelta('Half an ans'), sseDelta('wer ')], hold: true } } : undefined));
    const service1 = chats();
    const sending = service1.send(AGENT, 'Long question');
    await until(() => deltas.map((delta) => delta.text).join('') === 'Half an answer ', 'the partial text');
    service1.stop(AGENT);
    const entry = entryOf(await sending);
    expect(entry).toMatchObject({ status: 'stopped', text: 'Half an answer ' });
    await until(() => fake.chatClosed === 1, 'the aborted connection');
    expect((await stored()).at(-1)).toMatchObject({ status: 'stopped', text: 'Half an answer ' });
    await service1.send(AGENT, 'Next');
    expect(fake.chatCalls[1]?.body?.messages?.map((message) => message.content)).toEqual(['Long question', 'Half an answer ', 'Next']);
    service1.stop(AGENT);
  });

  it('stopping before the first byte gives an empty stopped reply and a later failed reply is not sent again', async () => {
    script((call) => (call.n === 1 ? { hang: true } : call.n === 2 ? { status: 429, body: { error: { code: 429, message: 'Rate limit exceeded' } } } : undefined));
    const service1 = chats();
    const sending = service1.send(AGENT, 'Hello?');
    await until(() => fake.chatCalls.length === 1, 'the request');
    service1.stop(AGENT);
    expect(entryOf(await sending)).toMatchObject({ status: 'stopped', text: '' });
    const failed = entryOf(await service1.send(AGENT, 'Again'));
    expect(failed.status).toBe('failed');
    await service1.send(AGENT, 'Once more');
    expect(fake.chatCalls[2]?.body?.messages?.map((message) => message.content)).toEqual(['Hello?', 'Again', 'Once more']);
  });

  it('refuses a second message while a reply is being written, and shutdown stops it', async () => {
    script(() => ({ stream: { parts: [sseDelta('Writing')], hold: true } }));
    const service1 = chats();
    const first = service1.send(AGENT, 'One');
    await until(() => deltas.length === 1, 'the first delta');
    expect(await service1.send(AGENT, 'Two')).toEqual({ ok: false, error: BUSY_TEXT });
    service1.shutdown();
    expect(entryOf(await first).status).toBe('stopped');
    expect((await stored()).map((entry) => entry.text)).toEqual(['One', 'Writing']);
  });
});

describe('errors become a failed reply with readable text', () => {
  async function failedWith(next: ChatScript): Promise<ChatEntry> {
    script(() => next);
    return entryOf(await chats().send(AGENT, 'Question'));
  }

  it('401 signs the key out through the account service', async () => {
    const entry = await failedWith({ status: 401, body: { error: { code: 401, message: 'No auth' } } });
    expect(entry.status).toBe('failed');
    expect(entry.text).toBe('');
    expect(entry.error).toBeTruthy();
    await until(() => statuses.at(-1)?.state === 'signed-out', 'the sign-out');
    expect(statuses.at(-1)?.notice).toBe('key-rejected');
    expect(await chats().send(AGENT, 'Again')).toMatchObject({ ok: false });
  });

  it('402 names the limit source and 429 the rate cap', async () => {
    const paid = await failedWith({ status: 402, body: { error: { code: 402, message: 'Insufficient credits', metadata: { limit_source: 'openrouter_credits' } } } });
    expect(paid.status).toBe('failed');
    expect(paid.error).toContain('openrouter_credits');
    const rate = await failedWith({ status: 429, body: { error: { code: 429, message: 'Rate limit exceeded' } } });
    expect(rate.status).toBe('failed');
    expect(rate.error).toBeTruthy();
    expect(rate.error).not.toBe(paid.error);
  });

  it('a 429 says whether the model provider or the account cap hit, with the server message', async () => {
    settings = { ...settings, model: PROVIDER_LIMITED_MODEL };
    const provider = entryOf(await chats().send(AGENT, 'Question'));
    expect(provider.status).toBe('failed');
    expect(provider.error).toContain(FAKE_PROVIDER_NAME);
    expect(provider.error).toContain(FAKE_LIMIT_MARKUP);
    settings = { ...settings, model: ACCOUNT_LIMITED_MODEL };
    const account = entryOf(await chats().send(AGENT, 'Question'));
    expect(account.error).not.toContain(FAKE_PROVIDER_NAME);
    expect(account.error).toContain('Rate limit exceeded');
    expect(account.error).toMatch(/4[45]/);
  });

  it('another status carries its detail', async () => {
    const entry = await failedWith({ status: 503, body: { error: { code: 503, message: 'No provider' } } });
    expect(entry.error).toContain('No provider');
    expect(entry.error).toContain('503');
  });

  it('a mid-stream error keeps the text before it and shows the reason', async () => {
    const entry = await failedWith({
      stream: { parts: [SSE_COMMENT, sseDelta('Partial '), sseData({ error: { code: 'server_error', message: 'Upstream died' }, choices: [{ index: 0, delta: { content: '' }, finish_reason: 'error' }] })] },
    });
    expect(entry).toMatchObject({ status: 'failed', text: 'Partial ' });
    expect(entry.error).toContain(MODEL_FAILED_TEXT);
    expect(entry.error).toContain('Upstream died');
  });

  it('an error chunk as the only event is a failure, not an empty answer', async () => {
    const entry = await failedWith({ stream: { parts: [sseData({ error: { code: 502, message: 'Bad gateway' }, choices: [{ finish_reason: 'error' }] })] } });
    expect(entry).toMatchObject({ status: 'failed', text: '' });
  });

  it('length with empty content, an empty reply, a cut connection and garbage each get their own text', async () => {
    expect((await failedWith({ stream: { parts: [sseData({ choices: [{ delta: { content: '' }, finish_reason: 'length' }] }), 'data: [DONE]\n\n'] } })).error).toBe(LENGTH_TEXT);
    expect((await failedWith({ stream: { parts: [...sseTail(3, 0)] } })).error).toBe(EMPTY_TEXT);
    expect((await failedWith({ stream: { parts: [sseDelta('half')] } })).error).toBe(INTERRUPTED_TEXT);
    expect((await failedWith({ stream: { parts: ['<html>proxy page</html>\n'] } })).error).toBe(UNREADABLE_TEXT);
  });

  it('a stream that goes silent fails after the idle limit', async () => {
    script(() => ({ stream: { parts: [sseDelta('Then silence')], hold: true } }));
    const entry = entryOf(await chats(150).send(AGENT, 'Question'));
    expect(entry).toMatchObject({ status: 'failed', text: 'Then silence', error: IDLE_TEXT });
  });

  it('a server that cannot be reached is a failed reply', async () => {
    await fake.close();
    const entry = entryOf(await chats().send(AGENT, 'Question'));
    expect(entry.status).toBe('failed');
    fake = await startFakeOpenRouter();
  });
});

describe('the agent, its conversation file and Copy', () => {
  it('the conversation is read again by a new service, and Copy puts the stored reply on the clipboard', async () => {
    await chats().send(AGENT, 'Remember me');
    const fresh = chats();
    const loaded = await fresh.load(AGENT);
    expect(loaded.ok && loaded.entries).toHaveLength(2);
    expect(await fresh.copy(AGENT, 1)).toBe(true);
    expect(copied).toEqual(['Reply from acme/free-model:free number 1']);
    expect(await fresh.copy(AGENT, 0)).toBe(false);
    expect(await fresh.copy(AGENT, 9)).toBe(false);
    expect(copied).toHaveLength(1);
  });

  it('closing the agent stops its reply and keeps the file; settings change the title until it is renamed', async () => {
    const closeChat = vi.fn<(id: string) => void>();
    const controller = new AgentController({ store: await openStore(dir), sharedDir: path.join(dir, 'shared'), platform: 'darwin', env: {}, pickFolder: async () => null, emit: () => undefined, closeChat });
    try {
      await controller.add('openrouter');
      const created = controller.snapshot().agents[0];
      expect(created).toMatchObject({ kind: 'openrouter', title: 'OpenRouter', openrouter: { model: '', effort: '', web: false } });
      const id = created?.id ?? '';
      expect(controller.openrouterSettings(id)).toEqual({ model: '', effort: '', web: false });
      expect(await controller.setOpenrouterSettings(id, { model: 'acme/paid-model', modelName: 'Acme Paid', effort: 'low', web: true })).toBe(true);
      expect(controller.agentById(id)).toMatchObject({ title: 'OpenRouter · Acme Paid', openrouter: { model: 'acme/paid-model', effort: 'low', web: true } });
      expect(await controller.setOpenrouterSettings(id, { model: 'acme/free-model:free', modelName: 'Acme Free', effort: '', web: false })).toBe(true);
      expect(controller.agentById(id)?.title).toBe('OpenRouter · Acme Free');
      expect(await controller.rename(id, 'My helper')).toBe(true);
      expect(await controller.setOpenrouterSettings(id, { model: 'acme/paid-model', modelName: 'Acme Paid', effort: '', web: true })).toBe(true);
      expect(controller.agentById(id)?.title).toBe('My helper');
      expect(await controller.setOpenrouterSettings(id, { model: 'Bad Model', effort: '', web: false })).toBe(false);
      expect(await controller.setOpenrouterSettings('missing', { model: '', effort: '', web: false })).toBe(false);
      await controller.add('chatgpt');
      const site = controller.snapshot().agents[1]?.id ?? '';
      expect(await controller.setOpenrouterSettings(site, { model: '', effort: '', web: false })).toBe(false);
      expect(controller.openrouterSettings(site)).toBeUndefined();
      expect(controller.openrouterSettings('missing')).toBeUndefined();
      await controller.close(id);
      expect(closeChat).toHaveBeenCalledWith(id);
      expect(controller.agentById(id)).toBeUndefined();
    } finally {
      controller.shutdown();
    }
  });

  it('a closed agent keeps its conversation file', async () => {
    settings = { model: 'acme/free-model:free', effort: '', web: false };
    await chats().send(AGENT, 'Keep this');
    const before = await readFile(store.file(AGENT), 'utf8');
    const state = await openStore(dir, { version: 2, agents: [{ id: AGENT, kind: 'openrouter', title: 'OpenRouter', openrouter: settings, createdAt: 1 }] });
    const controller = new AgentController({ store: state, sharedDir: path.join(dir, 'shared'), platform: 'darwin', env: {}, pickFolder: async () => null, emit: () => undefined });
    await controller.close(AGENT);
    controller.shutdown();
    expect(await readFile(store.file(AGENT), 'utf8')).toBe(before);
  });
});

describe('retry and dismissing a failed reply', () => {
  const NEW_MODEL = 'acme/free-model:free';

  async function failFirst(): Promise<OpenRouterChats> {
    settings = { ...settings, model: PROVIDER_LIMITED_MODEL };
    const service1 = chats();
    expect(entryOf(await service1.send(AGENT, 'Question')).status).toBe('failed');
    settings = { ...settings, model: NEW_MODEL };
    return service1;
  }

  it('retry sends the stored conversation once with the new model and keeps one copy of the message', async () => {
    const service1 = await failFirst();
    const entry = entryOf(await service1.retry(AGENT, 0));
    expect(entry).toMatchObject({ status: 'done', text: `Reply from ${NEW_MODEL} number 2` });
    expect(fake.chatCalls).toHaveLength(2);
    expect(fake.chatCalls[1]?.body?.model).toBe(NEW_MODEL);
    expect(fake.chatCalls[1]?.body?.messages).toEqual([{ role: 'user', content: 'Question' }]);
    expect((await stored()).map((item) => [item.role, item.status])).toEqual([['user', 'done'], ['assistant', 'done']]);
    expect(await service1.retry(AGENT, 0)).toEqual({ ok: false, error: NOTHING_TO_RETRY_TEXT });
    expect(fake.chatCalls).toHaveLength(2);
  });

  it('a settings change removes the failed reply from the file, the message stays, and the next send carries it once', async () => {
    const service1 = await failFirst();
    expect(await service1.dismiss(AGENT)).toBe(true);
    expect((await stored()).map((item) => item.text)).toEqual(['Question']);
    entryOf(await service1.send(AGENT, 'Next'));
    expect(fake.chatCalls[1]?.body?.messages?.map((message) => message.content)).toEqual(['Question', 'Next']);
  });

  it('retry of a message after a failed reply that follows an answered one resends only that message', async () => {
    entryOf(await chats().send(AGENT, 'First'));
    settings = { ...settings, model: PROVIDER_LIMITED_MODEL };
    const service1 = chats();
    expect(entryOf(await service1.send(AGENT, 'Second')).status).toBe('failed');
    settings = { ...settings, model: NEW_MODEL };
    entryOf(await service1.retry(AGENT, 2));
    expect(fake.chatCalls.at(-1)?.body?.messages?.map((message) => message.content)).toEqual(['First', 'Reply from acme/free-model:free number 1', 'Second']);
    expect((await stored()).map((item) => item.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  });
});

