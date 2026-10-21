// claude-transcripts.test.ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { claudeConfigDir, claudeTranscriptExists } from '../../src/main/claude-transcripts';

const SESSION = '0199a1b2-c3d4-7e5f-8a6b-9c2d3e4f5a6b';
const OTHER = '0199a1b2-c3d4-7e5f-8a6b-1c2d3e4f5a6b';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'aiaw-transcripts-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('claudeTranscriptExists', () => {
  it('finds the transcript in any project directory under CLAUDE_CONFIG_DIR', async () => {
    await mkdir(path.join(dir, 'projects', '-private-tmp-x'), { recursive: true });
    await mkdir(path.join(dir, 'projects', '-other'), { recursive: true });
    await writeFile(path.join(dir, 'projects', '-private-tmp-x', `${SESSION}.jsonl`), '{}\n');
    expect(claudeTranscriptExists({ CLAUDE_CONFIG_DIR: dir }, SESSION)).toBe(true);
  });

  it('is false for another session, an empty projects directory and a missing configuration directory', async () => {
    await mkdir(path.join(dir, 'projects', '-private-tmp-x'), { recursive: true });
    await writeFile(path.join(dir, 'projects', '-private-tmp-x', `${OTHER}.jsonl`), '{}\n');
    expect(claudeTranscriptExists({ CLAUDE_CONFIG_DIR: dir }, SESSION)).toBe(false);
    expect(claudeTranscriptExists({ CLAUDE_CONFIG_DIR: path.join(dir, 'nope') }, SESSION)).toBe(false);
  });

  it('uses the home directory when CLAUDE_CONFIG_DIR is not set', () => {
    expect(claudeConfigDir({})).toBe(path.join(os.homedir(), '.claude'));
    expect(claudeConfigDir({ CLAUDE_CONFIG_DIR: '/x' })).toBe('/x');
  });
});
