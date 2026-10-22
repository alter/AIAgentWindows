// reply-lines.ts
import { stripEntryMarkerLines } from '../../shared/room-history';

const MIN_ECHO_FRAGMENT = 12;
export const MIN_ANSWER_CHARS = 20;

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

export function extractReplyDetailed(current: string, before: string, prompt: string): ExtractedReply {
  const earlier = countLines(before.split('\n'));
  const left = new Map(earlier);
  const all = current.split('\n');
  const fresh = withoutLines(all, (key) => takeOne(left, key));
  const echoFree = withoutEcho(fresh, prompt);
  const markerFree = stripEntryMarkerLines(echoFree.join('\n')).split('\n');
  const candidates = withoutLines(markerFree, isUiLabel);
  const novel = withoutLines(candidates, (key) => earlier.has(key));
  const reply = joined(novel) ?? joined(candidates);
  const kept = joined(novel) === null ? candidates : novel;
  return {
    reply,
    dropped: {
      seen: filled(all) - filled(fresh) + filled(candidates) - filled(kept),
      echo: filled(fresh) - filled(echoFree),
      marker: filled(echoFree) - filled(markerFree),
      label: filled(markerFree) - filled(candidates),
    },
  };
}

export function extractReply(current: string, before: string, prompt: string): string | null {
  return extractReplyDetailed(current, before, prompt).reply;
}

export function isAnswerStart(reply: string | null): boolean {
  return reply !== null && collapse(reply).length >= MIN_ANSWER_CHARS;
}
