// sidebar.ts
import { parseAgentTitle, MAX_AGENT_TITLE_CHARS, type Agent, type AgentKind } from '../shared/agents';
import type { AgentsSnapshot } from '../shared/ipc';
import type { ThemeChoice } from '../shared/theme';
import { el } from './dom';
import { kindIcon } from './icons';
import { RoomTree, type RoomTreeState } from './room-tree';
import { ThemeSwitch } from './theme-switch';

export interface SidebarHandlers {
  onSelect(id: string): void;
  onRoom(): void;
  onRoomOpen(id: string): void;
  onRoomNew(): void;
  onRoomRename(id: string, title: string): void;
  onRoomDelete(id: string): void;
  onAdd(kind: AgentKind): void;
  onClose(id: string): void;
  onRename(id: string, title: string): void;
  onTheme(choice: ThemeChoice): void;
}

const ADD_OPTIONS: readonly { kind: AgentKind; label: string }[] = [
  { kind: 'claude', label: 'Claude Code' },
  { kind: 'codex', label: 'Codex' },
  { kind: 'chatgpt', label: 'ChatGPT' },
  { kind: 'grok', label: 'Grok' },
  { kind: 'deepseek', label: 'DeepSeek' },
];

interface Editing {
  id: string;
  draft: string;
}

export class Sidebar {
  readonly element = el('nav', 'sidebar');
  private readonly rooms: RoomTree;
  private readonly theme: ThemeSwitch;
  private readonly list = el('ul', 'agent-list');
  private readonly menu = el('div', 'add-menu');
  private readonly addButton = el('button', 'add-button', '+');
  private readonly contextMenu = el('div', 'context-menu');
  private readonly renameItem = el('button', 'context-item', 'Rename');
  private readonly contextItem = el('button', 'context-item', 'Close agent');
  private readonly confirm = el('div', 'close-confirm');
  private readonly confirmText = el('span', 'close-confirm-text');
  private readonly confirmYes = el('button', 'confirm-yes', 'Close agent');
  private readonly confirmNo = el('button', 'confirm-no', 'Cancel');
  private agents: Agent[] = [];
  private snapshot: AgentsSnapshot = { agents: [], selectedId: null, roomOpen: false };
  private pendingId: string | null = null;
  private contextId: string | null = null;
  private menuOpen = false;
  private editing: Editing | null = null;
  private rebuilding = false;

  constructor(private readonly handlers: SidebarHandlers) {
    this.rooms = new RoomTree({
      onPane: () => this.handlers.onRoom(),
      onOpen: (id) => this.handlers.onRoomOpen(id),
      onNew: () => this.handlers.onRoomNew(),
      onRename: (id, title) => this.handlers.onRoomRename(id, title),
      onDelete: (id) => this.handlers.onRoomDelete(id),
    });
    this.theme = new ThemeSwitch((choice) => this.handlers.onTheme(choice));
    const header = el('div', 'sidebar-header');
    header.append(el('span', 'sidebar-title', 'Agents'), this.addButton);
    this.addButton.type = 'button';
    this.addButton.title = 'Add agent';
    this.addButton.setAttribute('aria-haspopup', 'menu');
    this.addButton.setAttribute('aria-expanded', 'false');
    this.menu.hidden = true;
    this.menu.setAttribute('role', 'menu');
    for (const option of ADD_OPTIONS) this.menu.append(this.menuItem(option.kind, option.label));
    this.setupClose();
    this.element.append(this.rooms.element, header, this.menu, this.list, this.confirm, this.contextMenu, this.theme.element);
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

  setTheme(choice: ThemeChoice): void {
    this.theme.setChoice(choice);
  }

  setRooms(state: RoomTreeState): void {
    this.rooms.setState(state);
  }

  render(snapshot: AgentsSnapshot): void {
    this.agents = snapshot.agents;
    this.snapshot = snapshot;
    this.rooms.setPaneOpen(snapshot.roomOpen);
    if (this.pendingId !== null && !snapshot.agents.some((agent) => agent.id === this.pendingId)) this.setPending(null);
    if (this.editing !== null && !snapshot.agents.some((agent) => agent.id === this.editing?.id)) this.editing = null;
    this.rebuilding = true;
    this.list.replaceChildren();
    if (snapshot.agents.length === 0) {
      this.list.append(el('li', 'agent-empty', 'No agents yet. Use + to add one.'));
    }
    for (const agent of snapshot.agents) {
      const item = el('li');
      if (this.editing?.id === agent.id) {
        item.append(kindIcon(agent.kind), this.input(this.editing));
        item.classList.add('agent-editing');
        this.list.append(item);
        continue;
      }
      const button = el('button', 'agent-item');
      button.type = 'button';
      button.dataset['agentId'] = agent.id;
      button.title = agent.title;
      if (!snapshot.roomOpen && agent.id === snapshot.selectedId) button.classList.add('selected');
      button.append(kindIcon(agent.kind), el('span', 'agent-title', agent.title));
      button.addEventListener('click', () => this.handlers.onSelect(agent.id));
      button.addEventListener('keydown', (event) => {
        if (event.key !== 'F2') return;
        event.preventDefault();
        this.startRename(agent.id);
      });
      const close = el('button', 'agent-close', '×');
      close.type = 'button';
      close.title = 'Close agent';
      close.setAttribute('aria-label', `Close ${agent.title}`);
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
    const agent = this.agents.find((item) => item.id === id);
    if (agent === undefined) return;
    this.editing = { id, draft: agent.title };
    this.render(this.snapshot);
    this.focusInput(true);
  }

  private finishRename(commit: boolean): void {
    const editing = this.editing;
    if (editing === null) return;
    this.editing = null;
    const agent = this.agents.find((item) => item.id === editing.id);
    const next = commit && agent !== undefined ? parseAgentTitle(editing.draft) : null;
    this.render(this.snapshot);
    this.focusItem(editing.id);
    if (next !== null && agent !== undefined && next !== agent.title) this.handlers.onRename(editing.id, next);
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
    const agent = this.agents.find((item) => item.id === id);
    this.confirm.hidden = agent === undefined;
    this.confirmText.textContent = agent === undefined ? '' : `Close ${agent.title}? Its session files stay on disk.`;
  }

  private showContextMenu(id: string, x: number, y: number): void {
    this.contextId = id;
    this.contextMenu.style.left = `${x}px`;
    this.contextMenu.style.top = `${y}px`;
    this.contextMenu.hidden = false;
  }

  private hideContextMenu(): void {
    this.contextId = null;
    this.contextMenu.hidden = true;
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

  private setMenuOpen(open: boolean): void {
    this.menuOpen = open;
    this.menu.hidden = !open;
    this.addButton.setAttribute('aria-expanded', String(open));
  }
}
