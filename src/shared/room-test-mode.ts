// room-test-mode.ts
export const ROOM_FAST_ENV = 'AIAW_ROOM_FAST';
export const TEST_FOLDER_ENV = 'AIAW_TEST_FOLDER';

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

export type TestFolderPicker = () => string | null;

function folderAnswers(raw: string): readonly (string | null)[] {
  if (!raw.startsWith('[')) return [raw];
  const parsed: unknown = JSON.parse(raw);
  const valid = Array.isArray(parsed) && parsed.length > 0 && parsed.every((answer) => answer === null || (typeof answer === 'string' && answer.length > 0));
  if (!valid) throw new Error(`${TEST_FOLDER_ENV} must be a path or a JSON list of paths and nulls`);
  return parsed as readonly (string | null)[];
}

export function testFolderPicker(env: Env): TestFolderPicker | null {
  const raw = env[TEST_FOLDER_ENV];
  if (raw === undefined || raw === '') return null;
  const answers = folderAnswers(raw);
  let next = 0;
  return () => {
    const answer = answers[Math.min(next, answers.length - 1)] ?? null;
    next += 1;
    return answer;
  };
}
