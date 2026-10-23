// openrouter-chat.test.ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OpenRouterChats } from '../../src/main/openrouter/chats';
import { ConversationStore } from '../../src/main/openrouter/conversation-store';
import {
  CHAT_SIGNED_OUT_TEXT,
  EMPTY_TEXT,
  INTERRUPTED_TEXT,
  LENGTH_TEXT,
  MAX_CONVERSATION_BYTES,
  MAX_ENTRIES,
  MAX_MESSAGE_CHARS,
  MAX_REPLY_CHARS,
  ReplyStream,
  SseParser,
  UNREADABLE_CONVERSATION_TEXT,
  UNREADABLE_TEXT,
  assistantEntry,
  contextMessages,
  emptyConversation,
  errorDetail,
  failureText,
  openrouterTitle,
  parseConversation,
  replyOutcome,
  sendProblem,
  serializeConversation,
  userEntry,
  type ChatEntry,
  type Conversation,
  type StreamEvent,
} from '../../src/shared/openrouter-chat';
import { emptyOpenRouterSettings, parseOpenRouterSettings, type OpenRouterSettings } from '../../src/shared/openrouter';

const AGENT = '0b9a5d6e-3f43-4c1b-9d57-1f6b7a2c8e10';
const OTHER = '7c1f0a52-8d9e-4b3a-a1c4-5e6d7f8091a2';

function data(value: unknown): string {
  return `data: ${JSON.stringify(value)}\n\n`;
}

function delta(text: string, extra: Record<string, unknown> = {}): string {
  return data({ choices: [{ delta: { content: text }, finish_reason: null }], ...extra });
}

function feedAll(parts: string[]): { events: StreamEvent[]; parser: SseParser } {
  const parser = new SseParser();
  const events = parts.flatMap((part) => parser.push(part));
  return { events: [...events, ...parser.end()], parser };
}

