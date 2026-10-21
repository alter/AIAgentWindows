// cli-print.test.ts
import { describe, expect, it } from 'vitest';
import type { CliKind } from '../../src/shared/agents';
import { MAX_ERROR_CHARS } from '../../src/shared/room-model';
import { PrintReader } from '../../src/shared/cli-print';

function lines(...records: unknown[]): string {
  return records.map((record) => JSON.stringify(record)).join('\n') + '\n';
}

function read(kind: CliKind, ...chunks: string[]): PrintReader {
  const reader = new PrintReader(kind);
  for (const chunk of chunks) reader.feed(chunk);
  return reader;
}

const INIT = { type: 'system', subtype: 'init', session_id: 'sess-1' };
const SUCCESS = { type: 'result', subtype: 'success', is_error: false, result: 'the reply', session_id: 'sess-1' };

describe('claude stream-json output', () => {
  it('is running until the result message arrives, then holds the reply text', () => {
    const reader = read('claude', lines(INIT, { type: 'assistant', message: { content: [] } }));
    expect(reader.outcome).toEqual({ state: 'running' });
    expect(reader.sessionId).toBe('sess-1');
    reader.feed(lines(SUCCESS));
    expect(reader.outcome).toEqual({ state: 'done', reply: 'the reply' });
  });

  it('treats an empty result as a turn without a reply', () => {
    expect(read('claude', lines({ ...SUCCESS, result: '' })).outcome).toEqual({ state: 'done', reply: null });
    expect(read('claude', lines({ ...SUCCESS, result: undefined })).outcome).toEqual({ state: 'done', reply: null });
  });

  it('fails on is_error with the result text as the reason', () => {
    const outcome = read('claude', lines({ ...SUCCESS, is_error: true, result: 'Not logged in' })).outcome;
    expect(outcome).toEqual({ state: 'failed', reason: 'Not logged in' });
  });

  it('fails on an error subtype with the joined errors, or the subtype when there are none', () => {
    const withErrors = read('claude', lines({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['one', 'two'] }));
    expect(withErrors.outcome).toEqual({ state: 'failed', reason: 'one; two' });
    const bare = read('claude', lines({ type: 'result', subtype: 'error_max_turns', is_error: true }));
    expect(bare.outcome).toEqual({ state: 'failed', reason: 'error_max_turns' });
  });

  it('caps the reason of a failure', () => {
    const outcome = read('claude', lines({ ...SUCCESS, is_error: true, result: 'x'.repeat(MAX_ERROR_CHARS * 3) })).outcome;
    expect(outcome.state).toBe('failed');
    expect(outcome.state === 'failed' && outcome.reason.length).toBeLessThanOrEqual(MAX_ERROR_CHARS + 40);
  });

  it('keeps the first terminal message and ignores what follows', () => {
    const reader = read('claude', lines(SUCCESS, { ...SUCCESS, result: 'later' }, { ...SUCCESS, is_error: true, result: 'boom' }));
    expect(reader.outcome).toEqual({ state: 'done', reply: 'the reply' });
  });

  it('reads a line split across chunks and a last line without a newline', () => {
    const text = JSON.stringify(SUCCESS);
    const reader = read('claude', text.slice(0, 20), text.slice(20));
    expect(reader.outcome).toEqual({ state: 'running' });
    reader.finish();
    expect(reader.outcome).toEqual({ state: 'done', reply: 'the reply' });
  });

  it('skips shell noise, blank lines, broken JSON and non-object lines', () => {
    const reader = read('claude', 'Identity added: key\n\n{"type":"result","subtype"\n[1,2]\n"text"\nnull\n', lines(SUCCESS));
    expect(reader.outcome).toEqual({ state: 'done', reply: 'the reply' });
  });

  it('ignores a line of codex shape and a message without a type', () => {
    const reader = read('claude', lines({ type: 'turn.completed' }, { hello: 'world' }, { type: 'result' }));
    expect(reader.outcome).toEqual({ state: 'failed', reason: 'the turn failed' });
  });

  it('drops a line longer than the limit without losing the lines after it', () => {
    const reader = read('claude', 'x'.repeat(9 * 1024 * 1024), '\n', lines(SUCCESS));
    expect(reader.outcome).toEqual({ state: 'done', reply: 'the reply' });
  });

  it('keeps dropping a long line that arrives in several chunks', () => {
    const reader = new PrintReader('claude');
    for (let i = 0; i < 5; i += 1) reader.feed('y'.repeat(2 * 1024 * 1024));
    reader.feed('\n' + lines(SUCCESS));
    expect(reader.outcome).toEqual({ state: 'done', reply: 'the reply' });
  });

  it('has no session id before the init message', () => {
    expect(read('claude', '').sessionId).toBeNull();
  });
});

describe('codex exec --json output', () => {
  const started = { type: 'thread.started', thread_id: 'thread-9' };
  const message = (text: string) => ({ type: 'item.completed', item: { id: 'i', type: 'agent_message', text } });
  const completed = { type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } };

  it('takes the thread id from thread.started and the reply from the last agent_message at turn.completed', () => {
    const reader = read('codex', lines(started, { type: 'turn.started' }, message('working'), message('final')));
    expect(reader.outcome).toEqual({ state: 'running' });
    expect(reader.sessionId).toBe('thread-9');
    reader.feed(lines(completed));
    expect(reader.outcome).toEqual({ state: 'done', reply: 'final' });
  });

  it('ignores items that are not agent messages and agent messages without text', () => {
    const reader = read(
      'codex',
      lines(started, message('answer'), { type: 'item.completed', item: { id: 'x', type: 'command_execution', text: 'ls' } }, { type: 'item.completed', item: { type: 'agent_message' } }, { type: 'item.completed' }, completed),
    );
    expect(reader.outcome).toEqual({ state: 'done', reply: 'answer' });
  });

  it('is a turn without a reply when no agent message came', () => {
    expect(read('codex', lines(started, completed)).outcome).toEqual({ state: 'done', reply: null });
  });

  it('fails on turn.failed with its message, or a fixed text without one', () => {
    expect(read('codex', lines(started, { type: 'turn.failed', error: { message: 'rate limited' } })).outcome).toEqual({
      state: 'failed',
      reason: 'rate limited',
    });
    expect(read('codex', lines({ type: 'turn.failed' })).outcome).toEqual({ state: 'failed', reason: 'the turn failed' });
  });

  it('does not end the turn on an error event, and remembers it for a process that dies', () => {
    const reader = read('codex', lines(started, { type: 'error', message: 'Reconnecting... 1/5' }));
    expect(reader.outcome).toEqual({ state: 'running' });
    expect(reader.lastError).toBe('Reconnecting... 1/5');
    reader.feed(lines(message('recovered'), completed));
    expect(reader.outcome).toEqual({ state: 'done', reply: 'recovered' });
  });

  it('ignores an error event without a message and a claude-shaped result', () => {
    const reader = read('codex', lines({ type: 'error' }, SUCCESS));
    expect(reader.lastError).toBeNull();
    expect(reader.outcome).toEqual({ state: 'running' });
  });

  it('has no thread id before thread.started', () => {
    expect(read('codex', lines(message('x'))).sessionId).toBeNull();
  });
});
