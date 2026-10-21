// reply-lines.test.ts
import { describe, expect, it } from 'vitest';
import { extractReply } from '../../src/main/site-adapters/reply-lines';
import { stripEntryMarkerLines } from '../../src/shared/room-history';

const PROMPT = ['Intro line that is long enough', '<<<entry-abc author="Owner" kind=prompt>>>', 'Ask', '<<<end-abc>>>'].join('\n');

describe('extractReply', () => {
  it('drops lines that existed before, the prompt lines and marker lines, keeping order', () => {
    const before = 'Deep thinking\nSmart Search\nAI-generated, for reference only';
    const now = `${PROMPT}\nDeep thinking\nAnswer one\nSmart Search\nAnswer two\n<<<entry-zzz author="X">>>\nAI-generated, for reference only`;
    expect(extractReply(now, before, PROMPT)).toBe('Answer one\nAnswer two');
  });

  it('drops an echo collapsed into one line and a clipped part of it', () => {
    const collapsed = PROMPT.replace(/\s+/g, ' ');
    const clipped = collapsed.slice(0, 30);
    expect(extractReply(`${collapsed}\n${clipped}\nReal answer`, '', PROMPT)).toBe('Real answer');
  });

  it('keeps a short reply line that is only a fragment of the prompt', () => {
    expect(extractReply('Ask', '', PROMPT.replace('Ask', 'Please Ask now'))).toBe('Ask');
  });

  it('returns a reply equal to an earlier reply that the prompt also carries', () => {
    const prompt = 'Room so far:\nSame answer\nContinue.';
    const before = 'Question one\nSame answer';
    const now = `${before}\nRoom so far:\nSame answer\nContinue.\nSame answer`;
    expect(extractReply(now, before, prompt)).toBe('Same answer');
  });

  it('returns the reply when the page shows the prompt as one collapsed line and the reply equals an earlier one', () => {
    const prompt = 'Room so far:\nSame answer\nContinue.';
    const before = 'Question one\nSame answer';
    const now = `${before}\nRoom so far: Same answer Continue.\nSame answer`;
    expect(extractReply(now, before, prompt)).toBe('Same answer');
  });

  it('returns the reply when the collapsed echo carries entry markers and the reply equals an earlier one', () => {
    const prompt = '<<<entry-abc author="Owner" kind=prompt>>>\nSame answer\n<<<end-abc>>>';
    const before = 'Question one\nSame answer';
    const now = `${before}\n${prompt.replace(/\s+/g, ' ')}\nSame answer`;
    expect(extractReply(now, before, prompt)).toBe('Same answer');
  });

  it('keeps a reply that equals a middle line of the prompt on a page that never showed it', () => {
    const prompt = 'Intro line of the room\nA long shared sentence here\nClosing line of the room';
    const now = 'Intro line of the room\nA long shared sentence here\nClosing line of the room\nA long shared sentence here';
    expect(extractReply(now, '', prompt)).toBe('A long shared sentence here');
  });

  it('ignores whitespace differences when comparing lines', () => {
    expect(extractReply('  Smart   Search \nNew', 'Smart Search', 'p')).toBe('New');
  });

  it('keeps blank lines between kept lines and trims the ends', () => {
    expect(extractReply('\nA\n\nB\n\n', '', 'p')).toBe('A\n\nB');
  });

  it('returns null when nothing new is left', () => {
    expect(extractReply('Deep thinking\n\n<<<end-1>>>', 'Deep thinking', 'p')).toBeNull();
    expect(extractReply('', '', 'p')).toBeNull();
  });

  it('falls back to counting repeats when an identical answer repeats an earlier one', () => {
    expect(extractReply('Same answer\nSame answer', 'Same answer', 'p')).toBe('Same answer');
    expect(extractReply('Same answer', 'Same answer', 'p')).toBeNull();
  });
});

describe('stripEntryMarkerLines', () => {
  it('removes every line holding an entry or end marker, wherever the marker sits', () => {
    const text = 'keep\n<<<entry-a1 author="x">>>\n> quote <<<end-a1>>>\n\\<<<entry-a1 x\nalso keep';
    expect(stripEntryMarkerLines(text)).toBe('keep\nalso keep');
  });

  it('leaves text without markers unchanged', () => {
    expect(stripEntryMarkerLines('a <<< b\n<<<>>>')).toBe('a <<< b\n<<<>>>');
  });
});