describe('SSE parser', () => {
  it('comment lines are ignored', () => {
    const { events } = feedAll([': OPENROUTER PROCESSING\n\n', delta('Hel'), ':keep-alive\n', delta('lo'), 'data: [DONE]\n\n']);
    expect(events).toEqual([{ type: 'delta', text: 'Hel' }, { type: 'delta', text: 'lo' }, { type: 'done' }]);
  });

  it('puts a chunk back together when it arrives split anywhere', () => {
    const whole = delta('Hello world');
    for (let cut = 1; cut < whole.length; cut += 1) {
      const { events } = feedAll([whole.slice(0, cut), whole.slice(cut)]);
      expect(events).toEqual([{ type: 'delta', text: 'Hello world' }]);
    }
  });

  it('reads CRLF and bare CR line ends and data without the space', () => {
    const body = JSON.stringify({ choices: [{ delta: { content: 'x' } }] });
    expect(feedAll([`data:${body}\r\n\r\n`]).events).toEqual([{ type: 'delta', text: 'x' }]);
    expect(feedAll([`data: ${body}\r\r`]).events).toEqual([{ type: 'delta', text: 'x' }]);
    expect(feedAll([`data: ${body}\r`, '\ndata: [DONE]\n']).events).toEqual([{ type: 'delta', text: 'x' }, { type: 'done' }]);
  });

  it('flushes a last line that has no line end', () => {
    expect(feedAll(['data: [DONE]']).events).toEqual([{ type: 'done' }]);
    expect(feedAll(['']).events).toEqual([]);
  });

  it('ignores empty deltas and other SSE fields, and reports anything else as unreadable', () => {
    const { events } = feedAll(['event: message\nid: 7\nretry: 100\n', delta(''), data({ choices: [] }), data({ choices: [{ delta: 'x' }] })]);
    expect(events).toEqual([]);
    expect(feedAll(['not an event\n']).events).toEqual([{ type: 'unreadable' }]);
    expect(feedAll(['data: {broken\n']).events).toEqual([{ type: 'unreadable' }]);
    expect(feedAll(['data: [1]\n']).events).toEqual([{ type: 'unreadable' }]);
    expect(feedAll(['data\n']).events).toEqual([{ type: 'unreadable' }]);
  });

  it('reads the finish reason and the usage of the last chunk', () => {
    const { events } = feedAll([
      data({ choices: [{ delta: { content: 'a' }, finish_reason: 'stop' }] }),
      data({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15, cost: 0.0004 } }),
      data({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 2 } }),
      data({ choices: [], usage: { prompt_tokens: -1, completion_tokens: 2 } }),
      data({ choices: [], usage: 'x' }),
    ]);
    expect(events).toEqual([
      { type: 'delta', text: 'a' },
      { type: 'finish', reason: 'stop' },
      { type: 'finish', reason: 'stop' },
      { type: 'usage', usage: { promptTokens: 12, completionTokens: 3, cost: 0.0004 } },
      { type: 'usage', usage: { promptTokens: 1, completionTokens: 2, cost: null } },
    ]);
  });

  it('turns a mid-stream error chunk into one error event, with the code as number or string', () => {
    const numeric = data({ error: { code: 502, message: 'Provider disconnected' }, choices: [{ delta: { content: '' }, finish_reason: 'error' }] });
    const text = data({ error: { code: 'server_error', message: '  Upstream failed  ' }, choices: [{ finish_reason: 'error' }] });
    const bare = data({ choices: [{ finish_reason: 'error' }] });
    const plain = data({ error: 'overloaded' });
    expect(feedAll([numeric]).events).toEqual([{ type: 'error', detail: 'Provider disconnected' }]);
    expect(feedAll([text]).events).toEqual([{ type: 'error', detail: 'Upstream failed' }]);
    expect(feedAll([bare]).events).toEqual([{ type: 'error', detail: '' }]);
    expect(feedAll([plain]).events).toEqual([{ type: 'error', detail: 'overloaded' }]);
  });

  it('shortens an error detail and tolerates any shape', () => {
    expect(errorDetail({ message: 'x'.repeat(1000) })).toHaveLength(300);
    expect(errorDetail({ message: 5 })).toBe('');
    expect(errorDetail(undefined)).toBe('');
    expect(errorDetail([1])).toBe('');
    expect(failureText('Lead', '')).toBe('Lead');
    expect(failureText('Lead', 'why')).toContain('why');
  });
});

