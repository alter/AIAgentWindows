// room-test-mode.ts
export const ROOM_FAST_ENV = 'AIAW_ROOM_FAST';

export interface RoomTimingOverride {
  killGraceMs: number;
}

export interface RoomSiteOptions {
  quietMs: number;
}

type Env = Readonly<Record<string, string | undefined>>;

const FAST_SITE: RoomSiteOptions = {
  quietMs: 400,
};

const FAST_TIMING: RoomTimingOverride = {
  killGraceMs: 300,
};

export function roomTestMode(env: Env): boolean {
  return (env['AIAW_USER_DATA'] ?? '').length > 0 && env[ROOM_FAST_ENV] === '1';
}

export function roomLoginShell(env: Env): boolean {
  return !roomTestMode(env);
}

export function roomTimingOverride(env: Env): RoomTimingOverride | undefined {
  return roomTestMode(env) ? { ...FAST_TIMING } : undefined;
}

export function roomSiteOptions(env: Env): RoomSiteOptions | undefined {
  return roomTestMode(env) ? { ...FAST_SITE } : undefined;
}
