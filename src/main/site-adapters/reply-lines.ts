// reply-lines.ts
import { stripEntryMarkerLines } from '../../shared/room-history';

const MIN_ECHO_FRAGMENT = 12;
export const MIN_ANSWER_CHARS = 20;
const ECHO_KEY_CHARS = 48;
const TRAILING_ELLIPSIS = /\s*(…|\.{3})$/;

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}


function countLines(lines: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const key = collapse(line);
    if (key !== '') counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function takeOne(counts: Map<string, number>, key: string): boolean {
  const left = counts.get(key) ?? 0;
  if (left === 0) return false;
  counts.set(key, left - 1);
  return true;
}

function withoutLines(lines: readonly string[], known: (key: string) => boolean): string[] {
  return lines.filter((line) => {
    const key = collapse(line);
    return key === '' || !known(key);
  });
}

function joined(lines: readonly string[]): string | null {
  const text = lines.join('\n').trim();
  return text === '' ? null : text;
}

function echoMask(lines: readonly string[], prompt: string): boolean[] {
  const promptText = collapse(prompt);
  const promptLines = countLines(prompt.split('\n'));
  let rest = promptText;
  const consume = (key: string): void => {
    const at = rest.indexOf(key);
    if (at !== -1) rest = rest.slice(0, at) + rest.slice(at + key.length);
  };
  const isEcho = (key: string): boolean => {
    const stem = key.replace(TRAILING_ELLIPSIS, '');
    if (stem !== key) return stem.length >= MIN_ECHO_FRAGMENT && promptText.startsWith(stem);
    if (rest.includes(key)) {
      const exact = takeOne(promptLines, key);
      if (exact || key.length >= MIN_ECHO_FRAGMENT) {
        consume(key);
        return true;
      }
    }
    return key.length >= MIN_ECHO_FRAGMENT && promptText.startsWith(key);
  };
  return lines.map((line) => {
    const key = collapse(line);
    return key !== '' && isEcho(key);
  });
}

function withoutEcho(lines: readonly string[], prompt: string): string[] {
  const mask = echoMask(lines, prompt);
  return lines.filter((_, index) => !mask[index]);
}

export interface ReplyDrops {
  seen: number;
  echo: number;
  marker: number;
  label: number;
}

export interface ExtractedReply {
  reply: string | null;
  dropped: ReplyDrops;
}

const UI_LABELS: readonly RegExp[] = [
  /^(new chat|deep ?think(ing)?|smart search|regenerate|copy|share|like|dislike)$/i,
  /^(thinking|reasoning|searching( the web)?|generating)[.…]*$/i,
  /^thought for [^.]{1,24}$/i,
  /^(found|read|searched)?\s*\d+\s+web pages$/i,
];

const DISCLAIMER = /ai-generated|for reference only|can make mistakes/i;
const MAX_DISCLAIMER_CHARS = 60;

export function isUiLabel(line: string): boolean {
  const key = collapse(line);
  return UI_LABELS.some((label) => label.test(key)) || (key.length <= MAX_DISCLAIMER_CHARS && DISCLAIMER.test(key));
}

function filled(lines: readonly string[]): number {
  return lines.filter((line) => collapse(line) !== '').length;
}

export interface AnchoredReply extends ExtractedReply {
  echoFound: boolean;
  keyHits: number;
  anchorRank: number;
  hitsAtLineStart: number;
}

interface EchoHits {
  tails: string[];
  hitsAtLineStart: number;
  lineKeys: number[];
}

export const KEY_NONE = 0;
export const KEY_AT_START = 1;
export const KEY_MID_LINE = 2;

function echoHits(text: string, prompt: string): EchoHits {
  const key = collapse(prompt).slice(0, ECHO_KEY_CHARS).trimEnd();
  const lines = text.split('\n');
  const lineKeys = lines.map(() => KEY_NONE);
  if (key === '') return { tails: [], hitsAtLineStart: 0, lineKeys };
  const starts: number[] = [];
  let joined = '';
  for (const line of lines) {
    starts.push(joined.length);
    joined += `${collapse(line)} `;
  }
  const hits: number[] = [];
  for (let at = joined.indexOf(key); at !== -1; at = joined.indexOf(key, at + 1)) hits.push(at);
  const atStart: string[] = [];
  const midLine: string[] = [];
  const taken = new Set<string>();
  for (let n = hits.length - 1; n >= 0; n -= 1) {
    const at = hits[n] ?? 0;
    let index = starts.length - 1;
    while (index > 0 && (starts[index] ?? 0) > at) index -= 1;
    const offset = at - (starts[index] ?? 0);
    lineKeys[index] = Math.max(lineKeys[index] ?? KEY_NONE, offset === 0 ? KEY_AT_START : KEY_MID_LINE);
    const id = `${index}:${offset}`;
    if (taken.has(id)) continue;
    taken.add(id);
    const first = offset === 0 ? (lines[index] ?? '') : collapse(lines[index] ?? '').slice(offset);
    (offset === 0 ? atStart : midLine).push([first, ...lines.slice(index + 1)].join('\n'));
  }
  const tails = [...atStart, ...midLine];
  const hitsAtLineStart = atStart.length;
  return { tails, hitsAtLineStart, lineKeys };
}

export function echoTails(text: string, prompt: string): string[] {
  return echoHits(text, prompt).tails;
}

export function anchorAfterEcho(text: string, prompt: string): string | null {
  return echoTails(text, prompt)[0] ?? null;
}

interface CleanedTail {
  fresh: string[];
  echoFree: string[];
  markerFree: string[];
  candidates: string[];
}

function cleanTail(tail: string, prompt: string): CleanedTail {
  const fresh = tail.split('\n');
  const echoFree = withoutEcho(fresh, prompt);
  const markerFree = stripEntryMarkerLines(echoFree.join('\n')).split('\n');
  return { fresh, echoFree, markerFree, candidates: withoutLines(markerFree, isUiLabel) };
}

function hasAnswer(cleaned: CleanedTail): boolean {
  return isAnswerStart(joined(cleaned.candidates));
}

interface Anchor {
  tail: string | null;
  keyHits: number;
  rank: number;
  hitsAtLineStart: number;
}

function chooseAnchor(unseen: string, prompt: string): Anchor {
  const { tails, hitsAtLineStart } = echoHits(unseen, prompt);
  if (tails.length === 0) return { tail: null, keyHits: 0, rank: -1, hitsAtLineStart };
  const found = tails.findIndex((tail) => hasAnswer(cleanTail(tail, prompt)));
  const rank = found === -1 ? 0 : found;
  return { tail: tails[rank] ?? null, keyHits: tails.length, rank, hitsAtLineStart };
}

function extract(current: string, before: string, prompt: string, anchored: boolean): AnchoredReply {
  const earlier = countLines(before.split('\n'));
  const left = new Map(earlier);
  const all = current.split('\n');
  const unseen = withoutLines(all, (key) => takeOne(left, key));
  const unseenText = unseen.join('\n');
  const anchor: Anchor = anchored ? chooseAnchor(unseenText, prompt) : { tail: unseenText, keyHits: 0, rank: -1, hitsAtLineStart: 0 };
  const { fresh, echoFree, markerFree, candidates } = cleanTail(anchor.tail ?? '', prompt);
  const novel = withoutLines(candidates, (key) => earlier.has(key));
  const reply = joined(novel) ?? joined(candidates);
  const kept = joined(novel) === null ? candidates : novel;
  return {
    reply,
    echoFound: anchor.tail !== null,
    keyHits: anchor.keyHits,
    anchorRank: anchor.rank,
    hitsAtLineStart: anchor.hitsAtLineStart,
    dropped: {
      seen: filled(all) - filled(unseen) + filled(candidates) - filled(kept),
      echo: filled(fresh) - filled(echoFree),
      marker: filled(echoFree) - filled(markerFree),
      label: filled(markerFree) - filled(candidates),
    },
  };
}

export function extractReplyDetailed(current: string, before: string, prompt: string): ExtractedReply {
  const { reply, dropped } = extract(current, before, prompt, false);
  return { reply, dropped };
}

export function extractAnchoredReply(current: string, before: string, prompt: string): AnchoredReply {
  return extract(current, before, prompt, true);
}

export function extractReply(current: string, before: string, prompt: string): string | null {
  return extractReplyDetailed(current, before, prompt).reply;
}

export function isAnswerStart(reply: string | null): boolean {
  return reply !== null && collapse(reply).length >= MIN_ANSWER_CHARS;
}

export interface LineReport {
  lines: number;
  listed: number;
  hitsAtLineStart: number;
  entries: string;
}

export const MAX_REPORTED_LINES = 400;

export function describeLines(current: string, before: string, prompt: string): LineReport {
  const lines = current.split('\n');
  const left = countLines(before.split('\n'));
  const seen = lines.map((line) => {
    const key = collapse(line);
    return key !== '' && takeOne(left, key);
  });
  const unseenIndexes = lines.map((_, index) => index).filter((index) => !seen[index]);
  const mask = echoMask(unseenIndexes.map((index) => lines[index] ?? ''), prompt);
  const echo = new Set(unseenIndexes.filter((_, position) => mask[position]));
  const { hitsAtLineStart, lineKeys } = echoHits(current, prompt);
  const from = Math.max(0, lines.length - MAX_REPORTED_LINES);
  const entries = lines.slice(from).map((line, offset) => {
    const index = from + offset;
    const flags = [lineKeys[index] ?? KEY_NONE, echo.has(index) ? 1 : 0, isUiLabel(line) ? 1 : 0, seen[index] ? 1 : 0];
    return `${collapse(line).length}:${flags.join('')}`;
  });
  return { lines: lines.length, listed: entries.length, hitsAtLineStart, entries: entries.join(',') };
}
