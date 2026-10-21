// state-store.test.ts
import { describe, expect, it } from 'vitest';
import {
  AGENT_KINDS,
  SITE_URLS,
  emptyState,
  isCliKind,
  isSiteKind,
  isUuid,
  parseState,
  serializeState,
  type Agent,
  type AppState,
} from '../../src/shared/agents';

const SESSION = '3f2b8c1e-9a4d-4e57-b6a0-1c2d3e4f5a6b';
const HOSTILE = '/tmp/a b"; touch /tmp/pwned; "';

function sample(): AppState {
  const agents: Agent[] = [
    { id: 'a1', kind: 'claude', title: 'Claude Code', cwd: HOSTILE, sessionId: SESSION, createdAt: 1 },
    { id: 'a2', kind: 'codex', title: 'Codex', cwd: '/work/x', createdAt: 2 },
    { id: 'a3', kind: 'deepseek', title: 'DeepSeek', createdAt: 3 },
  ];
  return { version: 1, agents };
}

function withAgent(patch: Record<string, unknown>): string {
  const agent = { id: 'a1', kind: 'claude', title: 'T', cwd: '/w', createdAt: 1, ...patch };
  return JSON.stringify({ version: 1, agents: [agent] });
}

describe('state store', () => {
  it('round-trips hostile path', () => {
    const state = sample();
    expect(parseState(serializeState(state))).toEqual(state);
  });

  it('falls back to empty state on invalid file', () => {
    expect(parseState('{not json')).toEqual(emptyState());
    expect(parseState('')).toEqual(emptyState());
    expect(parseState('null')).toEqual(emptyState());
    expect(parseState('[]')).toEqual(emptyState());
    expect(parseState(JSON.stringify({ version: 1, agents: 'x' }))).toEqual(emptyState());
    expect(parseState(JSON.stringify({ version: 1, agents: [42] }))).toEqual(emptyState());
    expect(parseState('x'.repeat(1024 * 1024 + 1))).toEqual(emptyState());
  });

  it('falls back to empty state on wrong version', () => {
    expect(parseState(JSON.stringify({ version: 2, agents: [] }))).toEqual(emptyState());
    expect(parseState(JSON.stringify({ agents: [] }))).toEqual(emptyState());
  });

  it('rejects malformed session id', () => {
    for (const bad of ['', 'abc', `${SESSION}x`, '../../etc/passwd', `${SESSION.slice(0, -1)}g`, 7]) {
      expect(parseState(withAgent({ sessionId: bad }))).toEqual(emptyState());
    }
    expect(isUuid(SESSION)).toBe(true);
    expect(isUuid(SESSION.toUpperCase())).toBe(true);
    expect(isUuid('nope')).toBe(false);
  });

  it('rejects malformed agents', () => {
    const bad: Record<string, unknown>[] = [
      { id: '' },
      { id: 5 },
      { kind: 'gemini' },
      { title: 5 },
      { createdAt: 'now' },
      { createdAt: Number.NaN },
      { cwd: '' },
      { cwd: 'x'.repeat(4097) },
      { cwd: 5 },
      { kind: 'chatgpt', cwd: '/w' },
      { kind: 'chatgpt', cwd: undefined, sessionId: SESSION },
    ];
    for (const patch of bad) {
      expect(parseState(withAgent(patch))).toEqual(emptyState());
    }
  });

  it('rejects duplicate ids', () => {
    const a = { id: 'a1', kind: 'codex', title: 'T', cwd: '/w', createdAt: 1 };
    expect(parseState(JSON.stringify({ version: 1, agents: [a, a] }))).toEqual(emptyState());
  });

  it('drops unknown fields on read', () => {
    const parsed = parseState(withAgent({ extra: 'x' }));
    expect(parsed.agents).toHaveLength(1);
    expect(parsed.agents[0]).not.toHaveProperty('extra');
  });

  it('describes kinds', () => {
    expect([...AGENT_KINDS].sort()).toEqual(['chatgpt', 'claude', 'codex', 'deepseek', 'grok']);
    expect(isCliKind('claude')).toBe(true);
    expect(isCliKind('grok')).toBe(false);
    expect(isSiteKind('grok')).toBe(true);
    expect(isSiteKind('codex')).toBe(false);
    for (const kind of AGENT_KINDS.filter(isSiteKind)) {
      expect(new URL(SITE_URLS[kind]).protocol).toBe('https:');
    }
  });
});
