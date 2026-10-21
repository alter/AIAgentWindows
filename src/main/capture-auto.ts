// capture-auto.ts
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SiteKind } from '../shared/agents';
import {
  buildDiagnostic,
  diagnosticText,
  redactPath,
  type AutoStatus,
  type DiagnosticInput,
  type ViewportInfo,
  type WaitInfo,
} from '../shared/capture-diagnostic';
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

export type { AutoStatus };

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

interface Landing {
  path: string | null;
}

type Found = ({ link: string } & Landing) | ({ outcome: 'not-signed-in' | 'no-chat' } & Landing);

function pathOf(url: string): string | null {
  try {
    return redactPath(new URL(url).pathname);
  } catch {
    return null;
  }
}

async function findLink(kind: SiteKind, page: AutoPage, timing: AutoTiming, clock: Clock): Promise<Found> {
  const deadline = clock.now() + timing.discoverMs;
  let loginSeen = 0;
  let landing: string | null = null;
  while (clock.now() < deadline) {
    const found: Discovery | null = await ask(page.runner, discoverScript(), parseDiscovery);
    if (found !== null) {
      landing = pathOf(found.url);
      const link = pickConversationLink(kind, found.origin, found.hrefs);
      if (link !== null) return { link, path: landing };
      loginSeen = found.login ? loginSeen + 1 : 0;
      if (loginSeen >= timing.loginPolls) return { outcome: 'not-signed-in', path: landing };
    }
    await clock.sleep(timing.pollMs);
  }
  return { outcome: loginSeen > 0 ? 'not-signed-in' : 'no-chat', path: landing };
}

interface Rendered {
  ok: boolean;
  note?: string;
  detail?: string;
  wait: WaitInfo;
  viewport: ViewportInfo | null;
  mainRegion: boolean | null;
}

async function waitForReply(link: string, page: AutoPage, timing: AutoTiming, clock: Clock): Promise<Rendered> {
  const wanted = new URL(link).pathname.replace(/\/$/, '');
  const started = clock.now();
  const deadline = started + timing.replyMs;
  const wait: WaitInfo = { polls: 0, waitedMs: 0, messageListSeen: false, replySeen: false, settled: false, timedOut: false };
  let viewport: ViewportInfo | null = null;
  let mainRegion: boolean | null = null;
  let last = '';
  let stable = 0;
  let onPage = false;
  const finish = (result: { ok: boolean; note?: string; detail?: string }): Rendered => {
    wait.waitedMs = clock.now() - started;
    return { ...result, wait, viewport, mainRegion };
  };
  while (clock.now() < deadline) {
    const probe: Probe | null = await ask(page.runner, probeScript(), parseProbe);
    wait.polls += 1;
    if (probe !== null && new URL(probe.url).pathname.replace(/\/$/, '') === wanted) {
      onPage = true;
      viewport = { width: probe.width, height: probe.height };
      mainRegion = probe.mainRegion;
      const signature = `${String(probe.nodes)}:${String(probe.textChars)}`;
      stable = signature === last ? stable + 1 : 0;
      last = signature;
      wait.messageListSeen = wait.messageListSeen || probe.messageList;
      wait.replySeen = wait.replySeen || probe.reply;
      wait.settled = stable >= timing.stablePolls;
      if (probe.messageList && wait.settled) {
        return finish({ ok: true, ...(probe.reply ? {} : { note: 'the message list settled but no reply markup was recognised' }) });
      }
    } else {
      onPage = false;
      stable = 0;
      last = '';
      wait.settled = false;
    }
    await clock.sleep(timing.pollMs);
  }
  wait.timedOut = true;
  if (onPage && wait.settled) return finish({ ok: true, note: 'the page settled but no message list appeared' });
  return finish({ ok: false, detail: onPage ? 'the conversation page did not settle' : 'the conversation did not open' });
}

interface SiteOutcome {
  report: AutoReport;
  diagnostic: Omit<DiagnosticInput, 'site' | 'status'>;
}

const NO_DIAGNOSTIC: Omit<DiagnosticInput, 'site' | 'status'> = { landingPath: null, loadedPath: null, wait: null, viewport: null, mainRegion: null, stats: null };

async function captureSite(kind: SiteKind, page: AutoPage, options: AutoOptions, timing: AutoTiming, clock: Clock): Promise<SiteOutcome> {
  const found = await findLink(kind, page, timing, clock);
  const landingPath = found.path;
  if ('outcome' in found) return { report: { site: kind, status: found.outcome }, diagnostic: { ...NO_DIAGNOSTIC, landingPath } };
  const loadedPath = pathOf(found.link);
  try {
    await Promise.race([page.load(found.link), clock.sleep(timing.replyMs)]);
  } catch {
    // a redirect aborts the load; the probe below decides whether the conversation opened
  }
  const rendered = await waitForReply(found.link, page, timing, clock);
  const base = { landingPath, loadedPath, wait: rendered.wait, viewport: rendered.viewport, mainRegion: rendered.mainRegion };
  if (!rendered.ok) return { report: { site: kind, status: 'failed', detail: rendered.detail ?? 'unknown' }, diagnostic: { ...base, stats: null } };
  const result = await captureOne({ kind, runner: page.runner }, options.outDir);
  const diagnostic = { ...base, stats: result.stats ?? null };
  if (result.ok) {
    return { report: { site: kind, status: 'saved', path: result.path ?? '', ...(rendered.note === undefined ? {} : { detail: rendered.note }) }, diagnostic };
  }
  return { report: { site: kind, status: result.leak === true ? 'leak-refused' : 'failed', detail: result.error ?? 'unknown' }, diagnostic };
}

export async function writeDiagnostic(outDir: string, input: DiagnosticInput): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `${input.site}.diagnostic.json`);
  const temporary = `${file}.tmp`;
  await writeFile(temporary, diagnosticText(buildDiagnostic(input)), 'utf8');
  await rename(temporary, file);
  return file;
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
      const outcome = await captureSite(kind, page, options, timing, clock);
      const written = await writeDiagnostic(options.outDir, { site: kind, status: outcome.report.status, ...outcome.diagnostic }).then(
        () => true,
        () => false,
      );
      if (!written) outcome.report.detail = [outcome.report.detail, 'diagnostic not written'].filter((part) => part !== undefined).join('; ');
      reports.push(outcome.report);
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
