// context-pack.test.ts
import { describe, expect, it } from 'vitest';
import { composePack, historyProvider, type ContextProvider } from '../../src/main/runs/context-pack';
import { capabilitiesOf, NO_CATALOG, type Capabilities } from '../../src/shared/kinds/capabilities';
import { WEB_INLINE_LIMIT, buildParticipantPrompt, historyNonce, renderHistory } from '../../src/shared/room-history';
import type { RoomEntry, RoomParticipant } from '../../src/shared/room-model';

const CLI: RoomParticipant = { id: 'a', kind: 'claude', label: 'Claude Code' };
const WEB: RoomParticipant = { id: 'c', kind: 'chatgpt', label: 'ChatGPT' };
const ROUTER: RoomParticipant = { id: 'r', kind: 'openrouter', label: 'OpenRouter', model: 'vendor/model' };

const PLAIN: Capabilities = { attachesFiles: false, splitsSystem: false };

function entry(text: string, overrides: Partial<RoomEntry> = {}): RoomEntry {
  return { authorId: 'owner', label: 'Owner', time: Date.UTC(2026, 9, 24, 8, 0, 0), kind: 'prompt', text, ...overrides };
}

function part(id: string, priority: number, text: string, extra: { system?: string; files?: string[] } = {}): ContextProvider {
  return {
    id,
    priority,
    provide: () => ({ text, ...(extra.system === undefined ? {} : { system: extra.system }), files: (extra.files ?? []).map((content) => ({ content })) }),
  };
}

function unnonced(text: string): string {
  const nonce = historyNonce(text);
  return nonce === null ? text : text.split(nonce).join('NONCE');
}

function historyFor(participant: RoomParticipant, seen: RoomEntry[], renderRun: (entries: readonly RoomEntry[]) => string = () => 'RUN HISTORY') {
  return historyProvider({ participant, roomId: 'room-1', seen, phase: false, renderRun });
}

describe('composePack', () => {
  it('returns the text of a single provider with no system part and no files', () => {
    expect(composePack([part('one', 0, 'only text')], PLAIN)).toEqual({ text: 'only text', files: [] });
  });

  it('puts providers in priority order, ties in the order given, and keeps every system part, text and file', () => {
    const pack = composePack(
      [
        part('late', 5, 'late text', { files: ['late file'] }),
        part('first', 1, 'first text', { system: 'first system', files: ['first file'] }),
        part('tie-a', 3, 'tie a', { system: 'sys a' }),
        part('tie-b', 3, 'tie b', { system: 'sys b' }),
      ],
      PLAIN,
    );
    expect(pack.text).toBe('first text\n\ntie a\n\ntie b\n\nlate text');
    expect(pack.system).toBe('first system\n\nsys a\n\nsys b');
    expect(pack.files.map((file) => file.content)).toEqual(['first file', 'late file']);
  });

  it('hands the recipient capabilities to every provider', () => {
    const seen: Capabilities[] = [];
    const spy: ContextProvider = { id: 'spy', priority: 0, provide: (capabilities) => (seen.push(capabilities), { text: 'x' }) };
    composePack([spy], { attachesFiles: true, splitsSystem: false });
    expect(seen).toEqual([{ attachesFiles: true, splitsSystem: false }]);
  });

  it('skips a provider with nothing to say', () => {
    const empty: ContextProvider = { id: 'empty', priority: 0, provide: () => ({}) };
    expect(composePack([empty, part('one', 1, 'kept')], PLAIN)).toEqual({ text: 'kept', files: [] });
  });
});

describe('history provider', () => {
  it('gives a CLI participant the intro and the history in its text, no file and no system part', () => {
    const seen = [entry('the question'), entry('reply a1', { authorId: 'b', label: 'Codex', kind: 'reply' })];
    const pack = composePack([historyFor(CLI, seen)], capabilitiesOf(CLI.kind, CLI, NO_CATALOG));
    const prompt = buildParticipantPrompt(CLI, 'room-1', seen);
    expect(unnonced(pack.text)).toBe(unnonced(prompt.text));
    expect(pack.text).toContain('reply a1');
    expect(pack.files).toEqual([]);
    expect(pack.system).toBeUndefined();
  });

  it('gives a web participant a short history inline, with no file', () => {
    const seen = [entry('the question')];
    const pack = composePack([historyFor(WEB, seen)], capabilitiesOf(WEB.kind, WEB, NO_CATALOG));
    expect(unnonced(pack.text)).toBe(unnonced(buildParticipantPrompt(WEB, 'room-1', seen).text));
    expect(pack.files).toEqual([]);
    expect(pack.system).toBeUndefined();
  });

  it('gives a web participant a long history as one file and a text that names it, never both inline and attached', () => {
    const seen = [entry('x'.repeat(WEB_INLINE_LIMIT + 1))];
    const pack = composePack([historyFor(WEB, seen)], capabilitiesOf(WEB.kind, WEB, NO_CATALOG));
    expect(pack.text).toBe(buildParticipantPrompt(WEB, 'room-1', seen).text);
    expect(pack.text).not.toContain('xxxxxxxxxx');
    expect(pack.files).toHaveLength(1);
    expect(pack.files[0]?.content).toContain('x'.repeat(WEB_INLINE_LIMIT + 1));
    expect(unnonced(pack.files[0]?.content ?? '')).toBe(unnonced(renderHistory('room-1', seen)));
    expect(historyNonce(pack.text)).toBeNull();
  });

  it('keeps the system and user split for OpenRouter: the intro as system, the run history as text', () => {
    const seen = [entry('the question')];
    const renders: (readonly RoomEntry[])[] = [];
    const pack = composePack(
      [historyFor(ROUTER, seen, (entries) => (renders.push(entries), 'RUN HISTORY'))],
      capabilitiesOf(ROUTER.kind, ROUTER, NO_CATALOG),
    );
    expect(pack.system).toBe(buildParticipantPrompt(ROUTER, 'room-1', seen).text);
    expect(pack.text).toBe('RUN HISTORY');
    expect(pack.files).toEqual([]);
    expect(renders).toEqual([seen]);
  });

  it('never asks the run for its render when the recipient is not split', () => {
    let asked = 0;
    composePack([historyFor(CLI, [entry('q')], () => (asked += 1, ''))], capabilitiesOf(CLI.kind, CLI, NO_CATALOG));
    expect(asked).toBe(0);
  });

  it('carries the phase of the turn into the intro', () => {
    const provider = historyProvider({ participant: CLI, roomId: 'room-1', seen: [entry('q')], phase: 'final', renderRun: () => '' });
    expect(composePack([provider], PLAIN).text).toContain('final consolidated answer');
  });
});
