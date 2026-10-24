// git.ts
import { execFile } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';

export interface ExecOptions {
  cwd?: string;
  env: NodeJS.ProcessEnv;
  maxBuffer?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export class ExecFailure extends Error {
  constructor(message: string, readonly code: string | number | undefined, readonly stderr: string) {
    super(message);
  }
}

export type ExecFn = (file: string, args: string[], options: ExecOptions) => Promise<ExecResult>;

export interface GitConfig {
  platform: string;
  gitBinary: string;
  xcodeSelectBinary: string;
  hooksDir: string;
  env: Readonly<Record<string, string | undefined>>;
  exec?: ExecFn;
  exists?: (file: string) => Promise<boolean>;
}

export type GitOutcome = { ok: true; output: string } | { ok: false; error: string };
export type ListOutcome = { ok: true; paths: string[] } | { ok: false; error: string };

interface CallOptions {
  raw?: boolean;
  maxBuffer?: number;
}

const EXEC_TIMEOUT_MS = 30_000;
const EXEC_MAX_BUFFER = 1024 * 1024;
const LIST_MAX_BUFFER = 16 * 1024 * 1024;
const MAX_ERROR_CHARS = 300;
const TOOLS_HINT = 'Git needs the macOS Command Line Tools: run "xcode-select --install" in Terminal, then try again.';

export function defaultGitPaths(platform: string): { gitBinary: string; xcodeSelectBinary: string } {
  return platform === 'darwin'
    ? { gitBinary: '/usr/bin/git', xcodeSelectBinary: '/usr/bin/xcode-select' }
    : { gitBinary: 'git', xcodeSelectBinary: 'xcode-select' };
}

const defaultExec: ExecFn = (file, args, options) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { cwd: options.cwd, env: options.env, timeout: EXEC_TIMEOUT_MS, maxBuffer: options.maxBuffer ?? EXEC_MAX_BUFFER, windowsHide: true },
      (error, stdout, stderr) => {
        if (error === null) resolve({ stdout, stderr });
        else reject(new ExecFailure(error.message, (error as NodeJS.ErrnoException).code, stderr));
      },
    );
  });

async function defaultExists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

export class GitRunner {
  private version: string | null = null;

  constructor(private readonly config: GitConfig) {}

  async available(): Promise<GitOutcome> {
    if (this.version !== null) return { ok: true, output: this.version };
    if (this.config.platform === 'darwin' && !(await this.toolsInstalled())) return { ok: false, error: TOOLS_HINT };
    const ran = await this.run(['--version']);
    if (ran.ok) this.version = ran.output;
    return ran;
  }

  async init(folder: string): Promise<GitOutcome> {
    const ready = await this.available();
    return ready.ok ? this.run(['init'], folder) : ready;
  }

  async listFiles(folder: string): Promise<ListOutcome> {
    const ready = await this.available();
    if (!ready.ok) return ready;
    const listed = await this.run(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'], folder, { raw: true, maxBuffer: LIST_MAX_BUFFER });
    return listed.ok ? { ok: true, paths: [...new Set(listed.output.split('\0').filter((entry) => entry !== ''))] } : listed;
  }

  private async toolsInstalled(): Promise<boolean> {
    const tools = await this.call(this.config.xcodeSelectBinary, ['-p']);
    if (!tools.ok || tools.output.length === 0) return false;
    return (this.config.exists ?? defaultExists)(path.join(tools.output, 'usr', 'bin', 'git'));
  }

  private async run(args: string[], cwd?: string, options: CallOptions = {}): Promise<GitOutcome> {
    await mkdir(this.config.hooksDir, { recursive: true });
    const hardened = ['-c', `core.hooksPath=${this.config.hooksDir}`, '-c', 'core.fsmonitor=false', ...args];
    return this.call(this.config.gitBinary, hardened, cwd, options);
  }

  private async call(file: string, args: string[], cwd?: string, options: CallOptions = {}): Promise<GitOutcome> {
    const env = { ...this.config.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };
    try {
      const { stdout } = await (this.config.exec ?? defaultExec)(file, args, { cwd, env, maxBuffer: options.maxBuffer });
      return { ok: true, output: options.raw === true ? stdout : stdout.trim() };
    } catch (error) {
      return { ok: false, error: describeFailure(file, error) };
    }
  }
}

function describeFailure(file: string, error: unknown): string {
  const failure = error instanceof ExecFailure ? error : new ExecFailure(error instanceof Error ? error.message : String(error), undefined, '');
  if (failure.code === 'ENOENT') return `Git was not found (${file}). Install git and try again.`;
  const reason = failure.stderr.trim() || failure.message;
  return `Git failed: ${reason.slice(0, MAX_ERROR_CHARS)}`;
}
