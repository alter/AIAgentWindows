// pack-fit.test.ts
import { describe, expect, it } from 'vitest';
import { fitPack } from '../../src/shared/pack-fit';
import type { RoomEntry } from '../../src/shared/room-model';

function entry(kind: RoomEntry['kind'], text: string, time: number): RoomEntry {
  return { authorId: kind === 'prompt' ? 'owner' : 'a', label: 'A', time, kind, text };
}

const BASE = 100;
const size = (item: RoomEntry): number => item.text.length;

function fit(budget: number, map: string, entries: RoomEntry[]): ReturnType<typeof fitPack> {
  return fitPack({ budget, map, entries, base: BASE, blockSize: size });
}

describe('fitPack', () => {
  const history = [entry('prompt', 'p'.repeat(100), 1), entry('reply', 'r'.repeat(200), 2), entry('reply', 's'.repeat(200), 3)];

  it('changes nothing when the map and the history fit', () => {
    const result = fit(1000, 'm'.repeat(300), history);
    expect(result).toEqual({ map: 'm'.repeat(300), entries: history, cutEntries: 0, cutMapChars: 0 });
  });

  it('shrinks the map before it touches the history', () => {
    const result = fit(800, 'm'.repeat(400), history);
    expect(result.entries).toEqual(history);
    expect(result.cutEntries).toBe(0);
    expect(result.map.length).toBeLessThan(400);
    expect(result.map.length).toBeGreaterThan(0);
    expect(result.cutMapChars).toBe(400 - result.map.length);
  });

  it('cuts the oldest history entries once the map is down to its floor, and keeps the latest prompt', () => {
    const long = [entry('reply', 'x'.repeat(300), 1), entry('prompt', 'p'.repeat(100), 2), entry('reply', 'r'.repeat(300), 3), entry('reply', 's'.repeat(300), 4)];
    const result = fit(600, 'm'.repeat(400), long);
    expect(result.entries.map((item) => item.time)).toEqual([2, 4]);
    expect(result.cutEntries).toBe(2);
    expect(result.entries.some((item) => item.kind === 'prompt')).toBe(true);
  });

  it('keeps the latest prompt even when it alone is over the budget, and drops the map', () => {
    const result = fit(50, 'm'.repeat(400), [entry('reply', 'x'.repeat(300), 1), entry('prompt', 'p'.repeat(300), 2)]);
    expect(result.entries.map((item) => item.kind)).toEqual(['prompt']);
    expect(result.map).toBe('');
    expect(result.cutMapChars).toBe(400);
    expect(result.cutEntries).toBe(1);
  });

  it('cuts from the oldest end when there is no prompt entry at all', () => {
    const result = fit(400, '', [entry('reply', 'x'.repeat(300), 1), entry('reply', 'y'.repeat(300), 2)]);
    expect(result.entries.map((item) => item.time)).toEqual([2]);
  });

  it('takes the rest of the map away when the history that must stay leaves less room than the map floor', () => {
    const result = fit(1000, 'm'.repeat(2000), [entry('prompt', 'p'.repeat(700), 1)]);
    expect(result.entries).toHaveLength(1);
    expect(BASE + 700 + result.map.length).toBeLessThanOrEqual(1000);
    expect(result.map.length).toBeGreaterThan(0);
    const none = fit(850, 'm'.repeat(2000), [entry('prompt', 'p'.repeat(700), 1)]);
    expect(none.map).toBe('');
  });

  it('handles an empty map and an empty history', () => {
    expect(fit(10, '', [])).toEqual({ map: '', entries: [], cutEntries: 0, cutMapChars: 0 });
  });

  it('never returns a map longer than the room it was given', () => {
    const result = fit(500, 'm'.repeat(2000), [entry('prompt', 'p'.repeat(50), 1)]);
    expect(BASE + 50 + result.map.length).toBeLessThanOrEqual(500);
  });
});
