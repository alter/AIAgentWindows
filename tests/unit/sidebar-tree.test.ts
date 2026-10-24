// sidebar-tree.test.ts
import { describe, expect, it } from 'vitest';
import type { Agent } from '../../src/shared/agents';
import {
  AGENTS_SECTION,
  ROOMS_SECTION,
  initialSidebarTree,
  reduceSidebarTree,
  sameNodes,
  sameSection,
  sidebarNodes,
  sidebarSections,
  NO_PROJECT_NODE,
  projectNodeKey,
  projectSectionKey,
  type SidebarTreeState,
} from '../../src/shared/sidebar-tree';

const agent = (id: string, title: string, kind: Agent['kind'] = 'claude'): Agent => ({ id, kind, title, createdAt: 1 });
const row = (id: string, label: string, current = false, unreadable = false, projectId: string | null = null) => ({ id, projectId, label, current, unreadable });

const withData = (): SidebarTreeState => {
  let state = initialSidebarTree();
  state = reduceSidebarTree(state, { type: 'rooms', rows: [row('r1', 'Alpha', true), row('r2', 'Beta')], busy: false });
  return reduceSidebarTree(state, { type: 'agents', agents: [agent('a1', 'One'), agent('a2', 'Two', 'codex')], selectedId: 'a2', roomOpen: false });
};

const section = (state: SidebarTreeState, key: string) => {
  const found = sidebarSections(state).find((item) => item.key === key);
  if (found === undefined) throw new Error(`no section ${key}`);
  return found;
};

describe('sidebar tree', () => {
  it('starts with a rooms section and an agents section, both empty, rooms expanded', () => {
    const sections = sidebarSections(initialSidebarTree());
    expect(sections.map((item) => item.key)).toEqual([ROOMS_SECTION, AGENTS_SECTION]);
    expect(sections.every((item) => item.items.length === 0)).toBe(true);
    expect(sections[0]?.expanded).toBe(true);
    expect(sections[0]?.collapsible).toBe(true);
    expect(sections[1]?.collapsible).toBe(false);
    expect(sections[1]?.expanded).toBe(true);
  });

  it('keeps the order of rooms and agents, takes labels from the row and the agent title', () => {
    const state = withData();
    expect(section(state, ROOMS_SECTION).items.map((item) => [item.id, item.label, item.kind])).toEqual([
      ['r1', 'Alpha', null],
      ['r2', 'Beta', null],
    ]);
    expect(section(state, AGENTS_SECTION).items.map((item) => [item.id, item.label, item.kind])).toEqual([
      ['a1', 'One', 'claude'],
      ['a2', 'Two', 'codex'],
    ]);
  });

  it('selects the opened room only while the room pane is open, and the agent only while it is not', () => {
    const closed = withData();
    expect(section(closed, ROOMS_SECTION).items.map((item) => item.selected)).toEqual([false, false]);
    expect(section(closed, AGENTS_SECTION).items.map((item) => item.selected)).toEqual([false, true]);
    const open = reduceSidebarTree(closed, { type: 'agents', agents: closed.agents, selectedId: 'a2', roomOpen: true });
    expect(section(open, ROOMS_SECTION).items.map((item) => item.selected)).toEqual([true, false]);
    expect(section(open, AGENTS_SECTION).items.map((item) => item.selected)).toEqual([false, false]);
  });

  it('carries busy on the rooms section and the unreadable flag on an item', () => {
    let state = reduceSidebarTree(initialSidebarTree(), { type: 'rooms', rows: [row('x', 'x · unreadable', false, true)], busy: true });
    expect(section(state, ROOMS_SECTION).busy).toBe(true);
    expect(section(state, ROOMS_SECTION).items[0]?.unreadable).toBe(true);
    expect(section(state, AGENTS_SECTION).busy).toBe(false);
    state = reduceSidebarTree(state, { type: 'rooms', rows: [], busy: false });
    expect(section(state, ROOMS_SECTION).busy).toBe(false);
  });

  it('collapses and expands the rooms section and keeps the items', () => {
    const state = withData();
    const collapsed = reduceSidebarTree(state, { type: 'toggle', key: ROOMS_SECTION });
    expect(section(collapsed, ROOMS_SECTION).expanded).toBe(false);
    expect(section(collapsed, ROOMS_SECTION).items).toHaveLength(2);
    const expanded = reduceSidebarTree(collapsed, { type: 'toggle', key: ROOMS_SECTION });
    expect(section(expanded, ROOMS_SECTION).expanded).toBe(true);
  });

  it('refuses to collapse the agents list or an unknown key', () => {
    const state = withData();
    expect(reduceSidebarTree(state, { type: 'toggle', key: AGENTS_SECTION })).toBe(state);
    expect(reduceSidebarTree(state, { type: 'toggle', key: 'missing' })).toBe(state);
  });

  it('does not mutate the previous state', () => {
    const state = withData();
    const frozen = JSON.stringify(state);
    reduceSidebarTree(state, { type: 'toggle', key: ROOMS_SECTION });
    reduceSidebarTree(state, { type: 'rooms', rows: [], busy: true });
    reduceSidebarTree(state, { type: 'agents', agents: [], selectedId: null, roomOpen: true });
    expect(JSON.stringify(state)).toBe(frozen);
  });

  it('tells a changed section from an unchanged one', () => {
    const state = withData();
    const rooms = section(state, ROOMS_SECTION);
    expect(sameSection(rooms, section(withData(), ROOMS_SECTION))).toBe(true);
    const selected = reduceSidebarTree(state, { type: 'agents', agents: state.agents, selectedId: 'a1', roomOpen: true });
    expect(sameSection(rooms, section(selected, ROOMS_SECTION))).toBe(false);
    const titled = reduceSidebarTree(state, { type: 'rooms', rows: [row('r1', 'Renamed', true), row('r2', 'Beta')], busy: false });
    expect(sameSection(rooms, section(titled, ROOMS_SECTION))).toBe(false);
    const agentsOnly = reduceSidebarTree(state, { type: 'agents', agents: [agent('z', 'Z')], selectedId: 'z', roomOpen: false });
    expect(sameSection(rooms, section(agentsOnly, ROOMS_SECTION))).toBe(true);
    expect(sameSection(section(state, AGENTS_SECTION), section(agentsOnly, AGENTS_SECTION))).toBe(false);
  });
});

