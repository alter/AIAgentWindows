// plan-file.ts
import type { RoomEntry } from './room-model';

export const MAX_SLUG_CHARS = 80;
const MAX_SLUG_BYTES = 240;
const HEAD_LINES = 8;
const RUNNING_LINE = /^status: *running *$/;
const RUNNING_ANYWHERE = /status:\s*running/;
const DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

export type SavePlanResult =
  | { ok: true; file: string }
  | { ok: false; error: string }
  | { ok: false; error: string; exists: true; file: string };

function cutSlug(flat: string): string {
  let out = '';
  let count = 0;
  for (const char of flat) {
    if (count === MAX_SLUG_CHARS || Buffer.byteLength(out + char, 'utf8') > MAX_SLUG_BYTES) break;
    out += char;
    count += 1;
  }
  return out.replace(/-+$/, '');
}

export function planSlug(title: string, roomId: string): string {
  const flat = title
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  const slug = cutSlug(flat);
  return slug === '' || DEVICE_NAME.test(slug) ? `room-${roomId}` : slug;
}

export function planText(raw: string): string {
  const lines = raw.split('\n');
  for (let index = 0; index < Math.min(HEAD_LINES, lines.length); index += 1) {
    const line = lines[index] ?? '';
    const body = line.endsWith('\r') ? line.slice(0, -1) : line;
    const tail = line.slice(body.length);
    if (RUNNING_LINE.test(body)) lines[index] = `status: draft${tail}`;
    else if (RUNNING_ANYWHERE.test(body)) lines[index] = `${body.replace(RUNNING_ANYWHERE, 'status: draft')}${tail}`;
  }
  return lines.join('\n');
}

export function lastFinalText(entries: readonly RoomEntry[]): string | null {
  const last = [...entries].reverse().find((entry) => entry.kind === 'final');
  return last === undefined || last.text.length === 0 ? null : last.text;
}
