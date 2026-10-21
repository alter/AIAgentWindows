// terminal-input.test.ts
import { describe, expect, it } from 'vitest';
import { dropPastePayload, quotePathForShell, rawKeySequence, sanitizePaste, type KeyLike } from '../../src/shared/terminal-input';

function key(overrides: Partial<KeyLike>): KeyLike {
  return { type: 'keydown', key: 'v', code: 'KeyV', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...overrides };
}

describe('rawKeySequence', () => {
  it('maps Ctrl+V to the control byte and Alt+V to escape-v', () => {
    expect(rawKeySequence(key({ ctrlKey: true }))).toBe('\x16');
    expect(rawKeySequence(key({ altKey: true, key: '√' }))).toBe('\x1bv');
  });

  it('leaves every other combination to the terminal', () => {
    expect(rawKeySequence(key({}))).toBeNull();
    expect(rawKeySequence(key({ ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(rawKeySequence(key({ metaKey: true }))).toBeNull();
    expect(rawKeySequence(key({ ctrlKey: true, altKey: true }))).toBeNull();
    expect(rawKeySequence(key({ ctrlKey: true, code: 'KeyC', key: 'c' }))).toBeNull();
  });

  it('matches by physical key so Alt+V works on layouts that change the character', () => {
    expect(rawKeySequence(key({ altKey: true, key: 'м', code: 'KeyV' }))).toBe('\x1bv');
  });
});

describe('quotePathForShell', () => {
  it('wraps a plain path in single quotes', () => {
    expect(quotePathForShell('/tmp/a b/c.txt')).toBe("'/tmp/a b/c.txt'");
  });

  it('escapes embedded single quotes and keeps other shell metacharacters inert', () => {
    expect(quotePathForShell("/tmp/it's")).toBe(`'/tmp/it'\\''s'`);
    expect(quotePathForShell('/tmp/a b"; touch /tmp/pwned; "')).toBe(`'/tmp/a b"; touch /tmp/pwned; "'`);
  });

  it('refuses empty paths and control characters, which could end a bracketed paste early', () => {
    expect(quotePathForShell('')).toBeNull();
    expect(quotePathForShell('/tmp/a\nb')).toBeNull();
    expect(quotePathForShell('/tmp/a\x1b[201~b')).toBeNull();
    expect(quotePathForShell('/tmp/a\x7fb')).toBeNull();
  });
});

describe('dropPastePayload', () => {
  it('joins quoted paths with a space and skips the unusable ones', () => {
    expect(dropPastePayload(['/a/one', '', '/a/two words', '/a/bad\nname'])).toBe("'/a/one' '/a/two words'");
  });

  it('returns an empty string when nothing is usable', () => {
    expect(dropPastePayload([])).toBe('');
    expect(dropPastePayload(['', '/x\ny'])).toBe('');
  });
});

describe('sanitizePaste', () => {
  it('removes every escape and C1 control so no paste marker survives, including a split one', () => {
    expect(sanitizePaste('\x1b[201~X\r')).toBe('[201~X\r');
    expect(sanitizePaste('a\x1b[20\x1b[201~1~b')).not.toContain('\x1b');
    expect(sanitizePaste('\x9b201~x')).toBe('201~x');
  });

  it('keeps ordinary text, tabs, newlines and non-Latin characters', () => {
    expect(sanitizePaste('line one\n\tline два')).toBe('line one\n\tline два');
  });
});
