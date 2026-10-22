// site-replay.test.ts
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGenericAdapter } from '../../src/main/site-adapters/generic-adapter';
import { createTurnRecorder } from '../../src/main/site-adapters/recorder';
import { formatReplay, readRecording, replay, runReplay, type Recording } from '../../src/main/site-adapters/replay';
import { runAdapterTurn } from '../../src/main/site-adapters/turn';
import type { PageRunner } from '../../src/main/site-adapters/types';
import { ANSWER_FRAMES, SCRIPT_PROMPT, scriptedPage } from './helpers/scripted-page';

const OPTIONS = { quietMs: 130, confirmMs: 300, confirmPollMs: 10, maxReplyChars: 1_000_000 };
const TURN = { timeoutMs: 4000, pollMs: 10, settleMs: 30, startGraceMs: 600 };
const FIXTURE = readFileSync(new URL('../fixtures/sites/composer.html', import.meta.url), 'utf8');

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'aiaw-replay-'));
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(root, { recursive: true, force: true });
});

async function recordOn(runner: PageRunner, prompt: string, turn: string): Promise<{ dir: string; reply: string | null }> {
  const adapter = createGenericAdapter('fixture', OPTIONS);
  const rec = createTurnRecorder({
    root,
    runId: 'run',
    site: 'fixture',
    turn,
    prompt,
    timing: { ...TURN, ...adapter.settings?.() },
    onFail: (code) => {
      throw new Error(`recorder failed: ${code}`);
    },
  });
  let reply: string | null = null;
  let outcome = 'reply';
  let code = '';
  try {
    reply = await runAdapterTurn(adapter, runner, prompt, { ...TURN, tap: rec, turnId: turn });
  } catch (error) {
    outcome = 'failed';
    code = (error as { code?: string }).code ?? 'error';
  }
  await rec.finish({ outcome, code, trace: {}, dom: null });
  return { dir: rec.dir, reply };
}

async function recordScripted(frames = ANSWER_FRAMES, turnOptions = TURN): Promise<string> {
  vi.useFakeTimers();
  const page = scriptedPage(SCRIPT_PROMPT, frames);
  const adapter = createGenericAdapter('fixture', OPTIONS);
  const rec = createTurnRecorder({ root, runId: 'run', site: 'fixture', turn: 'scripted', prompt: SCRIPT_PROMPT, timing: { ...turnOptions, ...adapter.settings?.() }, onFail: () => undefined });
  let settled = false;
  let outcome = 'reply';
  let code = '';
  const running = runAdapterTurn(adapter, page.runner, SCRIPT_PROMPT, { ...turnOptions, tap: rec, turnId: 'scripted' })
    .catch((error: { code?: string }) => {
      outcome = 'failed';
      code = error.code ?? 'error';
    })
    .finally(() => {
      settled = true;
    });
  while (!settled) await vi.advanceTimersByTimeAsync(5);
  await running;
  vi.useRealTimers();
  await rec.finish({ outcome, code, trace: {}, dom: null });
  return rec.dir;
}

