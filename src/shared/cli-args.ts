// cli-args.ts
import { isUuid, type CliKind } from './agents';

export interface SpawnOptions {
  cwd: string;
  sessionId?: string;
  sharedDir: string;
  resume: boolean;
  platform: string;
  env: Readonly<Record<string, string | undefined>>;
}

export interface SpawnSpec {
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

const DEFAULT_SHELL = '/bin/zsh';
const SHELL_SCRIPT = 'exec "$@"';
const SHELL_ARG0 = 'agent-shell';
const BIN_OVERRIDE: Readonly<Record<CliKind, string>> = {
  claude: 'AIAW_CLAUDE_BIN',
  codex: 'AIAW_CODEX_BIN',
};

function childEnv(env: SpawnOptions['env']): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && key !== 'CLAUDE_CODE_CHILD_SESSION') result[key] = value;
  }
  return result;
}

function requireSessionId(sessionId: string | undefined): string {
  if (!isUuid(sessionId)) throw new Error('a valid session id is required');
  return sessionId;
}

const ROOM_CLAUDE_ARGS: readonly string[] = [
  '--permission-mode',
  'plan',
  '--disallowedTools',
  'Bash Edit Write NotebookEdit ExitPlanMode',
];
const ROOM_CODEX_ARGS: readonly string[] = [
  '--sandbox',
  'read-only',
  '--ask-for-approval',
  'never',
  '--no-daemon',
  '-c',
  'check_for_update_on_startup=false',
];

function cliArgs(kind: CliKind, options: SpawnOptions, room: boolean): string[] {
  if (kind === 'claude') {
    const flag = options.resume ? '--resume' : '--session-id';
    const base = [flag, requireSessionId(options.sessionId), '--add-dir', options.sharedDir];
    return room ? [...ROOM_CLAUDE_ARGS, ...base] : base;
  }
  const base = options.resume ? ['resume', requireSessionId(options.sessionId)] : [];
  return room ? [...ROOM_CODEX_ARGS, ...base] : base;
}

function binaryFor(kind: CliKind, env: SpawnOptions['env']): string {
  const override = env[BIN_OVERRIDE[kind]];
  if (override) return override;
  if (env.AIAW_USER_DATA) {
    throw new Error(`test mode: ${BIN_OVERRIDE[kind]} must name the ${kind} binary, a real CLI is never started`);
  }
  return kind;
}

function spawnSpec(kind: CliKind, options: SpawnOptions, room: boolean): SpawnSpec {
  if (options.cwd.length === 0) throw new Error('cwd is required');
  const bin = binaryFor(kind, options.env);
  const args = cliArgs(kind, options, room);
  const env = childEnv(options.env);
  if (options.platform === 'win32') return { file: bin, args, cwd: options.cwd, env };
  const shell = options.env.SHELL || DEFAULT_SHELL;
  return {
    file: shell,
    args: ['-l', '-i', '-c', SHELL_SCRIPT, SHELL_ARG0, bin, ...args],
    cwd: options.cwd,
    env,
  };
}

export function buildSpawn(kind: CliKind, options: SpawnOptions): SpawnSpec {
  return spawnSpec(kind, options, false);
}

export function buildRoomSpawn(kind: CliKind, options: SpawnOptions): SpawnSpec {
  return spawnSpec(kind, options, true);
}
