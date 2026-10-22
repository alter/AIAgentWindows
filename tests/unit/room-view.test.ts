// room-view.test.ts
import { describe, expect, it } from 'vitest';
import { AGENT_KINDS, AGENT_LABELS, SITE_KINDS_WITH_ADAPTER, isSiteKind, type SiteKind } from '../../src/shared/agents';
import type { RoomEntry, RoomEvent, RoomPlan } from '../../src/shared/room-model';
import { ROOM_PARTICIPANTS } from '../../src/shared/room-model';
import {
  applyRoomEvent,
  carryText,
  emptyRoomSnapshot,
  formToConfig,
  participantAvailability,
  resolveFinalizer,
  roomProgress,
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

const PLAN: RoomPlan = {
  mode: 'relay',
  rounds: 1,
  finalizerId: 'a',
  participants: [
    { id: 'a', kind: 'claude', label: 'Claude Code' },
    { id: 'b', kind: 'codex', label: 'Codex' },
  ],
};
const STARTED: RoomEvent = { type: 'started', roomId: 'r1', historyPath: '/h/r1.md', total: 3, plan: PLAN };

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
      plan: null,
      round: 0,
      chips: {},
    });
  });

  it('started resets the feed and marks the run running', () => {
    const old = run([STARTED, { type: 'entry', roomId: 'r1', entry: entry('prompt', 'old') }]);
    const next = applyRoomEvent(old, { type: 'started', roomId: 'r2', historyPath: '/h/r2.md', total: 2, plan: PLAN });
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

  it('passes the debug recording switch on and keeps it off by default', () => {
    const plain = formToConfig(form);
    expect(plain.ok && plain.config.debugSites).toBe(false);
    const on = formToConfig({ ...form, debugSites: true });
    expect(on.ok && on.config.debugSites).toBe(true);
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
      newChat: (item, timeoutMs) => {
        calls.push([`new:${item.id}`, timeoutMs]);
        return Promise.resolve();
      },
      adapterFor,
    });
    const deepseek = ROOM_PARTICIPANTS.find((item) => item.kind === 'deepseek');
    if (deepseek === undefined) throw new Error('no deepseek participant');
    const seat = seats(deepseek);
    await seat?.prepare?.(1234, new AbortController().signal);
    await seat?.newChat?.(777, new AbortController().signal);
    expect(calls).toEqual([['ds-1', 1234], ['new:ds-1', 777]]);
  });

  it('the driver error for a missing adapter names the missing adapter, not the chat page', () => {
    const seats = createSiteSeats({ agents: () => [], page: () => { throw new Error('unused'); }, prepare: () => Promise.resolve(), newChat: () => Promise.resolve(), adapterFor: () => null });
    const deepseek = ROOM_PARTICIPANTS.find((item) => item.kind === 'deepseek');
    if (deepseek === undefined) throw new Error('no deepseek participant');
    expect(() => seats(deepseek)).toThrow(/DeepSeek has no site adapter/);
  });
});

