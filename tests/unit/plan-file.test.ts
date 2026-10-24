// plan-file.test.ts
import { describe, expect, it } from 'vitest';
import { lastFinalText, MAX_SLUG_CHARS, planSlug, planText } from '../../src/shared/plan-file';
import type { RoomEntry } from '../../src/shared/room-model';

function entry(kind: RoomEntry['kind'], text: string): RoomEntry {
  return { authorId: 'a', label: 'A', time: 1, kind, text };
}

describe('planSlug', () => {
  it('lowercases a title and joins its words with single dashes', () => {
    expect(planSlug('  Plan: the  NEW   login flow! ', 'r1')).toBe('plan-the-new-login-flow');
  });

  it('keeps letters and digits of any script', () => {
    expect(planSlug('План №2 для проекта', 'r1')).toBe('план-2-для-проекта');
  });

  it('never carries a separator, a dot run or a control character', () => {
    for (const title of ['../../etc/passwd', 'a/b\\c', '..', 'x\u0000y\nz', 'a..b', '.hidden', 'name.md']) {
      const slug = planSlug(title, 'r1');
      expect(slug).not.toMatch(/[\\/.]/);
      expect(Array.from(slug).every((char) => (char.codePointAt(0) ?? 0) > 0x1f)).toBe(true);
      expect(slug.length).toBeGreaterThan(0);
    }
    expect(planSlug('../../etc/passwd', 'r1')).toBe('etc-passwd');
  });

  it('falls back to room-<id> when nothing is left', () => {
    expect(planSlug('...///', 'abc123')).toBe('room-abc123');
    expect(planSlug('', 'abc123')).toBe('room-abc123');
    expect(planSlug('🙂🙂', 'abc123')).toBe('room-abc123');
  });

  it('falls back for a Windows device name', () => {
    for (const title of ['CON', 'nul', 'com1', 'LPT9', 'aux', 'prn']) expect(planSlug(title, 'r7')).toBe('room-r7');
    expect(planSlug('console', 'r7')).toBe('console');
  });

  it('cuts to 80 characters and leaves no trailing dash', () => {
    const slug = planSlug(`${'a'.repeat(79)} bbbb`, 'r1');
    expect(slug).toBe('a'.repeat(79));
    expect(planSlug('b'.repeat(200), 'r1')).toHaveLength(MAX_SLUG_CHARS);
  });

  it('keeps the name within 240 bytes for letters of four bytes', () => {
    const slug = planSlug('\u{20000}'.repeat(100), 'r1');
    expect(Buffer.byteLength(slug, 'utf8')).toBeLessThanOrEqual(240);
    expect(slug.length).toBeGreaterThan(0);
  });
});

describe('planText', () => {
  const draft = 'status: draft';

  it('rewrites the status line of leading front matter', () => {
    expect(planText('---\nstatus: running\n---\n\n# Plan\n')).toBe(`---\n${draft}\n---\n\n# Plan\n`);
  });

  it('rewrites a status line inside a fenced block after an intro line', () => {
    const raw = 'Here is the plan in this repository format:\n\n```markdown\n---\nstatus: running\n---\n- [ ] T01 x\n```\n';
    expect(planText(raw)).toBe(raw.replace('status: running', draft));
  });

  it('rewrites a bare status line without front matter', () => {
    expect(planText('status: running\n\n# Plan')).toBe(`${draft}\n\n# Plan`);
  });

  it('rewrites status:running, extra spaces and trailing spaces to the one draft line', () => {
    expect(planText('status:running\nbody')).toBe(`${draft}\nbody`);
    expect(planText('status:    running   \nbody')).toBe(`${draft}\nbody`);
  });

  it('rewrites the loose pattern inside a line and keeps the rest of it', () => {
    expect(planText('  status: running # live\nbody')).toBe('  status: draft # live\nbody');
  });

  it('rewrites every matching line among the first 8 and none after', () => {
    const lines = Array.from({ length: 10 }, () => 'status: running');
    const out = planText(lines.join('\n')).split('\n');
    expect(out.slice(0, 8)).toEqual(Array(8).fill(draft));
    expect(out.slice(8)).toEqual(['status: running', 'status: running']);
  });

  it('keeps a carriage return where the line had one', () => {
    expect(planText('status: running\r\nbody\r\n')).toBe(`${draft}\r\nbody\r\n`);
    expect(planText('  status: running\r\n')).toBe('  status: draft\r\n');
  });

  it('leaves other statuses and a text of one line alone', () => {
    expect(planText('status: draft\nstatus: done\nstatus: ran')).toBe('status: draft\nstatus: done\nstatus: ran');
    expect(planText('')).toBe('');
    expect(planText('no status here')).toBe('no status here');
  });
});

describe('lastFinalText', () => {
  it('takes the raw text of the last final entry, not of a reply', () => {
    const raw = '# Plan\n<b>& `code`</b>\n';
    expect(lastFinalText([entry('prompt', 'q'), entry('final', 'old'), entry('reply', 'r'), entry('final', raw), entry('error', 'e')])).toBe(raw);
  });

  it('is null without a final entry or with an empty one', () => {
    expect(lastFinalText([entry('prompt', 'q'), entry('reply', 'r')])).toBeNull();
    expect(lastFinalText([entry('final', '')])).toBeNull();
    expect(lastFinalText([])).toBeNull();
  });
});