describe('reply stream', () => {
  function run(parts: string[]): ReplyStream {
    const stream = new ReplyStream();
    for (const part of parts) stream.feed(part);
    stream.end();
    return stream;
  }

  it('accumulates deltas, returns the new text of each feed and ends at [DONE]', () => {
    const stream = new ReplyStream();
    expect(stream.feed(delta('Hel') + delta('lo'))).toEqual(['Hel', 'lo']);
    expect(stream.finished).toBe(false);
    expect(stream.feed(data({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 2 } }) + 'data: [DONE]\n\n')).toEqual([]);
    expect(stream.finished).toBe(true);
    expect(stream.feed(delta('late'))).toEqual([]);
    const result = stream.result();
    expect(result).toMatchObject({ text: 'Hello', finish: 'stop', done: true, failure: null, usage: { promptTokens: 4, completionTokens: 2, cost: null } });
    expect(replyOutcome(result)).toEqual({ status: 'done', error: null });
  });

  it('ignores everything after an error and keeps the text before it', () => {
    const stream = run([delta('Part '), data({ error: { message: 'boom' }, choices: [{ finish_reason: 'error' }] }), delta('after')]);
    const result = stream.result();
    expect(result).toMatchObject({ text: 'Part ', failure: 'error', error: 'boom' });
    const outcome = replyOutcome(result);
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toContain('boom');
  });

  it('fails an unreadable stream and one that ends without finishing', () => {
    expect(replyOutcome(run([delta('x'), 'garbage\n']).result())).toEqual({ status: 'failed', error: UNREADABLE_TEXT });
    expect(replyOutcome(run([delta('x')]).result())).toEqual({ status: 'failed', error: INTERRUPTED_TEXT });
    expect(replyOutcome(run([delta('x'), data({ choices: [{ finish_reason: 'stop' }] })]).result())).toEqual({ status: 'done', error: null });
  });

  it('treats an empty reply as failed, and a length stop with no text as a limit problem', () => {
    expect(replyOutcome(run([data({ choices: [{ finish_reason: 'length', delta: { content: '' } }] }), 'data: [DONE]\n']).result())).toEqual({ status: 'failed', error: LENGTH_TEXT });
    expect(replyOutcome(run([delta('  \n'), data({ choices: [{ finish_reason: 'stop' }] }), 'data: [DONE]\n']).result())).toEqual({ status: 'failed', error: EMPTY_TEXT });
    expect(replyOutcome(run([delta('some'), data({ choices: [{ finish_reason: 'length' }] })]).result())).toEqual({ status: 'done', error: null });
  });

  it('cuts a reply at the size limit without splitting a surrogate pair and stops reading', () => {
    const stream = new ReplyStream();
    const fill = 'a'.repeat(MAX_REPLY_CHARS - 1);
    expect(stream.feed(delta(fill))).toEqual([fill]);
    expect(stream.finished).toBe(false);
    expect(stream.feed(delta('\u{1F600}tail'))).toEqual([]);
    expect(stream.finished).toBe(true);
    const cut = stream.result();
    expect(cut.capped).toBe(true);
    expect(cut.text).toHaveLength(MAX_REPLY_CHARS - 1);
    expect(replyOutcome(cut).status).toBe('stopped');
    const plain = new ReplyStream();
    plain.feed(delta('b'.repeat(MAX_REPLY_CHARS - 2)));
    expect(plain.feed(delta('xyz'))).toEqual(['xy']);
    expect(plain.result().text).toHaveLength(MAX_REPLY_CHARS);
    const exact = new ReplyStream();
    expect(exact.feed(delta('c'.repeat(MAX_REPLY_CHARS)))).toHaveLength(1);
    expect(exact.finished).toBe(false);
    expect(exact.feed(delta('d'))).toEqual([]);
    expect(exact.finished).toBe(true);
  });
});

function entry(role: 'user' | 'assistant', text: string, extra: Partial<ChatEntry> = {}): ChatEntry {
  return { role, text, status: 'done', time: 1_700_000_000_000, ...extra };
}

function conversation(entries: ChatEntry[]): Conversation {
  return { version: 1, agentId: AGENT, entries };
}

