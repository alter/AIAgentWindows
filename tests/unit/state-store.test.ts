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
  removeAgent,
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
  return { version: 2, agents };
}

function withAgent(patch: Record<string, unknown>): string {
  const agent = { id: 'a1', kind: 'claude', title: 'T', cwd: '/w', createdAt: 1, ...patch };
  return JSON.stringify({ version: 2, agents: [agent] });
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
    expect(parseState(JSON.stringify({ version: 2, agents: 'x' }))).toEqual(emptyState());
    expect(parseState(JSON.stringify({ version: 2, agents: [42] }))).toEqual(emptyState());
    expect(parseState('x'.repeat(1024 * 1024 + 1))).toEqual(emptyState());
  });

  it('falls back to empty state on wrong version', () => {
    expect(parseState(JSON.stringify({ version: 1, agents: [] }))).toEqual(emptyState());
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
    expect(parseState(JSON.stringify({ version: 2, agents: [a, a] }))).toEqual(emptyState());
  });

  it('drops unknown fields on read', () => {
    const parsed = parseState(withAgent({ extra: 'x' }));
    expect(parsed.agents).toHaveLength(1);
    expect(parsed.agents[0]).not.toHaveProperty('extra');
  });

  it('keeps the model, effort and web settings of an OpenRouter agent and loads an old one without them', () => {
    const settings = { model: 'acme/m:free', modelName: 'Acme M', effort: 'low', web: true };
    const state: AppState = { version: 2, agents: [{ id: 'o1', kind: 'openrouter', title: 'OpenRouter · Acme M', openrouter: settings, createdAt: 1 }] };
    expect(parseState(serializeState(state))).toEqual(state);
    const old = parseState(JSON.stringify({ version: 2, agents: [{ id: 'o2', kind: 'openrouter', title: 'OpenRouter', createdAt: 2 }] }));
    expect(old.agents[0]?.openrouter).toEqual({ model: '', effort: '', web: false });
  });

  it('refuses settings that are malformed or sit on another kind of agent', () => {
    const agent = (patch: Record<string, unknown>): string => JSON.stringify({ version: 2, agents: [{ id: 'o1', kind: 'openrouter', title: 'T', createdAt: 1, ...patch }] });
    expect(parseState(agent({ openrouter: { model: 'Bad Model', effort: '', web: false } }))).toEqual(emptyState());
    expect(parseState(agent({ openrouter: 'x' }))).toEqual(emptyState());
    expect(parseState(agent({ cwd: '/w' }))).toEqual(emptyState());
    expect(parseState(withAgent({ openrouter: { model: '', effort: '', web: false } }))).toEqual(emptyState());
  });

  it('describes kinds', () => {
    expect([...AGENT_KINDS].sort()).toEqual(['chatgpt', 'claude', 'codex', 'deepseek', 'grok', 'openrouter']);
    expect(isCliKind('openrouter')).toBe(false);
    expect(isSiteKind('openrouter')).toBe(false);
    expect(isCliKind('claude')).toBe(true);
    expect(isCliKind('grok')).toBe(false);
    expect(isSiteKind('grok')).toBe(true);
    expect(isSiteKind('codex')).toBe(false);
    for (const kind of AGENT_KINDS.filter(isSiteKind)) {
      expect(new URL(SITE_URLS[kind]).protocol).toBe('https:');
    }
  });

  it('removes an agent and selects the next one in the list, else the previous, else none', () => {
    const agents = sample().agents;
    expect(removeAgent(agents, 'a1', 'a2')).toEqual({ agents: [agents[0], agents[2]], selectedId: 'a1' });
    expect(removeAgent(agents, 'a2', 'a2')).toEqual({ agents: [agents[0], agents[2]], selectedId: 'a3' });
    expect(removeAgent(agents, 'a3', 'a3')).toEqual({ agents: [agents[0], agents[1]], selectedId: 'a2' });
    expect(removeAgent([agents[0] as Agent], 'a1', 'a1')).toEqual({ agents: [], selectedId: null });
    expect(removeAgent(agents, 'a1', 'missing')).toEqual({ agents, selectedId: 'a1' });
  });

  it('keeps an optional project id on an agent of any kind and refuses one that is not an id', () => {
    for (const kind of AGENT_KINDS) {
      const base = isCliKind(kind) ? { cwd: '/w' } : {};
      const text = JSON.stringify({ version: 2, agents: [{ id: 'a1', kind, title: 'T', createdAt: 1, projectId: 'proj-1', ...base }] });
      expect(parseState(text).agents[0]?.projectId).toBe('proj-1');
    }
    expect(parseState(withAgent({})).agents[0]?.projectId).toBeUndefined();
    for (const bad of ['', '../x', 'a/b', 'a b', 5, null, 'x'.repeat(65)]) {
      expect(parseState(withAgent({ projectId: bad }))).toEqual(emptyState());
    }
  });
});
