// reply-lines.test.ts
import { describe, expect, it } from 'vitest';
import { anchorAfterEcho, extractReply, extractReplyDetailed, isUiLabel } from '../../src/main/site-adapters/reply-lines';
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

describe('UI labels', () => {
  it.each(['New chat', 'AI-generated, for reference only', 'Deep thinking', 'Smart Search', 'Thought for 3 seconds', 'Thinking...', 'ChatGPT can make mistakes. Check important info.'])(
    'knows %s',
    (line) => {
      expect(isUiLabel(line)).toBe(true);
    },
  );

  it.each([
    'New chat ideas for the room',
    'Thinking about the design, the first option is simpler',
    'Language models can make mistakes in arithmetic, so the final figure should be recomputed by hand before it goes anywhere.',
    'Copy the file first',
  ])('keeps the answer line %s', (line) => {
    expect(isUiLabel(line)).toBe(false);
  });

  it('removes label lines from the reply', () => {
    expect(extractReply('New chat\nThe real answer begins here\nAI-generated, for reference only', '', 'p')).toBe('The real answer begins here');
    expect(extractReply('New chat\nAI-generated, for reference only', '', 'p')).toBeNull();
  });
});

describe('extractReplyDetailed', () => {
  it('counts the lines dropped as seen before, as the prompt echo, as markers and as labels', () => {
    const before = 'Older line one\nOlder line two';
    const now = [
      'Older line one',
      'Older line two',
      PROMPT,
      '<<<entry-zzz author="X">>>',
      'New chat',
      'AI-generated, for reference only',
      'The answer text',
    ].join('\n');
    const found = extractReplyDetailed(now, before, PROMPT);
    expect(found.reply).toBe('The answer text');
    expect(found.dropped).toEqual({ seen: 2, echo: 4, marker: 1, label: 2 });
  });

  it('counts lines dropped as seen when the repeated-answer fallback keeps them', () => {
    const prompt = 'Room so far:\nSame answer\nContinue.';
    const before = 'Question one\nSame answer';
    const found = extractReplyDetailed(`${before}\n${prompt}\nSame answer`, before, prompt);
    expect(found.reply).toBe('Same answer');
    expect(found.dropped.seen).toBe(2);
  });
});

describe('anchorAfterEcho', () => {
  const ASK = 'You are DeepSeek in a room where several agents take turns.\nCompare the two designs.';

  it('keeps only the text from the last line that holds the start of the prompt', () => {
    const page = `Sidebar title written later\nOlder chat\n${ASK}\nAnswer line`;
    expect(anchorAfterEcho(page, ASK)).toBe(`${ASK}\nAnswer line`);
  });

  it('takes the newest echo when an earlier turn of the page started with the same text', () => {
    const page = `${ASK}\nFirst answer\n${ASK}\nSecond answer`;
    expect(anchorAfterEcho(page, ASK)).toBe(`${ASK}\nSecond answer`);
  });

  it('finds an echo collapsed into one line and an echo whose first line is short', () => {
    expect(anchorAfterEcho(`Title\n${ASK.replace(/\s+/g, ' ')}\nAnswer`, ASK)).toBe(`${ASK.replace(/\s+/g, ' ')}\nAnswer`);
    const short = 'Hi\nthere friend, how are you doing today';
    expect(anchorAfterEcho('Title\nHi\nthere friend, how are you doing today\nAnswer', short)).toBe(
      'Hi\nthere friend, how are you doing today\nAnswer',
    );
  });

  it('prefers the line that starts with the prompt over a later reply line that quotes it', () => {
    const page = `Old title\n${ASK}\nMy answer begins here\nAs you wrote: ${ASK.replace(/\s+/g, ' ')}`;
    expect(anchorAfterEcho(page, ASK)).toBe(`${ASK}\nMy answer begins here\nAs you wrote: ${ASK.replace(/\s+/g, ' ')}`);
  });

  it('falls back to the last mention when no line starts with the prompt', () => {
    expect(anchorAfterEcho('Title\nYou said: hello there my friend\nAnswer', 'hello there my friend')).toBe(
      'You said: hello there my friend\nAnswer',
    );
  });

  it('is null when the page does not show the start of the prompt', () => {
    expect(anchorAfterEcho('Sidebar title\nSomething else', ASK)).toBeNull();
    expect(anchorAfterEcho('anything', '   ')).toBeNull();
  });
});
