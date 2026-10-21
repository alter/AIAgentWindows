// turn-signal.test.ts
import { describe, expect, it } from 'vitest';
import { MAX_ERROR_CHARS } from '../../src/shared/room-model';
import { readClaudeTurn, readCodexTurn } from '../../src/shared/turn-signal';

const SENT = Date.parse('2026-10-21T10:00:00.000Z');
const BEFORE = '2026-10-21T09:59:00.000Z';
const AFTER = '2026-10-21T10:00:05.000Z';

function lines(...records: unknown[]): string {
  return records.map((record) => JSON.stringify(record)).join('\n') + '\n';
}

function assistant(timestamp: string, id: string, stop: string, ...blocks: Record<string, unknown>[]): unknown {
  return { type: 'assistant', timestamp, message: { id, role: 'assistant', stop_reason: stop, content: blocks } };
}

describe('claude turn signal', () => {
  it('is running while no end_turn record after the send time exists', () => {
    expect(readClaudeTurn('', SENT)).toEqual({ state: 'running' });
    const old = lines(assistant(BEFORE, 'm1', 'end_turn', { type: 'text', text: 'old' }));
    expect(readClaudeTurn(old, SENT)).toEqual({ state: 'running' });
    const tool = lines(assistant(AFTER, 'm2', 'tool_use', { type: 'tool_use' }));
    expect(readClaudeTurn(tool, SENT)).toEqual({ state: 'running' });
  });

  it('skips a thinking-only end_turn record and joins the text blocks of one message', () => {
    const text = lines(
      assistant(AFTER, 'm3', 'end_turn', { type: 'thinking', thinking: 'hmm' }),
      assistant(AFTER, 'm3', 'end_turn', { type: 'text', text: 'part one' }),
      assistant(AFTER, 'm3', 'end_turn', { type: 'text', text: 'part two' }),
    );
    expect(readClaudeTurn(text, SENT)).toEqual({ state: 'done', reply: 'part one\npart two', continued: false });
  });

  it('flags a tool_use record after the end_turn text as a continuation', () => {
    const text = lines(
      assistant(AFTER, 'm4', 'end_turn', { type: 'text', text: 'almost' }),
      assistant(AFTER, 'm5', 'tool_use', { type: 'tool_use' }),
    );
    expect(readClaudeTurn(text, SENT)).toMatchObject({ state: 'done', continued: true });
  });

  it('ignores a half-written last line and non-JSON lines', () => {
    const text = `not json\n${lines(assistant(AFTER, 'm6', 'end_turn', { type: 'text', text: 'ok' }))}{"type":"assist`;
    expect(readClaudeTurn(text, SENT)).toMatchObject({ state: 'done', reply: 'ok' });
  });
});

function event(timestamp: string, payload: Record<string, unknown>): unknown {
  return { timestamp, type: 'event_msg', payload };
}

function finalItem(timestamp: string, text: string): unknown {
  return event(timestamp, { type: 'item_completed', item: { type: 'AgentMessage', phase: 'final_answer', content: [{ type: 'Text', text }] } });
}

describe('codex turn signal', () => {
  it('is running until task_complete after the send time', () => {
    expect(readCodexTurn('', SENT)).toEqual({ state: 'running' });
    const old = lines(event(BEFORE, { type: 'task_complete', last_agent_message: 'old' }));
    expect(readCodexTurn(old, SENT)).toEqual({ state: 'running' });
  });

  it('reads last_agent_message, then the final_answer item, then null', () => {
    const direct = lines(event(AFTER, { type: 'task_complete', last_agent_message: 'direct' }));
    expect(readCodexTurn(direct, SENT)).toMatchObject({ state: 'done', reply: 'direct' });
    const fallback = lines(
      event(AFTER, { type: 'item_completed', item: { type: 'AgentMessage', phase: 'commentary', content: [{ type: 'Text', text: 'chatter' }] } }),
      finalItem(AFTER, 'final'),
      event(AFTER, { type: 'task_complete', last_agent_message: null }),
    );
    expect(readCodexTurn(fallback, SENT)).toMatchObject({ state: 'done', reply: 'final' });
    const none = lines(event(AFTER, { type: 'task_complete', last_agent_message: null }));
    expect(readCodexTurn(none, SENT)).toEqual({ state: 'done', reply: null, continued: false });
  });

  it('reports error and turn_aborted as failures', () => {
    const failed = lines(event(AFTER, { type: 'task_complete', last_agent_message: null, error: { message: 'quota' } }));
    expect(readCodexTurn(failed, SENT)).toEqual({ state: 'failed', reason: 'quota' });
    const huge = lines(event(AFTER, { type: 'task_complete', last_agent_message: null, error: { message: 'E'.repeat(2_000_000) } }));
    const capped = readCodexTurn(huge, SENT);
    expect(capped.state).toBe('failed');
    expect(capped.state === 'failed' ? capped.reason.length : 0).toBeLessThanOrEqual(MAX_ERROR_CHARS);
    const aborted = lines(event(AFTER, { type: 'turn_aborted' }));
    expect(readCodexTurn(aborted, SENT)).toMatchObject({ state: 'failed' });
  });
});
