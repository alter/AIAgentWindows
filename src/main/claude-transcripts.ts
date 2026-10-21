// claude-transcripts.ts
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function claudeConfigDir(env: Readonly<Record<string, string | undefined>>): string {
  return env['CLAUDE_CONFIG_DIR'] || path.join(os.homedir(), '.claude');
}

export function claudeTranscriptExists(env: Readonly<Record<string, string | undefined>>, sessionId: string): boolean {
  const projects = path.join(claudeConfigDir(env), 'projects');
  let names: string[];
  try {
    names = readdirSync(projects);
  } catch {
    return false;
  }
  return names.some((name) => existsSync(path.join(projects, name, `${sessionId}.jsonl`)));
}
