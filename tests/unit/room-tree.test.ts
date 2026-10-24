// room-tree.test.ts
import { describe, expect, it } from 'vitest';
import type { RoomListItem } from '../../src/shared/room-model';
import { nextRoomAfterDelete, renameTitle, roomTreeRows } from '../../src/shared/room-view';

const readable = (id: string, title: string, projectId: string | null = null): RoomListItem => ({
  id,
  projectId,
  unreadable: false,
  createdAt: 1,
  updatedAt: 2,
  status: 'done',
  firstPrompt: 'prompt',
  title,
});

describe('roomTreeRows', () => {
  it('keeps the order of the list and takes the label from the title', () => {
    const rows = roomTreeRows([readable('a', 'Alpha'), readable('b', 'Beta')], null);
    expect(rows.map((row) => [row.id, row.label])).toEqual([
      ['a', 'Alpha'],
      ['b', 'Beta'],
    ]);
  });

  it('marks only the opened room as current', () => {
    const rows = roomTreeRows([readable('a', 'Alpha'), readable('b', 'Beta')], 'b');
    expect(rows.map((row) => row.current)).toEqual([false, true]);
    expect(roomTreeRows([readable('a', 'Alpha')], 'missing').some((row) => row.current)).toBe(false);
  });

  it('an unreadable record stays identifiable, cannot be opened or renamed', () => {
    const [row] = roomTreeRows([{ id: 'broken-1', projectId: null, unreadable: true }], 'broken-1');
    expect(row?.label).toContain('broken-1');
    expect(row?.unreadable).toBe(true);
    expect(row?.current).toBe(false);
  });

  it('carries the project of every room, readable or not', () => {
    const rows = roomTreeRows([readable('a', 'Alpha', 'p1'), readable('b', 'Beta'), { id: 'u', projectId: 'p2', unreadable: true }], null);
    expect(rows.map((row) => [row.id, row.projectId])).toEqual([
      ['a', 'p1'],
      ['b', null],
      ['u', 'p2'],
    ]);
  });

  it('shows markup in a title as plain characters of the label', () => {
    const [row] = roomTreeRows([readable('a', '<img src=x onerror=alert(1)>')], null);
    expect(row?.label).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('renameTitle', () => {
  it('returns the trimmed new title', () => {
    expect(renameTitle('Old', '  New name  ')).toBe('New name');
  });

  it('refuses an unchanged, empty or whitespace title', () => {
    expect(renameTitle('Old', 'Old')).toBeNull();
    expect(renameTitle('Old', '  Old ')).toBeNull();
    expect(renameTitle('Old', '')).toBeNull();
    expect(renameTitle('Old', '   ')).toBeNull();
  });

  it('refuses a title over 80 characters or with a control character', () => {
    expect(renameTitle('Old', 'x'.repeat(81))).toBeNull();
    expect(renameTitle('Old', 'x'.repeat(80))).toBe('x'.repeat(80));
    expect(renameTitle('Old', 'bad\u0007title')).toBeNull();
  });
});

describe('nextRoomAfterDelete', () => {
  const unreadable: RoomListItem = { id: 'u', projectId: null, unreadable: true };

  it('picks the next readable room, else the previous one, else nothing', () => {
    const list = [readable('a', 'A'), readable('b', 'B'), unreadable, readable('c', 'C')];
    expect(nextRoomAfterDelete(list, 'a')).toBe('b');
    expect(nextRoomAfterDelete(list, 'b')).toBe('c');
    expect(nextRoomAfterDelete(list, 'c')).toBe('b');
    expect(nextRoomAfterDelete([readable('a', 'A'), unreadable], 'a')).toBeNull();
    expect(nextRoomAfterDelete([readable('a', 'A')], 'a')).toBeNull();
    expect(nextRoomAfterDelete(list, 'missing')).toBeNull();
  });

  it('looks only among the rooms of the same project', () => {
    const list = [readable('a', 'A', 'p1'), readable('b', 'B'), readable('c', 'C', 'p1'), readable('d', 'D', 'p2')];
    expect(nextRoomAfterDelete(list, 'a')).toBe('c');
    expect(nextRoomAfterDelete(list, 'c')).toBe('a');
    expect(nextRoomAfterDelete(list, 'b')).toBeNull();
    expect(nextRoomAfterDelete(list, 'd')).toBeNull();
  });
});
