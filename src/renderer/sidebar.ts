// sidebar.ts
import { parseAgentTitle, MAX_AGENT_TITLE_CHARS, type AgentKind } from '../shared/agents';
import type { AgentsSnapshot } from '../shared/ipc';
import { pointAnchor, type PopupAnchor } from '../shared/popup-place';
import type { ProjectView } from '../shared/projects';
import {
  AGENTS_SECTION,
  NO_PROJECT_LABEL,
  NO_PROJECT_NODE,
  ROOMS_SECTION,
  initialSidebarTree,
  reduceSidebarTree,
  sameNodes,
  sameSection,
  sidebarNodes,
  sidebarSections,
  type SidebarTreeAction,
  type TreeNode,
  type TreeItem,
  type TreeSection,
} from '../shared/sidebar-tree';
import type { ThemeChoice } from '../shared/theme';
import { ADD_OPTIONS } from './agent-options';
import { el } from './dom';
import { kindIcon } from './icons';
import { hidePopup, showPopup } from './popup';
import { OpenRouterAccount } from './openrouter-account';
import { ProjectTree, type ProjectsApi } from './project-tree';
import { RoomTree, type RoomTreeState } from './room-tree';
import { ThemeSwitch } from './theme-switch';

export interface SidebarHandlers {
  onSelect(id: string): void;
  onRoom(): void;
  onRoomOpen(id: string): void;
  onRoomNew(projectId: string | null): void;
  onRoomRename(id: string, title: string): void;
  onRoomDelete(id: string): void;
  onAdd(kind: AgentKind, projectId?: string): void;
  onClose(id: string): void;
  onRename(id: string, title: string): void;
  onTheme(choice: ThemeChoice): void;
  projects: ProjectsApi;
}

const MENU_INSET = 12;

interface Editing {
  id: string;
  draft: string;
}

export class Sidebar {
  readonly element = el('nav', 'sidebar');
  private readonly rooms: RoomTree;
  private readonly projects: ProjectTree;
  private readonly noProject = el('section', 'no-project');
  private readonly noProjectToggle = el('button', 'project-toggle');
  private readonly noProjectBody = el('div', 'no-project-body');
  private readonly theme: ThemeSwitch;
  private readonly account = new OpenRouterAccount();
  private readonly list = el('ul', 'agent-list project-section-list');
  private readonly notice = el('p', 'sidebar-notice');
  private readonly agentsSection = el('div', 'project-section');
  private readonly agentsBody = el('div', 'project-section-body');
  private readonly agentsToggle = el('button', 'project-section-toggle');
  private readonly header = el('div', 'project-section-head');
  private readonly menu = el('div', 'add-menu');
  private readonly addButton = el('button', 'add-button project-agent-add', '+');
  private readonly contextMenu = el('div', 'context-menu');
  private readonly renameItem = el('button', 'context-item', 'Rename');
  private readonly contextItem = el('button', 'context-item', 'Close agent');
  private readonly confirm = el('div', 'close-confirm');
  private readonly confirmText = el('span', 'close-confirm-text');
  private readonly confirmYes = el('button', 'confirm-yes', 'Close agent');
  private readonly confirmNo = el('button', 'confirm-no', 'Cancel');
  private tree = initialSidebarTree();
  private roomsView: TreeSection = this.section(ROOMS_SECTION);
  private projectNodes: readonly TreeNode[] = [];
  private pendingId: string | null = null;
  private contextId: string | null = null;
  private menuOpen = false;
  private editing: Editing | null = null;
  private rebuilding = false;
  private revealedId: string | null = null;

