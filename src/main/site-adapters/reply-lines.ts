// reply-lines.ts
import { stripEntryMarkerLines } from '../../shared/room-history';

const MIN_ECHO_FRAGMENT = 12;

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function pageLines(text: string): string[] {
  return stripEntryMarkerLines(text).split('\n');
}

function countLines(lines: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const key = collapse(line);
    if (key !== '') counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function isEcho(key: string, promptLines: ReadonlySet<string>, promptText: string): boolean {
  return promptLines.has(key) || (key.length >= MIN_ECHO_FRAGMENT && promptText.includes(key));
}

function keepNew(lines: readonly string[], known: (key: string) => boolean): string[] {
  return lines.filter((line) => {
    const key = collapse(line);
    return key === '' || !known(key);
  });
}

function joined(lines: readonly string[]): string | null {
  const text = lines.join('\n').trim();
  return text === '' ? null : text;
}

export function extractReply(current: string, before: string, prompt: string): string | null {
  const promptText = collapse(prompt);
  const promptLines = new Set(countLines(prompt.split('\n')).keys());
  const echoed = (key: string): boolean => isEcho(key, promptLines, promptText);
  const lines = pageLines(current).filter((line) => !echoed(collapse(line)));
  const earlier = countLines(pageLines(before));
  const unseen = joined(keepNew(lines, (key) => earlier.has(key)));
  if (unseen !== null) return unseen;
  const remaining = new Map(earlier);
  return joined(
    keepNew(lines, (key) => {
      const left = remaining.get(key) ?? 0;
      if (left === 0) return false;
      remaining.set(key, left - 1);
      return true;
    }),
  );
}
