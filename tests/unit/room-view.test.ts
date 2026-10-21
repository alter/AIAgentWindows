// room-view.test.ts
import { describe, expect, it } from 'vitest';
import { AGENT_KINDS, AGENT_LABELS, SITE_KINDS_WITH_ADAPTER, isSiteKind, type SiteKind } from '../../src/shared/agents';
import type { RoomEntry, RoomEvent } from '../../src/shared/room-model';
import { ROOM_PARTICIPANTS } from '../../src/shared/room-model';
import {
  applyRoomEvent,
  carryText,
  emptyRoomSnapshot,
  formToConfig,
  participantAvailability,
  type RoomFormValues,
} from '../../src/shared/room-view';
import { adapterFor } from '../../src/main/site-adapters/registry';
import { createSiteSeats } from '../../src/main/site-seats';

function entry(kind: RoomEntry['kind'], text: string, label = 'Codex'): RoomEntry {
  return { authorId: label.toLowerCase(), label, time: 1_700_000_000_000, kind, text };
}

function run(events: RoomEvent[]): ReturnType<typeof emptyRoomSnapshot> {
  return events.reduce(applyRoomEvent, emptyRoomSnapshot());
}

const STARTED: RoomEvent = { type: 'started', roomId: 'r1', historyPath: '/h/r1.md', total: 3 };

describe('room participants', () => {
  it('offers every agent kind once, id equal to kind, with the agent label', () => {
    expect(ROOM_PARTICIPANTS.map((item) => item.kind)).toEqual([...AGENT_KINDS]);
    for (const item of ROOM_PARTICIPANTS) {
      expect(item.id).toBe(item.kind);
      expect(item.label).toBe(AGENT_LABELS[item.kind]);
    }
  });
});

describe('paused sessions', () => {
  const PAUSE: RoomEvent = { type: 'paused', roomId: 'r1', participantId: 'a', sessionId: 'room-a-1', note: 'accept, then Resume' };

  it('a pause is listed once per participant and replaced by a later pause of the same participant', () => {
    const first = run([STARTED, PAUSE]);
    expect(first.paused).toEqual([{ participantId: 'a', sessionId: 'room-a-1', note: 'accept, then Resume' }]);
    const again = applyRoomEvent(first, { ...PAUSE, sessionId: 'room-a-2' } as RoomEvent);
    expect(again.paused.map((item) => item.sessionId)).toEqual(['room-a-2']);
  });

  it('resume removes the pause, finish clears them all and a stray room is ignored', () => {
    const two = run([STARTED, PAUSE, { ...PAUSE, participantId: 'b', sessionId: 'room-b-1' } as RoomEvent]);
    expect(two.paused).toHaveLength(2);
    expect(applyRoomEvent(two, { type: 'resumed', roomId: 'r1', participantId: 'a' }).paused.map((item) => item.participantId)).toEqual(['b']);
    expect(applyRoomEvent(two, { type: 'finished', roomId: 'r1', status: 'stopped' }).paused).toEqual([]);
    expect(applyRoomEvent(two, { type: 'resumed', roomId: 'other', participantId: 'a' })).toBe(two);
  });
});

