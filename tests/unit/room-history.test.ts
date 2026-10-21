// room-history.test.ts
import { describe, expect, it } from 'vitest';
import {
  WEB_INLINE_LIMIT,
  buildParticipantPrompt,
  renderHistory,
} from '../../src/shared/room-history';
import type { RoomEntry, RoomParticipant } from '../../src/shared/room-model';

const A: RoomParticipant = { id: 'a', kind: 'claude', label: 'Claude Code' };
const B: RoomParticipant = { id: 'b', kind: 'chatgpt', label: 'ChatGPT' };

function entry(overrides: Partial<RoomEntry>): RoomEntry {
  return { authorId: 'owner', label: 'You', time: Date.UTC(2026, 9, 21, 12, 0, 0), kind: 'prompt', text: 'ask', ...overrides };
}

const TRICKY = '## not a heading\n<script>alert(1)</script>\n```\n\t  trailing  \n';

describe('renderHistory', () => {
  it('writes replies verbatim', () => {
    const text = renderHistory('r1', [entry({}), entry({ kind: 'reply', authorId: 'a', label: 'Claude Code', text: TRICKY })]);
    expect(text).toContain(TRICKY);
  });

  it('keeps entries in the order given and labels each author', () => {
    const text = renderHistory('r1', [
      entry({ text: 'first' }),
      entry({ kind: 'reply', authorId: 'a', label: 'Claude Code', text: 'second' }),
      entry({ kind: 'reply', authorId: 'b', label: 'ChatGPT', text: 'third' }),
    ]);
    const positions = ['first', 'second', 'third'].map((word) => text.indexOf(word));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((x, y) => x - y)).toEqual(positions);
    expect(text).toContain('Claude Code');
    expect(text).toContain('ChatGPT');
  });

  it('marks failed turns without inventing a reply', () => {
    const text = renderHistory('r1', [entry({ kind: 'error', authorId: 'a', label: 'Claude Code', text: 'timed out' })]);
    expect(text).toContain('timed out');
  });

  it('renders an empty history', () => {
    expect(renderHistory('r1', [])).toContain('r1');
  });
});

describe('buildParticipantPrompt', () => {
  const history = [entry({ text: 'the question' }), entry({ kind: 'reply', authorId: 'a', label: 'Claude Code', text: 'an answer' })];

  it('points a CLI participant at the history file and does not inline the history', () => {
    const prompt = buildParticipantPrompt(A, 'r1', history, '/shared/rooms/r1.md');
    expect(prompt.attachHistory).toBe(false);
    expect(prompt.text).toContain('/shared/rooms/r1.md');
    expect(prompt.text).not.toContain('an answer');
  });

  it('inlines the whole history for a web participant up to the limit', () => {
    const prompt = buildParticipantPrompt(B, 'r1', history, '/shared/rooms/r1.md');
    expect(prompt.attachHistory).toBe(false);
    expect(prompt.text).toContain('the question');
    expect(prompt.text).toContain('an answer');
    expect(prompt.text.indexOf('the question')).toBeLessThan(prompt.text.indexOf('an answer'));
  });

  it('attaches the history file for a web participant above the limit', () => {
    const big = [entry({ text: 'x'.repeat(WEB_INLINE_LIMIT + 1) })];
    const prompt = buildParticipantPrompt(B, 'r1', big, '/shared/rooms/r1.md');
    expect(prompt.attachHistory).toBe(true);
    expect(prompt.text).not.toContain('x'.repeat(100));
  });

  it('keeps the inline decision on the rendered history length', () => {
    const rendered = renderHistory('r1', history);
    expect(rendered.length).toBeLessThanOrEqual(WEB_INLINE_LIMIT);
    const edge = [entry({ text: 'y'.repeat(WEB_INLINE_LIMIT - renderHistory('r1', [entry({ text: '' })]).length) })];
    expect(renderHistory('r1', edge).length).toBe(WEB_INLINE_LIMIT);
    expect(buildParticipantPrompt(B, 'r1', edge, '/p').attachHistory).toBe(false);
    const over = [entry({ text: 'y'.repeat(WEB_INLINE_LIMIT - renderHistory('r1', [entry({ text: '' })]).length + 1) })];
    expect(buildParticipantPrompt(B, 'r1', over, '/p').attachHistory).toBe(true);
  });

  it('names the participant so a reply is addressed to the right author', () => {
    expect(buildParticipantPrompt(A, 'r1', history, '/p').text).toContain('Claude Code');
    expect(buildParticipantPrompt(B, 'r1', history, '/p').text).toContain('ChatGPT');
  });
});
