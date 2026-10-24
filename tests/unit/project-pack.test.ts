// project-pack.test.ts
import { describe, expect, it } from 'vitest';
import { digestOf, hashOf, runMap } from '../../src/main/runs/digest';
import { buildPack, mapLimitsFor, receivesMap, type PackBuildInput } from '../../src/main/runs/project-pack';
import { projectMapProvider } from '../../src/main/runs/project-map-provider';
import { capabilitiesOf, inputCharBudget, type ModelCatalog } from '../../src/shared/kinds/capabilities';
import { DEFAULT_MAP_LIMITS } from '../../src/shared/project-map';
import { WEB_INLINE_LIMIT, renderHistory } from '../../src/shared/room-history';
import type { RoomEntry, RoomParticipant } from '../../src/shared/room-model';

const CLI: RoomParticipant = { id: 'claude', kind: 'claude', label: 'Claude Code' };
const WEB: RoomParticipant = { id: 'chatgpt', kind: 'chatgpt', label: 'ChatGPT' };
const SMALL: RoomParticipant = { id: 'openrouter', kind: 'openrouter', label: 'OpenRouter · Small', model: 'acme/small' };
const TINY: RoomParticipant = { id: 'openrouter-3', kind: 'openrouter', label: 'OpenRouter · Tiny', model: 'acme/tiny' };
const FREE: RoomParticipant = { id: 'openrouter-2', kind: 'openrouter', label: 'OpenRouter · Unknown', model: 'acme/unknown' };

const CATALOG: ModelCatalog = {
  contextLength: (model) => (model === 'acme/small' ? 4000 : model === 'acme/tiny' ? 400 : null),
  maxCompletionTokens: (model) => (model === 'acme/small' ? 512 : null),
};

const MAP_TEXT = `Project files:\n${Array.from({ length: 400 }, (_, index) => `src/file-${index}.ts`).join('\n')}`;
const RUN_MAP = runMap(MAP_TEXT);

function entry(kind: RoomEntry['kind'], text: string, time: number): RoomEntry {
  return { authorId: kind === 'prompt' ? 'owner' : 'a', label: kind === 'prompt' ? 'Owner' : 'Agent', time, kind, text };
}

function longHistory(): RoomEntry[] {
  return [
    entry('prompt', 'first question', 1),
    ...Array.from({ length: 12 }, (_, index) => entry('reply', `${'answer '.repeat(120)} ${index}`, 2 + index)),
    entry('prompt', 'the latest request', 100),
  ];
}

function input(participant: RoomParticipant, overrides: Partial<PackBuildInput> = {}): PackBuildInput {
  const seen = overrides.seen ?? longHistory();
  return {
    participant,
    roomId: 'room-1',
    seen,
    phase: false,
    renderRun: (entries) => renderHistory('room-1', entries, () => 'f'.repeat(24)),
    capabilities: capabilitiesOf(participant.kind, participant, CATALOG),
    map: RUN_MAP,
    project: true,
    ...overrides,
  };
}

describe('a CLI participant', () => {
  it('gets today\'s history prompt and nothing of the map, in a project room', () => {
    const built = buildPack(input(CLI, { seen: [entry('prompt', 'q', 1)] }));
    expect(built.pack.files).toEqual([]);
    expect(built.pack.system).toBeUndefined();
    expect(built.pack.text).not.toContain('file-1.ts');
    expect(built.parts.map((part) => part.id)).toEqual(['history']);
    expect(built.sent).toHaveLength(1);
    expect(built.inline).toBeUndefined();
    expect(built.denyDataCollection).toBeUndefined();
  });
});