describe('conversation rules', () => {
  it('round-trips through the file text', () => {
    const saved = conversation([
      entry('user', 'hi'),
      entry('assistant', 'hello', { usage: { promptTokens: 3, completionTokens: 2, cost: null } }),
      entry('user', 'more'),
      entry('assistant', 'part', { status: 'stopped' }),
      entry('user', 'again'),
      entry('assistant', '', { status: 'failed', error: 'It failed' }),
    ]);
    expect(parseConversation(serializeConversation(saved), AGENT)).toEqual(saved);
    expect(parseConversation(serializeConversation(emptyConversation(AGENT)), AGENT)).toEqual(emptyConversation(AGENT));
  });

  it('sends the user turns and the kept replies, never a failed or empty one', () => {
    const entries = [
      entry('user', 'one'),
      entry('assistant', 'reply one'),
      entry('user', 'two'),
      entry('assistant', 'cut', { status: 'stopped' }),
      entry('user', 'three'),
      entry('assistant', 'broken', { status: 'failed', error: 'x' }),
      entry('user', 'four'),
      entry('assistant', '', { status: 'stopped' }),
    ];
    expect(contextMessages(entries)).toEqual([
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'reply one' },
      { role: 'user', content: 'two' },
      { role: 'assistant', content: 'cut' },
      { role: 'user', content: 'three' },
      { role: 'user', content: 'four' },
    ]);
  });

  it('builds entries from a user text and from a stream outcome', () => {
    expect(userEntry('hi', 5)).toEqual({ role: 'user', text: 'hi', status: 'done', time: 5 });
    expect(assistantEntry({ status: 'done', text: 'a', usage: null, error: null }, 6)).toEqual({ role: 'assistant', text: 'a', status: 'done', time: 6 });
    expect(assistantEntry({ status: 'failed', text: 'p', usage: { promptTokens: 1, completionTokens: 2, cost: 0.5 }, error: 'bad' }, 7)).toEqual({
      role: 'assistant',
      text: 'p',
      status: 'failed',
      time: 7,
      error: 'bad',
      usage: { promptTokens: 1, completionTokens: 2, cost: 0.5 },
    });
  });

  it('refuses a blank or oversized message and a conversation at its limits', () => {
    expect(sendProblem([], 'hi')).toBeNull();
    expect(sendProblem([], '')).not.toBeNull();
    expect(sendProblem([], ' \n\t ')).not.toBeNull();
    expect(sendProblem([], 'x'.repeat(MAX_MESSAGE_CHARS))).toBeNull();
    expect(sendProblem([], 'x'.repeat(MAX_MESSAGE_CHARS + 1))).not.toBeNull();
    const many = Array.from({ length: MAX_ENTRIES - 1 }, () => entry('user', 'a'));
    expect(sendProblem(many.slice(0, MAX_ENTRIES - 2), 'b')).toBeNull();
    expect(sendProblem(many, 'b')).not.toBeNull();
    const heavy = Array.from({ length: 30 }, () => entry('assistant', 'x'.repeat(MAX_REPLY_CHARS)));
    expect(sendProblem(heavy, 'b')).not.toBeNull();
    expect(sendProblem(heavy.slice(0, 5), 'b')).toBeNull();
  });

  it('titles an agent from its model name until renamed', () => {
    expect(openrouterTitle({ model: '', effort: '', web: false })).toBe('OpenRouter');
    expect(openrouterTitle({ model: 'acme/m', effort: '', web: false })).toBe('OpenRouter · acme/m');
    expect(openrouterTitle({ model: 'acme/m', modelName: 'Acme M', effort: 'low', web: true })).toBe('OpenRouter · Acme M');
  });
});

