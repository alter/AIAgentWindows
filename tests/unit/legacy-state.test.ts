// legacy-state.test.ts
import { describe, expect, it } from 'vitest';
import { defaultPartition, parseStateDocument, partitionFor, type SitePartitions } from '../../src/shared/agents';
import { legacyPartitions, migrateLegacyState, parseLegacyState } from '../../src/shared/legacy-state';

const CHATGPT = '8182ddf2-1111-4111-8111-aaaaaaaaaaaa';
const GROK = '5dff1f45-2222-4222-8222-bbbbbbbbbbbb';
const DEEPSEEK = 'cfdc58b3-3333-4333-8333-cccccccccccc';
const SECOND_GROK = '99999999-4444-4444-8444-dddddddddddd';

function agent(id: string, kind: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, kind, title: kind, createdAt: 1, ...extra };
}

function legacy(agents: unknown[], extra: Record<string, unknown> = {}): unknown {
  return { version: 1, agents, ...extra };
}

describe('version-1 reader', () => {
  it('keeps the old partition of every signed-in site kind, the settings and no agents', () => {
    const raw = legacy(
      [agent(CHATGPT, 'chatgpt'), agent(GROK, 'grok'), agent(DEEPSEEK, 'deepseek'), agent('c1', 'claude', { cwd: '/w' })],
      { theme: 'dark', sidebarWidth: 300, openrouterKey: 'AQIDBA==' },
    );
    expect(migrateLegacyState(parseLegacyState(raw))).toEqual({
      version: 2,
      agents: [],
      theme: 'dark',
      sidebarWidth: 300,
      openrouterKey: 'AQIDBA==',
      partitions: { chatgpt: `persist:${CHATGPT}`, grok: `persist:${GROK}`, deepseek: `persist:${DEEPSEEK}` },
    });
  });

  it('takes the first valid agent of a kind in file order', () => {
    const parsed = parseLegacyState(legacy([agent(SECOND_GROK, 'grok'), agent(GROK, 'grok')]));
    expect(legacyPartitions(parsed.agents).grok).toBe(`persist:${SECOND_GROK}`);
  });

  it('gives a kind without an agent the default partition of that kind', () => {
    expect(migrateLegacyState(parseLegacyState(legacy([]))).partitions).toEqual({
      chatgpt: 'persist:chatgpt',
      grok: 'persist:grok',
      deepseek: 'persist:deepseek',
    });
  });

  it('skips an invalid agent and keeps the partitions of the valid ones', () => {
    const raw = legacy([agent(CHATGPT, 'chatgpt', { createdAt: 'x' }), agent(GROK, 'grok'), 42, agent(DEEPSEEK, 'deepseek', { cwd: '/not/for/a/site' })]);
    const parsed = parseLegacyState(raw);
    expect(parsed.agents.map((item) => item.id)).toEqual([GROK]);
    expect(migrateLegacyState(parsed).partitions).toEqual({ chatgpt: 'persist:chatgpt', grok: `persist:${GROK}`, deepseek: 'persist:deepseek' });
  });

  it('never puts an id that is not a UUID into a partition name', () => {
    const hostile = ['../../outside', 'a/b', 'x'.repeat(40), `${GROK}/..`, ''];
    for (const id of hostile) {
      expect(legacyPartitions(parseLegacyState(legacy([agent(id, 'grok')])).agents).grok).toBe('persist:grok');
    }
    const parsed = parseLegacyState(legacy([agent('not-a-uuid', 'grok'), agent(GROK, 'grok')]));
    expect(legacyPartitions(parsed.agents).grok).toBe(`persist:${GROK}`);
  });

  it('refuses a file that is not a version-1 object with a list of agents', () => {
    for (const raw of [null, [], 'x', 3, { agents: [] }, { version: 2, agents: [] }, { version: 1 }, { version: 1, agents: 'x' }]) {
      expect(() => parseLegacyState(raw)).toThrow();
    }
  });
});

describe('partitions in the version-2 document', () => {
  const base = { version: 2, agents: [] };

  it('round-trips the map and falls back to the default partition of a kind', () => {
    const partitions: SitePartitions = { chatgpt: `persist:${CHATGPT}`, grok: 'persist:grok' };
    const parsed = parseStateDocument({ ...base, partitions });
    expect(parsed.partitions).toEqual(partitions);
    expect(partitionFor(parsed.partitions, 'chatgpt')).toBe(`persist:${CHATGPT}`);
    expect(partitionFor(parsed.partitions, 'deepseek')).toBe(defaultPartition('deepseek'));
    expect(partitionFor(undefined, 'grok')).toBe('persist:grok');
  });

  it('refuses a partition that could leave the Partitions folder or belongs to another kind', () => {
    for (const value of ['persist:../x', 'persist:a/b', 'x', '', 7, null, 'persist:grok', `persist:${GROK}/..`]) {
      expect(() => parseStateDocument({ ...base, partitions: { chatgpt: value } }), String(value)).toThrow();
    }
    expect(() => parseStateDocument({ ...base, partitions: [] })).toThrow();
  });

  it('refuses a document whose agent is invalid or repeated instead of reading it as empty', () => {
    const one = agent(GROK, 'grok');
    expect(() => parseStateDocument({ ...base, agents: [one, one] })).toThrow();
    expect(() => parseStateDocument({ ...base, agents: [{ id: 1 }] })).toThrow();
    expect(() => parseStateDocument({ ...base, agents: 'x' })).toThrow();
    expect(() => parseStateDocument(null)).toThrow();
    expect(() => parseStateDocument({ ...base, version: 1 })).toThrow();
  });
});
