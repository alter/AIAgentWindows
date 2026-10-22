// stub-print.test.ts
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const STUB = path.resolve(__dirname, '..', 'fixtures', 'stub-cli.mjs');

let cwd: string;
let home: string;

beforeEach(() => {
  cwd = mkdtempSync(path.join(os.tmpdir(), 'aiaw-stub-cwd-'));
  home = mkdtempSync(path.join(os.tmpdir(), 'aiaw-stub-home-'));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

function run(args: string[], env: Record<string, string>): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [STUB, ...args], { cwd, input: 'hello', encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env } });
}

describe('stub print mode session directory', () => {
  it('claude without CLAUDE_CONFIG_DIR refuses to run and leaves nothing in its cwd', () => {
    const result = run(['-p', '--session-id', randomUUID()], {});
    expect(result.status).not.toBe(0);
    expect(readdirSync(cwd)).toEqual([]);
  });

  it('codex without CODEX_HOME refuses to run and leaves nothing in its cwd', () => {
    const result = run(['exec', '--skip-git-repo-check', '--json', '-'], {});
    expect(result.status).not.toBe(0);
    expect(readdirSync(cwd)).toEqual([]);
  });

  it('with an explicit directory the sessions go there and not into the cwd', () => {
    const result = run(['-p', '--session-id', randomUUID()], { CLAUDE_CONFIG_DIR: home });
    expect(result.status).toBe(0);
    expect(readdirSync(cwd)).toEqual([]);
    expect(readdirSync(home)).toEqual(['stub-sessions']);
  });
});