describe('applyRoomEvent', () => {
  it('starts idle and empty', () => {
    expect(emptyRoomSnapshot()).toEqual({
      phase: 'idle',
      roomId: null,
      historyPath: null,
      entries: [],
      running: [],
      paused: [],
      completed: 0,
      total: 0,
    });
  });

  it('started resets the feed and marks the run running', () => {
    const old = run([STARTED, { type: 'entry', roomId: 'r1', entry: entry('prompt', 'old') }]);
    const next = applyRoomEvent(old, { type: 'started', roomId: 'r2', historyPath: '/h/r2.md', total: 2 });
    expect(next).toMatchObject({ phase: 'running', roomId: 'r2', historyPath: '/h/r2.md', entries: [], total: 2, completed: 0 });
  });

  it('appends entries of the current room in order and ignores other rooms', () => {
    const snapshot = run([
      STARTED,
      { type: 'entry', roomId: 'r1', entry: entry('prompt', 'one', 'Owner') },
      { type: 'entry', roomId: 'other', entry: entry('reply', 'stray') },
      { type: 'entry', roomId: 'r1', entry: entry('reply', 'two') },
    ]);
    expect(snapshot.entries.map((item) => item.text)).toEqual(['one', 'two']);
  });

  it('tracks who is running and how far the run is', () => {
    const running = run([
      STARTED,
      { type: 'progress', roomId: 'r1', participantId: 'a', state: 'running', completed: 0, total: 3 },
      { type: 'progress', roomId: 'r1', participantId: 'b', state: 'running', completed: 0, total: 3 },
    ]);
    expect(running.running).toEqual(['a', 'b']);
    const replied = applyRoomEvent(running, { type: 'progress', roomId: 'r1', participantId: 'a', state: 'replied', completed: 1, total: 3 });
    expect(replied.running).toEqual(['b']);
    expect(replied.completed).toBe(1);
    const failed = applyRoomEvent(replied, { type: 'progress', roomId: 'r1', participantId: 'b', state: 'failed', completed: 2, total: 3 });
    expect(failed.running).toEqual([]);
    expect(applyRoomEvent(failed, { type: 'progress', roomId: 'x', participantId: 'a', state: 'running', completed: 0, total: 1 })).toBe(failed);
  });

  it('a running step is not added twice', () => {
    const snapshot = run([
      STARTED,
      { type: 'progress', roomId: 'r1', participantId: 'a', state: 'running', completed: 0, total: 3 },
      { type: 'progress', roomId: 'r1', participantId: 'a', state: 'running', completed: 0, total: 3 },
    ]);
    expect(snapshot.running).toEqual(['a']);
  });

  it('finished records the status and clears the running list', () => {
    const snapshot = run([
      STARTED,
      { type: 'progress', roomId: 'r1', participantId: 'a', state: 'running', completed: 0, total: 3 },
      { type: 'finished', roomId: 'r1', status: 'stopped' },
    ]);
    expect(snapshot.phase).toBe('stopped');
    expect(snapshot.running).toEqual([]);
    expect(applyRoomEvent(snapshot, { type: 'finished', roomId: 'other', status: 'done' })).toBe(snapshot);
  });
});

describe('carryText', () => {
  it('the final reply is the last reply entry, verbatim', () => {
    const snapshot = run([
      STARTED,
      { type: 'entry', roomId: 'r1', entry: entry('prompt', 'q', 'Owner') },
      { type: 'entry', roomId: 'r1', entry: entry('reply', 'first <b>x</b>') },
      { type: 'entry', roomId: 'r1', entry: entry('reply', 'last <b>y</b>') },
      { type: 'entry', roomId: 'r1', entry: entry('error', 'timed out') },
      { type: 'finished', roomId: 'r1', status: 'done' },
    ]);
    expect(carryText(snapshot, 'final')).toBe('last <b>y</b>');
  });

  it('the history is the rendered markdown of the run', () => {
    const snapshot = run([
      STARTED,
      { type: 'entry', roomId: 'r1', entry: entry('prompt', 'q', 'Owner') },
      { type: 'entry', roomId: 'r1', entry: entry('reply', 'a') },
      { type: 'finished', roomId: 'r1', status: 'done' },
    ]);
    const text = carryText(snapshot, 'history') ?? '';
    expect(text.startsWith('# Room r1')).toBe(true);
    expect(text.indexOf('\nq\n')).toBeLessThan(text.indexOf('\na\n'));
  });

  it('the history carries body lines without the escape prefix', () => {
    const snapshot = run([
      STARTED,
      { type: 'entry', roomId: 'r1', entry: entry('reply', '- one\n# two') },
      { type: 'finished', roomId: 'r1', status: 'done' },
    ]);
    const text = carryText(snapshot, 'history') ?? '';
    expect(text).toContain('\n- one\n# two\n');
    expect(text).not.toContain('\\');
  });

  it('is null while running, with no replies, or with no room', () => {
    expect(carryText(emptyRoomSnapshot(), 'final')).toBeNull();
    expect(carryText(emptyRoomSnapshot(), 'history')).toBeNull();
    const running = run([STARTED, { type: 'entry', roomId: 'r1', entry: entry('reply', 'a') }]);
    expect(carryText(running, 'final')).toBeNull();
    const noReply = run([STARTED, { type: 'entry', roomId: 'r1', entry: entry('prompt', 'q', 'Owner') }, { type: 'finished', roomId: 'r1', status: 'done' }]);
    expect(carryText(noReply, 'final')).toBeNull();
    expect(carryText(noReply, 'history')).not.toBeNull();
  });

  it('an empty reply is not carried', () => {
    const snapshot = run([STARTED, { type: 'entry', roomId: 'r1', entry: entry('reply', '') }, { type: 'finished', roomId: 'r1', status: 'done' }]);
    expect(carryText(snapshot, 'final')).toBeNull();
  });
});