describe('finalizer choice', () => {
  const form: RoomFormValues = { prompt: 'hello', mode: 'relay', rounds: '1', timeoutMinutes: '10', checked: ['codex', 'claude', 'grok'] };

  it('keeps the previous choice while it is ticked and falls back to Claude Code, then to the first ticked', () => {
    expect(resolveFinalizer(['codex', 'claude', 'grok'], 'grok')).toBe('grok');
    expect(resolveFinalizer(['claude', 'codex'], 'grok')).toBe('claude');
    expect(resolveFinalizer(['grok', 'codex'], '')).toBe('codex');
    expect(resolveFinalizer(['bash'], 'claude')).toBe('');
    expect(resolveFinalizer([], '')).toBe('');
  });

  it('formToConfig puts the choice into the config and defaults it when missing or not ticked', () => {
    const chosen = formToConfig({ ...form, finalizerId: 'grok' });
    expect(chosen.ok && chosen.config.finalizerId).toBe('grok');
    const missing = formToConfig(form);
    expect(missing.ok && missing.config.finalizerId).toBe('claude');
    const stale = formToConfig({ ...form, checked: ['codex', 'grok'], finalizerId: 'claude' });
    expect(stale.ok && stale.config.finalizerId).toBe('codex');
  });

  it('carry final takes the final entry, not the last reply; without one it takes the last reply', () => {
    const done: RoomEvent = { type: 'finished', roomId: 'r1', status: 'done' };
    const withFinal = run([
      STARTED,
      { type: 'entry', roomId: 'r1', entry: entry('final', 'consolidated', 'Claude') },
      { type: 'entry', roomId: 'r1', entry: entry('reply', 'late reply') },
      done,
    ]);
    expect(carryText(withFinal, 'final')).toBe('consolidated');
    const noFinal = run([STARTED, { type: 'entry', roomId: 'r1', entry: entry('reply', 'only reply') }, done]);
    expect(carryText(noFinal, 'final')).toBe('only reply');
    const failedFinal = run([
      STARTED,
      { type: 'entry', roomId: 'r1', entry: entry('reply', 'a reply') },
      { type: 'entry', roomId: 'r1', entry: entry('error', 'boom', 'Claude') },
      done,
    ]);
    expect(carryText(failedFinal, 'final')).toBe('a reply');
  });
});


const TWO_ROUNDS: RoomPlan = { ...PLAN, rounds: 2 };
const BEGIN: RoomEvent = { type: 'started', roomId: 'r1', historyPath: '/h/r1.md', total: 5, plan: TWO_ROUNDS };

function step(participantId: string, state: 'running' | 'replied' | 'failed' | 'timeout', completed: number): RoomEvent {
  return { type: 'progress', roomId: 'r1', participantId, state, completed, total: 5 };
}

function chips(events: RoomEvent[]): Array<[string, string]> {
  const view = roomProgress(run(events));
  return (view?.chips ?? []).map((chip) => [chip.id, chip.state]);
}

