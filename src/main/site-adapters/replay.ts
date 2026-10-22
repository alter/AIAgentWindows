// replay.ts
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { freshLoop, freshTrack, judgeGenerating, observe, stepLoop, timedOut } from './decide';

export interface ReplayTiming {
  pollMs: number;
  settleMs: number;
  startGraceMs: number;
  timeoutMs: number;
  quietMs: number;
  maxReplyChars: number;
}

export interface RecordedMeta {
  timing: ReplayTiming;
  outcome: string;
  code: string;
  finishedAtMs: number;
  polls: number[];
}

export interface RecordedSnapshot {
  t: number;
  text: string;
  stop: boolean;
  accepting: boolean;
}

export interface Recording {
  meta: RecordedMeta;
  prompt: string;
  before: string;
  snapshots: RecordedSnapshot[];
}

export interface ReplayLine {
  t: number;
  textChars: number;
  replyChars: number;
  started: boolean;
  generating: boolean;
  keyHits: number;
  anchorRank: number;
}

export interface ReplayResult {
  lines: ReplayLine[];
  outcome: 'reply' | 'timeout' | 'no-response';
  finishedAtMs: number;
  reply: string | null;
}

function ticksAfter(snapshotT: number, nextT: number | null, timing: ReplayTiming, polls: readonly number[]): number[] {
  const upto = Math.min(nextT ?? Number.POSITIVE_INFINITY, timing.timeoutMs + timing.pollMs);
  if (polls.length > 0) return polls.filter((t) => t > snapshotT && t < upto);
  const ticks: number[] = [];
  for (let t = snapshotT + Math.max(1, timing.pollMs); t < upto; t += Math.max(1, timing.pollMs)) ticks.push(t);
  return ticks;
}

export function replay(recording: Recording): ReplayResult {
  const { timing, polls } = recording.meta;
  const snapshots = [...recording.snapshots].sort((a, b) => a.t - b.t);
  if (snapshots.length === 0) throw new Error('the recording has no snapshots');
  const options = { timeoutMs: timing.timeoutMs, startGraceMs: timing.startGraceMs, settleMs: timing.settleMs };
  let track = freshTrack();
  let loop = freshLoop();
  const lines: ReplayLine[] = [];
  for (const [index, snapshot] of snapshots.entries()) {
    const next = snapshots[index + 1]?.t ?? null;
    const times = [snapshot.t, ...ticksAfter(snapshot.t, next, timing, polls)];
    for (const [position, now] of times.entries()) {
      if (timedOut(now, 0, timing.timeoutMs)) return { lines, outcome: 'timeout', finishedAtMs: now, reply: null };
      const seen = observe(track, snapshot, recording.before, recording.prompt, now, now, timing.maxReplyChars);
      track = seen.track;
      const { generating } = judgeGenerating(track, snapshot, now, timing.quietMs);
      if (position === 0) {
        lines.push({
          t: snapshot.t,
          textChars: snapshot.text.length,
          replyChars: seen.reply?.length ?? 0,
          started: track.started,
          generating,
          keyHits: seen.keyHits,
          anchorRank: seen.anchorRank,
        });
      }
      const step = stepLoop(loop, { now, started: 0, generating, reply: seen.reply, baseline: null, echoSeen: seen.echoFound }, options);
      loop = step.state;
      if (step.verdict === 'no-response') return { lines, outcome: 'no-response', finishedAtMs: now, reply: null };
      if (step.verdict === 'done') return { lines, outcome: 'reply', finishedAtMs: now, reply: seen.reply };
    }
  }
  return { lines, outcome: 'timeout', finishedAtMs: timing.timeoutMs, reply: null };
}

export function formatReplay(result: ReplayResult, meta: RecordedMeta): string[] {
  const rows = result.lines.map(
    (line) =>
      `t=${line.t} text=${line.textChars} reply=${line.replyChars} started=${line.started} generating=${line.generating} keyHits=${line.keyHits} anchorRank=${line.anchorRank}`,
  );
  const recorded = `recorded=${meta.outcome}${meta.code === '' ? '' : `:${meta.code}`} recordedAtMs=${meta.finishedAtMs}`;
  return [...rows, `outcome=${result.outcome} finishedAtMs=${result.finishedAtMs} ${recorded}`];
}

async function readText(file: string): Promise<string> {
  return readFile(file, 'utf8');
}

export async function readRecording(dir: string): Promise<Recording> {
  const meta = JSON.parse(await readText(path.join(dir, 'meta.json'))) as RecordedMeta;
  meta.polls = await readText(path.join(dir, 'polls.json')).then(
    (raw) => JSON.parse(raw) as number[],
    () => [],
  );
  const names = (await readdir(path.join(dir, 'snapshots'))).filter((name) => name.endsWith('.json')).sort();
  const snapshots: RecordedSnapshot[] = [];
  for (const name of names) {
    const value = JSON.parse(await readText(path.join(dir, 'snapshots', name))) as Partial<RecordedSnapshot>;
    if (typeof value.text !== 'string' || typeof value.t !== 'number') {
      throw new Error(`snapshot ${name} has no page text, so this site's adapter cannot be replayed`);
    }
    snapshots.push({ t: value.t, text: value.text, stop: value.stop === true, accepting: value.accepting === true });
  }
  return { meta, prompt: await readText(path.join(dir, 'prompt.txt')), before: await readText(path.join(dir, 'before.txt')), snapshots };
}

export async function runReplay(dir: string): Promise<string[]> {
  const recording = await readRecording(dir);
  return formatReplay(replay(recording), recording.meta);
}
