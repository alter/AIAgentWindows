// cli-models.test.ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createModelCatalog } from '../../src/main/cli-models';

const STUB = path.resolve(__dirname, '..', 'fixtures', 'stub-cli.mjs');

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'aiaw-models-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function catalog(extra: Record<string, string> = {}, timeoutMs?: number): ReturnType<typeof createModelCatalog> {
  return createModelCatalog({
    cwd: dir,
    platform: 'darwin',
    loginShell: false,
    timeoutMs,
    env: { PATH: process.env.PATH, AIAW_USER_DATA: dir, AIAW_CLAUDE_BIN: STUB, AIAW_CODEX_BIN: STUB, ...extra },
  });
}

describe('model catalog from the stub CLIs', () => {
  it('offers the aliases and levels of the claude help and the visible codex models', async () => {
    const models = await catalog()();
    expect(models.claude).toEqual({ models: ['fable', 'opus', 'sonnet'], efforts: ['low', 'medium', 'high', 'xhigh', 'max'] });
    expect(models.codex.models.map((model) => model.id)).toEqual(['stub-gpt-a', 'stub-gpt-b']);
    expect(models.codex.models[1]?.efforts).toContain('ultra');
  });

  it('starts each CLI once per catalog however often it is asked', async () => {
    const log = path.join(dir, 'argv.log');
    const read = catalog({ AIAW_STUB_ARGV_LOG: log });
    const first = await read();
    const second = await read();
    expect(second).toBe(first);
    const lines = readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { argv: string[] });
    expect(lines.map((line) => line.argv)).toEqual(expect.arrayContaining([['--help'], ['debug', 'models']]));
    expect(lines).toHaveLength(2);
  });

  it('reads the catalog through start-up noise', async () => {
    const models = await catalog({ AIAW_STUB_NOISE: '1' })();
    expect(models.codex.models).toHaveLength(2);
    expect(models.claude.models).toContain('opus');
  });

  it('leaves the suggestions empty when a CLI hangs past the timeout', async () => {
    const started = Date.now();
    const models = await catalog({ AIAW_STUB_HANG: '1' }, 300)();
    expect(models).toEqual({ claude: { models: [], efforts: [] }, codex: { models: [] } });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('leaves the suggestions empty when the binary is missing or test mode names none', async () => {
    const missing = path.join(dir, 'no-such-binary');
    expect(await catalog({ AIAW_CLAUDE_BIN: missing, AIAW_CODEX_BIN: missing })()).toEqual({ claude: { models: [], efforts: [] }, codex: { models: [] } });
    const unnamed = createModelCatalog({ cwd: dir, platform: 'darwin', loginShell: false, env: { PATH: process.env.PATH, AIAW_USER_DATA: dir } });
    expect(await unnamed()).toEqual({ claude: { models: [], efforts: [] }, codex: { models: [] } });
  });
});
