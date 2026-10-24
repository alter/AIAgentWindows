// project-map.test.ts
import { describe, expect, it } from 'vitest';
import { buildProjectMap, DEFAULT_MAP_LIMITS, isListablePath, type MapLimits } from '../../src/shared/project-map';

const bytes = (text: string): number => new TextEncoder().encode(text).length;
const limits = (overrides: Partial<MapLimits>): MapLimits => ({ ...DEFAULT_MAP_LIMITS, ...overrides });

describe('isListablePath', () => {
  it.each(['README.md', 'src/app.ts', 'a b/c d.txt', '.github/workflows/ci.yml', 'dir/.hidden'])('accepts %s', (rel) => {
    expect(isListablePath(rel)).toBe(true);
  });

  it.each([
    '',
    '/etc/passwd',
    'C:/Windows/win.ini',
    'c:rel.txt',
    '../outside.txt',
    'a/../../b',
    'a/./b',
    'a//b',
    'dir/',
    'with\nnewline.txt',
    'with\u0000nul.txt',
    'back\\slash.txt',
    'bell\u0007.txt',
    'del\u007f.txt',
    '.env',
    'config/.env.local',
    'keys/server.pem',
    '.ssh/id_rsa',
  ])('refuses %j', (rel) => {
    expect(isListablePath(rel)).toBe(false);
  });
});

describe('buildProjectMap paths', () => {
  it('lists every allowed path once, sorted, and nothing else when the paths fit', () => {
    const map = buildProjectMap({ paths: ['src/b.ts', 'README.md', 'src/a.ts', 'src/b.ts', 'package.json'], documents: [] });
    expect(map.listed).toBe(4);
    expect(map.shown).toBe(4);
    expect(map.folded).toBe(false);
    const lines = map.text.split('\n');
    const at = (path: string): number => lines.indexOf(path);
    expect(at('README.md')).toBeGreaterThanOrEqual(0);
    expect(at('package.json')).toBeLessThan(at('src/a.ts'));
    expect(at('src/a.ts')).toBeLessThan(at('src/b.ts'));
    expect(lines.filter((line) => line === 'src/b.ts')).toHaveLength(1);
  });

  it('drops denied names, denied directories, escapes and malformed paths', () => {
    const map = buildProjectMap({
      paths: ['.env', 'app/.env.production', 'cert/server.pem', 'secrets/notes.txt', '.aws/credentials', '../x', '/abs', 'a\nb', 'ok.ts'],
      documents: [],
    });
    expect(map.listed).toBe(1);
    for (const gone of ['.env', 'server.pem', 'secrets', 'credentials', '../x', '/abs', 'a\nb']) expect(map.text).not.toContain(gone);
    expect(map.text).toContain('ok.ts');
  });

  it('says so when nothing is listed', () => {
    const map = buildProjectMap({ paths: [], documents: [] });
    expect(map.listed).toBe(0);
    expect(map.shown).toBe(0);
    expect(map.folded).toBe(false);
    expect(map.text.length).toBeGreaterThan(0);
  });

  it('folds directories into counts when the paths pass the cap, keeping the shallowest level that fits', () => {
    const paths = ['top.txt'];
    for (let n = 0; n < 40; n += 1) paths.push(`src/a/f${n}.ts`, `src/b/f${n}.ts`);
    paths.push('src/index.ts');
    const map = buildProjectMap({ paths, documents: [] }, limits({ maxPaths: 10 }));
    expect(map.listed).toBe(82);
    expect(map.folded).toBe(true);
    expect(map.shown).toBeLessThanOrEqual(10);
    expect(map.text).not.toContain('f10.ts');
    expect(map.text).toContain('src/index.ts');
    expect(map.text).toContain('top.txt');
    expect(map.text).toContain('src/a/');
    expect(map.text).toContain('40');
  });

  it('shows the deepest level whose entries fit the path cap', () => {
    const paths = ['a/x/1.ts', 'a/x/2.ts', 'a/y/1.ts', 'b/1.ts', 'b/2.ts', 'b/3.ts'];
    const map = buildProjectMap({ paths, documents: [] }, limits({ maxPaths: 5 }));
    expect(map.folded).toBe(true);
    expect(map.shown).toBe(5);
    expect(map.text).toContain('a/x/');
    expect(map.text).toContain('b/1.ts');
    expect(map.text).not.toContain('a/x/1.ts');
  });

  it('cuts the top level and says how many entries are missing when even it does not fit', () => {
    const paths = Array.from({ length: 100 }, (_, n) => `file${String(n).padStart(3, '0')}.txt`);
    const map = buildProjectMap({ paths, documents: [] }, limits({ maxPaths: 5 }));
    expect(map.folded).toBe(true);
    expect(map.shown).toBeLessThanOrEqual(5);
    expect(map.text).toContain('file000.txt');
    expect(map.text).not.toContain('file099.txt');
    expect(map.text).toContain('96');
  });

  it('keeps the whole text under the byte cap', () => {
    const paths = Array.from({ length: 300 }, (_, n) => `directory-with-a-long-name/${'x'.repeat(40)}-${n}.ts`);
    const map = buildProjectMap({ paths, documents: [] }, limits({ maxBytes: 2000, maxPaths: 1000 }));
    expect(bytes(map.text)).toBeLessThanOrEqual(2000);
    expect(map.folded).toBe(true);
    const cut = buildProjectMap({ paths: Array.from({ length: 300 }, (_, n) => `${'y'.repeat(60)}${n}.ts`), documents: [] }, limits({ maxBytes: 1000, maxPaths: 1000 }));
    expect(bytes(cut.text)).toBeLessThanOrEqual(1000);
    expect(cut.folded).toBe(true);
    expect(cut.shown).toBeGreaterThan(0);
  });

  it('counts multi-byte names by their bytes', () => {
    const paths = Array.from({ length: 50 }, (_, n) => `каталог/файл-${n}.txt`);
    const map = buildProjectMap({ paths, documents: [] }, limits({ maxBytes: 600, maxPaths: 1000 }));
    expect(bytes(map.text)).toBeLessThanOrEqual(600);
  });
});