describe('formToConfig', () => {
  const form: RoomFormValues = {
    prompt: 'hello',
    mode: 'relay',
    rounds: '2',
    timeoutMinutes: '10',
    checked: ['codex', 'claude'],
  };

  it('keeps participants in the fixed room order, whatever order they were ticked in', () => {
    const result = formToConfig(form);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.participants.map((item) => item.id)).toEqual(['claude', 'codex']);
    expect(result.config).toMatchObject({ prompt: 'hello', mode: 'relay', rounds: 2, turnTimeoutMs: 600000 });
  });

  it('rejects an empty prompt, no participants, bad rounds and bad timeout', () => {
    expect(formToConfig({ ...form, prompt: '' }).ok).toBe(false);
    expect(formToConfig({ ...form, checked: [] }).ok).toBe(false);
    expect(formToConfig({ ...form, rounds: '0' }).ok).toBe(false);
    expect(formToConfig({ ...form, rounds: 'abc' }).ok).toBe(false);
    expect(formToConfig({ ...form, rounds: '51' }).ok).toBe(false);
    expect(formToConfig({ ...form, timeoutMinutes: '0' }).ok).toBe(false);
    expect(formToConfig({ ...form, timeoutMinutes: '' }).ok).toBe(false);
  });

  it('accepts a fractional timeout and ignores unknown ticked kinds', () => {
    const result = formToConfig({ ...form, timeoutMinutes: '0.5', checked: ['claude', 'bash'] });
    expect(result.ok && result.config.turnTimeoutMs).toBe(30000);
    expect(result.ok && result.config.participants.length).toBe(1);
  });

  it('broadcast takes the rounds field like relay does', () => {
    const result = formToConfig({ ...form, mode: 'broadcast', rounds: '4' });
    expect(result.ok && result.config.rounds).toBe(4);
    expect(formToConfig({ ...form, mode: 'broadcast', rounds: 'junk' }).ok).toBe(false);
  });
});

describe('participants without an adapter', () => {
  const WEB: readonly SiteKind[] = ['chatgpt', 'grok', 'deepseek'];
  const NONE: readonly SiteKind[] = [];

  it('CLI participants are always available; a web participant is available only with an adapter and says what is missing', () => {
    for (const item of ROOM_PARTICIPANTS) {
      const web = isSiteKind(item.kind);
      expect(participantAvailability(item, NONE).available).toBe(!web);
      expect(participantAvailability(item).available).toBe(true);
      if (web) expect(participantAvailability(item, NONE).note).toContain('no site adapter');
    }
  });

  it('every web site has an adapter and the list of sites with an adapter is the registry', () => {
    expect([...SITE_KINDS_WITH_ADAPTER].sort()).toEqual([...WEB].sort());
    for (const kind of WEB) expect(adapterFor(kind) !== null).toBe(SITE_KINDS_WITH_ADAPTER.includes(kind));
  });

  it('a ticked web participant without an adapter is refused before the run starts', () => {
    const form: RoomFormValues = { prompt: 'hello', mode: 'broadcast', rounds: '1', timeoutMinutes: '10', checked: ['claude', 'deepseek'] };
    const result = formToConfig(form, NONE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('DeepSeek');
    expect(formToConfig(form).ok).toBe(true);
  });

  it('the seat prepares the agent page through the dependency with the given bound', async () => {
    const calls: Array<[string, number]> = [];
    const agent = { id: 'ds-1', kind: 'deepseek' as const, title: 'DeepSeek', createdAt: 0 };
    const seats = createSiteSeats({
      agents: () => [agent],
      page: () => ({ executeJavaScriptInIsolatedWorld: () => Promise.resolve(null), isDestroyed: () => false }),
      prepare: (item, timeoutMs) => {
        calls.push([item.id, timeoutMs]);
        return Promise.resolve();
      },
      adapterFor,
    });
    const deepseek = ROOM_PARTICIPANTS.find((item) => item.kind === 'deepseek');
    if (deepseek === undefined) throw new Error('no deepseek participant');
    const seat = seats(deepseek);
    await seat?.prepare?.(1234, new AbortController().signal);
    expect(calls).toEqual([['ds-1', 1234]]);
  });

  it('the driver error for a missing adapter names the missing adapter, not the chat page', () => {
    const seats = createSiteSeats({ agents: () => [], page: () => { throw new Error('unused'); }, prepare: () => Promise.resolve(), adapterFor: () => null });
    const deepseek = ROOM_PARTICIPANTS.find((item) => item.kind === 'deepseek');
    if (deepseek === undefined) throw new Error('no deepseek participant');
    expect(() => seats(deepseek)).toThrow(/DeepSeek has no site adapter/);
  });
});
