// simple-ignore.test.ts
import { describe, expect, it } from 'vitest';
import { simpleIgnore } from '../../src/shared/simple-ignore';

describe('simpleIgnore', () => {
  const ignored = simpleIgnore(
    [
      '# a comment',
      '',
      '   ',
      '*.log',
      'build/',
      '/dist',
      'docs/tmp',
      '**/cache',
      'a?c.txt',
      'docs/**/draft.md',
      'gen/o**.txt',
      '!keep.log',
      'trailing.txt   ',
      'weird+name(1).txt',
      '',
    ].join('\r\n'),
  );

  it('matches a name pattern at any depth', () => {
    expect(ignored('error.log', false)).toBe(true);
    expect(ignored('deep/er/error.log', false)).toBe(true);
    expect(ignored('error.logs', false)).toBe(false);
    expect(ignored('trailing.txt', false)).toBe(true);
  });

  it('matches a directory-only pattern for directories only', () => {
    expect(ignored('build', true)).toBe(true);
    expect(ignored('src/build', true)).toBe(true);
    expect(ignored('build', false)).toBe(false);
  });

  it('anchors a pattern with a leading or inner slash to the project root', () => {
    expect(ignored('dist', true)).toBe(true);
    expect(ignored('dist', false)).toBe(true);
    expect(ignored('src/dist', true)).toBe(false);
    expect(ignored('docs/tmp', false)).toBe(true);
    expect(ignored('x/docs/tmp', false)).toBe(false);
  });

  it('reads ** as any run of characters and ? as one character, and treats the rest literally', () => {
    expect(ignored('one/two/cache', true)).toBe(true);
    expect(ignored('cache', true)).toBe(true);
    expect(ignored('docs/a/b/draft.md', false)).toBe(true);
    expect(ignored('docs/draft.md', false)).toBe(true);
    expect(ignored('docs/xdraft.md', false)).toBe(false);
    expect(ignored('gen/out-1.txt', false)).toBe(true);
    expect(ignored('abc.txt', false)).toBe(true);
    expect(ignored('a/c.txt', false)).toBe(false);
    expect(ignored('weird+name(1).txt', false)).toBe(true);
    expect(ignored('weirdXname(1).txt', false)).toBe(false);
  });

  it('skips comments, blanks and negations', () => {
    expect(ignored('keep.log', false)).toBe(true);
    expect(ignored('# a comment', false)).toBe(false);
  });

  it('ignores nothing for an empty file', () => {
    expect(simpleIgnore('')('anything', false)).toBe(false);
  });
});
