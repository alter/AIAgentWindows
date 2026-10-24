// sidebar-tree.ts
import type { Agent, AgentKind } from './agents';
import type { ProjectView } from './projects';
import type { RoomTreeRow } from './room-view';

export const ROOMS_SECTION = 'rooms';
export const AGENTS_SECTION = 'agents';

export const NO_PROJECT_NODE = 'no-project';
export const NO_PROJECT_LABEL = 'No project';

const PROJECT_SECTIONS = ['rooms', 'agents'] as const;
type ProjectSectionName = (typeof PROJECT_SECTIONS)[number];

export function projectNodeKey(id: string): string {
  return `project:${id}`;
}

export function projectSectionKey(id: string, section: ProjectSectionName): string {
  return `project:${id}:${section}`;
}

function collapsibleKey(state: SidebarTreeState, key: string): boolean {
  if (key === ROOMS_SECTION || key === NO_PROJECT_NODE) return true;
  const [prefix, id, section, extra] = key.split(':');
  if (prefix !== 'project' || id === undefined || extra !== undefined) return false;
  if (!state.projects.some((project) => project.id === id)) return false;
  return section === undefined || (PROJECT_SECTIONS as readonly string[]).includes(section);
}

export interface SidebarTreeState {
  rooms: readonly RoomTreeRow[];
  busy: boolean;
  agents: readonly Agent[];
  selectedId: string | null;
  roomOpen: boolean;
  collapsed: readonly string[];
  projects: readonly ProjectView[];
}

export type SidebarTreeAction =
  | { type: 'projects'; projects: readonly ProjectView[] }
  | { type: 'rooms'; rows: readonly RoomTreeRow[]; busy: boolean }
  | { type: 'agents'; agents: readonly Agent[]; selectedId: string | null; roomOpen: boolean }
  | { type: 'toggle'; key: string };

export interface TreeNode {
  key: string;
  projectId: string | null;
  label: string;
  folder: string | null;
  missing: boolean;
  collapsible: boolean;
  expanded: boolean;
  sections: readonly TreeSection[];
}

export interface TreeItem {
  id: string;
  label: string;
  kind: AgentKind | null;
  unreadable: boolean;
  selected: boolean;
  blocked: boolean;
}

export interface TreeSection {
  key: string;
  collapsible: boolean;
  expanded: boolean;
  busy: boolean;
  items: readonly TreeItem[];
}

export function initialSidebarTree(): SidebarTreeState {
  return { rooms: [], busy: false, agents: [], selectedId: null, roomOpen: false, collapsed: [], projects: [] };
}

export function reduceSidebarTree(state: SidebarTreeState, action: SidebarTreeAction): SidebarTreeState {
  switch (action.type) {
    case 'rooms':
      return { ...state, rooms: action.rows, busy: action.busy };
    case 'agents':
      return { ...state, agents: action.agents, selectedId: action.selectedId, roomOpen: action.roomOpen };
    case 'projects': {
      const live = new Set(action.projects.map((project) => project.id));
      const collapsed = state.collapsed.filter((key) => {
        const [prefix, id] = key.split(':');
        return prefix !== 'project' || (id !== undefined && live.has(id));
      });
      return { ...state, projects: action.projects, collapsed };
    }
    case 'toggle': {
      if (!collapsibleKey(state, action.key)) return state;
      const collapsed = state.collapsed.includes(action.key)
        ? state.collapsed.filter((key) => key !== action.key)
        : [...state.collapsed, action.key];
      return { ...state, collapsed };
    }
  }
}

function agentItems(state: SidebarTreeState, owned: (agent: Agent) => boolean): TreeItem[] {
  return state.agents.filter(owned).map((agent) => ({
    id: agent.id,
    label: agent.title,
    kind: agent.kind,
    unreadable: false,
    selected: !state.roomOpen && agent.id === state.selectedId,
    blocked: false,
  }));
}

function roomItems(state: SidebarTreeState, owned: (row: RoomTreeRow) => boolean): TreeItem[] {
  return state.rooms.filter(owned).map((row) => ({
    id: row.id,
    label: row.label,
    kind: null,
    unreadable: row.unreadable,
    selected: row.current && state.roomOpen,
    blocked: state.busy && !row.current,
  }));
}

export function sidebarSections(state: SidebarTreeState): TreeSection[] {
  return [
    {
      key: ROOMS_SECTION,
      collapsible: true,
      expanded: !state.collapsed.includes(ROOMS_SECTION),
      busy: state.busy,
      items: roomItems(state, (row) => row.projectId === null),
    },
    {
      key: AGENTS_SECTION,
      collapsible: false,
      expanded: true,
      busy: false,
      items: agentItems(state, (agent) => agent.projectId === undefined),
    },
  ];
}

function projectNode(state: SidebarTreeState, project: ProjectView): TreeNode {
  const key = projectNodeKey(project.id);
  const sections: TreeSection[] = project.missing
    ? []
    : PROJECT_SECTIONS.map((name) => ({
        key: projectSectionKey(project.id, name),
        collapsible: true,
        expanded: !state.collapsed.includes(projectSectionKey(project.id, name)),
        busy: name === ROOMS_SECTION && state.busy,
        items: name === AGENTS_SECTION ? agentItems(state, (agent) => agent.projectId === project.id) : roomItems(state, (row) => row.projectId === project.id),
      }));
  return {
    key,
    projectId: project.id,
    label: project.name,
    folder: project.folder,
    missing: project.missing,
    collapsible: true,
    expanded: !state.collapsed.includes(key),
    sections,
  };
}

export function sidebarNodes(state: SidebarTreeState): TreeNode[] {
  const noProject: TreeNode = {
    key: NO_PROJECT_NODE,
    projectId: null,
    label: NO_PROJECT_LABEL,
    folder: null,
    missing: false,
    collapsible: true,
    expanded: !state.collapsed.includes(NO_PROJECT_NODE),
    sections: sidebarSections(state),
  };
  return [...state.projects.map((project) => projectNode(state, project)), noProject];
}

export function sameNodes(a: readonly TreeNode[], b: readonly TreeNode[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function sameSection(a: TreeSection, b: TreeSection): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
