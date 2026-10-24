// site-recorder.test.ts
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRoomDrivers } from '../../src/main/room-drivers';
import type { TurnRequest } from '../../src/main/room';
import type { NetSink, NetWatch, PageRunner, PollProbe, SiteAdapter } from '../../src/main/site-adapters/types';
import type { RoomParticipant } from '../../src/shared/room-model';

const SECRET_PROMPT = 'FIXTURE-PROMPT-TEXT about the owner chat';
const SECRET_PAGE = 'FIXTURE-PAGE-TEXT before submit';
const SECRET_REPLY = 'FIXTURE-REPLY-TEXT that streams in';
const DOM = '<main>FIXTURE-DOM-TEXT</main>';
const PARTICIPANT: RoomParticipant = { id: 'chatgpt', kind: 'chatgpt', label: 'ChatGPT' };

interface State {
  text: string;
  reply: string | null;
  stop: boolean;
}

const STATES: State[] = [
  { text: 'q', reply: null, stop: false },
  { text: 'q\nR', reply: `${SECRET_REPLY} part one`, stop: true },
  { text: 'q\nR', reply: `${SECRET_REPLY} part one`, stop: true },
  { text: 'q\nR2', reply: `${SECRET_REPLY} part one two`, stop: true },
  { text: 'q\nR2', reply: `${SECRET_REPLY} part one two`, stop: false },
];

function scripted(options: { dom?: () => Promise<string> } = {}): SiteAdapter {
  let polls = 0;
  let submitted = false;
  const state = (): State => STATES[Math.min(Math.max(polls - 1, 0), STATES.length - 1)] as State;
  const probe = (): PollProbe => {
    const current = state();
    return {
      before: SECRET_PAGE,
      text: current.text,
      stop: current.stop,
      accepting: !current.stop,
      reply: current.reply,
      started: current.reply !== null,
      drops: { seen: 0, echo: 0, marker: 0, label: 0 },
      keyHits: 1,
      anchorRank: 0,
      hitsAtLineStart: 1,
    };
  };
  return {
    site: 'fixture',
    insertText: () => Promise.resolve(),
    submit: () => {
      submitted = true;
      return Promise.resolve();
    },
    isGenerating: () => {
      if (submitted) polls += 1;
      return Promise.resolve(state().stop);
    },
    lastReply: () => Promise.resolve(state().reply),
    attachFile: () => Promise.resolve(),
    trace: () => ({ composer: 'textarea', inserted: SECRET_PROMPT.length, submit: 'enter', composerClearedMs: 3 }),
    probe,
    settings: () => ({ quietMs: 0, maxReplyChars: 1000 }),
    domDump: options.dom ?? (() => Promise.resolve(DOM)),
  };
}

let root: string;
let lines: Array<[string, string, Readonly<Record<string, unknown>>]>;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'aiaw-recorder-'));
  lines = [];
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 3 });
});

function request(debugSites: boolean, overrides: Partial<TurnRequest> = {}): TurnRequest {
  return { runId: 'run1', text: SECRET_PROMPT, files: [], roomName: 'room', timeoutMs: 5000, signal: new AbortController().signal, debugSites, ...overrides };
}

async function driverFor(adapter: SiteAdapter, runner: PageRunner, debugRoot: string | undefined, extra: { prepare?: () => Promise<void> } = {}) {
  const drivers = createRoomDrivers({
    sharedDir: root,
    platform: 'darwin',
    envFor: () => ({}),
    siteFor: () => ({ adapter, runner, ...extra }),
    timing: { pollMs: 5, settleMs: 15 },
    siteLog: (site, event, fields) => lines.push([site, event, fields]),
    debugRoot,
  });
  return drivers.factory(PARTICIPANT, 'run-1', { path: root, create: false, isolated: false });
}

const quiet: PageRunner = { run: () => Promise.resolve('') };

async function turnDir(debugRoot: string): Promise<string> {
  const runs = await readdir(path.join(debugRoot, 'run1'));
  expect(runs).toHaveLength(1);
  return path.join(debugRoot, 'run1', runs[0] as string);
}