describe('roomProgress', () => {
  it('is empty before any run', () => {
    expect(roomProgress(emptyRoomSnapshot())).toBeNull();
  });

  it('shows round 1 of N with every participant waiting right after the start', () => {
    const view = roomProgress(run([BEGIN]));
    expect(view?.headline).toBe('Round 1 of 2');
    expect(view?.remaining).toBe(5);
    expect(view?.remainingText).toBe('5 turns left');
    expect(chips([BEGIN])).toEqual([['a', 'waiting'], ['b', 'waiting']]);
    expect(view?.banner).toBeNull();
  });

  it('marks who runs and who answered in the current round', () => {
    const events = [BEGIN, step('a', 'running', 0), step('a', 'replied', 1), step('b', 'running', 1)];
    expect(chips(events)).toEqual([['a', 'answered'], ['b', 'running']]);
    expect(roomProgress(run(events))?.remainingText).toBe('4 turns left');
  });

  it('starts the next round with everybody waiting again', () => {
    const events = [BEGIN, step('a', 'running', 0), step('a', 'replied', 1), step('b', 'running', 1), step('b', 'failed', 2), step('a', 'running', 2)];
    expect(roomProgress(run(events))?.headline).toBe('Round 2 of 2');
    expect(chips(events)).toEqual([['a', 'running'], ['b', 'waiting']]);
  });

  it('keeps the round of a parallel pass until all of it has answered', () => {
    const events = [BEGIN, step('a', 'running', 0), step('b', 'running', 0), step('a', 'replied', 1)];
    expect(roomProgress(run(events))?.headline).toBe('Round 1 of 2');
    expect(chips(events)).toEqual([['a', 'answered'], ['b', 'running']]);
  });

  it('distinguishes an error from a timeout', () => {
    const events = [BEGIN, step('a', 'running', 0), step('a', 'timeout', 1), step('b', 'running', 1), step('b', 'failed', 2)];
    expect(chips(events)).toEqual([['a', 'timeout'], ['b', 'error']]);
  });

  it('names the final turn and shows only the finalizer', () => {
    const events = [
      BEGIN,
      step('a', 'running', 0), step('a', 'replied', 1), step('b', 'running', 1), step('b', 'replied', 2),
      step('a', 'running', 2), step('a', 'replied', 3), step('b', 'running', 3), step('b', 'replied', 4),
      step('a', 'running', 4),
    ];
    const view = roomProgress(run(events));
    expect(view?.headline).toBe('Final: Claude Code');
    expect(view?.remainingText).toBe('1 turn left');
    expect(chips(events)).toEqual([['a', 'running']]);
  });

  it('a done run announces the final answer and its author', () => {
    const events: RoomEvent[] = [
      BEGIN,
      { type: 'entry', roomId: 'r1', entry: { ...entry('final', 'answer', 'Claude Code'), authorId: 'a' } },
      step('a', 'replied', 5),
      { type: 'finished', roomId: 'r1', status: 'done' },
    ];
    expect(roomProgress(run(events))?.banner).toEqual({ tone: 'done', text: 'Done \u2014 final answer from Claude Code' });
    expect(roomProgress(run(events))?.remainingText).toBe('0 turns left');
  });

  describe('final turn handed to another participant', () => {
    const afterRounds = [
      BEGIN,
      step('a', 'running', 0), step('a', 'replied', 1), step('b', 'running', 1), step('b', 'replied', 2),
      step('a', 'running', 2), step('a', 'replied', 3), step('b', 'running', 3), step('b', 'replied', 4),
      step('a', 'running', 4), step('a', 'failed', 5),
    ];

    it('shows the finalizer and the stand-in, and names the hand-over in the headline', () => {
      const events = [...afterRounds, step('b', 'running', 5)];
      expect(chips(events)).toEqual([['a', 'error'], ['b', 'running']]);
      expect(roomProgress(run(events))?.headline).toBe('Final: Codex (finalizer Claude Code failed)');
    });

    it('a done run says who gave the final answer and that the finalizer failed', () => {
      const events: RoomEvent[] = [
        ...afterRounds,
        { type: 'entry', roomId: 'r1', entry: { ...entry('final', 'answer', 'Codex'), authorId: 'b' } },
        step('b', 'replied', 6),
        { type: 'finished', roomId: 'r1', status: 'done' },
      ];
      expect(roomProgress(run(events))?.banner).toEqual({ tone: 'warn', text: 'Done \u2014 final by Codex (finalizer Claude Code failed)' });
    });
  });

  it('a done run without a final entry says the finalizer failed', () => {
    const events: RoomEvent[] = [BEGIN, step('a', 'failed', 5), { type: 'finished', roomId: 'r1', status: 'done' }];
    expect(roomProgress(run(events))?.banner).toEqual({ tone: 'warn', text: 'Done \u2014 no final answer (Claude Code failed)' });
  });

  it('a stopped run says Stopped and no chip stays running', () => {
    const events: RoomEvent[] = [BEGIN, step('a', 'running', 0), { type: 'finished', roomId: 'r1', status: 'stopped' }];
    expect(roomProgress(run(events))?.banner).toEqual({ tone: 'stopped', text: 'Stopped' });
    expect(chips(events)).toEqual([['a', 'stopped'], ['b', 'waiting']]);
  });

  it('a failed run says Failed', () => {
    const events: RoomEvent[] = [BEGIN, { type: 'finished', roomId: 'r1', status: 'failed' }];
    expect(roomProgress(run(events))?.banner).toEqual({ tone: 'failed', text: 'Failed' });
  });

  it('a snapshot without a plan (state of an older main) shows nothing', () => {
    expect(roomProgress({ ...run([BEGIN]), plan: null })).toBeNull();
  });
});