describe('buildProjectMap documents', () => {
  const doc = (path: string, content?: string) => ({ path, ...(content === undefined ? {} : { content }) });

  it('appends the known documents in a fixed order with their content', () => {
    const map = buildProjectMap({
      paths: ['AGENTS.md', 'CLAUDE.md', 'README.md', 'src/a.ts'],
      documents: [doc('AGENTS.md', 'agents text'), doc('README.md', 'readme text'), doc('CLAUDE.md', 'claude text')],
    });
    expect(map.documents).toEqual(['README.md', 'CLAUDE.md', 'AGENTS.md']);
    expect(map.omitted).toEqual([]);
    expect(map.text.indexOf('readme text')).toBeLessThan(map.text.indexOf('claude text'));
    expect(map.text.indexOf('claude text')).toBeLessThan(map.text.indexOf('agents text'));
  });

  it('leaves out a document that was not read, is over the cap, or does not fit the budget, and names it', () => {
    const big = 'b'.repeat(500);
    const map = buildProjectMap(
      {
        paths: ['README.md', 'CLAUDE.md', 'AGENTS.md'],
        documents: [doc('README.md', 'r'.repeat(300)), doc('CLAUDE.md', big), doc('AGENTS.md')],
      },
      limits({ maxBytes: 800, maxDocumentBytes: 400 }),
    );
    expect(map.documents).toEqual(['README.md']);
    expect(map.omitted).toEqual(['CLAUDE.md', 'AGENTS.md']);
    expect(map.text).not.toContain(big);
    expect(bytes(map.text)).toBeLessThanOrEqual(800);
  });

  it('refuses a second document that would overflow the document budget even when each fits the cap', () => {
    const map = buildProjectMap(
      { paths: ['README.md', 'CLAUDE.md'], documents: [doc('README.md', 'r'.repeat(300)), doc('CLAUDE.md', 'c'.repeat(300))] },
      limits({ maxBytes: 800, maxDocumentBytes: 400 }),
    );
    expect(map.documents).toEqual(['README.md']);
    expect(map.omitted).toEqual(['CLAUDE.md']);
  });

  it('ignores a document whose path is not among the listed files, is nested, or is not a known name', () => {
    const map = buildProjectMap({
      paths: ['sub/README.md', 'notes.md', 'src/a.ts'],
      documents: [doc('README.md', 'ghost readme'), doc('sub/README.md', 'nested readme'), doc('notes.md', 'not a doc'), doc('CLAUDE.md', 'ghost claude')],
    });
    expect(map.documents).toEqual([]);
    expect(map.omitted).toEqual([]);
    for (const text of ['ghost readme', 'nested readme', 'not a doc', 'ghost claude']) expect(map.text).not.toContain(text);
  });
});
