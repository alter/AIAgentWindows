// sidebar.ts
import type { AgentKind } from '../shared/agents';
import type { AgentsSnapshot } from '../shared/ipc';
import { el } from './dom';
import { kindIcon } from './icons';

export interface SidebarHandlers {
  onSelect(id: string): void;
  onAdd(kind: AgentKind): void;
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
  private readonly list = el('ul', 'agent-list');
  private readonly menu = el('div', 'add-menu');
  private readonly addButton = el('button', 'add-button', '+');
  private menuOpen = false;

  constructor(private readonly handlers: SidebarHandlers) {
    const header = el('div', 'sidebar-header');
    header.append(el('span', 'sidebar-title', 'Agents'), this.addButton);
    this.addButton.type = 'button';
    this.addButton.title = 'Add agent';
    this.addButton.setAttribute('aria-haspopup', 'menu');
    this.addButton.setAttribute('aria-expanded', 'false');
    this.menu.hidden = true;
    this.menu.setAttribute('role', 'menu');
    for (const option of ADD_OPTIONS) this.menu.append(this.menuItem(option.kind, option.label));
    this.element.append(header, this.menu, this.list);
    this.addButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.setMenuOpen(!this.menuOpen);
    });
    document.addEventListener('click', () => this.setMenuOpen(false));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.setMenuOpen(false);
    });
  }

  render(snapshot: AgentsSnapshot): void {
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
      if (agent.id === snapshot.selectedId) button.classList.add('selected');
      button.append(kindIcon(agent.kind), el('span', 'agent-title', agent.title));
      button.addEventListener('click', () => this.handlers.onSelect(agent.id));
      item.append(button);
      this.list.append(item);
    }
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
