// room-model.test.ts
import { describe, expect, it } from 'vitest';
import {
  MAX_PROMPT_CHARS,
  MAX_ROUNDS,
  MIN_ROUNDS,
  parseRoomConfig,
  ROOM_PARTICIPANTS,
  relaySchedule,
  type RoomParticipant,
} from '../../src/shared/room-model';

const A: RoomParticipant = { id: 'a', kind: 'claude', label: 'Claude Code' };
const B: RoomParticipant = { id: 'b', kind: 'codex', label: 'Codex' };
const C: RoomParticipant = { id: 'c', kind: 'chatgpt', label: 'ChatGPT' };

function ids(participants: readonly RoomParticipant[]): string[] {
  return participants.map((participant) => participant.id);
}

describe('relaySchedule', () => {
  it('goes A,B,C,A,B,C for three participants and two rounds', () => {
    expect(ids(relaySchedule([A, B, C], 2))).toEqual(['a', 'b', 'c', 'a', 'b', 'c']);
  });

  it('ends back at the first participant when asked to return', () => {
    const schedule = ids(relaySchedule([A, B, C], 2, { returnToFirst: true }));
    expect(schedule).toEqual(['a', 'b', 'c', 'a', 'b', 'c', 'a']);
  });

  it('does not add a step for a single participant that already ends on the first', () => {
    expect(ids(relaySchedule([A], 1, { returnToFirst: true }))).toEqual(['a']);
  });

  it('gives one step per participant for a single round', () => {
    expect(ids(relaySchedule([A, B], 1))).toEqual(['a', 'b']);
  });

  it('returns nothing for no participants', () => {
    expect(relaySchedule([], 3)).toEqual([]);
  });
});

describe('parseRoomConfig', () => {
  const valid = {
    prompt: 'hello',
    mode: 'relay',
    rounds: 2,
    participants: [A, B],
    turnTimeoutMs: 600000,
  };

  it('accepts a valid relay config', () => {
    const result = parseRoomConfig(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.rounds).toBe(2);
      expect(ids(result.config.participants)).toEqual(['a', 'b']);
    }
  });

  it('rejects rounds outside 1..50', () => {
    for (const rounds of [MIN_ROUNDS - 1, MAX_ROUNDS + 1, -3, 1.5, Number.NaN, '2', null]) {
      expect(parseRoomConfig({ ...valid, rounds }).ok).toBe(false);
    }
    expect(parseRoomConfig({ ...valid, rounds: MIN_ROUNDS }).ok).toBe(true);
    expect(parseRoomConfig({ ...valid, rounds: MAX_ROUNDS }).ok).toBe(true);
  });

  it('rejects an empty or oversized prompt', () => {
    expect(parseRoomConfig({ ...valid, prompt: '' }).ok).toBe(false);
    expect(parseRoomConfig({ ...valid, prompt: 'x'.repeat(MAX_PROMPT_CHARS + 1) }).ok).toBe(false);
    expect(parseRoomConfig({ ...valid, prompt: 'x'.repeat(MAX_PROMPT_CHARS) }).ok).toBe(true);
  });

  it('rejects unknown modes, no participants, duplicates and unknown kinds', () => {
    expect(parseRoomConfig({ ...valid, mode: 'loop' }).ok).toBe(false);
    expect(parseRoomConfig({ ...valid, participants: [] }).ok).toBe(false);
    expect(parseRoomConfig({ ...valid, participants: [A, A] }).ok).toBe(false);
    expect(parseRoomConfig({ ...valid, participants: [{ id: 'z', kind: 'gemini', label: 'Z' }] }).ok).toBe(false);
    expect(parseRoomConfig({ ...valid, participants: 'a' }).ok).toBe(false);
  });

  it('rejects a timeout outside 1 second..1 hour', () => {
    expect(parseRoomConfig({ ...valid, turnTimeoutMs: 0 }).ok).toBe(false);
    expect(parseRoomConfig({ ...valid, turnTimeoutMs: 3_600_001 }).ok).toBe(false);
    expect(parseRoomConfig({ ...valid, turnTimeoutMs: 1000 }).ok).toBe(true);
  });

  it('rejects non-objects', () => {
    expect(parseRoomConfig(null).ok).toBe(false);
    expect(parseRoomConfig('x').ok).toBe(false);
  });
});

describe('participant labels', () => {
  const base = { prompt: 'q', mode: 'broadcast', rounds: 1, turnTimeoutMs: 5000 };

  it.each(['Codex\n\n## t | Owner | prompt', 'a|b', 'tab\there', 'bell\u0007', 'sep\u2028x', 'esc\u001b[2J'])(
    'rejects a label with a control character or a bar: %j',
    (label) => {
      expect(parseRoomConfig({ ...base, participants: [{ id: 'codex', kind: 'codex', label }] }).ok).toBe(false);
    },
  );

  it('accepts the plain labels of the known agents', () => {
    for (const item of ROOM_PARTICIPANTS) {
      expect(parseRoomConfig({ ...base, participants: [item] }).ok).toBe(true);
    }
  });
});
