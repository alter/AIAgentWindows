// recorder.ts
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SiteLogValue } from '../../shared/site-log';
import type { PollSample, TurnTap } from './turn';
import type { NetSink } from './types';

export interface RecorderOptions {
  root: string;
  runId: string;
  site: string;
  turn: string;
  prompt: string;
  timing: Readonly<Record<string, number>>;
  onFail(code: string): void;
  now?(): number;
}

export interface RecorderFinish {
  outcome: string;
  code: string;
  trace: Readonly<Record<string, SiteLogValue>>;
  dom: string | null;
}

export interface TurnRecorder extends TurnTap, NetSink {
  readonly dir: string;
  finish(info: RecorderFinish): Promise<void>;
}

function pad(value: number): string {
  return String(value).padStart(4, '0');
}

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'error';
}

export function createTurnRecorder(options: RecorderOptions): TurnRecorder {
  const now = options.now ?? Date.now;
  const begun = now();
  const dir = path.join(options.root, options.runId, `${options.site}-${options.turn}`);
  let queue: Promise<void> = Promise.resolve();
  let broken = false;
  let snapshots = 0;
  let bodies = 0;
  let previous: string | null = null;
  let submittedAt: number | null = null;
  let lastPollT = 0;
  const polls: number[] = [];

  const enqueue = (work: () => Promise<void>): Promise<void> => {
    queue = queue.then(async () => {
      if (broken) return;
      try {
        await work();
      } catch (error) {
        broken = true;
        options.onFail(errorCode(error));
      }
    });
    return queue;
  };

  void enqueue(async () => {
    await mkdir(path.join(dir, 'snapshots'), { recursive: true });
    await writeFile(path.join(dir, 'prompt.txt'), options.prompt, 'utf8');
  });

  const event = (name: string, fields: Readonly<Record<string, SiteLogValue>> = {}): void => {
    const at = now();
    if (name === 'submit') submittedAt = at;
    const line = JSON.stringify({ at: at - begun, event: name, ...fields });
    void enqueue(() => appendFile(path.join(dir, 'events.jsonl'), `${line}\n`, 'utf8'));
  };

  return {
    dir,
    event,
    before(text) {
      void enqueue(() => writeFile(path.join(dir, 'before.txt'), text, 'utf8'));
    },
    poll(sample: PollSample) {
      lastPollT = sample.t;
      polls.push(sample.t);
      const { t, ...decision } = sample;
      const key = JSON.stringify(decision);
      if (key === previous) return;
      previous = key;
      snapshots += 1;
      const file = path.join(dir, 'snapshots', `${pad(snapshots)}.json`);
      const body = JSON.stringify({ t, ...decision });
      void enqueue(() => writeFile(file, body, 'utf8'));
    },
    saveBody(text) {
      bodies += 1;
      const name = `${pad(bodies)}.txt`;
      const file = path.join(dir, 'net', name);
      const written = enqueue(async () => {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, text, 'utf8');
      });
      return written.then(() => (broken ? null : `net/${name}`));
    },
    finish(info) {
      const finishedAt = now();
      const afterSubmit = finishedAt - (submittedAt ?? begun);
      const meta = {
        site: options.site,
        runId: options.runId,
        turn: options.turn,
        startedAt: new Date(begun).toISOString(),
        finishedAt: new Date(finishedAt).toISOString(),
        timing: options.timing,
        outcome: info.outcome,
        code: info.code,
        finishedAtMs: info.outcome === 'reply' ? lastPollT : afterSubmit,
        snapshots,
        trace: info.trace,
      };
      if (info.dom !== null) {
        const html = info.dom;
        void enqueue(() => writeFile(path.join(dir, 'dom-end.html'), html, 'utf8'));
      }
      void enqueue(() => writeFile(path.join(dir, 'polls.json'), JSON.stringify(polls), 'utf8'));
      return enqueue(() => writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8'));
    },
  };
}