describe('conversation file parse', () => {
  const good = (): Record<string, unknown> => ({ version: 1, agentId: AGENT, entries: [{ role: 'user', text: 'hi', status: 'done', time: 1 }] });
  const text = (value: unknown): string => JSON.stringify(value);

  it('accepts the exact shape and drops unknown fields', () => {
    const parsed = parseConversation(text({ ...good(), extra: 1, entries: [{ role: 'user', text: 'hi', status: 'done', time: 1, extra: 2 }] }), AGENT);
    expect(parsed).toEqual(conversation([entry('user', 'hi', { time: 1 })]));
  });

  it('refuses every malformed shape', () => {
    const bad: unknown[] = [
      null,
      [],
      'text',
      { ...good(), version: 2 },
      { ...good(), agentId: OTHER },
      { ...good(), entries: 'x' },
      { ...good(), entries: [null] },
      { ...good(), entries: [{ role: 'system', text: 'x', status: 'done', time: 1 }] },
      { ...good(), entries: [{ role: 'user', text: 5, status: 'done', time: 1 }] },
      { ...good(), entries: [{ role: 'user', text: 'x', status: 'stopped', time: 1 }] },
      { ...good(), entries: [{ role: 'assistant', text: 'x', status: 'paused', time: 1 }] },
      { ...good(), entries: [{ role: 'user', text: 'x', status: 'done', time: 'now' }] },
      { ...good(), entries: [{ role: 'user', text: 'x', status: 'done', time: Number.POSITIVE_INFINITY }] },
      { ...good(), entries: [{ role: 'user', text: 'x'.repeat(MAX_MESSAGE_CHARS + 1), status: 'done', time: 1 }] },
      { ...good(), entries: [{ role: 'assistant', text: 'x'.repeat(MAX_REPLY_CHARS + 1), status: 'done', time: 1 }] },
      { ...good(), entries: [{ role: 'assistant', text: 'x', status: 'failed', time: 1, error: 5 }] },
      { ...good(), entries: [{ role: 'assistant', text: 'x', status: 'failed', time: 1, error: 'e'.repeat(2001) }] },
      { ...good(), entries: [{ role: 'assistant', text: 'x', status: 'done', time: 1, usage: { promptTokens: 'a', completionTokens: 1, cost: null } }] },
      { ...good(), entries: [{ role: 'assistant', text: 'x', status: 'done', time: 1, usage: { promptTokens: 1, completionTokens: 1, cost: 'free' } }] },
      { ...good(), entries: [{ role: 'assistant', text: 'x', status: 'done', time: 1, usage: { promptTokens: 1.5, completionTokens: 1, cost: null } }] },
      { ...good(), entries: [{ role: 'assistant', text: 'x', status: 'done', time: 1, usage: 'many' }] },
      { ...good(), entries: Array.from({ length: MAX_ENTRIES + 1 }, () => ({ role: 'user', text: 'a', status: 'done', time: 1 })) },
    ];
    for (const value of bad) expect(parseConversation(text(value), AGENT)).toBeNull();
    expect(parseConversation('{broken', AGENT)).toBeNull();
    expect(parseConversation('', AGENT)).toBeNull();
    expect(parseConversation(' '.repeat(MAX_CONVERSATION_BYTES + 1), AGENT)).toBeNull();
  });

  it('keeps a usage with a numeric cost', () => {
    const value = { ...good(), entries: [{ role: 'assistant', text: 'x', status: 'done', time: 1, usage: { promptTokens: 1, completionTokens: 2, cost: 0.25 } }] };
    expect(parseConversation(text(value), AGENT)?.entries[0]?.usage).toEqual({ promptTokens: 1, completionTokens: 2, cost: 0.25 });
  });
});

describe('agent settings', () => {
  it('parses the model, effort and web settings and refuses a bad one', () => {
    expect(emptyOpenRouterSettings()).toEqual({ model: '', effort: '', web: false });
    expect(parseOpenRouterSettings({ model: 'acme/m:free', effort: 'low', web: true })).toEqual({ model: 'acme/m:free', effort: 'low', web: true });
    expect(parseOpenRouterSettings({ model: 'acme/m', modelName: 'Acme M', effort: '', web: false, extra: 1 })).toEqual({ model: 'acme/m', modelName: 'Acme M', effort: '', web: false });
    expect(parseOpenRouterSettings({ model: '', effort: '', web: false })).toEqual({ model: '', effort: '', web: false });
    const bad: unknown[] = [
      null,
      'x',
      { model: 5, effort: '', web: false },
      { model: 'Bad Model', effort: '', web: false },
      { model: 'a/b', effort: 'LOW', web: false },
      { model: 'a/b', effort: 7, web: false },
      { model: 'a/b', effort: '', web: 'yes' },
      { model: 'a/b', modelName: '', effort: '', web: false },
      { model: 'a/b', modelName: 'x'.repeat(201), effort: '', web: false },
      { model: 'a/b', modelName: 'bad\nname', effort: '', web: false },
      { model: 'a/b', modelName: 3, effort: '', web: false },
    ];
    for (const value of bad) expect(parseOpenRouterSettings(value)).toBeNull();
  });
});

