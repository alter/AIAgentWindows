// projects.test.ts
import { describe, expect, it } from 'vitest';
import { parseStateDocument } from '../../src/shared/agents';
import {
  MAX_FOLDER_NAME_BYTES,
  MAX_PROJECTS,
  isProjectId,
  nameFromFolder,
  parseFolderName,
  parseProject,
  parseProjectName,
  parseProjects,
} from '../../src/shared/projects';

const GOOD = { id: 'p-1_A', name: 'My project', folder: '/work/my-project', createdAt: 5 };

describe('parseFolderName', () => {
  it('accepts one plain folder name', () => {
    for (const name of ['app', 'my app', 'a.b', '.hidden', 'проект', 'x'.repeat(80)]) {
      expect(parseFolderName(name)).toEqual({ ok: true, name });
    }
  });

  it('refuses anything that is not one path segment', () => {
    for (const name of ['../x', 'a/b', '/abs', 'a\\b', '..', '.', 'x/..', '']) {
      expect(parseFolderName(name).ok).toBe(false);
    }
    expect(parseFolderName(undefined).ok).toBe(false);
    expect(parseFolderName(7).ok).toBe(false);
  });

  it('refuses NUL and control characters, edge spaces and long names', () => {
    for (const name of ['a\u0000b', 'a\nb', ' a', 'a ', ' x ']) {
      expect(parseFolderName(name).ok).toBe(false);
    }
    expect(parseFolderName('x'.repeat(81)).ok).toBe(false);
    expect(parseFolderName('x'.repeat(MAX_FOLDER_NAME_BYTES + 1)).ok).toBe(false);
  });

  it('gives a readable reason', () => {
    const refused = parseFolderName('../x');
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.length).toBeGreaterThan(10);
  });
});

describe('project names and ids', () => {
  it('validates the name like an agent title', () => {
    expect(parseProjectName('  Plan  ')).toBe('Plan');
    expect(parseProjectName('')).toBeNull();
    expect(parseProjectName('a\nb')).toBeNull();
    expect(parseProjectName('x'.repeat(81))).toBeNull();
    expect(parseProjectName(4)).toBeNull();
  });

  it('validates the id like a room id', () => {
    expect(isProjectId('3f2c9a1e-aaaa-4bbb-8ccc-1234567890ab')).toBe(true);
    for (const id of ['', '../x', 'a/b', 'a b', 'x'.repeat(65), 5, null]) expect(isProjectId(id)).toBe(false);
  });

  it('names a project after its folder, with a fallback', () => {
    expect(nameFromFolder('/work/my-project')).toBe('my-project');
    expect(nameFromFolder('/work/' + 'x'.repeat(100))).toBe('x'.repeat(80));
    expect(nameFromFolder('/work/a\u0001b')).toBe('ab');
    expect(nameFromFolder('/')).toBe('Project');
    expect(nameFromFolder('C:\\work\\win-app\\')).toBe('win-app');
  });
});

describe('parseProject and the state document', () => {
  it('reads a valid record', () => {
    expect(parseProject(GOOD)).toEqual(GOOD);
  });

  it('reads absolute folders of both path styles', () => {
    for (const folder of ['/work/p', 'C:\\work\\p', 'D:/work/p', '\\\\server\\share\\p']) {
      expect(parseProject({ ...GOOD, folder })?.folder).toBe(folder);
    }
  });

  it('refuses a record with a bad field', () => {
    for (const bad of [
      null,
      [],
      { ...GOOD, id: '../x' },
      { ...GOOD, name: ' padded ' },
      { ...GOOD, name: '' },
      { ...GOOD, folder: 'relative/dir' },
      { ...GOOD, folder: 7 },
      { ...GOOD, folder: `/${'x'.repeat(4100)}` },
      { ...GOOD, createdAt: -1 },
      { ...GOOD, createdAt: 'now' },
      { ...GOOD, createdAt: Number.NaN },
    ]) {
      expect(parseProject(bad)).toBeNull();
    }
  });

  it('refuses a list that is too long, not a list or repeats an id', () => {
    expect(() => parseProjects('x')).toThrow();
    expect(() => parseProjects(Array.from({ length: MAX_PROJECTS + 1 }, () => GOOD))).toThrow();
    expect(() => parseProjects([GOOD, { ...GOOD, folder: '/other' }])).toThrow('repeated');
    expect(() => parseProjects([GOOD, 5])).toThrow('not valid');
    expect(parseProjects([GOOD, { ...GOOD, id: 'q', folder: '/other' }])).toHaveLength(2);
  });

  it('keeps the optional projects slice in a version 2 document and rejects a bad one', () => {
    const base = { version: 2, agents: [] };
    expect(parseStateDocument(base).projects).toBeUndefined();
    expect(parseStateDocument({ ...base, projects: [GOOD] }).projects).toEqual([GOOD]);
    expect(() => parseStateDocument({ ...base, projects: [{ ...GOOD, id: '../x' }] })).toThrow();
  });
});
