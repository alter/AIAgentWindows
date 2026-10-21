// capture-auto.ts
import type { SiteKind } from '../shared/agents';
import {
  discoverScript,
  parseDiscovery,
  parseProbe,
  pickConversationLink,
  probeScript,
  type Discovery,
  type Probe,
} from '../shared/conversation-link';
import { captureOne } from './capture-sites';
import type { PageRunner } from './site-adapters/types';

export const CAPTURE_AUTO_ENV = 'AIAW_CAPTURE_AUTO';
export const AUTO_SITES: readonly SiteKind[] = ['chatgpt', 'grok', 'deepseek'];

export interface AutoPage {
  readonly runner: PageRunner;
  load(url: string): Promise<void>;
}

export interface AutoTiming {
  pollMs: number;
  discoverMs: number;
  replyMs: number;
  stablePolls: number;
  loginPolls: number;
}

export const DEFAULT_AUTO_TIMING: AutoTiming = { pollMs: 500, discoverMs: 30_000, replyMs: 40_000, stablePolls: 3, loginPolls: 6 };

export function autoTiming(env: Readonly<Record<string, string | undefined>>): AutoTiming {
  const testMode = (env['AIAW_USER_DATA'] ?? '').length > 0 && env['AIAW_CAPTURE_AUTO_FAST'] === '1';
  return testMode ? { pollMs: 100, discoverMs: 3000, replyMs: 10_000, stablePolls: 3, loginPolls: 3 } : DEFAULT_AUTO_TIMING;
}

export type AutoStatus = 'saved' | 'no-chat' | 'not-signed-in' | 'leak-refused' | 'no-agent' | 'failed';

export interface AutoReport {
  site: SiteKind;
  status: AutoStatus;
  path?: string;
  detail?: string;
}

export interface AutoOptions {
  sites: readonly SiteKind[];
  open(kind: SiteKind): AutoPage | null;
  outDir: string;
  timing?: AutoTiming;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

interface Clock {
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

async function ask<T>(runner: PageRunner, script: string, parse: (raw: unknown) => T | null): Promise<T | null> {
  try {
    return parse(await runner.run(script));
  } catch {
    return null;
  }
}

type Found = { link: string } | { outcome: 'not-signed-in' | 'no-chat' };

async function findLink(kind: SiteKind, page: AutoPage, timing: AutoTiming, clock: Clock): Promise<Found> {
  const deadline = clock.now() + timing.discoverMs;
  let loginSeen = 0;
  while (clock.now() < deadline) {
    const found: Discovery | null = await ask(page.runner, discoverScript(), parseDiscovery);
    if (found !== null) {
      const link = pickConversationLink(kind, found.origin, found.hrefs);
      if (link !== null) return { link };
      loginSeen = found.login ? loginSeen + 1 : 0;
      if (loginSeen >= timing.loginPolls) return { outcome: 'not-signed-in' };
    }
    await clock.sleep(timing.pollMs);
  }
  return { outcome: loginSeen > 0 ? 'not-signed-in' : 'no-chat' };
}

type Rendered = { ok: true; note?: string } | { ok: false; detail: string };

async function waitForReply(link: string, page: AutoPage, timing: AutoTiming, clock: Clock): Promise<Rendered> {
  const wanted = new URL(link).pathname;
  const deadline = clock.now() + timing.replyMs;
  let last = -1;
  let stable = 0;
  let onPage = false;
  while (clock.now() < deadline) {
    const probe: Probe | null = await ask(page.runner, probeScript(), parseProbe);
    if (probe !== null && new URL(probe.url).pathname.replace(/\/$/, '') === wanted.replace(/\/$/, '')) {
      onPage = true;
      stable = probe.nodes === last ? stable + 1 : 0;
      last = probe.nodes;
      if (probe.reply && stable >= timing.stablePolls) return { ok: true };
    } else {
      onPage = false;
      stable = 0;
      last = -1;
    }
    await clock.sleep(timing.pollMs);
  }
  if (onPage && stable >= timing.stablePolls) return { ok: true, note: 'the page settled but no reply markup was recognised' };
  return { ok: false, detail: onPage ? 'the conversation page did not settle' : 'the conversation did not open' };
}

async function captureSite(kind: SiteKind, page: AutoPage, options: AutoOptions, timing: AutoTiming, clock: Clock): Promise<AutoReport> {
  const found = await findLink(kind, page, timing, clock);
  if ('outcome' in found) return { site: kind, status: found.outcome };
  try {
    await Promise.race([page.load(found.link), clock.sleep(timing.replyMs)]);
  } catch {
    // a redirect aborts the load; the probe below decides whether the conversation opened
  }
  const rendered = await waitForReply(found.link, page, timing, clock);
  if (!rendered.ok) return { site: kind, status: 'failed', detail: rendered.detail };
  const result = await captureOne({ kind, runner: page.runner }, options.outDir);
  if (result.ok) return { site: kind, status: 'saved', path: result.path ?? '', ...(rendered.note === undefined ? {} : { detail: rendered.note }) };
  return { site: kind, status: result.leak === true ? 'leak-refused' : 'failed', detail: result.error ?? 'unknown' };
}

export async function captureAuto(options: AutoOptions): Promise<AutoReport[]> {
  const timing = options.timing ?? DEFAULT_AUTO_TIMING;
  const clock: Clock = {
    sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    now: options.now ?? Date.now,
  };
  const reports: AutoReport[] = [];
  for (const kind of options.sites) {
    const page = options.open(kind);
    if (page === null) {
      reports.push({ site: kind, status: 'no-agent' });
      continue;
    }
    try {
      reports.push(await captureSite(kind, page, options, timing, clock));
    } catch (error) {
      reports.push({ site: kind, status: 'failed', detail: error instanceof Error ? error.message : 'unknown' });
    }
  }
  return reports;
}

const STATUS_TEXT: Readonly<Record<AutoStatus, string>> = {
  saved: 'saved',
  'no-chat': 'no existing chat (nothing saved)',
  'not-signed-in': 'not signed in (nothing saved)',
  'leak-refused': 'leak refused (nothing saved)',
  'no-agent': 'no agent for this site in the profile (nothing saved)',
  failed: 'failed',
};

export function formatAutoReport(reports: readonly AutoReport[]): string {
  return reports
    .map((report) => {
      const parts = [STATUS_TEXT[report.status], report.path, report.detail].filter((part) => part !== undefined && part !== '');
      return `${report.site}: ${parts.join(', ')}`;
    })
    .join('\n');
}

export function autoExitCode(reports: readonly AutoReport[]): number {
  return reports.length > 0 && reports.every((report) => report.status === 'saved') ? 0 : 1;
}
