// sidebar-tree.test.ts
import { describe, expect, it } from 'vitest';
import type { Agent } from '../../src/shared/agents';
import {
  AGENTS_SECTION,
  ROOMS_SECTION,
  initialSidebarTree,
  reduceSidebarTree,
  sameSection,
  sidebarSections,
  type SidebarTreeState,
} from '../../src/shared/sidebar-tree';

const agent = (id: string, title: string, kind: Agent['kind'] = 'claude'): Agent => ({ id, kind, title, createdAt: 1 });
const row = (id: string, label: string, current = false, unreadable = false) => ({ id, label, current, unreadable });

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
