// copy-agents.test.ts
import { describe, expect, it } from 'vitest';
import type { Agent } from '../../src/shared/agents';
import { copyAgentsOptions, copySourceAgents, defaultCopyChoice, parseCopyAgentsFrom, sourceOfChoice } from '../../src/shared/copy-agents';

const A = 'proj-a';
const B = 'proj-b_2';

function agent(id: string, projectId?: string): Agent {
  return projectId === undefined ? { id, kind: 'claude', title: id, createdAt: 1 } : { id, kind: 'claude', title: id, projectId, createdAt: 1 };
}

describe('copyAgentsOptions', () => {
  it('lists No project, Do not copy, then every project in index order', () => {
    const options = copyAgentsOptions([
      { id: B, name: 'Second' },
      { id: A, name: 'First' },
    ]);
    expect(options.map((option) => option.value)).toEqual(['no-project', 'none', `project:${B}`, `project:${A}`]);
    expect(options.slice(2).map((option) => option.label)).toEqual(['Second', 'First']);
  });

  it('has the two fixed options when there are no projects', () => {
    expect(copyAgentsOptions([]).map((option) => option.value)).toEqual(['no-project', 'none']);
  });

  it('selects the first option by default', () => {
    expect(defaultCopyChoice(copyAgentsOptions([{ id: A, name: 'First' }]))).toBe('no-project');
  });
});

describe('sourceOfChoice', () => {
  it('maps each option value to its source', () => {
    expect(sourceOfChoice('no-project')).toEqual({ projectId: null });
    expect(sourceOfChoice('none')).toBe('none');
    expect(sourceOfChoice(`project:${A}`)).toEqual({ projectId: A });
  });

  it('refuses anything else instead of falling back to a copy or to none', () => {
    for (const value of ['', 'copy', 'NONE', 'project:', 'project:../x', 'project:a b', `project:${'a'.repeat(65)}`, 'project']) {
      expect(sourceOfChoice(value)).toBeNull();
    }
  });
});

describe('parseCopyAgentsFrom', () => {
  it('accepts none, the No project source and a project id', () => {
    expect(parseCopyAgentsFrom('none')).toBe('none');
    expect(parseCopyAgentsFrom({ projectId: null })).toEqual({ projectId: null });
    expect(parseCopyAgentsFrom({ projectId: A })).toEqual({ projectId: A });
  });

  it('refuses every other shape', () => {
    const refused: unknown[] = [
      undefined,
      null,
      5,
      true,
      '',
      'NONE',
      'no-project',
      [],
      ['none'],
      {},
      { projectId: undefined },
      { projectId: '' },
      { projectId: '../x' },
      { projectId: 5 },
      { projectId: null, extra: 1 },
      { projectId: A, from: 'x' },
    ];
    for (const value of refused) expect(parseCopyAgentsFrom(value)).toBeNull();
  });
});

describe('copySourceAgents', () => {
  const agents = [agent('x1'), agent('a1', A), agent('x2'), agent('b1', B), agent('a2', A)];

  it('takes the agents outside any project, in order', () => {
    expect(copySourceAgents(agents, { projectId: null }).map((item) => item.id)).toEqual(['x1', 'x2']);
  });

  it('takes the agents of one project, in order', () => {
    expect(copySourceAgents(agents, { projectId: A }).map((item) => item.id)).toEqual(['a1', 'a2']);
  });

  it('is empty for a project without agents', () => {
    expect(copySourceAgents(agents, { projectId: 'other' })).toEqual([]);
  });
});