describe('conversation store and chat service', () => {
  let dir: string;
  let store: ConversationStore;
  let settings: OpenRouterSettings | undefined;
  let streamed: number;
  let signedIn: boolean;
  const copied: string[] = [];

  function chats(): OpenRouterChats {
    return new OpenRouterChats({
      service: {
        status: () => ({ state: signedIn ? 'connected' : 'signed-out', mode: null, notice: null, info: null }),
        chatStream: () => {
          streamed += 1;
          return Promise.resolve({ status: 'done', text: 'ok', usage: null, error: null, unauthorized: false });
        },
      },
      store,
      settingsOf: (id) => (id === AGENT ? settings : undefined),
      emit: () => undefined,
      copy: (text) => copied.push(text),
      now: () => 42,
    });
  }

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'aiaw-or-chat-'));
    store = new ConversationStore(path.join(dir, 'openrouter'));
    settings = { model: 'acme/m', effort: '', web: false };
    streamed = 0;
    signedIn = true;
    copied.length = 0;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5 });
  });

  async function plant(content: string): Promise<string> {
    const file = store.file(AGENT);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content, 'utf8');
    return file;
  }

  it('an unreadable or malformed conversation file is refused', async () => {
    for (const content of ['{broken', '[]', JSON.stringify({ version: 1, agentId: OTHER, entries: [] }), JSON.stringify({ version: 1, agentId: AGENT, entries: [{ role: 'x' }] }), '']) {
      const file = await plant(content);
      expect(await store.load(AGENT)).toEqual({ ok: false });
      const service = chats();
      expect(await service.load(AGENT)).toEqual({ ok: false, error: UNREADABLE_CONVERSATION_TEXT });
      expect(await service.send(AGENT, 'hello')).toEqual({ ok: false, error: UNREADABLE_CONVERSATION_TEXT });
      expect(await service.copy(AGENT, 0)).toBe(false);
      expect(await readFile(file, 'utf8')).toBe(content);
    }
    expect(streamed).toBe(0);
  });

  it('refuses a directory in place of the file and a file that is too large', async () => {
    await mkdir(store.file(AGENT), { recursive: true });
    expect(await store.load(AGENT)).toEqual({ ok: false });
    await rm(store.file(AGENT), { recursive: true });
    await plant(' '.repeat(MAX_CONVERSATION_BYTES + 1));
    expect(await store.load(AGENT)).toEqual({ ok: false });
  });

  it('never turns an id that is not a UUID into a path', async () => {
    for (const id of ['', '../escape', 'a/b', '..', 'not-a-uuid', `${AGENT}/x`]) {
      expect(() => store.file(id)).toThrow();
      expect(await store.load(id)).toEqual({ ok: false });
      await expect(store.save(emptyConversation(id))).rejects.toThrow();
    }
    expect(store.file(AGENT)).toBe(path.join(dir, 'openrouter', `${AGENT}.json`));
  });

  it('reads a missing file as an empty conversation and saves atomically', async () => {
    expect(await store.load(AGENT)).toEqual({ ok: true, conversation: emptyConversation(AGENT) });
    const saved = conversation([entry('user', 'hi')]);
    await store.save(saved);
    expect(await store.load(AGENT)).toEqual({ ok: true, conversation: saved });
    expect(parseConversation(await readFile(store.file(AGENT), 'utf8'), AGENT)).toEqual(saved);
  });

  it('refuses before touching the stream: no model, signed out, unknown agent, blank text', async () => {
    const service = chats();
    expect((await service.send(OTHER, 'hi')).ok).toBe(false);
    settings = { model: '', effort: '', web: false };
    expect((await service.send(AGENT, 'hi')).ok).toBe(false);
    settings = { model: 'acme/m', effort: '', web: false };
    signedIn = false;
    expect(await service.send(AGENT, 'hi')).toEqual({ ok: false, error: CHAT_SIGNED_OUT_TEXT });
    signedIn = true;
    expect((await service.send(AGENT, '   ')).ok).toBe(false);
    expect(streamed).toBe(0);
    expect(await store.load(AGENT)).toEqual({ ok: true, conversation: emptyConversation(AGENT) });
  });
});
