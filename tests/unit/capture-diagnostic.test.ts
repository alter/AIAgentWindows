// capture-diagnostic.test.ts
import { describe, expect, it } from 'vitest';
import { buildDiagnostic, diagnosticText, redactPath, type DiagnosticInput } from '../../src/shared/capture-diagnostic';

const WAIT = { polls: 4, waitedMs: 2000, messageListSeen: true, replySeen: false, settled: true, timedOut: false };

function input(overrides: Partial<DiagnosticInput>): DiagnosticInput {
  return { site: 'deepseek', status: 'saved', landingPath: '/', loadedPath: '/a/chat/s/:id', wait: WAIT, viewport: { width: 1340, height: 964 }, mainRegion: true, stats: null, ...overrides };
}

describe('redactPath', () => {
  it('keeps structural words and replaces every other segment', () => {
    expect(redactPath('/a/chat/s/5f2c8e1a-1111-4222-8333-944455556666')).toBe('/a/chat/s/:id');
    expect(redactPath('/c/abc123')).toBe('/c/:id');
    expect(redactPath('/g/g-p-acme-merger/c/uuid-1')).toBe('/g/:id/c/:id');
    expect(redactPath('/')).toBe('/');
    expect(redactPath('')).toBe('/');
  });

  it('never lets a name of a project or a person through, in any case', () => {
    expect(redactPath('/Chat/acme/merger')).toBe('/:id/:id/:id');
    expect(redactPath('/chat/' + 'x/'.repeat(20))).toBe('/chat/' + ':id/'.repeat(6) + ':id');
  });
});

describe('buildDiagnostic', () => {
  it('reports a missing conversation as not found and keeps no stats', () => {
    const found = buildDiagnostic(input({ loadedPath: null, wait: null, viewport: null, mainRegion: null }));
    expect(found).toMatchObject({ conversationLinkFound: false, wait: null, viewport: null, elements: null, classes: null, stylesheets: null });
    expect(buildDiagnostic(input({})).conversationLinkFound).toBe(true);
  });

  it('keeps only known tag names and whole numbers from the page', () => {
    const stats = {
      elements: { before: { div: 3, 'my-secret-tag': 9, textarea: 1.5, a: -1, span: 'x', svg: 2 }, after: { div: 2 } },
      classes: { seen: 10, closed: 4, stylesheet: 5, dropped: 1, extra: 7 },
      stylesheets: { total: 2, readable: 1, unreadable: 1, classNames: 'many' },
    };
    const built = buildDiagnostic(input({ stats }));
    expect(built.elements).toEqual({ before: { a: 0, div: 3, span: 0, svg: 2, textarea: 0 }, after: { div: 2 } });
    expect(built.classes).toEqual({ seen: 10, closed: 4, stylesheet: 5, dropped: 1 });
    expect(built.stylesheets).toEqual({ total: 2, readable: 1, unreadable: 1, classNames: 0 });
    expect(JSON.stringify(built)).not.toContain('secret');
  });

  it('tolerates stats of the wrong shape', () => {
    for (const stats of [null, 'text', [], 7, { elements: 'x', classes: [], stylesheets: 3 }]) {
      const built = buildDiagnostic(input({ stats }));
      expect(built.classes).toBeNull();
      expect(built.stylesheets).toBeNull();
      expect(built.elements === null || (Object.keys(built.elements.before).length === 0)).toBe(true);
    }
  });

  it('coerces numbers of the wait and the viewport and refuses an odd site name', () => {
    const built = buildDiagnostic(input({ site: 'Evil Site!', wait: { ...WAIT, polls: -5, waitedMs: 2 ** 40 }, viewport: { width: 1.5, height: 7 } }));
    expect(built.site).toBe('x');
    expect(built.wait).toMatchObject({ polls: 0, waitedMs: 0 });
    expect(built.viewport).toEqual({ width: 0, height: 7 });
  });

  it('serialises as indented JSON ending in a newline', () => {
    const text = diagnosticText(buildDiagnostic(input({})));
    expect(text.endsWith('}\n')).toBe(true);
    expect(JSON.parse(text)).toMatchObject({ site: 'deepseek', status: 'saved' });
  });
});
