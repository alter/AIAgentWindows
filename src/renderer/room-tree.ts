// room-tree.ts
import { pointAnchor } from '../shared/popup-place';
import { renameTitle, type RoomTreeRow } from '../shared/room-view';
import { ROOMS_SECTION, type TreeItem, type TreeSection } from '../shared/sidebar-tree';
import { el } from './dom';
import { hidePopup, showPopup } from './popup';

export interface RoomTreeHandlers {
  onPane(): void;
  onOpen(id: string): void;
  onNew(): void;
  onToggle(): void;
  onRename(id: string, title: string): void;
  onDelete(id: string): void;
}

export interface RoomTreeState {
  rows: readonly RoomTreeRow[];
  busy: boolean;
}

interface Editing {
  id: string;
  draft: string;
}

const MAX_TITLE_LENGTH = 80;

export class RoomTree {
  readonly element = el('section', 'rooms project-section');
  private readonly toggle = el('button', 'rooms-toggle project-section-toggle');
  private readonly title = el('button', 'rooms-title project-section-title', '# Rooms');
  private readonly add = el('button', 'rooms-add project-agent-add', '+');
  private readonly list = el('ul', 'rooms-list project-section-list');
  private readonly menu = el('div', 'rooms-menu');
  private readonly renameItem = el('button', 'rooms-menu-item', 'Rename');
  private readonly deleteItem = el('button', 'rooms-menu-item', 'Delete');
  private readonly confirm = el('div', 'rooms-confirm');
  private readonly confirmText = el('span', 'rooms-confirm-text');
  private readonly confirmYes = el('button', 'rooms-confirm-yes', 'Delete');
  private readonly confirmNo = el('button', 'rooms-confirm-no', 'Cancel');
  private section: TreeSection = { key: ROOMS_SECTION, collapsible: true, expanded: true, busy: false, items: [] };
  private menuId: string | null = null;
  private pendingId: string | null = null;
  private editing: Editing | null = null;
  private rebuilding = false;

