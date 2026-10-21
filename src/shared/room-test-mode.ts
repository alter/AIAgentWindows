// room-test-mode.ts
export const ROOM_FAST_ENV = 'AIAW_ROOM_FAST';

export interface RoomTimingOverride {
  startMaxMs: number;
  pollMs: number;
  settleMs: number;
  submitDelayMs: number;
  killWaitMs: number;
}

type Env = Readonly<Record<string, string | undefined>>;

const FAST_TIMING: RoomTimingOverride = {
  startMaxMs: 10000,
  pollMs: 50,
  settleMs: 100,
  submitDelayMs: 50,
  killWaitMs: 3000,
};

export function roomTestMode(env: Env): boolean {
  return (env['AIAW_USER_DATA'] ?? '').length > 0 && env[ROOM_FAST_ENV] === '1';
}

export function roomTimingOverride(env: Env): RoomTimingOverride | undefined {
  return roomTestMode(env) ? { ...FAST_TIMING } : undefined;
}

export function roomChildEnv(env: Env, kind: string): Env {
  if (!roomTestMode(env)) return env;
  return { ...env, AIAW_STUB_TRANSCRIPT: kind };
}
