// cli-args.ts
import { isUuid, type CliKind } from './agents';
import { freeRoomProfile, WEB_TOOLS, type TurnProfile } from './turn-profile';

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

const CLAUDE_BASE_ARGS: readonly string[] = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode'];
const CLAUDE_NO_MCP_ARGS: readonly string[] = ['--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disallowedTools', 'mcp__*'];
const CODEX_BASE_ARGS: readonly string[] = ['exec'];
const CODEX_SANDBOX_ARGS: readonly string[] = ['--sandbox', 'read-only'];
const CODEX_RUN_ARGS: readonly string[] = ['--skip-git-repo-check', '--json'];
const FORBIDDEN_FLAGS: readonly string[] = [
  '--dangerously-skip-permissions',
  '--allow-dangerously-skip-permissions',
  '--dangerously-bypass-approvals-and-sandbox',
  '--dangerously-bypass-hook-trust',
  '--yolo',
];
const FORBIDDEN_PREFIX = '--dangerously-';
const FORBIDDEN_MODE = 'bypasspermissions';
const MODE_FLAG = '--permission-mode';

export function forbiddenRoomArg(args: readonly string[]): string | null {
  for (const [index, arg] of args.entries()) {
    if (FORBIDDEN_FLAGS.includes(arg) || arg.startsWith(FORBIDDEN_PREFIX)) return arg;
    if (arg.toLowerCase() === FORBIDDEN_MODE) return arg;
    if (args[index - 1] === MODE_FLAG && arg !== 'plan') return arg;
  }
  return null;
}

function allowsWeb(profile: TurnProfile): boolean {
  return profile.tools.some((tool) => WEB_TOOLS.includes(tool));
}

function claudeRoomArgs(profile: TurnProfile, options: SpawnOptions): string[] {
  const web = profile.tools.filter((tool) => WEB_TOOLS.includes(tool));
  return [
    ...CLAUDE_BASE_ARGS,
    profile.mode,
    ...(profile.isolation === 'project' ? ['--restricted'] : []),
    '--tools',
    profile.tools.join(','),
    ...(web.length > 0 ? ['--allowedTools', web.join(',')] : []),
    ...CLAUDE_NO_MCP_ARGS,
    ...(profile.denyRead.length > 0 ? ['--settings', JSON.stringify({ permissions: { deny: [...profile.denyRead] } })] : []),
    ...(profile.name === undefined ? [] : ['-n', profile.name]),
    ...claudeChoice(options),
    ...profile.extraDirs.flatMap((dir) => ['--add-dir', dir]),
    ...sessionFlag(options),
  ];
}

function codexRoomArgs(profile: TurnProfile, options: SpawnOptions): string[] {
  const project = profile.isolation === 'project';
  const resume = options.resume ? ['resume', requireSessionId(options.sessionId)] : [];
  return [
    ...CODEX_BASE_ARGS,
    ...(project ? ['--ignore-user-config'] : []),
    ...CODEX_SANDBOX_ARGS,
    '-c',
    `web_search="${allowsWeb(profile) ? 'live' : 'disabled'}"`,
    ...(project ? ['-c', 'features.plugins=false'] : []),
    ...CODEX_RUN_ARGS,
    ...codexChoice(options),
    ...resume,
    PROMPT_FROM_STDIN,
  ];
}

function roomCliArgs(kind: CliKind, options: SpawnOptions, profile: TurnProfile): string[] {
  if (profile.mode !== 'plan') throw new Error('a room turn runs in plan mode only');
  const args = kind === 'claude' ? claudeRoomArgs(profile, options) : codexRoomArgs(profile, options);
  const forbidden = forbiddenRoomArg(args);
  if (forbidden !== null) throw new Error(`a room turn never passes ${forbidden}`);
  return args;
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

const ROOM_ENV: Readonly<Record<string, string>> = { GIT_OPTIONAL_LOCKS: '0' };

export function buildRoomTurnSpawn(kind: CliKind, options: SpawnOptions, profile: TurnProfile = freeRoomProfile(options.sharedDir)): SpawnSpec {
  const spec = wrapSpec(kind, roomCliArgs(kind, options, profile), options);
  return { ...spec, env: { ...spec.env, ...ROOM_ENV } };
}

export function buildInfoSpawn(kind: CliKind, args: readonly string[], options: InfoOptions): SpawnSpec {
  return wrapSpec(kind, [...args], options);
}
