// decide.ts
import { extractAnchoredReply, isAnswerStart, type ReplyDrops } from './reply-lines';

export interface PageRead {
  stop: boolean;
  text: string;
  accepting: boolean;
}

export interface ReplyTrack {
  started: boolean;
  lastSeen: string | null;
  changedAt: number;
  firstGrowthMs: number;
}

export interface Observation {
  track: ReplyTrack;
  reply: string | null;
  echoFound: boolean;
  keyHits: number;
  anchorRank: number;
  hitsAtLineStart: number;
  drops: ReplyDrops;
}

export function freshTrack(): ReplyTrack {
  return { started: false, lastSeen: null, changedAt: 0, firstGrowthMs: -1 };
}

export function observe(
  track: ReplyTrack,
  read: PageRead,
  before: string,
  prompt: string,
  now: number,
  sinceSubmitMs: number,
  maxReplyChars: number,
): Observation {
  const found = extractAnchoredReply(read.text, before, prompt);
  const text = track.started || isAnswerStart(found.reply) ? found.reply : null;
  const begins = text !== null && !track.started;
  const grown = begins ? { started: true, firstGrowthMs: sinceSubmitMs } : {};
  const moved = text !== track.lastSeen ? { lastSeen: text, changedAt: now } : {};
  return {
    track: { ...track, ...grown, ...moved },
    reply: text === null ? null : text.slice(0, maxReplyChars),
    echoFound: found.echoFound,
    keyHits: found.keyHits,
    anchorRank: found.anchorRank,
    hitsAtLineStart: found.hitsAtLineStart,
    drops: found.dropped,
  };
}

export interface GeneratingVerdict {
  generating: boolean;
  settledText: string | null;
}

export function judgeGenerating(track: ReplyTrack, read: PageRead, now: number, quietMs: number): GeneratingVerdict {
  if (read.stop) return { generating: true, settledText: null };
  if (!track.started) return { generating: false, settledText: null };
  const generating = now - track.changedAt < quietMs || !read.accepting;
  return { generating, settledText: generating ? null : read.text };
}

export interface LoopState {
  answering: boolean;
  sawGenerating: boolean;
  idleSince: number | null;
}

export interface LoopInput {
  now: number;
  started: number;
  generating: boolean;
  reply: string | null;
  baseline: string | null;
  echoSeen: boolean;
}

export interface LoopOptions {
  timeoutMs: number;
  startGraceMs: number;
  settleMs: number;
}

export type LoopVerdict = 'continue' | 'no-response' | 'done';

export interface LoopStep {
  state: LoopState;
  verdict: LoopVerdict;
}

export function freshLoop(): LoopState {
  return { answering: false, sawGenerating: false, idleSince: null };
}

export function timedOut(now: number, started: number, timeoutMs: number): boolean {
  return now - started >= timeoutMs;
}

export function stepLoop(state: LoopState, input: LoopInput, options: LoopOptions): LoopStep {
  const { now, started, generating, reply, baseline } = input;
  const changed = reply !== baseline;
  const sawGenerating = state.sawGenerating || generating;
  const answering = state.answering || generating || changed;
  if (!answering && now - started >= options.startGraceMs && !input.echoSeen) {
    return { state: { answering, sawGenerating, idleSince: state.idleSince }, verdict: 'no-response' };
  }
  if (answering && !generating && reply !== null && (changed || sawGenerating)) {
    const idleSince = state.idleSince ?? now;
    const verdict = now - idleSince >= options.settleMs ? 'done' : 'continue';
    return { state: { answering, sawGenerating, idleSince }, verdict };
  }
  return { state: { answering, sawGenerating, idleSince: null }, verdict: 'continue' };
}
