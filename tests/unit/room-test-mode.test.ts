// room-test-mode.test.ts
import { describe, expect, it } from 'vitest';
import { roomChildEnv, roomTestMode, roomTimingOverride } from '../../src/shared/room-test-mode';

const TEST_MODE = { AIAW_USER_DATA: '/tmp/profile', AIAW_ROOM_FAST: '1' };

describe('room test-mode override', () => {
  it('is never active without AIAW_USER_DATA', () => {
    const env = { AIAW_ROOM_FAST: '1' };
    expect(roomTestMode(env)).toBe(false);
    expect(roomTimingOverride(env)).toBeUndefined();
    expect(roomChildEnv(env, 'claude')).toBe(env);
  });

  it('is off in test mode unless asked for', () => {
    const env = { AIAW_USER_DATA: '/tmp/profile' };
    expect(roomTestMode(env)).toBe(false);
    expect(roomTimingOverride(env)).toBeUndefined();
  });

  it('shortens the room timing and marks the stub transcript kind in test mode', () => {
    expect(roomTestMode(TEST_MODE)).toBe(true);
    const timing = roomTimingOverride(TEST_MODE);
    expect(timing?.pollMs).toBeLessThan(250);
    expect(timing).not.toHaveProperty('quietMs');
    expect(roomChildEnv(TEST_MODE, 'codex')).toMatchObject({ AIAW_STUB_TRANSCRIPT: 'codex', AIAW_USER_DATA: '/tmp/profile' });
  });

  it('treats an empty AIAW_USER_DATA as normal mode', () => {
    expect(roomTestMode({ AIAW_USER_DATA: '', AIAW_ROOM_FAST: '1' })).toBe(false);
  });
});
