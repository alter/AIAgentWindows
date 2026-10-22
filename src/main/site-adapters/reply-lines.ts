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

function withoutEcho(lines: readonly string[], prompt: string): string[] {
  const promptText = collapse(prompt);
  const promptLines = countLines(prompt.split('\n'));
  let rest = promptText;
  const consume = (key: string): void => {
    const at = rest.indexOf(key);
    if (at !== -1) rest = rest.slice(0, at) + rest.slice(at + key.length);
  };
  return withoutLines(lines, (key) => {
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
  });
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
}

export function echoTails(text: string, prompt: string): string[] {
  const key = collapse(prompt).slice(0, ECHO_KEY_CHARS).trimEnd();
  if (key === '') return [];
  const lines = text.split('\n');
  const starts: number[] = [];
  let joined = '';
  for (const line of lines) {
    starts.push(joined.length);
    joined += `${collapse(line)} `;
  }
  const lineStarts = new Set(starts);
  const hits: number[] = [];
  for (let at = joined.indexOf(key); at !== -1; at = joined.indexOf(key, at + 1)) hits.push(at);
  const atLineStart = hits.filter((at) => lineStarts.has(at));
  const chosen = atLineStart.length > 0 ? atLineStart : hits;
  const indexes: number[] = [];
  for (let n = chosen.length - 1; n >= 0; n -= 1) {
    const at = chosen[n] ?? 0;
    let index = starts.length - 1;
    while (index > 0 && (starts[index] ?? 0) > at) index -= 1;
    if (!indexes.includes(index)) indexes.push(index);
  }
  return indexes.map((index) => lines.slice(index).join('\n'));
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
}

function chooseAnchor(unseen: string, prompt: string): Anchor {
  const tails = echoTails(unseen, prompt);
  if (tails.length === 0) return { tail: null, keyHits: 0, rank: -1 };
  const found = tails.findIndex((tail) => hasAnswer(cleanTail(tail, prompt)));
  const rank = found === -1 ? 0 : found;
  return { tail: tails[rank] ?? null, keyHits: tails.length, rank };
}

function extract(current: string, before: string, prompt: string, anchored: boolean): AnchoredReply {
  const earlier = countLines(before.split('\n'));
  const left = new Map(earlier);
  const all = current.split('\n');
  const unseen = withoutLines(all, (key) => takeOne(left, key));
  const unseenText = unseen.join('\n');
  const anchor: Anchor = anchored ? chooseAnchor(unseenText, prompt) : { tail: unseenText, keyHits: 0, rank: -1 };
  const { fresh, echoFree, markerFree, candidates } = cleanTail(anchor.tail ?? '', prompt);
  const novel = withoutLines(candidates, (key) => earlier.has(key));
  const reply = joined(novel) ?? joined(candidates);
  const kept = joined(novel) === null ? candidates : novel;
  return {
    reply,
    echoFound: anchor.tail !== null,
    keyHits: anchor.keyHits,
    anchorRank: anchor.rank,
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
