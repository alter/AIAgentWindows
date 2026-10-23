// sidebar-tree.ts
import type { Agent, AgentKind } from './agents';
import type { RoomTreeRow } from './room-view';

export const ROOMS_SECTION = 'rooms';
export const AGENTS_SECTION = 'agents';

const COLLAPSIBLE: readonly string[] = [ROOMS_SECTION];

export interface SidebarTreeState {
  rooms: readonly RoomTreeRow[];
  busy: boolean;
  agents: readonly Agent[];
  selectedId: string | null;
  roomOpen: boolean;
  collapsed: readonly string[];
}

export type SidebarTreeAction =
  | { type: 'rooms'; rows: readonly RoomTreeRow[]; busy: boolean }
  | { type: 'agents'; agents: readonly Agent[]; selectedId: string | null; roomOpen: boolean }
  | { type: 'toggle'; key: string };

export interface TreeItem {
  id: string;
  label: string;
  kind: AgentKind | null;
  unreadable: boolean;
  selected: boolean;
}

export interface TreeSection {
  key: string;
  collapsible: boolean;
  expanded: boolean;
  busy: boolean;
  items: readonly TreeItem[];
}

export function initialSidebarTree(): SidebarTreeState {
  return { rooms: [], busy: false, agents: [], selectedId: null, roomOpen: false, collapsed: [] };
}

export function reduceSidebarTree(state: SidebarTreeState, action: SidebarTreeAction): SidebarTreeState {
  switch (action.type) {
    case 'rooms':
      return { ...state, rooms: action.rows, busy: action.busy };
    case 'agents':
      return { ...state, agents: action.agents, selectedId: action.selectedId, roomOpen: action.roomOpen };
    case 'toggle': {
      if (!COLLAPSIBLE.includes(action.key)) return state;
      const collapsed = state.collapsed.includes(action.key)
        ? state.collapsed.filter((key) => key !== action.key)
        : [...state.collapsed, action.key];
      return { ...state, collapsed };
    }
  }
}

export function sidebarSections(state: SidebarTreeState): TreeSection[] {
  return [
    {
      key: ROOMS_SECTION,
      collapsible: true,
      expanded: !state.collapsed.includes(ROOMS_SECTION),
      busy: state.busy,
      items: state.rooms.map((row) => ({
        id: row.id,
        label: row.label,
        kind: null,
        unreadable: row.unreadable,
        selected: row.current && state.roomOpen,
      })),
    },
    {
      key: AGENTS_SECTION,
      collapsible: false,
      expanded: true,
      busy: false,
      items: state.agents.map((agent) => ({
        id: agent.id,
        label: agent.title,
        kind: agent.kind,
        unreadable: false,
        selected: !state.roomOpen && agent.id === state.selectedId,
      })),
    },
  ];
}

export function sameSection(a: TreeSection, b: TreeSection): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
