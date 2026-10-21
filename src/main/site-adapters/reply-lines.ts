// reply-lines.ts
import { stripEntryMarkerLines } from '../../shared/room-history';

const MIN_ECHO_FRAGMENT = 12;

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

export function extractReply(current: string, before: string, prompt: string): string | null {
  const earlier = countLines(before.split('\n'));
  const left = new Map(earlier);
  const fresh = withoutLines(current.split('\n'), (key) => takeOne(left, key));
  const candidates = stripEntryMarkerLines(withoutEcho(fresh, prompt).join('\n')).split('\n');
  return joined(withoutLines(candidates, (key) => earlier.has(key))) ?? joined(candidates);
}