describe('a web participant', () => {
  it('gets one attachment holding the history and the map, and a text that points at it', () => {
    const built = buildPack(input(WEB, { seen: [entry('prompt', 'q', 1)] }));
    expect(built.pack.files).toHaveLength(1);
    const file = built.pack.files[0]?.content ?? '';
    expect(file).toContain('src/file-399.ts');
    expect(file).toContain('<<<entry-');
    expect(built.pack.text).toContain('attached file');
    expect(built.pack.text).toMatch(/project map/i);
    expect(built.pack.text).not.toContain('src/file-1.ts');
    expect(built.parts.map((part) => part.id)).toEqual(['history', 'project-map']);
  });

  it('has an inline text of the same material, cut from the oldest end within today\'s limit, the latest request kept', () => {
    const built = buildPack(input(WEB));
    const inline = built.inline;
    expect(inline).toBeDefined();
    const body = inline?.text ?? '';
    expect(body).toContain('the latest request');
    expect(body).not.toContain('first question');
    expect(body.length).toBeLessThanOrEqual(WEB_INLINE_LIMIT + 1200);
    expect(inline?.cut.entries).toBeGreaterThan(0);
    expect(inline?.cut.mapChars).toBeGreaterThan(0);
  });

  it('inlines the whole text and cuts nothing when it already fits', () => {
    const built = buildPack(input(WEB, { seen: [entry('prompt', 'short', 1)], map: runMap('Project files:\na.ts') }));
    expect(built.inline?.cut).toEqual({ entries: 0, mapChars: 0 });
    expect(built.inline?.text).toContain('a.ts');
    expect(built.inline?.text).toContain('short');
  });

  it('keeps today\'s prompt and has no inline text when the room has no map', () => {
    const built = buildPack(input(WEB, { map: null, seen: [entry('prompt', 'q', 1)] }));
    expect(built.pack.text).not.toMatch(/project map/i);
    expect(built.inline).toBeUndefined();
    expect(built.pack.files).toEqual([]);
    expect(built.parts.map((part) => part.id)).toEqual(['history']);
  });

  it('gets no map outside a project room', () => {
    const built = buildPack(input(WEB, { project: false, map: null, seen: [entry('prompt', 'q', 1)] }));
    expect(built.parts.map((part) => part.id)).toEqual(['history']);
  });
});

describe('an OpenRouter participant', () => {
  it('has a system part with the map after the intro, the run history as the user text, and a request that fits its context', () => {
    const built = buildPack(input(SMALL));
    const budget = inputCharBudget(capabilitiesOf('openrouter', SMALL, CATALOG)) ?? 0;
    expect(built.pack.system).toContain('You are');
    expect(built.pack.system).toContain('file-');
    expect((built.pack.system?.length ?? 0) + built.pack.text.length).toBeLessThanOrEqual(budget);
    expect(built.pack.text).toContain('the latest request');
    expect(built.cut?.via).toBe('budget');
    expect(built.cut?.entries).toBeGreaterThan(0);
    expect(built.sent.length).toBeLessThan(longHistory().length);
    expect(built.sent.map((item) => item.text)).toContain('the latest request');
    expect(built.denyDataCollection).toBe(true);
  });

  it('asks for a completion ceiling only when the model reported one, never more than the reserve', () => {
    expect(buildPack(input(SMALL)).maxCompletionTokens).toBe(512);
    expect(buildPack(input(FREE)).maxCompletionTokens).toBeUndefined();
  });

  it('sends the whole map and the whole history when the model\'s context is unknown', () => {
    const built = buildPack(input(FREE));
    expect(built.cut).toBeUndefined();
    expect(built.sent).toHaveLength(longHistory().length);
    expect(built.pack.system).toContain('src/file-399.ts');
    expect(built.denyDataCollection).toBe(true);
  });

  it('has no map part when the map is empty after the cut, and none when the room has no map', () => {
    const none = buildPack(input(FREE, { map: null }));
    expect(none.parts.map((part) => part.id)).toEqual(['history']);
    const tight = buildPack(input(TINY, { seen: [entry('prompt', 'short question', 1)] }));
    expect(tight.parts.map((part) => part.id)).toEqual(['history']);
    expect(tight.cut?.mapChars).toBe(MAP_TEXT.length);
  });

  it('sends none of the project fields outside a project room', () => {
    const built = buildPack(input(SMALL, { project: false, map: null, capabilities: capabilitiesOf('openrouter', SMALL, { contextLength: () => null }) }));
    expect(built.denyDataCollection).toBeUndefined();
    expect(built.maxCompletionTokens).toBeUndefined();
    expect(built.cut).toBeUndefined();
  });
});

describe('projectMapProvider', () => {
  it('marks the map as data and places it by capability', () => {
    const provider = projectMapProvider('MAP');
    expect(provider.id).toBe('project-map');
    expect(provider.provide({ attachesFiles: false, splitsSystem: true }).system).toContain('MAP');
    expect(provider.provide({ attachesFiles: true, splitsSystem: false }).files?.[0]?.content).toContain('MAP');
    expect(provider.provide({ attachesFiles: false, splitsSystem: false })).toEqual({});
    expect(provider.provide({ attachesFiles: true, splitsSystem: false }).files?.[0]?.content).toMatch(/data/i);
  });
});