  constructor(private readonly handlers: SidebarHandlers) {
    this.rooms = new RoomTree({
      onPane: () => this.handlers.onRoom(),
      onOpen: (id) => this.handlers.onRoomOpen(id),
      onNew: () => this.handlers.onRoomNew(null),
      onRename: (id, title) => this.handlers.onRoomRename(id, title),
      onDelete: (id) => this.handlers.onRoomDelete(id),
      onToggle: () => this.dispatch({ type: 'toggle', key: ROOMS_SECTION }),
    });
    this.projects = new ProjectTree(this.handlers.projects, {
      onList: (projects) => this.setProjects(projects),
      onToggle: (key) => this.dispatch({ type: 'toggle', key }),
      onAddAgent: (kind, projectId) => this.handlers.onAdd(kind, projectId),
      onSelectAgent: (id) => this.handlers.onSelect(id),
      onCloseAgent: (id) => this.handlers.onClose(id),
      onOpenRoom: (id) => this.handlers.onRoomOpen(id),
      onNewRoom: (projectId) => this.handlers.onRoomNew(projectId),
      onDeleteRoom: (id) => this.handlers.onRoomDelete(id),
    });
    this.theme = new ThemeSwitch((choice) => this.handlers.onTheme(choice));
    this.setupNoProject();
    this.agentsSection.dataset['projectSection'] = 'agents';
    this.agentsToggle.type = 'button';
    this.agentsToggle.setAttribute('aria-label', 'Agents');
    this.agentsToggle.setAttribute('aria-expanded', 'true');
    this.agentsToggle.addEventListener('click', () => this.dispatch({ type: 'toggle', key: AGENTS_SECTION }));
    this.header.append(this.agentsToggle, el('span', 'project-section-title', 'Agents'), this.addButton);
    this.addButton.type = 'button';
    this.addButton.title = 'Add agent';
    this.addButton.setAttribute('aria-haspopup', 'menu');
    this.addButton.setAttribute('aria-expanded', 'false');
    this.menu.hidden = true;
    this.notice.hidden = true;
    this.notice.dataset['sidebar'] = 'notice';
    this.notice.setAttribute('role', 'status');
    this.menu.setAttribute('role', 'menu');
    for (const option of ADD_OPTIONS) this.menu.append(this.menuItem(option.kind, option.label));
    this.setupClose();
    this.agentsBody.append(this.notice, this.menu, this.list, this.confirm);
    this.agentsSection.append(this.header, this.agentsBody);
    this.noProjectBody.append(this.rooms.element, this.agentsSection);
    this.element.append(this.projects.element, this.noProject, this.contextMenu, this.account.element, this.theme.element);
    this.addButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.setMenuOpen(!this.menuOpen);
    });
    document.addEventListener('click', () => {
      this.setMenuOpen(false);
      this.hideContextMenu();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      this.setMenuOpen(false);
      this.hideContextMenu();
      this.setPending(null);
    });
  }

  showNotice(text: string, projectId?: string): void {
    if (projectId !== undefined) {
      this.projects.notify(text);
      return;
    }
    this.notice.textContent = text;
    this.notice.hidden = text === '';
  }

  setTheme(choice: ThemeChoice): void {
    this.theme.setChoice(choice);
  }

  refreshProjects(): void {
    this.projects.refresh();
  }

  setProjects(projects: readonly ProjectView[]): void {
    this.dispatch({ type: 'projects', projects });
  }

  setRooms(state: RoomTreeState): void {
    this.dispatch({ type: 'rooms', rows: state.rows, busy: state.busy });
  }

  render(snapshot: AgentsSnapshot): void {
    this.dispatch({ type: 'agents', agents: snapshot.agents, selectedId: snapshot.selectedId, roomOpen: snapshot.roomOpen });
    const items = this.section(AGENTS_SECTION).items;
    if (this.pendingId !== null && !items.some((agent) => agent.id === this.pendingId)) this.setPending(null);
    if (this.editing !== null && !items.some((agent) => agent.id === this.editing?.id)) this.editing = null;
    this.renderAgents();
  }

  private dispatch(action: SidebarTreeAction): void {
    this.tree = reduceSidebarTree(this.tree, action);
    const nodes = sidebarNodes(this.tree);
    const projects = nodes.filter((node) => node.projectId !== null);
    if (!sameNodes(projects, this.projectNodes)) {
      this.projectNodes = projects;
      this.projects.setNodes(projects);
    }
    const expanded = nodes.find((node) => node.key === NO_PROJECT_NODE)?.expanded ?? true;
    this.noProjectBody.hidden = !expanded;
    this.noProjectToggle.setAttribute('aria-expanded', String(expanded));
    const agentsExpanded = this.section(AGENTS_SECTION).expanded;
    this.agentsBody.hidden = !agentsExpanded;
    this.agentsToggle.setAttribute('aria-expanded', String(agentsExpanded));
    const rooms = this.section(ROOMS_SECTION);
    if (sameSection(rooms, this.roomsView)) return;
    this.roomsView = rooms;
    this.rooms.setSection(rooms);
  }

  private setupNoProject(): void {
    this.noProject.dataset['project'] = 'no-project';
    this.noProjectToggle.type = 'button';
    this.noProjectToggle.dataset['project'] = 'no-project-toggle';
    this.noProjectToggle.setAttribute('aria-label', `Collapse ${NO_PROJECT_LABEL}`);
    this.noProjectToggle.setAttribute('aria-expanded', 'true');
    this.noProjectToggle.addEventListener('click', () => this.dispatch({ type: 'toggle', key: NO_PROJECT_NODE }));
    const name = el('button', 'project-name', NO_PROJECT_LABEL);
    name.type = 'button';
    name.addEventListener('click', () => this.dispatch({ type: 'toggle', key: NO_PROJECT_NODE }));
    const row = el('div', 'project-row');
    row.append(this.noProjectToggle, name);
    this.noProject.append(row, this.noProjectBody);
  }

  private section(key: string): TreeSection {
    const found = sidebarSections(this.tree).find((item) => item.key === key);
    if (found === undefined) throw new Error(`no sidebar section ${key}`);
    return found;
  }

  private agentItems(): readonly TreeItem[] {
    return this.section(AGENTS_SECTION).items;
  }

  private renderAgents(): void {
    const agents = this.agentItems();
    this.rebuilding = true;
    this.list.replaceChildren();
    if (agents.length === 0) {
      this.list.append(el('li', 'agent-empty', 'No agents yet. Use + to add one.'));
    }
    for (const agent of agents) {
      const kind = agent.kind;
      if (kind === null) continue;
      const item = el('li');
      if (this.editing?.id === agent.id) {
        item.append(kindIcon(kind), this.input(this.editing));
        item.classList.add('agent-editing');
        this.list.append(item);
        continue;
      }
      const button = el('button', 'agent-item');
      button.type = 'button';
      button.dataset['agentId'] = agent.id;
      button.title = agent.label;
      if (agent.selected) button.classList.add('selected');
      button.append(kindIcon(kind), el('span', 'agent-title', agent.label));
      button.addEventListener('click', () => this.handlers.onSelect(agent.id));
      button.addEventListener('keydown', (event) => {
        if (event.key !== 'F2') return;
        event.preventDefault();
        this.startRename(agent.id);
      });
      const close = el('button', 'agent-close', '×');
      close.type = 'button';
      close.title = 'Close agent';
      close.setAttribute('aria-label', `Close ${agent.label}`);
      close.addEventListener('click', (event) => {
        event.stopPropagation();
        this.setPending(agent.id);
      });
      item.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        this.showContextMenu(agent.id, event.clientX, event.clientY);
      });
      item.append(button, close);
      this.list.append(item);
    }
    this.rebuilding = false;
    if (this.editing !== null) this.focusInput(false);
    this.revealSelected();
  }

  private revealSelected(): void {
    const selected = this.list.querySelector<HTMLElement>('.agent-item.selected');
    const id = selected?.dataset['agentId'] ?? null;
    if (id !== null && id !== this.revealedId) selected?.scrollIntoView({ block: 'nearest' });
    this.revealedId = id;
  }

  private input(editing: Editing): HTMLInputElement {
    const input = el('input', 'agent-rename');
    input.type = 'text';
    input.maxLength = MAX_AGENT_TITLE_CHARS;
    input.value = editing.draft;
    input.dataset['agent'] = 'rename-input';
    input.setAttribute('aria-label', 'Agent title');
    input.addEventListener('input', () => {
      editing.draft = input.value;
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.finishRename(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.finishRename(false);
      }
    });
    input.addEventListener('blur', () => {
      if (!this.rebuilding && this.editing === editing) this.finishRename(false);
    });
    return input;
  }

  private startRename(id: string): void {
    const agent = this.agentItems().find((item) => item.id === id);
    if (agent === undefined) return;
    this.editing = { id, draft: agent.label };
    this.renderAgents();
    this.focusInput(true);
  }

  private finishRename(commit: boolean): void {
    const editing = this.editing;
    if (editing === null) return;
    this.editing = null;
    const agent = this.agentItems().find((item) => item.id === editing.id);
    const next = commit && agent !== undefined ? parseAgentTitle(editing.draft) : null;
    this.renderAgents();
    this.focusItem(editing.id);
    if (next !== null && agent !== undefined && next !== agent.label) this.handlers.onRename(editing.id, next);
  }

  private focusInput(selectAll: boolean): void {
    const input = this.list.querySelector<HTMLInputElement>('.agent-rename');
    if (input === null || document.activeElement === input) return;
    input.focus();
    if (selectAll) input.select();
  }

  private focusItem(id: string): void {
    for (const button of this.list.querySelectorAll<HTMLButtonElement>('.agent-item')) {
      if (button.dataset['agentId'] === id) button.focus();
    }
  }

  private setupClose(): void {
    this.contextMenu.hidden = true;
    this.contextMenu.setAttribute('role', 'menu');
    this.contextItem.type = 'button';
    this.contextItem.setAttribute('role', 'menuitem');
    this.renameItem.type = 'button';
    this.renameItem.setAttribute('role', 'menuitem');
    this.renameItem.dataset['agent'] = 'rename';
    this.contextItem.dataset['agent'] = 'close';
    this.contextMenu.append(this.renameItem, this.contextItem);
    this.renameItem.addEventListener('click', () => {
      const id = this.contextId;
      this.hideContextMenu();
      if (id !== null) this.startRename(id);
    });
    this.contextItem.addEventListener('click', () => {
      const id = this.contextId;
      this.hideContextMenu();
      if (id !== null) this.setPending(id);
    });
    this.confirm.hidden = true;
    this.confirm.setAttribute('role', 'alertdialog');
    this.confirmYes.type = 'button';
    this.confirmNo.type = 'button';
    this.confirm.append(this.confirmText, this.confirmYes, this.confirmNo);
    this.confirmYes.addEventListener('click', () => {
      const id = this.pendingId;
      this.setPending(null);
      if (id !== null) this.handlers.onClose(id);
    });
    this.confirmNo.addEventListener('click', () => this.setPending(null));
  }

  private setPending(id: string | null): void {
    this.pendingId = id;
    const agent = this.agentItems().find((item) => item.id === id);
    this.confirm.hidden = agent === undefined;
    this.confirmText.textContent = agent === undefined ? '' : `Close ${agent.label}? Its session files stay on disk.`;
  }

  private showContextMenu(id: string, x: number, y: number): void {
    this.contextId = id;
    showPopup(this.contextMenu, () => pointAnchor(x, y));
  }

  private hideContextMenu(): void {
    this.contextId = null;
    hidePopup(this.contextMenu);
  }

  private menuItem(kind: AgentKind, label: string): HTMLButtonElement {
    const button = el('button', 'menu-item');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.dataset['kind'] = kind;
    button.append(kindIcon(kind), el('span', undefined, label));
    button.addEventListener('click', () => {
      this.setMenuOpen(false);
      this.handlers.onAdd(kind);
    });
    return button;
  }

  private menuAnchor(): PopupAnchor {
    const box = this.header.getBoundingClientRect();
    return { left: box.left + MENU_INSET, top: box.top, right: box.right - MENU_INSET, bottom: box.bottom };
  }

  private setMenuOpen(open: boolean): void {
    this.menuOpen = open;
    if (open) showPopup(this.menu, () => this.menuAnchor(), () => this.header.getBoundingClientRect().width - 2 * MENU_INSET);
    else hidePopup(this.menu);
    this.addButton.setAttribute('aria-expanded', String(open));
  }
}
