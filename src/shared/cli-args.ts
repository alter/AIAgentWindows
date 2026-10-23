// cli-args.ts
import { isUuid, type CliKind } from './agents';

export interface SpawnOptions {
  cwd: string;
  sessionId?: string;
  sharedDir: string;
  resume: boolean;
  platform: string;
  loginShell?: boolean;
  model?: string;
  effort?: string;
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
  '-p',
  '--output-format',
  'stream-json',
  '--verbose',
  '--permission-mode',
  'plan',
  '--tools',
  'Read,Grep,Glob,WebSearch,WebFetch',
  '--allowedTools',
  'WebSearch,WebFetch',
  '--strict-mcp-config',
  '--mcp-config',
  '{"mcpServers":{}}',
  '--disallowedTools',
  'mcp__*',
];
const ROOM_CODEX_ARGS: readonly string[] = [
  'exec',
  '--sandbox',
  'read-only',
  '-c',
  'web_search="live"',
  '--skip-git-repo-check',
  '--json',
];
const PROMPT_FROM_STDIN = '-';

function sessionFlag(options: SpawnOptions): string[] {
  return [options.resume ? '--resume' : '--session-id', requireSessionId(options.sessionId)];
}

function workingCliArgs(kind: CliKind, options: SpawnOptions): string[] {
  if (kind === 'claude') return [...sessionFlag(options), '--add-dir', options.sharedDir];
  return options.resume ? ['resume', requireSessionId(options.sessionId)] : [];
}

function claudeChoice(options: SpawnOptions): string[] {
  return [...(options.model ? ['--model', options.model] : []), ...(options.effort ? ['--effort', options.effort] : [])];
}

function codexChoice(options: SpawnOptions): string[] {
  return [
    ...(options.model ? ['-m', options.model] : []),
    ...(options.effort ? ['-c', `model_reasoning_effort="${options.effort}"`] : []),
  ];
}

function roomCliArgs(kind: CliKind, options: SpawnOptions): string[] {
  if (kind === 'claude') return [...ROOM_CLAUDE_ARGS, ...claudeChoice(options), '--add-dir', options.sharedDir, ...sessionFlag(options)];
  const resume = options.resume ? ['resume', requireSessionId(options.sessionId)] : [];
  return [...ROOM_CODEX_ARGS, ...codexChoice(options), ...resume, PROMPT_FROM_STDIN];
}

export type InfoOptions = Pick<SpawnOptions, 'cwd' | 'platform' | 'loginShell' | 'env'>;

function binaryFor(kind: CliKind, env: SpawnOptions['env']): string {
  const override = env[BIN_OVERRIDE[kind]];
  if (override) return override;
  if (env.AIAW_USER_DATA) {
    throw new Error(`test mode: ${BIN_OVERRIDE[kind]} must name the ${kind} binary, a real CLI is never started`);
  }
  return kind;
}

function wrapSpec(kind: CliKind, args: string[], options: InfoOptions): SpawnSpec {
  if (options.cwd.length === 0) throw new Error('cwd is required');
  const bin = binaryFor(kind, options.env);
  const env = childEnv(options.env);
  if (options.platform === 'win32' || options.loginShell === false) return { file: bin, args, cwd: options.cwd, env };
  const shell = options.env.SHELL || DEFAULT_SHELL;
  return {
    file: shell,
    args: ['-l', '-i', '-c', SHELL_SCRIPT, SHELL_ARG0, bin, ...args],
    cwd: options.cwd,
    env,
  };
}

export function buildSpawn(kind: CliKind, options: SpawnOptions): SpawnSpec {
  return wrapSpec(kind, workingCliArgs(kind, options), options);
}

export function buildRoomTurnSpawn(kind: CliKind, options: SpawnOptions): SpawnSpec {
  return wrapSpec(kind, roomCliArgs(kind, options), options);
}

export function buildInfoSpawn(kind: CliKind, args: readonly string[], options: InfoOptions): SpawnSpec {
  return wrapSpec(kind, [...args], options);
}
