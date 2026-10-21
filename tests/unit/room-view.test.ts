// room-view.test.ts
import { describe, expect, it } from 'vitest';
import { AGENT_KINDS, AGENT_LABELS } from '../../src/shared/agents';
import type { RoomEntry, RoomEvent } from '../../src/shared/room-model';
import { ROOM_PARTICIPANTS } from '../../src/shared/room-model';
import {
  applyRoomEvent,
  carryText,
  emptyRoomSnapshot,
  formToConfig,
  type RoomFormValues,
} from '../../src/shared/room-view';

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

describe('applyRoomEvent', () => {
  it('starts idle and empty', () => {
    expect(emptyRoomSnapshot()).toEqual({
      phase: 'idle',
      roomId: null,
      historyPath: null,
      entries: [],
      running: [],
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

  it('broadcast ignores the rounds field', () => {
    const result = formToConfig({ ...form, mode: 'broadcast', rounds: 'junk' });
    expect(result.ok && result.config.rounds).toBe(1);
  });
});
