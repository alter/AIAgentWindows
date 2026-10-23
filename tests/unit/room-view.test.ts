// room-view.test.ts
import { describe, expect, it } from 'vitest';
import { AGENT_KINDS, AGENT_LABELS, SITE_KINDS_WITH_ADAPTER, isSiteKind, type SiteKind } from '../../src/shared/agents';
import type { RoomEntry, RoomEvent, RoomPlan, RoomRecord, RoomRecordConfig } from '../../src/shared/room-model';
import type { RoomModels } from '../../src/shared/cli-models';
import { ROOM_PARTICIPANTS, parseRoomRecord, roomPlan } from '../../src/shared/room-model';
import {
  addRow,
  defaultRows,
  effortChoices,
  finalizerChoices,
  modelSuggestions,
  removeRow,
  applyRoomEvent,
  carryText,
  emptyRoomSnapshot,
  entryState,
  feedSections,
  finalText,
  formFromRecord,
  formToConfig,
  participantAvailability,
  resolveFinalizer,
  roomListOption,
  roomProgress,
  snapshotFromRecord,
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

describe('formToConfig with participant rows', () => {
  const form: RoomFormValues = {
    prompt: 'hello',
    mode: 'relay',
    rounds: '2',
    timeoutMinutes: '10',
    checked: ['claude', 'claude-2', 'codex', 'grok'],
    rows: [
      { id: 'claude', kind: 'claude', model: 'opus', effort: 'high' },
      { id: 'claude-2', kind: 'claude', model: ' sonnet ', effort: '' },
      { id: 'codex', kind: 'codex', model: '', effort: '' },
    ],
  };

  it('carries every ticked row in row order with trimmed model and effort, then the ticked sites', () => {
    const result = formToConfig(form);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.participants).toEqual([
      { id: 'claude', kind: 'claude', label: 'Claude Code \u00b7 opus \u00b7 high', model: 'opus', effort: 'high' },
      { id: 'claude-2', kind: 'claude', label: 'Claude Code \u00b7 sonnet', model: 'sonnet' },
      { id: 'codex', kind: 'codex', label: 'Codex' },
      { id: 'grok', kind: 'grok', label: 'Grok' },
    ]);
  });

  it('leaves out a row that is not ticked and ignores a ticked id that is no row and no site', () => {
    const result = formToConfig({ ...form, checked: ['claude-2', 'nobody'] });
    expect(result.ok && result.config.participants.map((item) => item.id)).toEqual(['claude-2']);
  });

  it('refuses a bad model or effort in a row', () => {
    const bad = (row: object) => formToConfig({ ...form, rows: [{ id: 'claude', kind: 'claude', ...row }], checked: ['claude'] });
    expect(bad({ model: 'a b' }).ok).toBe(false);
    expect(bad({ effort: 'HIGH' }).ok).toBe(false);
    expect(bad({ model: 'opus[1m]' }).ok).toBe(true);
  });

  it('without rows the fixed Claude Code and Codex rows apply, as before', () => {
    const result = formToConfig({ prompt: 'q', mode: 'relay', rounds: '1', timeoutMinutes: '1', checked: ['codex', 'claude'] });
    expect(result.ok && result.config.participants.map((item) => item.id)).toEqual(['claude', 'codex']);
  });

  it('the finalizer may be a second instance of a kind and falls back to the first Claude instance', () => {
    const chosen = formToConfig({ ...form, finalizerId: 'claude-2' });
    expect(chosen.ok && chosen.config.finalizerId).toBe('claude-2');
    const stale = formToConfig({ ...form, checked: ['codex', 'claude-2'], finalizerId: 'claude' });
    expect(stale.ok && stale.config.finalizerId).toBe('claude-2');
    expect(resolveFinalizer(['claude-2', 'codex'], '', form.rows)).toBe('claude-2');
  });

  it('two sites of one kind cannot come from the form: a row of a site kind duplicates the site', () => {
    const rows = [{ id: 'x', kind: 'chatgpt' as const }];
    expect(formToConfig({ ...form, rows, checked: ['x', 'chatgpt'] }).ok).toBe(false);
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

const TRIO: RoomPlan = {
  mode: 'relay',
  rounds: 2,
  finalizerId: 'a',
  participants: [
    { id: 'a', kind: 'claude', label: 'Claude Code' },
    { id: 'b', kind: 'codex', label: 'Codex' },
    { id: 'c', kind: 'chatgpt', label: 'ChatGPT' },
  ],
};

function turn(id: string, round: number | undefined, kind: RoomEntry['kind'] = 'reply', extra: Partial<RoomEntry> = {}): RoomEntry {
  const base: RoomEntry = { authorId: id, label: id.toUpperCase(), time: 1_700_000_000_000, kind, text: `${id}${round ?? ''}` };
  return round === undefined ? { ...base, ...extra } : { ...base, round, ...extra };
}

function owner(): RoomEntry {
  return { authorId: 'owner', label: 'Owner', time: 1_700_000_000_000, kind: 'prompt', text: 'q' };
}

function members(sections: ReturnType<typeof feedSections>): Array<[string, string[]]> {
  return sections.map((section) => [section.key, section.entries.map((item) => `${item.entry.authorId}${item.entry.round ?? ''}`)]);
}

describe('feedSections', () => {
  it('a relay of 3 participants over 2 rounds puts each reply into its round, then the final', () => {
    const entries = [owner(), turn('a', 1), turn('b', 1), turn('c', 1), turn('a', 2), turn('b', 2), turn('c', 2), turn('a', undefined, 'final')];
    const sections = feedSections(entries, TRIO);
    expect(members(sections)).toEqual([
      ['prompt', ['owner']],
      ['round-1', ['a1', 'b1', 'c1']],
      ['round-2', ['a2', 'b2', 'c2']],
      ['final', ['a']],
    ]);
    expect(sections.filter((section) => section.key.startsWith('round-')).map((section) => section.title)).toEqual(['Round 1/2', 'Round 2/2']);
  });

  it('a broadcast of 2 participants over 2 rounds keeps arrival order inside a round', () => {
    const plan: RoomPlan = { ...TRIO, mode: 'broadcast', participants: TRIO.participants.slice(0, 2) };
    const entries = [owner(), turn('b', 1), turn('a', 1), turn('a', 2), turn('b', 2, 'error'), turn('a', undefined, 'final')];
    expect(members(feedSections(entries, plan))).toEqual([
      ['prompt', ['owner']],
      ['round-1', ['b1', 'a1']],
      ['round-2', ['a2', 'b2']],
      ['final', ['a']],
    ]);
  });

  it('entries without a round (older records) fall into one untitled section between the prompt and the final', () => {
    const entries = [owner(), turn('a', undefined), turn('b', undefined), turn('a', undefined), turn('b', undefined, 'final')];
    const sections = feedSections(entries, TRIO);
    expect(members(sections)).toEqual([
      ['prompt', ['owner']],
      ['rest', ['a', 'b', 'a']],
      ['final', ['b']],
    ]);
    expect(sections[1]?.title).toBeNull();
  });

  it('keeps the index of every entry in the whole list and works without a plan', () => {
    const entries = [owner(), turn('a', 1), turn('b', 1)];
    const sections = feedSections(entries, null);
    expect(sections.flatMap((section) => section.entries.map((item) => item.index))).toEqual([0, 1, 2]);
    expect(sections.find((section) => section.key === 'round-1')?.title).toBeTruthy();
  });

  it('a live run has no final section yet, and a new entry only grows the section it belongs to', () => {
    const before = feedSections([owner(), turn('a', 1)], TRIO);
    const after = feedSections([owner(), turn('a', 1), turn('b', 1)], TRIO);
    expect(before.map((section) => section.key)).toEqual(['prompt', 'round-1']);
    expect(after.map((section) => section.key)).toEqual(['prompt', 'round-1']);
    expect(after[1]?.entries).toHaveLength(2);
  });

  it('a failed finalizer note and error without a round stay out of every round and out of the final', () => {
    const entries = [owner(), turn('a', 1), turn('a', undefined, 'error'), turn('room', undefined, 'error'), turn('b', undefined, 'final')];
    expect(members(feedSections(entries, TRIO))).toEqual([
      ['prompt', ['owner']],
      ['round-1', ['a1']],
      ['rest', ['a', 'room']],
      ['final', ['b']],
    ]);
  });
});

describe('feedSections of a continued room', () => {
  it('a new owner prompt starts a new group: its rounds and final do not merge with the earlier run', () => {
    const entries = [
      owner(),
      turn('a', 1),
      turn('b', 1),
      turn('a', undefined, 'final'),
      owner(),
      turn('a', 1),
      turn('b', 1),
      turn('b', undefined, 'final'),
    ];
    const sections = feedSections(entries, TRIO);
    expect(members(sections)).toEqual([
      ['prompt', ['owner']],
      ['round-1', ['a1', 'b1']],
      ['final', ['a']],
      ['run2-prompt', ['owner']],
      ['run2-round-1', ['a1', 'b1']],
      ['run2-final', ['b']],
    ]);
    expect(sections.flatMap((section) => section.entries.map((item) => item.index))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(sections.map((section) => section.title)).toEqual(['Prompt', 'Round 1/2', 'Final result', 'Prompt', 'Round 1/2', 'Final result']);
  });

  it('a stopped continuation keeps its own untitled leftovers apart from the earlier run', () => {
    const entries = [owner(), turn('a', undefined, 'error'), owner(), turn('a', 1), turn('room', undefined, 'error', { state: 'stopped' })];
    expect(members(feedSections(entries, TRIO))).toEqual([
      ['prompt', ['owner']],
      ['rest', ['a']],
      ['run2-prompt', ['owner']],
      ['run2-round-1', ['a1']],
      ['run2-rest', ['room']],
    ]);
  });

  it('the third run is numbered run3 and entries before any prompt belong to the first run', () => {
    const entries = [turn('a', 1), owner(), owner(), owner()];
    expect(feedSections(entries, null).map((section) => section.key)).toEqual(['round-1', 'prompt', 'run2-prompt', 'run3-prompt']);
  });
});

describe('a continued room in the snapshot', () => {
  const FIRST: RoomEntry[] = [owner(), turn('a', 1), turn('a', undefined, 'final')];

  it('the started event of a continuation keeps the earlier entries and adds the new ones after them', () => {
    const started: RoomEvent = { type: 'started', roomId: 'r1', historyPath: '/h/r1.md', total: 3, plan: PLAN, previous: FIRST };
    const added = applyRoomEvent(applyRoomEvent(emptyRoomSnapshot(), started), { type: 'entry', roomId: 'r1', entry: owner() });
    expect(added.phase).toBe('running');
    expect(added.entries).toEqual([...FIRST, owner()]);
  });

  it('the banner of a continued run looks at its own final entry, not the earlier one', () => {
    const second: RoomEvent[] = [
      { type: 'started', roomId: 'r1', historyPath: '/h/r1.md', total: 5, plan: TWO_ROUNDS, previous: [owner(), { ...turn('a', undefined, 'final'), label: 'Claude Code' }] },
      { type: 'entry', roomId: 'r1', entry: owner() },
      step('a', 'failed', 5),
      { type: 'finished', roomId: 'r1', status: 'done' },
    ];
    expect(roomProgress(run(second))?.banner).toEqual({ tone: 'warn', text: 'Done \u2014 no final answer (Claude Code failed)' });
  });
});

describe('entryState', () => {
  it('names the outcome of an entry', () => {
    expect(entryState(turn('a', 1))).toBe('replied');
    expect(entryState(turn('a', 1, 'error'))).toBe('error');
    expect(entryState(turn('a', 1, 'error', { state: 'timeout' }))).toBe('timeout');
    expect(entryState(turn('room', undefined, 'error', { state: 'stopped' }))).toBe('stopped');
    expect(entryState(turn('a', undefined, 'final'))).toBe('final');
    expect(entryState(owner())).toBe('prompt');
  });
});

describe('finalText', () => {
  it('is the text of the newest final entry, whole, and null without one or when it is empty', () => {
    const long = 'x'.repeat(5000);
    const snapshot = { ...emptyRoomSnapshot(), roomId: 'r', entries: [owner(), turn('a', 1), { ...turn('b', undefined, 'final'), text: long }] };
    expect(finalText(snapshot)).toBe(long);
    expect(finalText({ ...snapshot, entries: snapshot.entries.slice(0, 2) })).toBeNull();
    expect(finalText({ ...snapshot, entries: [{ ...turn('b', undefined, 'final'), text: '' }] })).toBeNull();
    expect(finalText(emptyRoomSnapshot())).toBeNull();
  });
});

describe('snapshot from a record', () => {
  const MS = 1_700_000_000_000;
  const CONFIG: RoomRecordConfig = { mode: 'relay', rounds: 1, participants: PLAN.participants, finalizerId: 'a', turnTimeoutMs: 90_000, debugSites: false };

  function record(entries: RoomEntry[], status: RoomRecord['status'], config = CONFIG): RoomRecord {
    const parsed = parseRoomRecord(JSON.parse(JSON.stringify({ version: 1, id: 'r1', createdAt: MS, updatedAt: MS, status, config, entries, nonce: 'abcd1234abcd1234' })));
    if (parsed === null) throw new Error('record does not parse');
    return parsed;
  }

  const prompt = (text = 'ask'): RoomEntry => ({ authorId: 'owner', label: 'Owner', time: MS, kind: 'prompt', text });
  const roomNote = (text: string, extra: Partial<RoomEntry> = {}): RoomEntry => ({ authorId: 'room', label: 'Room', time: MS, kind: 'error', text, ...extra });

  function live(entries: RoomEntry[], status: 'done' | 'stopped' | 'failed', plan: RoomPlan, total: number): ReturnType<typeof emptyRoomSnapshot> {
    const lastPrompt = entries.map((item) => item.kind).lastIndexOf('prompt');
    const events: RoomEvent[] = [{ type: 'started', roomId: 'r1', historyPath: '/h/r1.md', total, plan, previous: entries.slice(0, lastPrompt) }];
    let completed = 0;
    let all = total;
    for (const item of entries.slice(lastPrompt)) {
      if (item.authorId === 'room' && item.state !== 'stopped') all += 1;
      if (item.authorId !== 'owner' && item.authorId !== 'room') events.push({ type: 'progress', roomId: 'r1', participantId: item.authorId, state: 'running', completed, total: all });
      events.push({ type: 'entry', roomId: 'r1', entry: item });
      if (item.authorId !== 'owner' && item.authorId !== 'room') {
        completed += 1;
        const state = item.kind !== 'error' ? 'replied' : item.state === 'timeout' ? 'timeout' : 'failed';
        events.push({ type: 'progress', roomId: 'r1', participantId: item.authorId, state, completed, total: all });
      }
    }
    events.push({ type: 'finished', roomId: 'r1', status });
    return run(events);
  }

  const reply = (id: string, text: string, round?: number): RoomEntry => ({ authorId: id, label: id === 'a' ? 'Claude Code' : 'Codex', time: MS, kind: 'reply', text, ...(round === undefined ? {} : { round }) });
  const final = (id: string, text: string): RoomEntry => ({ ...reply(id, text), kind: 'final' });

  it('carries the id, history path, status as phase, entries and plan of the record', () => {
    const entries = [prompt(), reply('a', 'one', 1), reply('b', 'two', 1), final('a', 'end')];
    const snapshot = snapshotFromRecord(record(entries, 'done'), '/h/r1.md');
    expect(snapshot).toMatchObject({ phase: 'done', roomId: 'r1', historyPath: '/h/r1.md', entries, plan: roomPlan({ ...CONFIG, prompt: '' }), paused: [], running: [] });
  });

  it('equals the live snapshot at the end of a finished relay with a final answer', () => {
    const entries = [prompt(), reply('a', 'one', 1), reply('b', 'two', 1), final('a', 'end')];
    expect(snapshotFromRecord(record(entries, 'done'), '/h/r1.md')).toEqual(live(entries, 'done', PLAN, 3));
  });

  it('equals the live snapshot after a timeout, a failed finalizer and a fallback final', () => {
    const entries = [
      prompt(),
      reply('a', 'one', 1),
      { ...reply('b', 'late', 1), kind: 'error' as const, state: 'timeout' as const },
      { ...reply('a', 'broke'), kind: 'error' as const },
      roomNote('Final by Codex (finalizer Claude Code failed)'),
      final('b', 'saved'),
    ];
    const snapshot = snapshotFromRecord(record(entries, 'done'), '/h/r1.md');
    expect(snapshot).toEqual(live(entries, 'done', PLAN, 3));
    expect(roomProgress(snapshot)?.banner?.tone).toBe('warn');
  });

  it('equals the live snapshot of a broadcast over two rounds', () => {
    const config = { ...CONFIG, mode: 'broadcast' as const, rounds: 2 };
    const entries = [prompt(), reply('b', 'b1', 1), reply('a', 'a1', 1), reply('a', 'a2', 2), reply('b', 'b2', 2), final('a', 'end')];
    expect(snapshotFromRecord(record(entries, 'done', config), '/h/r1.md')).toEqual(live(entries, 'done', { ...PLAN, mode: 'broadcast', rounds: 2 }, 5));
  });

  it('a stopped record keeps its replies and says Stopped', () => {
    const entries = [prompt(), reply('a', 'one', 1), roomNote('Stopped by the owner.', { state: 'stopped' })];
    const snapshot = snapshotFromRecord(record(entries, 'stopped'), '/h/r1.md');
    expect(snapshot).toEqual(live(entries, 'stopped', PLAN, 3));
    expect(roomProgress(snapshot)?.banner).toEqual({ tone: 'stopped', text: 'Stopped' });
    expect(carryText(snapshot, 'final')).toBe('one');
  });

  it('a failed record says Failed', () => {
    const snapshot = snapshotFromRecord(record([prompt()], 'failed'), '/h/r1.md');
    expect(snapshot.phase).toBe('failed');
    expect(roomProgress(snapshot)?.banner).toEqual({ tone: 'failed', text: 'Failed' });
  });

  it('a record still marked running is shown as stopped, never as running', () => {
    expect(snapshotFromRecord(record([prompt(), reply('a', 'one', 1)], 'running'), '/h/r1.md').phase).toBe('stopped');
  });

  it('a continued room is shown like the live end of its second run', () => {
    const first = [prompt('first'), reply('a', 'one', 1), reply('b', 'two', 1), final('a', 'end one')];
    const second = [prompt('second'), reply('a', 'three', 1), reply('b', 'four', 1), final('a', 'end two')];
    const entries = [...first, ...second];
    const snapshot = snapshotFromRecord(record(entries, 'done'), '/h/r1.md');
    expect(snapshot).toEqual(live(entries, 'done', PLAN, 3));
    expect(feedSections(snapshot.entries, snapshot.plan).map((section) => section.key)).toEqual(['prompt', 'round-1', 'final', 'run2-prompt', 'run2-round-1', 'run2-final']);
    expect(roomProgress(snapshot)?.banner).toEqual({ tone: 'done', text: 'Done \u2014 final answer from Claude Code' });
    expect(carryText(snapshot, 'final')).toBe('end two');
  });

  it('a record without entries gives an empty feed', () => {
    const snapshot = snapshotFromRecord(record([], 'stopped'), '/h/r1.md');
    expect(snapshot.entries).toEqual([]);
    expect(snapshot.phase).toBe('stopped');
  });

  it('prefills the settings of the last run and leaves the prompt empty', () => {
    const form = formFromRecord(record([prompt()], 'done', { ...CONFIG, mode: 'broadcast', rounds: 3, debugSites: true }));
    expect(form).toEqual({
      prompt: '',
      mode: 'broadcast',
      rounds: '3',
      timeoutMinutes: '1.5',
      checked: ['a', 'b'],
      finalizerId: 'a',
      debugSites: true,
      rows: [{ id: 'a', kind: 'claude' }, { id: 'b', kind: 'codex' }],
    });
  });

  it('prefills a row per CLI participant with its model and effort and none for a site, and turns back into the same config', () => {
    const participants = [
      { id: 'claude', kind: 'claude' as const, label: 'Claude Code \u00b7 opus \u00b7 high', model: 'opus', effort: 'high' },
      { id: 'claude-2', kind: 'claude' as const, label: 'Claude Code \u00b7 sonnet', model: 'sonnet' },
      { id: 'grok', kind: 'grok' as const, label: 'Grok' },
    ];
    const config = { ...CONFIG, participants, finalizerId: 'claude-2' };
    const form = formFromRecord(record([prompt()], 'done', config));
    expect(form.checked).toEqual(['claude', 'claude-2', 'grok']);
    expect(form.rows).toEqual([
      { id: 'claude', kind: 'claude', model: 'opus', effort: 'high' },
      { id: 'claude-2', kind: 'claude', model: 'sonnet' },
    ]);
    expect(formToConfig({ ...form, prompt: 'again' })).toEqual({ ok: true, config: { ...config, prompt: 'again' } });
  });

  it('the prefilled settings turn back into the same config', () => {
    const participants = ROOM_PARTICIPANTS.filter((item) => item.id === 'claude' || item.id === 'codex');
    const config = { ...CONFIG, participants, finalizerId: 'codex', rounds: 2, turnTimeoutMs: 90_000 };
    const result = formToConfig({ ...formFromRecord(record([prompt()], 'done', config)), prompt: 'again' });
    expect(result).toEqual({ ok: true, config: { ...config, prompt: 'again' } });
  });
});

describe('roomListOption', () => {
  const readable = { id: 'r1', unreadable: false as const, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_100_000, status: 'stopped' as const, firstPrompt: 'what is\n  up' };

  it('a readable room can be chosen and shows its status and first prompt', () => {
    const option = roomListOption(readable);
    expect(option.id).toBe('r1');
    expect(option.disabled).toBe(false);
    expect(option.label).toContain('stopped');
    expect(option.label).toContain('what is up');
    expect(option.label).not.toContain('\n');
  });

  it('an unreadable room is disabled and still identifiable', () => {
    const option = roomListOption({ id: 'broken-1', unreadable: true });
    expect(option.disabled).toBe(true);
    expect(option.label).toContain('broken-1');
  });

  it('a room with an empty prompt still has a label', () => {
    expect(roomListOption({ ...readable, firstPrompt: '' }).label.length).toBeGreaterThan(0);
  });
});

describe('participant row logic', () => {
  const models: RoomModels = {
    claude: { models: ['opus', 'sonnet'], efforts: ['low', 'high'] },
    codex: {
      models: [
        { id: 'gpt-a', efforts: ['low', 'medium'] },
        { id: 'gpt-b', efforts: ['medium', 'xhigh'] },
      ],
    },
  };

  it('adds a row of a CLI kind with the next free id and refuses a site kind', () => {
    const first = addRow(defaultRows(), 'claude');
    expect(first.map((row) => row.id)).toEqual(['claude', 'codex', 'claude-2']);
    expect(addRow(removeRow(first, 'claude'), 'claude').map((row) => row.id)).toEqual(['codex', 'claude-2', 'claude']);
    expect(addRow(first, 'grok')).toEqual(first);
  });

  it('removes only the row with that id', () => {
    expect(removeRow(addRow(defaultRows(), 'codex'), 'codex').map((row) => row.id)).toEqual(['claude', 'codex-2']);
    expect(removeRow(defaultRows(), 'nobody')).toEqual(defaultRows());
  });

  it('suggests models of the kind, and none for a site or when the CLI could not be read', () => {
    expect(modelSuggestions('claude', models)).toEqual(['opus', 'sonnet']);
    expect(modelSuggestions('codex', models)).toEqual(['gpt-a', 'gpt-b']);
    expect(modelSuggestions('grok', models)).toEqual([]);
    expect(modelSuggestions('claude')).toEqual([]);
  });

  it('claude offers its levels; codex offers the levels of the chosen model or the union when the model is unknown', () => {
    expect(effortChoices('claude', 'anything', '', models)).toEqual(['low', 'high']);
    expect(effortChoices('codex', 'gpt-b', '', models)).toEqual(['medium', 'xhigh']);
    expect(effortChoices('codex', ' gpt-a ', '', models)).toEqual(['low', 'medium']);
    expect(effortChoices('codex', 'my-own', '', models)).toEqual(['low', 'medium', 'xhigh']);
    expect(effortChoices('codex', '', '', models)).toEqual(['low', 'medium', 'xhigh']);
    expect(effortChoices('grok', '', '', models)).toEqual([]);
  });

  it('keeps a saved effort the CLI no longer lists, and offers nothing else when no levels are known', () => {
    expect(effortChoices('claude', '', 'ultra', models)).toEqual(['low', 'high', 'ultra']);
    expect(effortChoices('claude', '', 'high', models)).toEqual(['low', 'high']);
    expect(effortChoices('claude', '', '')).toEqual([]);
    expect(effortChoices('codex', 'x', 'high')).toEqual(['high']);
  });

  it('lists the finalizer candidates by instance label in row order, sites last', () => {
    const rows = [
      { id: 'claude', kind: 'claude' as const, model: 'opus', effort: 'high' },
      { id: 'claude-2', kind: 'claude' as const },
    ];
    expect(finalizerChoices(['grok', 'claude-2', 'claude'], rows)).toEqual([
      { id: 'claude', label: 'Claude Code · opus · high' },
      { id: 'claude-2', label: 'Claude Code' },
      { id: 'grok', label: 'Grok' },
    ]);
    expect(finalizerChoices(['codex']).map((item) => item.id)).toEqual(['codex']);
  });
});