const view = (id: string, name: string, missing = false) => ({ id, name, folder: `/work/${name}`, missing });

describe('sidebar tree with projects', () => {
  it('has only the No project node before any project exists, holding the rooms and agents sections', () => {
    const state = withData();
    const nodes = sidebarNodes(state);
    expect(nodes.map((node) => [node.key, node.projectId, node.label])).toEqual([[NO_PROJECT_NODE, null, 'No project']]);
    expect(nodes[0]?.sections).toEqual(sidebarSections(state));
    expect(nodes[0]?.expanded).toBe(true);
  });

  it('lists the projects in index order and the No project node last', () => {
    const state = reduceSidebarTree(withData(), { type: 'projects', projects: [view('p2', 'Beta'), view('p1', 'Alpha')] });
    expect(sidebarNodes(state).map((node) => [node.key, node.projectId, node.label])).toEqual([
      [projectNodeKey('p2'), 'p2', 'Beta'],
      [projectNodeKey('p1'), 'p1', 'Alpha'],
      [NO_PROJECT_NODE, null, 'No project'],
    ]);
  });

  it('gives a project a Rooms and an Agents section, empty and expanded', () => {
    const state = reduceSidebarTree(withData(), { type: 'projects', projects: [view('p1', 'Alpha')] });
    const node = sidebarNodes(state)[0];
    expect(node?.sections.map((item) => [item.key, item.items.length, item.expanded, item.collapsible])).toEqual([
      [projectSectionKey('p1', 'rooms'), 0, true, true],
      [projectSectionKey('p1', 'agents'), 0, true, true],
    ]);
  });

  it('shows a missing project as missing, with its folder and no sections', () => {
    const state = reduceSidebarTree(withData(), { type: 'projects', projects: [view('p1', 'Alpha', true), view('p2', 'Beta')] });
    const [gone, here] = sidebarNodes(state);
    expect([gone?.missing, gone?.folder, gone?.sections.length]).toEqual([true, '/work/Alpha', 0]);
    expect([here?.missing, here?.sections.length]).toEqual([false, 2]);
  });

  it('keeps the rooms and agents of today in the No project node, unchanged by projects', () => {
    const plain = withData();
    const withProjects = reduceSidebarTree(plain, { type: 'projects', projects: [view('p1', 'Alpha')] });
    expect(sidebarNodes(withProjects).at(-1)?.sections).toEqual(sidebarSections(plain));
    expect(sidebarSections(withProjects)).toEqual(sidebarSections(plain));
  });

  it('collapses a project, one of its sections, and the No project node, each on its own', () => {
    let state = reduceSidebarTree(withData(), { type: 'projects', projects: [view('p1', 'Alpha')] });
    state = reduceSidebarTree(state, { type: 'toggle', key: projectNodeKey('p1') });
    expect(sidebarNodes(state)[0]?.expanded).toBe(false);
    expect(sidebarNodes(state).at(-1)?.expanded).toBe(true);
    state = reduceSidebarTree(state, { type: 'toggle', key: projectSectionKey('p1', 'agents') });
    expect(sidebarNodes(state)[0]?.sections.map((item) => item.expanded)).toEqual([true, false]);
    state = reduceSidebarTree(state, { type: 'toggle', key: NO_PROJECT_NODE });
    expect(sidebarNodes(state).at(-1)?.expanded).toBe(false);
    expect(sidebarNodes(state).at(-1)?.sections).toEqual(sidebarSections(state));
    state = reduceSidebarTree(state, { type: 'toggle', key: projectNodeKey('p1') });
    expect(sidebarNodes(state)[0]?.expanded).toBe(true);
  });

  it('ignores a toggle for a project that is not in the tree or a section that does not exist', () => {
    const state = reduceSidebarTree(withData(), { type: 'projects', projects: [view('p1', 'Alpha')] });
    expect(reduceSidebarTree(state, { type: 'toggle', key: projectNodeKey('p9') })).toBe(state);
    expect(reduceSidebarTree(state, { type: 'toggle', key: 'project:p1:other' })).toBe(state);
    expect(reduceSidebarTree(state, { type: 'toggle', key: projectSectionKey('p9', 'rooms') })).toBe(state);
  });

  it('forgets the collapse of a project that left the tree', () => {
    let state = reduceSidebarTree(withData(), { type: 'projects', projects: [view('p1', 'Alpha')] });
    state = reduceSidebarTree(state, { type: 'toggle', key: projectNodeKey('p1') });
    state = reduceSidebarTree(state, { type: 'projects', projects: [] });
    expect(state.collapsed).toEqual([]);
    state = reduceSidebarTree(state, { type: 'projects', projects: [view('p1', 'Alpha')] });
    expect(sidebarNodes(state)[0]?.expanded).toBe(true);
  });

  it('keeps the collapse of a project that stays', () => {
    let state = reduceSidebarTree(withData(), { type: 'projects', projects: [view('p1', 'Alpha'), view('p2', 'Beta')] });
    state = reduceSidebarTree(state, { type: 'toggle', key: projectNodeKey('p2') });
    state = reduceSidebarTree(state, { type: 'projects', projects: [view('p2', 'Beta')] });
    expect(sidebarNodes(state)[0]?.expanded).toBe(false);
  });

  it('tells changed nodes from unchanged ones', () => {
    const base = reduceSidebarTree(withData(), { type: 'projects', projects: [view('p1', 'Alpha')] });
    expect(sameNodes(sidebarNodes(base), sidebarNodes(reduceSidebarTree(base, { type: 'projects', projects: [view('p1', 'Alpha')] })))).toBe(true);
    expect(sameNodes(sidebarNodes(base), sidebarNodes(reduceSidebarTree(base, { type: 'projects', projects: [view('p1', 'Renamed')] })))).toBe(false);
    expect(sameNodes(sidebarNodes(base), sidebarNodes(reduceSidebarTree(base, { type: 'projects', projects: [view('p1', 'Alpha', true)] })))).toBe(false);
  });

  it('lists the rooms of a project in its Rooms section and keeps them out of the No project node', () => {
    let state = reduceSidebarTree(withData(), { type: 'projects', projects: [view('p1', 'Alpha'), view('p2', 'Beta')] });
    state = reduceSidebarTree(state, {
      type: 'rooms',
      rows: [row('r1', 'Loose', false), row('q1', 'In Alpha', true, false, 'p1'), row('q2', 'In Beta', false, false, 'p2'), row('q3', 'Broken', false, true, 'p1')],
      busy: true,
    });
    state = reduceSidebarTree(state, { type: 'agents', agents: [], selectedId: null, roomOpen: true });
    const [alpha, beta, none] = sidebarNodes(state);
    const roomsOf = (node: typeof alpha) => node?.sections.find((item) => item.key.endsWith(':rooms'));
    expect(roomsOf(alpha)?.items.map((item) => `${item.id}:${item.label}:${item.selected}:${item.unreadable}:${item.kind}`)).toEqual(['q1:In Alpha:true:false:null', 'q3:Broken:false:true:null']);
    expect(roomsOf(beta)?.items.map((item) => item.id)).toEqual(['q2']);
    expect([roomsOf(alpha)?.busy, roomsOf(beta)?.busy]).toEqual([true, true]);
    expect(none?.sections.find((item) => item.key === ROOMS_SECTION)?.items.map((item) => item.id)).toEqual(['r1']);
    expect(section(state, ROOMS_SECTION).items.map((item) => item.id)).toEqual(['r1']);
  });

  it('lists the agents of a project in its Agents section and keeps them out of the No project node', () => {
    let state = reduceSidebarTree(withData(), { type: 'projects', projects: [view('p1', 'Alpha'), view('p2', 'Beta')] });
    const owned = (id: string, title: string, projectId: string, kind: Agent['kind'] = 'claude'): Agent => ({ ...agent(id, title, kind), projectId });
    state = reduceSidebarTree(state, {
      type: 'agents',
      agents: [agent('a1', 'One'), owned('b1', 'In Alpha', 'p1'), owned('b2', 'Site in Beta', 'p2', 'grok'), owned('b3', 'Second in Alpha', 'p1', 'codex')],
      selectedId: 'b3',
      roomOpen: false,
    });
    const [alpha, beta, none] = sidebarNodes(state);
    const agentsOf = (node: typeof alpha): string[] => node?.sections.find((item) => item.key.endsWith(':agents'))?.items.map((item) => `${item.id}:${item.kind}:${item.selected}`) ?? [];
    expect(agentsOf(alpha)).toEqual(['b1:claude:false', 'b3:codex:true']);
    expect(agentsOf(beta)).toEqual(['b2:grok:false']);
    expect(none?.sections.find((item) => item.key === AGENTS_SECTION)?.items.map((item) => item.id)).toEqual(['a1']);
    expect(section(state, AGENTS_SECTION).items.map((item) => item.id)).toEqual(['a1']);
  });

  it('selects a project agent only while the room pane is closed, and shows an agent of an unknown project nowhere', () => {
    let state = reduceSidebarTree(withData(), { type: 'projects', projects: [view('p1', 'Alpha')] });
    const agents: Agent[] = [{ ...agent('b1', 'In Alpha'), projectId: 'p1' }, { ...agent('c1', 'Orphan'), projectId: 'gone' }];
    state = reduceSidebarTree(state, { type: 'agents', agents, selectedId: 'b1', roomOpen: true });
    const [alpha, none] = sidebarNodes(state);
    expect(alpha?.sections[1]?.items.map((item) => item.selected)).toEqual([false]);
    expect(none?.sections[1]?.items).toEqual([]);
  });
});
