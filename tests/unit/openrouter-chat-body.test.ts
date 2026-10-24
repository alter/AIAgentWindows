// openrouter-chat-body.test.ts
import { describe, expect, it } from 'vitest';
import { ChatError, chatBody, requestBody, runChat, type ChatInput } from '../../src/main/openrouter/chat';

const INPUT: ChatInput = { model: 'acme/paid-model', system: 'sys', user: 'usr', effort: 'high', web: true };

function reply(status: number, body: unknown): typeof fetch {
  return () => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

describe('chatBody', () => {
  it('carries exactly the fields of today for a request without project fields', () => {
    expect(Object.keys(chatBody(INPUT)).sort()).toEqual(['messages', 'model', 'reasoning', 'stream', 'tools']);
    expect(Object.keys(chatBody({ ...INPUT, effort: null, web: false })).sort()).toEqual(['messages', 'model', 'stream']);
  });

  it('adds provider.data_collection deny and max_completion_tokens only when asked', () => {
    const body = chatBody({ ...INPUT, denyDataCollection: true, maxCompletionTokens: 1000 });
    expect(body['provider']).toEqual({ data_collection: 'deny' });
    expect(body['max_completion_tokens']).toBe(1000);
    const onlyDeny = chatBody({ ...INPUT, denyDataCollection: true });
    expect(onlyDeny['provider']).toEqual({ data_collection: 'deny' });
    expect(onlyDeny).not.toHaveProperty('max_completion_tokens');
    const onlyCap = chatBody({ ...INPUT, maxCompletionTokens: 7 });
    expect(onlyCap['max_completion_tokens']).toBe(7);
    expect(onlyCap).not.toHaveProperty('provider');
    expect(chatBody({ ...INPUT, denyDataCollection: false })).not.toHaveProperty('provider');
  });

  it('leaves the body of the streaming chat agent alone', () => {
    const body = requestBody({ model: 'm', messages: [{ role: 'user', content: 'x' }], effort: null, web: false }, true);
    expect(Object.keys(body).sort()).toEqual(['messages', 'model', 'stream']);
  });
});

describe('a refusal for lack of endpoints', () => {
  const options = { timeoutMs: 2000, signal: new AbortController().signal };
  const refusal = { error: { code: 404, message: 'No endpoints found matching your data policy (Free model training)' } };

  async function failure(input: ChatInput, fetchImpl: typeof fetch): Promise<ChatError> {
    try {
      await runChat({ base: 'http://fake', fetch: fetchImpl }, 'key', input, options);
    } catch (error) {
      return error as ChatError;
    }
    throw new Error('the chat did not fail');
  }

  it('names data_collection when the request denied collection', async () => {
    const error = await failure({ ...INPUT, denyDataCollection: true }, reply(404, refusal));
    expect(error).toBeInstanceOf(ChatError);
    expect(error.code).toBe('failed');
    expect(error.message).toContain('data_collection');
    expect(error.message).toContain('acme/paid-model');
  });

  it('stays the plain HTTP error when collection was not denied, and for other 404 bodies', async () => {
    const plain = await failure(INPUT, reply(404, refusal));
    expect(plain.message).not.toContain('data_collection');
    const other = await failure({ ...INPUT, denyDataCollection: true }, reply(404, { error: { code: 404, message: 'Model not found' } }));
    expect(other.message).not.toContain('data_collection');
    const unreadable = await failure({ ...INPUT, denyDataCollection: true }, () => Promise.resolve(new Response('<html>', { status: 404 })));
    expect(unreadable.message).not.toContain('data_collection');
  });
});
