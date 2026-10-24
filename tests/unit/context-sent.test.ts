// context-sent.test.ts
import { describe, expect, it } from 'vitest';
import type { ContextDigest } from '../../src/shared/context-digest';
import { collectionRecipients, contextSentView, recipientsLine } from '../../src/shared/context-sent';

const HASH = '0123456789abcdef';

describe('contextSentView', () => {
  const full: ContextDigest = {
    history: { first: 2, last: 7, count: 4 },
    parts: [
      { id: 'history', bytes: 120, hash: HASH },
      { id: 'project-map', bytes: 40, hash: 'fedcba9876543210' },
    ],
    files: [{ name: '3.md', bytes: 160 }],
    map: 'aaaaaaaaaaaaaaaa',
    cut: { via: 'inline', entries: 2, mapChars: 50 },
  };

  it('carries the title and one line per fact of the digest', () => {
    const view = contextSentView(full);
    expect(view.title).toBe('Context sent');
    const text = view.lines.join('\n');
    for (const fact of ['4', HASH, 'fedcba9876543210', '3.md', 'aaaaaaaaaaaaaaaa', '120', '160']) expect(text).toContain(fact);
    expect(view.lines.length).toBeGreaterThanOrEqual(6);
  });

  it('names the route of a cut and what it dropped', () => {
    const inline = contextSentView(full).lines.join('\n');
    expect(inline).toContain('inline');
    expect(inline).toContain('50');
    const budget = contextSentView({ ...full, cut: { via: 'budget', entries: 3, mapChars: 0 } }).lines.join('\n');
    expect(budget).toContain('budget');
    expect(budget).not.toEqual(inline);
  });

  it('has no map, file or cut line when the digest has none', () => {
    const plain = contextSentView({ history: { first: 0, last: 0, count: 1 }, parts: [{ id: 'history', bytes: 5, hash: HASH }], files: [] });
    expect(plain.lines).toHaveLength(2);
  });
});

describe('collection allowed in the context sent', () => {
  const plain: ContextDigest = { history: { first: 0, last: 0, count: 1 }, parts: [{ id: 'history', bytes: 5, hash: HASH }], files: [] };

  it('flags a digest of a participant that may be collected, and adds a line for it', () => {
    const allowed = contextSentView({ ...plain, collectionAllowed: true });
    const denied = contextSentView(plain);
    expect(allowed.collectionAllowed).toBe(true);
    expect(denied.collectionAllowed).toBe(false);
    expect(allowed.lines).toHaveLength(denied.lines.length + 1);
  });
});

describe('collectionRecipients', () => {
  const rows = [
    { kind: 'claude' as const },
    { kind: 'openrouter' as const, model: 'acme/paid-model', modelName: 'Acme Paid', allowCollection: true },
    { kind: 'openrouter' as const, model: 'acme/free-model:free', modelName: 'Acme Free' },
    { kind: 'openrouter' as const, model: 'acme/other', modelName: 'Other', allowCollection: false },
  ];

  it('lists only the OpenRouter rows that allow collection, in a project room', () => {
    expect(collectionRecipients(rows, 'proj-1')).toEqual(['OpenRouter \u00b7 Acme Paid']);
    expect(collectionRecipients(rows.slice(0, 1), 'proj-1')).toEqual([]);
  });

  it('is empty without a project, where nothing is denied or collected by the room', () => {
    expect(collectionRecipients(rows, null)).toEqual([]);
  });

  it('changes the recipients line for a room with such a row and not for one without', () => {
    const without = recipientsLine(rows.filter((row) => row.allowCollection !== true), 'proj-1');
    const withRow = recipientsLine(rows, 'proj-1') ?? '';
    expect(withRow).not.toBe(recipientsLine(rows.map((row) => ({ ...row, allowCollection: false })), 'proj-1'));
    expect(without).not.toBeNull();
  });
});

describe('recipientsLine', () => {
  const rows = [
    { kind: 'claude' as const },
    { kind: 'chatgpt' as const },
    { kind: 'openrouter' as const, model: 'acme/paid-model', modelName: 'Acme Paid' },
  ];

  it('is absent outside a project room and when nobody receives the map', () => {
    expect(recipientsLine(rows, null)).toBeNull();
    expect(recipientsLine([{ kind: 'claude' }, { kind: 'codex' }], 'proj-1')).toBeNull();
    expect(recipientsLine([], 'proj-1')).toBeNull();
  });

  it('names every site and OpenRouter model that gets the map, and says the history may quote CLI reads', () => {
    const line = recipientsLine(rows, 'proj-1') ?? '';
    expect(line).toContain('ChatGPT');
    expect(line).toContain('Acme Paid');
    expect(line).not.toContain('Claude');
    expect(line.toLowerCase()).toContain('cli');
  });

  it('names a row without a chosen model by its kind and ignores empty strings', () => {
    expect(recipientsLine([{ kind: 'openrouter', model: '', modelName: '' }], 'proj-1')).toBe('OpenRouter receive the project map and the room history.');
  });

  it('leaves the CLI remark out when no CLI participant is in the room', () => {
    const line = recipientsLine([{ kind: 'chatgpt' }], 'proj-1') ?? '';
    expect(line).toContain('ChatGPT');
    expect(line.toLowerCase()).not.toContain('cli');
  });
});
