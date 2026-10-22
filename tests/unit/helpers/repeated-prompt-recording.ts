// repeated-prompt-recording.ts
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const REPEATED_PROMPT_LINES = [
  'Room so far: the owner asks the participants for one concrete point about the sample topic',
  'Reply with a short answer',
];

export const REPEATED_TIMING = { pollMs: 100, settleMs: 300, startGraceMs: 3000, timeoutMs: 20000, quietMs: 1000, maxReplyChars: 1000000 };

const HEADER = ['Sample chat title', 'Sidebar entry one', 'Sidebar entry two'];
const TAIL = ['Copy', 'Regenerate', 'Page footer text of the sample site'];
const OLD_REPLY = ['Old reply opens with a sentence about the sample topic', 'Old reply continues with a second sentence', 'Old reply ends here'];
export const NEW_REPLY = [
  'New reply opens with a different sentence about the topic',
  'New reply adds a second point that the old one lacked',
  'New reply adds a third point with some detail',
  'New reply closes with a short summary line',
];

export const NAVIGATOR_COPY = REPEATED_PROMPT_LINES.join(' ');

export function repeatedBefore(): string {
  return [...HEADER, ...REPEATED_PROMPT_LINES, ...OLD_REPLY, ...TAIL, NAVIGATOR_COPY].join('\n');
}

export function repeatedPage(replyLines: number): string {
  return [...HEADER, ...REPEATED_PROMPT_LINES, ...NEW_REPLY.slice(0, replyLines), ...TAIL, NAVIGATOR_COPY, NAVIGATOR_COPY].join('\n');
}

export const GROWTH_STEPS: ReadonlyArray<[number, number]> = [
  [0, 0],
  [600, 0],
  [1200, 1],
  [1800, 2],
  [2400, 3],
  [3000, 4],
];

export async function writeRepeatedPromptRecording(dir: string): Promise<{ lastChangeMs: number }> {
  await mkdir(path.join(dir, 'snapshots'), { recursive: true });
  const polls: number[] = [];
  for (let t = 0; t <= 8000; t += REPEATED_TIMING.pollMs) polls.push(t);
  const meta = { site: 'sample', runId: 'run', turn: 'repeated', timing: REPEATED_TIMING, outcome: 'failed', code: 'timeout', finishedAtMs: REPEATED_TIMING.timeoutMs, snapshots: GROWTH_STEPS.length };
  await writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta), 'utf8');
  await writeFile(path.join(dir, 'polls.json'), JSON.stringify(polls), 'utf8');
  await writeFile(path.join(dir, 'prompt.txt'), REPEATED_PROMPT_LINES.join('\n'), 'utf8');
  await writeFile(path.join(dir, 'before.txt'), repeatedBefore(), 'utf8');
  for (const [index, [t, replyLines]] of GROWTH_STEPS.entries()) {
    const name = `${String(index + 1).padStart(4, '0')}.json`;
    const snapshot = { t, generating: false, reply: null, text: repeatedPage(replyLines), stop: false, accepting: true };
    await writeFile(path.join(dir, 'snapshots', name), JSON.stringify(snapshot), 'utf8');
  }
  return { lastChangeMs: GROWTH_STEPS[GROWTH_STEPS.length - 1]?.[0] ?? 0 };
}
