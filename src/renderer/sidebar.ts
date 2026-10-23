// sidebar.ts
import type { Agent, AgentKind } from '../shared/agents';
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
  onAdd(kind: AgentKind): void;
  onClose(id: string): void;
  onTheme(choice: ThemeChoice): void;
}

const ADD_OPTIONS: readonly { kind: AgentKind; label: string }[] = [
  { kind: 'claude', label: 'Claude Code' },
  { kind: 'codex', label: 'Codex' },
  { kind: 'chatgpt', label: 'ChatGPT' },
  { kind: 'grok', label: 'Grok' },
  { kind: 'deepseek', label: 'DeepSeek' },
];

export class Sidebar {
  readonly element = el('nav', 'sidebar');
  private readonly rooms: RoomTree;
  private readonly theme: ThemeSwitch;
  private readonly list = el('ul', 'agent-list');
  private readonly menu = el('div', 'add-menu');
  private readonly addButton = el('button', 'add-button', '+');
  private readonly contextMenu = el('div', 'context-menu');
  private readonly contextItem = el('button', 'context-item', 'Close agent');
  private readonly confirm = el('div', 'close-confirm');
  private readonly confirmText = el('span', 'close-confirm-text');
  private readonly confirmYes = el('button', 'confirm-yes', 'Close agent');
  private readonly confirmNo = el('button', 'confirm-no', 'Cancel');
  private agents: Agent[] = [];
  private pendingId: string | null = null;
  private contextId: string | null = null;
  private menuOpen = false;

  constructor(private readonly handlers: SidebarHandlers) {
    this.rooms = new RoomTree({
      onPane: () => this.handlers.onRoom(),
      onOpen: (id) => this.handlers.onRoomOpen(id),
      onNew: () => this.handlers.onRoomNew(),
      onRename: (id, title) => this.handlers.onRoomRename(id, title),
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
    this.rooms.setPaneOpen(snapshot.roomOpen);
    if (this.pendingId !== null && !snapshot.agents.some((agent) => agent.id === this.pendingId)) this.setPending(null);
    this.list.replaceChildren();
    if (snapshot.agents.length === 0) {
      this.list.append(el('li', 'agent-empty', 'No agents yet. Use + to add one.'));
      return;
    }
    for (const agent of snapshot.agents) {
      const item = el('li');
      const button = el('button', 'agent-item');
      button.type = 'button';
      button.dataset['agentId'] = agent.id;
      if (!snapshot.roomOpen && agent.id === snapshot.selectedId) button.classList.add('selected');
      button.append(kindIcon(agent.kind), el('span', 'agent-title', agent.title));
      button.addEventListener('click', () => this.handlers.onSelect(agent.id));
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
  }

  private setupClose(): void {
    this.contextMenu.hidden = true;
    this.contextMenu.setAttribute('role', 'menu');
    this.contextItem.type = 'button';
    this.contextItem.setAttribute('role', 'menuitem');
    this.contextMenu.append(this.contextItem);
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