  constructor(private readonly handlers: RoomTreeHandlers) {
    this.element.dataset['room'] = 'tree';
    this.element.dataset['projectSection'] = 'rooms';
    this.toggle.type = 'button';
    this.toggle.dataset['room'] = 'tree-toggle';
    this.toggle.setAttribute('aria-label', 'Rooms');
    this.toggle.setAttribute('aria-controls', 'rooms-list');
    this.toggle.addEventListener('click', () => {
      this.hideMenu();
      this.handlers.onToggle();
    });
    this.title.type = 'button';
    this.title.dataset['room'] = 'open';
    this.title.addEventListener('click', () => this.handlers.onPane());
    this.add.type = 'button';
    this.add.dataset['room'] = 'new';
    this.add.title = 'New room';
    this.add.setAttribute('aria-label', 'New room');
    this.add.addEventListener('click', () => this.handlers.onNew());
    this.list.id = 'rooms-list';
    const header = el('div', 'rooms-header project-section-head');
    header.append(this.toggle, this.title, this.add);
    this.menu.hidden = true;
    this.menu.setAttribute('role', 'menu');
    this.renameItem.type = 'button';
    this.renameItem.dataset['room'] = 'rename';
    this.renameItem.setAttribute('role', 'menuitem');
    this.renameItem.addEventListener('click', () => {
      const id = this.menuId;
      this.hideMenu();
      if (id !== null) this.startRename(id);
    });
    this.deleteItem.type = 'button';
    this.deleteItem.dataset['room'] = 'delete';
    this.deleteItem.setAttribute('role', 'menuitem');
    this.deleteItem.addEventListener('click', () => {
      const id = this.menuId;
      this.hideMenu();
      if (id !== null) this.askDelete(id);
    });
    this.menu.append(this.renameItem, this.deleteItem);
    this.confirm.hidden = true;
    this.confirm.dataset['room'] = 'delete-confirm';
    this.confirm.setAttribute('role', 'alertdialog');
    this.confirmYes.type = 'button';
    this.confirmYes.dataset['room'] = 'delete-yes';
    this.confirmNo.type = 'button';
    this.confirmNo.dataset['room'] = 'delete-no';
    this.confirm.append(this.confirmText, this.confirmYes, this.confirmNo);
    this.confirmYes.addEventListener('click', () => {
      const id = this.pendingId;
      this.setPending(null);
      if (id !== null) this.handlers.onDelete(id);
    });
    this.confirmNo.addEventListener('click', () => this.cancelDelete());
    this.element.append(header, this.list, this.confirm, this.menu);
    document.addEventListener('click', () => this.hideMenu());
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (this.pendingId !== null) {
        this.cancelDelete();
      } else if (this.menuId !== null) {
        const id = this.menuId;
        this.hideMenu();
        this.focusItem(id);
      }
    });
    this.render();
  }

  setSection(section: TreeSection): void {
    this.section = section;
    this.render();
  }

  private render(): void {
    this.toggle.setAttribute('aria-expanded', String(this.section.expanded));
    this.add.disabled = this.section.busy;
    this.list.hidden = !this.section.expanded;
    if (this.pendingId !== null && (this.section.busy || !this.section.items.some((row) => row.id === this.pendingId))) this.setPending(null);
    if (!this.section.expanded) {
      this.editing = null;
      this.list.replaceChildren();
      return;
    }
    if (this.editing !== null && !this.section.items.some((row) => row.id === this.editing?.id)) this.editing = null;
    if (this.section.items.length === 0) {
      this.list.replaceChildren(el('li', 'rooms-empty', 'No saved rooms yet.'));
      return;
    }
    this.rebuilding = true;
    this.list.replaceChildren(...this.section.items.map((row) => this.item(row)));
    this.rebuilding = false;
    if (this.editing !== null) this.focusInput(false);
  }

  private item(row: TreeItem): HTMLLIElement {
    const item = el('li');
    if (this.editing?.id === row.id) {
      item.append(this.input(this.editing));
      return item;
    }
    const button = el('button', 'rooms-item');
    button.type = 'button';
    button.dataset['roomId'] = row.id;
    button.title = row.label;
    button.disabled = row.unreadable;
    button.append(el('span', 'rooms-item-label', row.label));
    button.classList.toggle('selected', row.selected);
    if (row.selected) button.setAttribute('aria-current', 'true');
    if (row.blocked) button.setAttribute('aria-disabled', 'true');
    button.addEventListener('click', () => {
      if (!row.blocked) this.handlers.onOpen(row.id);
    });
    button.addEventListener('keydown', (event) => {
      if (event.key === 'F2' && !row.unreadable) {
        event.preventDefault();
        this.startRename(row.id);
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && !row.unreadable) {
        event.preventDefault();
        this.askDelete(row.id);
      }
    });
    if (!row.unreadable) {
      item.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        const box = button.getBoundingClientRect();
        const keyboard = event.clientX === 0 && event.clientY === 0;
        this.showMenu(row.id, keyboard ? box.left : event.clientX, keyboard ? box.bottom : event.clientY);
      });
    }
    item.append(button);
    return item;
  }

  private input(editing: Editing): HTMLInputElement {
    const input = el('input', 'rooms-rename');
    input.type = 'text';
    input.maxLength = MAX_TITLE_LENGTH;
    input.value = editing.draft;
    input.dataset['room'] = 'rename-input';
    input.setAttribute('aria-label', 'Room title');
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
    const row = this.section.items.find((item) => item.id === id);
    if (row === undefined || row.unreadable) return;
    this.editing = { id, draft: row.label };
    this.render();
    this.focusInput(true);
  }

  private finishRename(commit: boolean): void {
    const editing = this.editing;
    if (editing === null) return;
    this.editing = null;
    const row = this.section.items.find((item) => item.id === editing.id);
    const next = commit && row !== undefined ? renameTitle(row.label, editing.draft) : null;
    this.render();
    this.focusItem(editing.id);
    if (next !== null) this.handlers.onRename(editing.id, next);
  }

  private focusInput(selectAll: boolean): void {
    const input = this.list.querySelector<HTMLInputElement>('.rooms-rename');
    if (input === null || document.activeElement === input) return;
    input.focus();
    if (selectAll) input.select();
  }

  private focusItem(id: string): void {
    for (const button of this.list.querySelectorAll<HTMLButtonElement>('.rooms-item')) {
      if (button.dataset['roomId'] === id) button.focus();
    }
  }

  private askDelete(id: string): void {
    const row = this.section.items.find((item) => item.id === id);
    if (row === undefined || row.unreadable || this.section.busy) return;
    this.hideMenu();
    this.setPending(id);
    this.confirmNo.focus();
  }

  private cancelDelete(): void {
    const id = this.pendingId;
    this.setPending(null);
    if (id !== null) this.focusItem(id);
  }

  private setPending(id: string | null): void {
    this.pendingId = id;
    const row = this.section.items.find((item) => item.id === id);
    this.confirm.hidden = row === undefined;
    this.confirmText.textContent = row === undefined ? '' : `Delete ${row.label}? It moves to the Trash.`;
  }

  private showMenu(id: string, x: number, y: number): void {
    this.menuId = id;
    this.deleteItem.disabled = this.section.busy;
    showPopup(this.menu, () => pointAnchor(x, y));
    this.renameItem.focus();
  }

  private hideMenu(): void {
    this.menuId = null;
    hidePopup(this.menu);
  }
}