describe('digestOf', () => {
  const seen = longHistory();

  it('records the range of history entries, the size and hash of each part, the files and the run\'s map hash', () => {
    const built = buildPack(input(WEB, { seen }));
    const digest = digestOf({ all: seen, built, files: [{ name: '1.md', bytes: 99 }], map: RUN_MAP.hash, inlined: false });
    expect(digest.history).toEqual({ first: 0, last: seen.length - 1, count: seen.length });
    expect(digest.parts.map((part) => part.id)).toEqual(['history', 'project-map']);
    for (const part of digest.parts) {
      expect(part.bytes).toBeGreaterThan(0);
      expect(part.hash).toMatch(/^[0-9a-f]{16}$/);
    }
    expect(digest.files).toEqual([{ name: '1.md', bytes: 99 }]);
    expect(digest.map).toBe(RUN_MAP.hash);
    expect(digest.cut).toBeUndefined();
  });

  it('records the inline fallback and what it cut only when it ran', () => {
    const built = buildPack(input(WEB, { seen }));
    const used = digestOf({ all: seen, built, files: [], map: RUN_MAP.hash, inlined: true });
    expect(used.cut).toEqual({ via: 'inline', ...built.inline?.cut });
    expect(digestOf({ all: seen, built, files: [], map: RUN_MAP.hash, inlined: false }).cut).toBeUndefined();
  });

  it('records a budget cut, and the range of what was sent rather than of what was seen', () => {
    const built = buildPack(input(SMALL, { seen }));
    const digest = digestOf({ all: seen, built, files: [], inlined: false });
    expect(digest.cut?.via).toBe('budget');
    expect(digest.history.count).toBe(built.sent.length);
    expect(digest.history.last).toBe(seen.length - 1);
    expect(digest.map).toBeUndefined();
  });

  it('counts bytes of UTF-8, not characters, and tolerates a pack that sent no entry', () => {
    const built = buildPack(input(CLI, { seen: [entry('prompt', 'ж'.repeat(40), 1)] }));
    const digest = digestOf({ all: [], built: { ...built, sent: [] }, files: [], inlined: false });
    expect(digest.history).toEqual({ first: 0, last: 0, count: 0 });
    expect(digest.parts[0]?.bytes).toBeGreaterThan(built.pack.text.length + 40);
    expect(hashOf('ж')).toMatch(/^[0-9a-f]{16}$/);
    expect(hashOf('a')).not.toBe(hashOf('b'));
  });
});

describe('mapLimitsFor', () => {
  it('keeps the default limits when no OpenRouter participant has a known context', () => {
    expect(mapLimitsFor([CLI, WEB, FREE], CATALOG)).toEqual(DEFAULT_MAP_LIMITS);
  });

  it('shrinks the map bytes to a quarter of the smallest input budget, and the document cap with it', () => {
    const limits = mapLimitsFor([WEB, SMALL, FREE], CATALOG);
    const budget = inputCharBudget(capabilitiesOf('openrouter', SMALL, CATALOG)) ?? 0;
    expect(limits.maxBytes).toBe(Math.floor(budget / 4));
    expect(limits.maxPaths).toBe(DEFAULT_MAP_LIMITS.maxPaths);
    expect(limits.maxDocumentBytes).toBeLessThanOrEqual(Math.floor(limits.maxBytes / 4));
  });

  it('never goes under a floor, and never over the default', () => {
    expect(mapLimitsFor([TINY], CATALOG).maxBytes).toBe(1024);
    expect(mapLimitsFor([{ ...SMALL, model: 'acme/huge' }], { contextLength: () => 1_000_000 }).maxBytes).toBe(DEFAULT_MAP_LIMITS.maxBytes);
  });
});

describe('receivesMap', () => {
  it('is true when a site or an OpenRouter participant is in the room, false for CLI only', () => {
    expect(receivesMap([CLI])).toBe(false);
    expect(receivesMap([CLI, WEB])).toBe(true);
    expect(receivesMap([SMALL])).toBe(true);
  });
});
