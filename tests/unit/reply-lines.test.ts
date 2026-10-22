// reply-lines.test.ts
import { describe, expect, it } from 'vitest';
import { anchorAfterEcho, describeLines, echoTails, extractAnchoredReply, extractReply, extractReplyDetailed, isUiLabel } from '../../src/main/site-adapters/reply-lines';
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
  it.each(['13 web pages', 'Read 13 web pages', 'searched 5 Web Pages', 'Found 1 web pages', 'New chat', 'AI-generated, for reference only', 'Deep thinking', 'Smart Search', 'Thought for 3 seconds', 'Thinking...', 'ChatGPT can make mistakes. Check important info.'])(
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
    'Found 13 web pages worth reading about the topic',
    'About 13 web pages',
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

  it('counts lines as seen only up to their number before, so a repeated answer is still read', () => {
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

  it('prefers the line that starts with the prompt over a later reply line that quotes it mid-line', () => {
    const page = `Old title\n${ASK}\nMy answer begins here\nAs you wrote: ${ASK.replace(/\s+/g, ' ')}`;
    expect(anchorAfterEcho(page, ASK)).toBe(`${ASK}\nMy answer begins here\nAs you wrote: ${ASK.replace(/\s+/g, ' ')}`);
  });

  it('starts the tail of a mid-line hit at the key, the part of the line before it is not reply', () => {
    expect(anchorAfterEcho('Title\nYou said: hello there my friend\nAnswer', 'hello there my friend')).toBe(
      'hello there my friend\nAnswer',
    );
  });

  it('is null when the page does not show the start of the prompt', () => {
    expect(anchorAfterEcho('Sidebar title\nSomething else', ASK)).toBeNull();
    expect(anchorAfterEcho('anything', '   ')).toBeNull();
  });
});

describe('echoTails', () => {
  const ASK = 'You are DeepSeek in a room where several agents take turns.\nCompare the two designs.';

  it('lists the tails from the last occurrence of the key to the first, one per line', () => {
    const page = `${ASK}\nOne\n${ASK}\nTwo\n${ASK.replace(/\s+/g, ' ')}`;
    expect(echoTails(page, ASK)).toEqual([ASK.replace(/\s+/g, ' '), `${ASK}\nTwo\n${ASK.replace(/\s+/g, ' ')}`, `${ASK}\nOne\n${ASK}\nTwo\n${ASK.replace(/\s+/g, ' ')}`]);
  });

  it('is empty without the key and gives one tail for a key mentioned only inside a line', () => {
    expect(echoTails('nothing here', ASK)).toEqual([]);
    expect(echoTails('Title\nYou said: hello there my friend\nAnswer', 'hello there my friend')).toEqual([
      'hello there my friend\nAnswer',
    ]);
  });
});

describe('anchored reply with a navigator that repeats the prompt', () => {
  const ASK = 'You are DeepSeek in a room where several agents take turns.\nCompare the two designs.';
  const ONE_LINE = ASK.replace(/\s+/g, ' ');
  const ANSWER = 'The first design is simpler and the second scales better.';

  it('anchors on the last occurrence that a reply follows, not on a navigator item after the reply', () => {
    const page = [ASK, ANSWER, ONE_LINE, ONE_LINE].join('\n');
    const found = extractAnchoredReply(page, '', ASK);
    expect(found).toMatchObject({ reply: ANSWER, echoFound: true, keyHits: 3, anchorRank: 2 });
  });

  it('never puts a navigator item cut off with an ellipsis into the reply', () => {
    const cut = `${ONE_LINE.slice(0, 60)}\u2026`;
    const page = [ASK, ANSWER, cut, `${ONE_LINE.slice(0, 20)}...`].join('\n');
    const found = extractAnchoredReply(page, '', ASK);
    expect(found.reply).toBe(ANSWER);
    expect(found.dropped.echo).toBe(4);
  });

  it('keeps a line that only ends with an ellipsis and is not the start of the prompt', () => {
    expect(extractAnchoredReply(`${ASK}\nSo the answer is unclear but we could try...`, '', ASK).reply).toBe(
      'So the answer is unclear but we could try...',
    );
  });

  it('keeps the newest reply when an older identical echo with its reply is unseen too', () => {
    const page = [ASK, 'Old reply to the same question text.', ASK, ANSWER, ONE_LINE].join('\n');
    const found = extractAnchoredReply(page, '', ASK);
    expect(found).toMatchObject({ reply: ANSWER, anchorRank: 1 });
  });

  it('uses the last occurrence and no reply when nothing follows any occurrence', () => {
    const found = extractAnchoredReply(`${ASK}\n${ONE_LINE}`, '', ASK);
    expect(found).toMatchObject({ reply: null, echoFound: true, keyHits: 2, anchorRank: 0 });
  });

  it('reports no hits and no rank without an echo', () => {
    expect(extractAnchoredReply('Sidebar title\nSomething else', '', ASK)).toMatchObject({ echoFound: false, keyHits: 0, anchorRank: -1 });
  });
});

describe('anchored reply when the echo sits mid-line behind a file card', () => {
  const ASK = 'You are DeepSeek in a room where several agents take turns.\nCompare the two designs.';
  const ONE_LINE = ASK.replace(/\s+/g, ' ');
  const FIRST = 'You are DeepSeek in a room where several agents take turns.';
  const ANSWER = 'The first design is simpler and the second scales better.';
  const CARD_LINE = `history.md 14 KB${FIRST}`;

  it('anchors on the mid-line echo when the navigator items after the reply are the only line-start hits', () => {
    const page = [CARD_LINE, 'Compare the two designs.', ANSWER, ONE_LINE, ONE_LINE].join('\n');
    const found = extractAnchoredReply(page, '', ASK);
    expect(found).toMatchObject({ reply: ANSWER, echoFound: true, keyHits: 3, anchorRank: 2, hitsAtLineStart: 2 });
  });

  it('does not put the file card of the echo line into the reply', () => {
    const page = [CARD_LINE, 'Compare the two designs.', ANSWER].join('\n');
    const found = extractAnchoredReply(page, '', ASK);
    expect(found.reply).toBe(ANSWER);
    expect(found.hitsAtLineStart).toBe(0);
  });

  it('counts the hits at a line start separately from the mid-line ones', () => {
    expect(extractAnchoredReply(`${ASK}\n${ANSWER}\n${CARD_LINE}`, '', ASK)).toMatchObject({ keyHits: 2, hitsAtLineStart: 1 });
  });
});

describe('describeLines', () => {
  const ASK = 'You are DeepSeek in a room where several agents take turns.\nCompare the two designs.';
  const SECRET = 'private sentence that must never reach a log';

  it('describes every line by length and flags only, never by text', () => {
    const before = `${SECRET} earlier\nNew chat`;
    const page = [`${SECRET} earlier`, 'New chat', `card${ASK.split('\n')[0]}`, 'Compare the two designs.', SECRET, 'Thinking...'].join('\n');
    const report = describeLines(page, before, ASK);
    expect(report.lines).toBe(6);
    expect(report.listed).toBe(6);
    expect(report.hitsAtLineStart).toBe(0);
    const length = (text: string): number => text.length;
    expect(report.entries.split(',')).toEqual([
      `${length(`${SECRET} earlier`)}:0001`,
      '8:0011',
      `${length(`card${ASK.split('\n')[0]}`)}:2000`,
      '24:0100',
      `${length(SECRET)}:0000`,
      '11:0010',
    ]);
    expect(JSON.stringify(report)).not.toContain('private');
    expect(JSON.stringify(report)).not.toContain('Compare');
  });

  it('keeps the last 400 lines when the page is longer', () => {
    const page = Array.from({ length: 450 }, (_, n) => `line number ${n}`).join('\n');
    const report = describeLines(page, '', ASK);
    expect(report.lines).toBe(450);
    expect(report.listed).toBe(400);
    expect(report.entries.split(',')).toHaveLength(400);
  });
});

describe('extractAnchoredReply: the same prompt in every round', () => {
  const PROMPT_LINES = ['Room so far: the owner asks for one concrete point about the sample topic', 'Reply with a short answer'];
  const ASKED = PROMPT_LINES.join('\n');
  const NAVIGATOR = PROMPT_LINES.join(' ');
  const OLD_REPLY = ['Old reply opens with a sentence about the topic', 'Old reply continues with a second sentence'];
  const NEW_REPLY = ['New reply opens with a different sentence about the topic', 'New reply adds a second point', 'New reply closes with a summary line'];
  const before = ['Chat title', ...PROMPT_LINES, ...OLD_REPLY, 'Copy', NAVIGATOR].join('\n');

  it('reads the new reply that sits before the navigator copy of the prompt at the end of the page', () => {
    const now = ['Chat title', ...PROMPT_LINES, ...NEW_REPLY, 'Copy', NAVIGATOR, NAVIGATOR].join('\n');
    const found = extractAnchoredReply(now, before, ASKED);
    expect(found.reply).toBe(NEW_REPLY.join('\n'));
    expect(found.echoFound).toBe(true);
    expect(found.keyHits).toBe(3);
  });

  it('reads the new reply when the earlier bubble and its reply are still above the new bubble', () => {
    const now = ['Chat title', ...PROMPT_LINES, ...OLD_REPLY, ...PROMPT_LINES, ...NEW_REPLY, 'Copy', NAVIGATOR, NAVIGATOR].join('\n');
    expect(extractAnchoredReply(now, before, ASKED).reply).toBe(NEW_REPLY.join('\n'));
  });

  it('never returns the reply of an older bubble while the new reply has not started', () => {
    const now = ['Chat title', ...PROMPT_LINES, ...OLD_REPLY, ...PROMPT_LINES, 'Copy', NAVIGATOR, NAVIGATOR].join('\n');
    const found = extractAnchoredReply(now, before, ASKED);
    expect(found.reply).toBeNull();
    expect(found.echoFound).toBe(true);
  });

  it('ignores a short prompt that only occurs inside static text of the page', () => {
    const found = extractAnchoredReply('Chat title\nThis page is about something else', 'Chat title\nThis page is about something else', 'hi');
    expect(found.echoFound).toBe(false);
    expect(found.reply).toBeNull();
  });
});