describe('site debug recording of a turn', () => {
  it('writes meta, prompt, before text, one snapshot per change, events and the final DOM', async () => {
    const debugRoot = path.join(root, 'debug', 'sites');
    const driver = await driverFor(scripted(), quiet, debugRoot, { prepare: () => Promise.resolve() });
    const reply = await driver.turn(request(true));
    expect(reply).toBe(`${SECRET_REPLY} part one two`);
    const dir = await turnDir(debugRoot);
    expect(path.basename(dir)).toMatch(/^fixture-[0-9a-f]{6}$/);
    const meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8'));
    expect(meta).toMatchObject({ site: 'fixture', runId: 'run1', outcome: 'reply', code: '', timing: { pollMs: 5, settleMs: 15, timeoutMs: 5000, quietMs: 0 } });
    expect(meta.trace).toMatchObject({ outcome: 'reply', replyChars: reply?.length });
    expect(Date.parse(meta.startedAt)).toBeLessThanOrEqual(Date.parse(meta.finishedAt));
    expect(await readFile(path.join(dir, 'prompt.txt'), 'utf8')).toBe(SECRET_PROMPT);
    expect(await readFile(path.join(dir, 'before.txt'), 'utf8')).toBe(SECRET_PAGE);
    expect(await readFile(path.join(dir, 'dom-end.html'), 'utf8')).toBe(DOM);
    const snapshots = (await readdir(path.join(dir, 'snapshots'))).sort();
    expect(snapshots).toEqual(['0001.json', '0002.json', '0003.json', '0004.json']);
    const first = JSON.parse(await readFile(path.join(dir, 'snapshots', '0001.json'), 'utf8'));
    expect(first).toMatchObject({ t: expect.any(Number), text: 'q', stop: false, accepting: true, reply: null, started: false, generating: false, keyHits: 1, anchorRank: 0, hitsAtLineStart: 1 });
    expect(first.drops).toEqual({ seen: 0, echo: 0, marker: 0, label: 0 });
    const events = (await readFile(path.join(dir, 'events.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as { event: string });
    const names = events.map((item) => item.event);
    for (const wanted of ['ready', 'idle-wait', 'insert', 'submit', 'generating', 'first-growth', 'settle-start', 'finish']) expect(names).toContain(wanted);
    expect(events.find((item) => item.event === 'insert')).toMatchObject({ composer: 'textarea', chars: SECRET_PROMPT.length });
    expect(events.find((item) => item.event === 'submit')).toMatchObject({ path: 'enter', composerClearedMs: 3 });
    expect(events.find((item) => item.event === 'finish')).toMatchObject({ outcome: 'reply' });
    expect(events.every((item) => typeof (item as unknown as { at: unknown }).at === 'number')).toBe(true);
    expect(events.filter((item) => item.event === 'ready').every((item) => typeof (item as unknown as { ms: unknown }).ms === 'number')).toBe(true);
    expect(events.filter((item) => item.event === 'ready').map((item) => (item as unknown as { phase: string }).phase)).toEqual(['prepare', 'composer']);
  });

  it('keeps every word of the owner chat out of the site log and adds only the directory to the trace line', async () => {
    const debugRoot = path.join(root, 'debug', 'sites');
    const driver = await driverFor(scripted(), quiet, debugRoot);
    await driver.turn(request(true));
    const dir = await turnDir(debugRoot);
    const serialized = JSON.stringify(lines);
    for (const text of [SECRET_PROMPT, SECRET_PAGE, SECRET_REPLY, 'FIXTURE-DOM-TEXT', 'FIXTURE']) expect(serialized).not.toContain(text);
    const trace = lines.find(([, event]) => event === 'turn')?.[2] as Record<string, unknown>;
    expect(trace['debugDir']).toBe(dir);
    const plain = await driverFor(scripted(), quiet, undefined);
    lines.length = 0;
    await plain.turn(request(false));
    expect(Object.keys(lines.find(([, event]) => event === 'turn')?.[2] ?? {})).not.toContain('debugDir');
  });

  it('writes nothing when the switch is off, or when no debug root is configured', async () => {
    const debugRoot = path.join(root, 'debug', 'sites');
    await (await driverFor(scripted(), quiet, debugRoot)).turn(request(false));
    await (await driverFor(scripted(), quiet, undefined)).turn(request(true));
    await expect(stat(path.join(root, 'debug'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('records the failure code and still dumps the DOM when the turn fails', async () => {
    const debugRoot = path.join(root, 'debug', 'sites');
    const adapter = scripted();
    adapter.submit = () => Promise.reject(Object.assign(new Error('x'), { name: 'SiteAdapterError', code: 'not-submitted' }));
    const driver = await driverFor(adapter, quiet, debugRoot);
    await expect(driver.turn(request(true))).rejects.toThrow();
    const dir = await turnDir(debugRoot);
    const meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8'));
    expect(meta).toMatchObject({ outcome: 'failed', code: 'error' });
    expect(await readFile(path.join(dir, 'dom-end.html'), 'utf8')).toBe(DOM);
  });

  it('records a not-ready page as a failed turn with its code', async () => {
    const debugRoot = path.join(root, 'debug', 'sites');
    const adapter = scripted();
    adapter.composerReady = () => Promise.resolve(false);
    const drivers = createRoomDrivers({
      sharedDir: root,
      platform: 'darwin',
      envFor: () => ({}),
      siteFor: () => ({ adapter, runner: quiet }),
      timing: { readyMs: 30, readyPollMs: 5 },
      debugRoot,
    });
    const driver = await drivers.factory(PARTICIPANT, 'run-1', { path: root, create: false, isolated: false });
    await expect(driver.turn(request(true))).rejects.toMatchObject({ code: 'not-ready' });
    const meta = JSON.parse(await readFile(path.join(await turnDir(debugRoot), 'meta.json'), 'utf8'));
    expect(meta).toMatchObject({ outcome: 'failed', code: 'not-ready' });
  });

  it('survives a DOM dump that fails and says so in the events', async () => {
    const debugRoot = path.join(root, 'debug', 'sites');
    const driver = await driverFor(scripted({ dom: () => Promise.reject(new Error('page closed')) }), quiet, debugRoot);
    await driver.turn(request(true));
    const dir = await turnDir(debugRoot);
    expect(await readdir(dir)).not.toContain('dom-end.html');
    expect(await readFile(path.join(dir, 'events.jsonl'), 'utf8')).toContain('dom-failed');
  });

  it('logs one recorder-failed line and lets the turn continue when the files cannot be written', async () => {
    const blocked = path.join(root, 'blocked');
    await writeFile(blocked, 'a file where the directory should be', 'utf8');
    const driver = await driverFor(scripted(), quiet, blocked);
    const reply = await driver.turn(request(true));
    expect(reply).toBe(`${SECRET_REPLY} part one two`);
    const failed = lines.filter(([, event]) => event === 'recorder-failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.[2]).toMatchObject({ code: expect.any(String) });
    expect(JSON.stringify(failed)).not.toContain(root);
  });

  it('feeds the network watch into the events and saves response bodies under net/', async () => {
    const debugRoot = path.join(root, 'debug', 'sites');
    let stopped = 0;
    const runner: PageRunner = {
      run: () => Promise.resolve(''),
      watchNetwork: async (sink: NetSink): Promise<NetWatch> => {
        sink.event('net', { phase: 'request', id: '1', path: '/api/chat' });
        const file = await sink.saveBody?.('STREAM BODY');
        sink.event('net', { phase: 'body', id: '1', file: file ?? 'none' });
        return {
          stop: () => {
            stopped += 1;
            return Promise.resolve();
          },
        };
      },
    };
    const driver = await driverFor(scripted(), runner, debugRoot);
    await driver.turn(request(true));
    const dir = await turnDir(debugRoot);
    expect(stopped).toBe(1);
    expect(await readFile(path.join(dir, 'net', '0001.txt'), 'utf8')).toBe('STREAM BODY');
    const events = await readFile(path.join(dir, 'events.jsonl'), 'utf8');
    expect(events).toContain('"phase":"request"');
    expect(events).toContain('"file":"net/0001.txt"');
  });

  it('records a network watch that fails to start and a stop that fails, and goes on', async () => {
    const debugRoot = path.join(root, 'debug', 'sites');
    const failing: PageRunner = { run: () => Promise.resolve(''), watchNetwork: () => Promise.reject(new Error('debugger detached')) };
    await (await driverFor(scripted(), failing, debugRoot)).turn(request(true));
    const brokenStop: PageRunner = { run: () => Promise.resolve(''), watchNetwork: () => Promise.resolve({ stop: () => Promise.reject(new Error('stop failed')) }) };
    await (await driverFor(scripted(), brokenStop, debugRoot)).turn(request(true, { runId: 'run1' }));
    const runs = await readdir(path.join(debugRoot, 'run1'));
    const all = await Promise.all(runs.map((name) => readFile(path.join(debugRoot, 'run1', name, 'events.jsonl'), 'utf8')));
    expect(all.join('')).toContain('debugger detached');
    expect(all.join('')).toContain('stop failed');
  });

  it('does not record an adapter that has no probe beyond the reply and the generating flag', async () => {
    const debugRoot = path.join(root, 'debug', 'sites');
    const adapter = scripted();
    delete adapter.probe;
    delete adapter.settings;
    delete adapter.domDump;
    const driver = await driverFor(adapter, quiet, debugRoot);
    await driver.turn(request(true));
    const dir = await turnDir(debugRoot);
    const first = JSON.parse(await readFile(path.join(dir, 'snapshots', '0001.json'), 'utf8'));
    expect(Object.keys(first).sort()).toEqual(['generating', 'reply', 't']);
    expect(await readdir(dir)).not.toContain('dom-end.html');
  });
});
