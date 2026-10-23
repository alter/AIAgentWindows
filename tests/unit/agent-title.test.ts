// agent-title.test.ts
import { describe, expect, it } from 'vitest';
import { MAX_AGENT_TITLE_CHARS, parseAgentTitle } from '../../src/shared/agents';

describe('parseAgentTitle', () => {
  it('trims and accepts one to eighty characters', () => {
    expect(parseAgentTitle('  Reviewer  ')).toBe('Reviewer');
    expect(parseAgentTitle('x')).toBe('x');
    expect(MAX_AGENT_TITLE_CHARS).toBe(80);
    expect(parseAgentTitle('x'.repeat(80))).toBe('x'.repeat(80));
    expect(parseAgentTitle('<b>bold</b> & "quoted"')).toBe('<b>bold</b> & "quoted"');
  });

  it('refuses empty, blank, too long and non-string values', () => {
    for (const value of ['', '   ', 'x'.repeat(81), 7, null, undefined, {}, ['a']]) {
      expect(parseAgentTitle(value)).toBeNull();
    }
  });

  it('refuses control characters and line separators anywhere', () => {
    for (const value of ['a\nb', 'a\u0000b', 'a\tb', 'a\u007fb', 'a\u0085b', 'a\u009fb', 'a\u2028b', 'a\u2029b']) {
      expect(parseAgentTitle(value)).toBeNull();
    }
  });
});
