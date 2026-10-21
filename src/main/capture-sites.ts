// capture-sites.ts
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type SiteKind } from '../shared/agents';
import { findLeaks, sanitizeScript, type SanitizeStats } from '../shared/capture-sanitize';
import type { PageRunner } from './site-adapters/types';

export const CAPTURE_ENV = 'AIAW_CAPTURE_SITES';
const ALL_SITES: readonly SiteKind[] = ['chatgpt', 'grok', 'deepseek'];

export interface CaptureTarget {
  kind: SiteKind;
  runner: PageRunner;
}

export interface CaptureResult {
  site: SiteKind;
  ok: boolean;
  path?: string;
  error?: string;
  leak?: boolean;
  stats?: SanitizeStats;
}

interface PageAnswer {
  ok: boolean;
  html?: string;
  classes?: unknown;
  stats?: unknown;
  error?: string;
}

function parseAnswer(raw: unknown): PageAnswer {
  if (typeof raw !== 'string') return { ok: false, error: 'the page returned no result' };
  try {
    const parsed = JSON.parse(raw) as PageAnswer;
    return typeof parsed === 'object' && parsed !== null ? parsed : { ok: false, error: 'unreadable page result' };
  } catch {
    return { ok: false, error: 'unreadable page result' };
  }
}

export async function captureOne(target: CaptureTarget, outDir: string): Promise<CaptureResult> {
  const site = target.kind;
  let answer: PageAnswer;
  try {
    answer = parseAnswer(await target.runner.run(sanitizeScript(site)));
  } catch {
    return { site, ok: false, error: 'the page could not be read' };
  }
  if (!answer.ok || typeof answer.html !== 'string') return { site, ok: false, error: answer.error ?? 'page-error' };
  const classes = Array.isArray(answer.classes) ? answer.classes.filter((name): name is string => typeof name === 'string') : [];
  const stats = answer.stats as SanitizeStats | undefined;
  const problems = findLeaks(answer.html, classes);
  if (problems.length > 0) return { site, ok: false, leak: true, error: `not saved, sanitizer check failed: ${problems.join(', ')}`, ...(stats === undefined ? {} : { stats }) };
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `${site}.html`);
  const temporary = `${file}.tmp`;
  await writeFile(temporary, answer.html, 'utf8');
  await rename(temporary, file);
  return { site, ok: true, path: file, ...(stats === undefined ? {} : { stats }) };
}

export async function captureSites(targets: readonly CaptureTarget[], outDir: string): Promise<CaptureResult[]> {
  await mkdir(outDir, { recursive: true });
  const results: CaptureResult[] = [];
  for (const target of targets) results.push(await captureOne(target, outDir));
  return results;
}

export function summarizeCapture(results: readonly CaptureResult[]): string {
  const lines = ALL_SITES.map((site) => {
    const found = results.find((result) => result.site === site);
    if (found === undefined) return `${site}: not opened in this run, open it (signed in, on a chat that has a reply) and capture again`;
    return found.ok ? `${site}: saved to ${found.path ?? ''}` : `${site}: failed, ${found.error ?? 'unknown'}`;
  });
  return lines.join('\n');
}