describe('replay of a recorded turn', () => {
  it('reproduces the recorded outcome and finish time exactly on a scripted page', async () => {
    const dir = await recordScripted();
    const recording = await readRecording(dir);
    expect(recording.meta.outcome).toBe('reply');
    const result = replay(recording);
    expect(result.outcome).toBe('reply');
    expect(result.finishedAtMs).toBe(recording.meta.finishedAtMs);
    expect(result.reply).toBe('First part of the scripted answer arrives\nSecond part of the scripted answer arrives');
    expect(result.lines.length).toBe(recording.snapshots.length);
  });

  it('reproduces the finish time of a page without a stop button, which only the quiet time can end', async () => {
    const first = 'First part of the scripted answer arrives';
    const quiet = [
      { from: 0, lines: [], stop: false },
      { from: 100, lines: [first], stop: false },
      { from: 200, lines: [first, 'Second part of the scripted answer arrives'], stop: false },
    ];
    const dir = await recordScripted(quiet);
    const recording = await readRecording(dir);
    const result = replay(recording);
    expect(recording.meta.finishedAtMs).toBeGreaterThanOrEqual(200 + OPTIONS.quietMs);
    expect(result.finishedAtMs).toBe(recording.meta.finishedAtMs);
    const impatient = replay({ ...recording, meta: { ...recording.meta, timing: { ...recording.meta.timing, quietMs: 0 } } });
    expect(impatient.finishedAtMs).toBeLessThan(recording.meta.finishedAtMs);
  });

  it('reproduces the same finish time from a recording that carries no poll times', async () => {
    const dir = await recordScripted();
    const recording = await readRecording(dir);
    const result = replay({ ...recording, meta: { ...recording.meta, polls: [] } });
    expect(result.outcome).toBe('reply');
    expect(result.finishedAtMs).toBe(recording.meta.finishedAtMs);
  });

  it('judges the same recording again under other timings: a longer quiet time finishes later', async () => {
    const dir = await recordScripted();
    const recording = await readRecording(dir);
    const slower = replay({ ...recording, meta: { ...recording.meta, polls: [], timing: { ...recording.meta.timing, quietMs: 600 } } });
    expect(slower.outcome).toBe('reply');
    expect(slower.finishedAtMs).toBeGreaterThan(recording.meta.finishedAtMs);
  });

  it('reproduces the outcome of a turn over the fixture page, within a few polls of the finish time', async () => {
    const dom = new JSDOM(FIXTURE, { runScripts: 'dangerously', url: 'https://fixture.test/?composer=textarea' });
    const runner: PageRunner = { run: (code) => Promise.resolve(dom.window.eval(code)) };
    const made = await recordOn(runner, 'one\ntwo', 'jsdom');
    dom.window.close();
    expect(made.reply).toBe('ECHO: one two part-2 part-3');
    const recording = await readRecording(made.dir);
    const result = replay(recording);
    expect(result.outcome).toBe('reply');
    expect(result.reply).toBe(made.reply);
    expect(Math.abs(result.finishedAtMs - recording.meta.finishedAtMs)).toBeLessThanOrEqual(200);
  });

  it('prints one line per snapshot and the outcome with the recorded one beside it', async () => {
    const dir = await recordScripted();
    const recording = await readRecording(dir);
    const lines = formatReplay(replay(recording), recording.meta);
    expect(lines.length).toBe(recording.snapshots.length + 1);
    expect(lines[0]).toMatch(/^t=\d+ text=\d+ reply=\d+ started=(true|false) generating=(true|false) keyHits=\d+ anchorRank=-?\d+$/);
    expect(lines[lines.length - 1]).toBe(`outcome=reply finishedAtMs=${recording.meta.finishedAtMs} recorded=reply recordedAtMs=${recording.meta.finishedAtMs}`);
    expect(await runReplay(dir)).toEqual(lines);
  });

  it('shows a recorded failure code beside the replayed outcome', () => {
    const base = fakeRecording();
    const lines = formatReplay({ lines: [], outcome: 'timeout', finishedAtMs: 9, reply: null }, { ...base.meta, outcome: 'failed', code: 'timeout' });
    expect(lines).toEqual(['outcome=timeout finishedAtMs=9 recorded=failed:timeout recordedAtMs=0']);
  });
});

function fakeRecording(overrides: Partial<Recording> = {}): Recording {
  return {
    meta: { timing: { pollMs: 100, settleMs: 200, startGraceMs: 1000, timeoutMs: 3000, quietMs: 300, maxReplyChars: 1000 }, outcome: 'failed', code: 'timeout', finishedAtMs: 0, polls: [] },
    prompt: SCRIPT_PROMPT,
    before: 'old',
    snapshots: [{ t: 0, text: `old\n${SCRIPT_PROMPT}`, stop: false, accepting: true }],
    ...overrides,
  };
}

describe('replay outcomes on hand-made recordings', () => {
  it('times out when the page never shows an answer but the echo is there', () => {
    const result = replay(fakeRecording());
    expect(result.outcome).toBe('timeout');
    expect(result.finishedAtMs).toBeGreaterThanOrEqual(3000);
  });

  it('reports no-response when the echo never appears after the start grace', () => {
    const result = replay(fakeRecording({ snapshots: [{ t: 0, text: 'old', stop: false, accepting: true }] }));
    expect(result.outcome).toBe('no-response');
    expect(result.finishedAtMs).toBe(1000);
  });

  it('times out at the timeout when the recording ends with polls recorded', () => {
    const recording = fakeRecording();
    const result = replay({ ...recording, meta: { ...recording.meta, polls: [0, 100, 200] } });
    expect(result).toMatchObject({ outcome: 'timeout', finishedAtMs: 3000 });
  });

  it('refuses a recording without snapshots', () => {
    expect(() => replay(fakeRecording({ snapshots: [] }))).toThrow(/no snapshots/);
  });

  it('refuses a snapshot written by an adapter that records no page text', async () => {
    const dir = path.join(root, 'bare');
    await mkdir(path.join(dir, 'snapshots'), { recursive: true });
    await writeFile(path.join(dir, 'meta.json'), JSON.stringify(fakeRecording().meta), 'utf8');
    await writeFile(path.join(dir, 'prompt.txt'), 'p', 'utf8');
    await writeFile(path.join(dir, 'before.txt'), '', 'utf8');
    await writeFile(path.join(dir, 'snapshots', '0001.json'), JSON.stringify({ t: 0, generating: false, reply: null }), 'utf8');
    await expect(readRecording(dir)).rejects.toThrow(/no page text/);
  });

  it('reads the files the recorder wrote', async () => {
    const dir = await recordScripted();
    expect(JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8')).timing).toMatchObject({ quietMs: 130 });
  });
});
