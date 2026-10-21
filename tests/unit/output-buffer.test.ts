// output-buffer.test.ts
import { describe, expect, it } from 'vitest';
import { OutputBuffer, OUTPUT_BACKLOG_LIMIT } from '../../src/shared/output-buffer';

describe('OutputBuffer', () => {
  it('starts empty', () => {
    expect(new OutputBuffer(10).snapshot()).toEqual({ data: '', end: 0 });
  });

  it('keeps everything under the cap and counts the total', () => {
    const buffer = new OutputBuffer(100);
    expect(buffer.append('abc')).toBe(3);
    expect(buffer.append('def')).toBe(6);
    expect(buffer.snapshot()).toEqual({ data: 'abcdef', end: 6 });
  });

  it('drops the oldest characters over the cap and keeps counting', () => {
    const buffer = new OutputBuffer(5);
    buffer.append('abc');
    buffer.append('defg');
    expect(buffer.snapshot()).toEqual({ data: 'cdefg', end: 7 });
  });

  it('drops whole oldest chunks when they overflow completely', () => {
    const buffer = new OutputBuffer(5);
    buffer.append('abc');
    buffer.append('de');
    buffer.append('fgh');
    expect(buffer.snapshot()).toEqual({ data: 'defgh', end: 8 });
  });

  it('trims inside the oldest chunk when only part of it overflows', () => {
    const buffer = new OutputBuffer(6);
    buffer.append('abcd');
    buffer.append('ef');
    buffer.append('gh');
    expect(buffer.snapshot()).toEqual({ data: 'cdefgh', end: 8 });
  });

  it('keeps only the tail of a single chunk larger than the cap', () => {
    const buffer = new OutputBuffer(4);
    buffer.append('0123456789');
    expect(buffer.snapshot()).toEqual({ data: '6789', end: 10 });
  });

  it('ignores empty chunks', () => {
    const buffer = new OutputBuffer(4);
    buffer.append('');
    expect(buffer.snapshot()).toEqual({ data: '', end: 0 });
  });

  it('defaults to a 256 KB cap', () => {
    expect(OUTPUT_BACKLOG_LIMIT).toBe(256 * 1024);
    const buffer = new OutputBuffer();
    buffer.append('x'.repeat(OUTPUT_BACKLOG_LIMIT + 10));
    expect(buffer.snapshot().data).toHaveLength(OUTPUT_BACKLOG_LIMIT);
  });
});
