// screen-reader.test.ts
import { describe, expect, it } from 'vitest';
import { ScreenReader } from '../../src/shared/screen-reader';

describe('screen reader', () => {
  it('returns the visible rows after cursor positioning, not the byte order', async () => {
    const reader = new ScreenReader(40, 10);
    reader.write('\x1b[2;8Hworld\x1b[2;1Hhello');
    const rows = (await reader.text()).split('\n');
    expect(rows[1]).toBe('hello  world');
    reader.dispose();
  });

  it('shows only what is still on the screen after a redraw', async () => {
    const reader = new ScreenReader(40, 4);
    reader.write('old dialog\r\n');
    reader.write('\x1b[2J\x1b[Hfresh');
    const text = await reader.text();
    expect(text).not.toContain('old dialog');
    expect(text).toContain('fresh');
    reader.dispose();
  });

  it('keeps the last rows when the output scrolls', async () => {
    const reader = new ScreenReader(40, 3);
    reader.write('one\r\ntwo\r\nthree\r\nfour');
    const text = await reader.text();
    expect(text.split('\n')).toHaveLength(3);
    expect(text).toContain('four');
    expect(text).not.toContain('one');
    reader.dispose();
  });

  it('follows a resize', async () => {
    const reader = new ScreenReader(40, 3);
    reader.resize(30, 5);
    expect((await reader.text()).split('\n')).toHaveLength(5);
    reader.dispose();
  });
});
