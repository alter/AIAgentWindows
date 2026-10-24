// room-test-mode.test.ts
import { describe, expect, it } from 'vitest';
import { roomLoginShell, roomSiteOptions, roomTestMode, roomTimingOverride, testFolderPicker } from '../../src/shared/room-test-mode';

const TEST_MODE = { AIAW_USER_DATA: '/tmp/profile', AIAW_ROOM_FAST: '1' };

describe('room test-mode override', () => {
  it('is never active without AIAW_USER_DATA', () => {
    const env = { AIAW_ROOM_FAST: '1' };
    expect(roomTestMode(env)).toBe(false);
    expect(roomTimingOverride(env)).toBeUndefined();
  });

  it('is off in test mode unless asked for', () => {
    const env = { AIAW_USER_DATA: '/tmp/profile' };
    expect(roomTestMode(env)).toBe(false);
    expect(roomTimingOverride(env)).toBeUndefined();
  });

  it('shortens the grace before a stopped CLI process is killed outright in test mode', () => {
    expect(roomTestMode(TEST_MODE)).toBe(true);
    const timing = roomTimingOverride(TEST_MODE);
    expect(timing?.killGraceMs).toBeLessThan(3000);
    expect(timing).not.toHaveProperty('pollMs');
  });

  it('starts room CLI turns without the login shell only in test mode', () => {
    expect(roomLoginShell({})).toBe(true);
    expect(roomLoginShell({ AIAW_ROOM_FAST: '1' })).toBe(true);
    expect(roomLoginShell({ AIAW_USER_DATA: '/tmp/profile' })).toBe(true);
    expect(roomLoginShell(TEST_MODE)).toBe(false);
  });

  it('shortens the quiet window that ends a web turn only in test mode', () => {
    expect(roomSiteOptions({})).toBeUndefined();
    expect(roomSiteOptions({ AIAW_ROOM_FAST: '1' })).toBeUndefined();
    const options = roomSiteOptions(TEST_MODE);
    expect(options?.quietMs).toBeGreaterThan(0);
    expect(options?.quietMs).toBeLessThan(5000);
  });

  it('treats an empty AIAW_USER_DATA as normal mode', () => {
    expect(roomTestMode({ AIAW_USER_DATA: '', AIAW_ROOM_FAST: '1' })).toBe(false);
  });
});

describe('test folder answers', () => {
  it('has no picker when the variable is unset or empty', () => {
    expect(testFolderPicker({})).toBeNull();
    expect(testFolderPicker({ AIAW_TEST_FOLDER: '' })).toBeNull();
  });

  it('answers a plain path every time, as it always did', () => {
    const pick = testFolderPicker({ AIAW_TEST_FOLDER: '/tmp/one' });
    expect([pick?.(), pick?.(), pick?.()]).toEqual(['/tmp/one', '/tmp/one', '/tmp/one']);
  });

  it('answers a JSON list in order, then repeats the last answer', () => {
    const pick = testFolderPicker({ AIAW_TEST_FOLDER: JSON.stringify(['/tmp/a', '/tmp/b', '/tmp/c']) });
    expect([pick?.(), pick?.(), pick?.(), pick?.(), pick?.()]).toEqual(['/tmp/a', '/tmp/b', '/tmp/c', '/tmp/c', '/tmp/c']);
  });

  it('lets a list answer null for a cancelled dialog', () => {
    const pick = testFolderPicker({ AIAW_TEST_FOLDER: JSON.stringify([null, '/tmp/a']) });
    expect([pick?.(), pick?.()]).toEqual([null, '/tmp/a']);
  });

  it('keeps one list per call of testFolderPicker', () => {
    const env = { AIAW_TEST_FOLDER: JSON.stringify(['/tmp/a', '/tmp/b']) };
    const first = testFolderPicker(env);
    const second = testFolderPicker(env);
    expect([first?.(), first?.(), second?.()]).toEqual(['/tmp/a', '/tmp/b', '/tmp/a']);
  });

  it('refuses a list that is not JSON, empty, or holds anything but strings and null', () => {
    expect(() => testFolderPicker({ AIAW_TEST_FOLDER: '[/tmp/a' })).toThrow();
    expect(() => testFolderPicker({ AIAW_TEST_FOLDER: '[]' })).toThrow();
    expect(() => testFolderPicker({ AIAW_TEST_FOLDER: '[1]' })).toThrow();
    expect(() => testFolderPicker({ AIAW_TEST_FOLDER: '[""]' })).toThrow();
  });
});
