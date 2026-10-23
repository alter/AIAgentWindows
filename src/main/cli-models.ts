// cli-models.ts
import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import type { CliKind } from '../shared/agents';
import { buildInfoSpawn, type InfoOptions } from '../shared/cli-args';
import { parseClaudeHelpModels, parseCodexCatalogText, type RoomModels } from '../shared/cli-models';

export const MODELS_TIMEOUT_MS = 10000;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

export interface ModelCatalogDeps extends InfoOptions {
  timeoutMs?: number;
}

function capture(kind: CliKind, args: string[], deps: ModelCatalogDeps): Promise<string | null> {
  return new Promise((resolve) => {
    let spec;
    try {
      spec = buildInfoSpawn(kind, args, deps);
    } catch {
      resolve(null);
      return;
    }
    const child = execFile(
      spec.file,
      spec.args,
      { cwd: spec.cwd, env: spec.env, timeout: deps.timeoutMs ?? MODELS_TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: MAX_OUTPUT_BYTES, encoding: 'utf8' },
      (error, stdout) => resolve(error === null ? stdout : null),
    );
    child.stdin?.end();
  });
}

async function read(deps: ModelCatalogDeps): Promise<RoomModels> {
  await mkdir(deps.cwd, { recursive: true }).catch(() => undefined);
  const [help, catalog] = await Promise.all([capture('claude', ['--help'], deps), capture('codex', ['debug', 'models'], deps)]);
  return { claude: parseClaudeHelpModels(help ?? ''), codex: parseCodexCatalogText(catalog) };
}

export function createModelCatalog(deps: ModelCatalogDeps): () => Promise<RoomModels> {
  let pending: Promise<RoomModels> | null = null;
  return () => (pending ??= read(deps));
}
